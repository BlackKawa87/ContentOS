import type { VideoModel as Video } from '../generated/prisma/models.js'
import type { VisualSceneCategory, VisualSceneMotion } from '../generated/prisma/enums.js'
import { prisma } from '../lib/prisma.js'
import { getOpenAiClientForProfile } from '../lib/openai.js'
import { detectSceneCuts, extractFrame } from '../lib/ffmpeg.js'
import { uploadAsset } from '../lib/storage.js'
import { logApiUsage, RATES } from '../lib/apiUsage.js'
import { downloadAsset, getVideoContext } from './common.js'

const CATEGORIES: VisualSceneCategory[] = [
  'ARCHIVAL_PHOTO',
  'PORTRAIT',
  'LANDSCAPE',
  'MAP',
  'DOCUMENT',
  'CHART',
  'SCREENSHOT',
  'ILLUSTRATION',
  'GENERATED_IMAGE',
  'TEXT_CARD',
  'UNKNOWN',
]

const MOTIONS: VisualSceneMotion[] = ['SLOW_ZOOM', 'ZOOM_OUT', 'PAN', 'STATIC', 'CROP', 'UNKNOWN']

/** Caps the number of frames sent to the vision model in one call, both for cost and because
 * viral short-form videos rarely exceed this many hard cuts; long-form sources are subsampled evenly. */
const MAX_SCENES = 40

interface SceneInterval {
  index: number
  startSec: number
  endSec: number
}

function buildIntervals(cuts: number[], durationSec: number): SceneInterval[] {
  const boundaries = [0, ...cuts.filter((c) => c > 0 && c < durationSec).sort((a, b) => a - b), durationSec]
  const intervals: SceneInterval[] = []
  for (let i = 0; i < boundaries.length - 1; i++) {
    if (boundaries[i + 1] - boundaries[i] < 0.1) continue
    intervals.push({ index: intervals.length, startSec: boundaries[i], endSec: boundaries[i + 1] })
  }
  return intervals
}

function subsample(intervals: SceneInterval[], max: number): SceneInterval[] {
  if (intervals.length <= max) return intervals
  const step = intervals.length / max
  const picked: SceneInterval[] = []
  for (let i = 0; i < max; i++) picked.push(intervals[Math.floor(i * step)])
  return picked.map((s, index) => ({ ...s, index }))
}

interface VisionSceneResult {
  index: number
  category: VisualSceneCategory
  motion: VisualSceneMotion
  description?: string
  sceneScore?: number
  confidence?: number
}

/** Module 5: detects hard cuts (deterministic, ffmpeg), extracts a representative frame per scene,
 * then classifies each frame in one batched vision call. */
export async function visualAnalyzedStage(video: Video): Promise<void> {
  const { projectId, profile } = await getVideoContext(video)
  const openai = await getOpenAiClientForProfile(profile.id)

  const videoBuffer = await downloadAsset('VIDEOS', `${profile.id}/${video.id}/source.mp4`)
  const durationSec = video.durationSec ?? 0
  if (durationSec <= 0) {
    await prisma.visualScene.deleteMany({ where: { videoId: video.id } })
    return
  }

  const cuts = await detectSceneCuts(videoBuffer)
  const intervals = subsample(buildIntervals(cuts, durationSec), MAX_SCENES)

  const frames = await Promise.all(
    intervals.map(async (scene) => {
      const midpoint = (scene.startSec + scene.endSec) / 2
      const frameBuffer = await extractFrame(videoBuffer, midpoint)
      const frameStoragePath = await uploadAsset({
        bucket: 'THUMBNAILS',
        ownerId: profile.id,
        projectId,
        videoId: video.id,
        filename: `scene-${scene.index}.jpg`,
        data: frameBuffer,
        contentType: 'image/jpeg',
      })
      return { scene, frameBuffer, frameStoragePath }
    }),
  )

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `You classify representative frames from short-form video scenes for viral-video reverse engineering. category must be one of: ${CATEGORIES.join(', ')}. motion must be your best guess at the camera/image motion applied to this scene, one of: ${MOTIONS.join(', ')}.`,
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Classify each of these ${frames.length} scene frames, in order. Respond with a JSON object { "scenes": [{ "index": number, "category": string, "motion": string, "description": string, "sceneScore": number (0-1, visual engagement), "confidence": number (0-1) }] }.`,
          },
          ...frames.map(
            (f) =>
              ({
                type: 'image_url' as const,
                image_url: { url: `data:image/jpeg;base64,${f.frameBuffer.toString('base64')}` },
              }) as const,
          ),
        ],
      },
    ],
    response_format: { type: 'json_object' },
  })

  const raw = completion.choices[0].message.content ?? '{}'
  const parsed = JSON.parse(raw) as { scenes: VisionSceneResult[] }
  const resultsByIndex = new Map(parsed.scenes.map((s) => [s.index, s]))

  await prisma.visualScene.deleteMany({ where: { videoId: video.id } })
  await prisma.visualScene.createMany({
    data: frames.map(({ scene, frameStoragePath }) => {
      const result = resultsByIndex.get(scene.index)
      return {
        videoId: video.id,
        index: scene.index,
        startSec: scene.startSec,
        endSec: scene.endSec,
        durationSec: scene.endSec - scene.startSec,
        frameStoragePath,
        category: result?.category ?? 'UNKNOWN',
        motion: result?.motion ?? 'UNKNOWN',
        transition: scene.index === 0 ? null : 'cut',
        sceneScore: result?.sceneScore,
        description: result?.description,
        confidence: result?.confidence,
      }
    }),
  })

  const usage = completion.usage
  if (usage) {
    await logApiUsage({
      profileId: profile.id,
      projectId,
      videoId: video.id,
      provider: 'OPENAI',
      unit: 'tokens',
      quantity: usage.total_tokens,
      estimatedCostUsd:
        (usage.prompt_tokens / 1000) * RATES.OPENAI_INPUT_PER_1K_TOKENS +
        (usage.completion_tokens / 1000) * RATES.OPENAI_OUTPUT_PER_1K_TOKENS,
    })
  }
}
