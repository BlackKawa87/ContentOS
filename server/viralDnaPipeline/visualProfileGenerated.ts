import type { VideoModel as Video } from '../generated/prisma/models.js'
import { prisma } from '../lib/prisma.js'
import { getOpenAiClientForProfile } from '../lib/openai.js'
import { logApiUsage, RATES } from '../lib/apiUsage.js'
import { getVideoContext, getWorkingProfile, addEvidence } from './common.js'

const STYLE_CATEGORIES = [
  'archival documentary', 'slideshow documentary', 'historical storytelling', 'news montage',
  'cinematic illustration', 'AI-image narrative', 'map-driven explanation',
  'document-driven investigation', 'portrait-led biography', 'mixed visual essay',
]

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length
}
function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}
function stddev(values: number[]): number {
  if (values.length === 0) return 0
  const m = mean(values)
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)))
}
function distribution<T extends string>(values: T[]): Record<string, number> {
  const dist: Record<string, number> = {}
  for (const v of values) dist[v] = (dist[v] ?? 0) + 1
  return dist
}
function dominant(dist: Record<string, number>): string | null {
  const entries = Object.entries(dist)
  if (entries.length === 0) return null
  return entries.sort((a, b) => b[1] - a[1])[0][0]
}

interface StyleAiDraft {
  representativeStyleSummary?: string
  styleCategory?: string
  possiblyGeneratedImages?: boolean
  confidence?: number
  evidence?: string
}

/** Module 6: visual rhythm/composition stats — almost entirely deterministic code over the
 * VisualScene rows Phase 2 already classified, plus one light text-only AI call (scene
 * descriptions, not frames) for the overall style summary. */
export async function visualProfileGeneratedStage(video: Video): Promise<void> {
  const { projectId, profile: ownerProfile } = await getVideoContext(video)
  const workingProfile = await getWorkingProfile(video.id)
  const openai = await getOpenAiClientForProfile(ownerProfile.id)
  const durationSec = video.durationSec ?? 0
  const durationMin = durationSec / 60

  const [scenes, timelineSegments] = await Promise.all([
    prisma.visualScene.findMany({ where: { videoId: video.id }, orderBy: { index: 'asc' } }),
    prisma.timelineSegment.findMany({ where: { videoId: video.id }, orderBy: { index: 'asc' } }),
  ])

  const durations = scenes.map((s) => s.durationSec)
  const categoryDist = distribution(scenes.map((s) => s.category))
  const motionDist = distribution(scenes.map((s) => s.motion))
  const transitionDist = distribution(scenes.filter((s) => s.transition).map((s) => s.transition!))

  const descriptions = new Map<string, number>()
  for (const s of scenes) {
    if (!s.description) continue
    descriptions.set(s.description, (descriptions.get(s.description) ?? 0) + 1)
  }
  const repeated = [...descriptions.values()].filter((n) => n > 1).reduce((sum, n) => sum + n, 0)
  const imageRepeatRate = scenes.length > 0 ? repeated / scenes.length : 0

  const avgSceneDuration = mean(durations)
  const patternInterruptScenes = scenes.filter((s) => avgSceneDuration > 0 && s.durationSec < avgSceneDuration / 2)

  const sceneBoundaries = scenes.map((s) => s.startSec)
  const segmentBoundaries = timelineSegments.map((s) => s.startSec)
  const syncedScenes = sceneBoundaries.filter((t) => segmentBoundaries.some((b) => Math.abs(t - b) <= 1.5))
  const visualNarrativeSync = scenes.length > 0 ? syncedScenes.length / scenes.length : 0

  const styleText = scenes.map((s) => `[${s.index}] ${s.category}/${s.motion}: ${s.description ?? ''}`).join('\n')
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `You summarize the overall visual style of a short-form video from its per-scene classifications (text only, no images). styleCategory must be one of: ${STYLE_CATEGORIES.join(', ')}. Never assert an image is AI-generated as fact — if the evidence is ambiguous, set possiblyGeneratedImages true with a lower confidence rather than a definitive claim.`,
      },
      {
        role: 'user',
        content: `Summarize this video's visual style from its scene list. Respond with JSON: { "representativeStyleSummary": string, "styleCategory": string, "possiblyGeneratedImages": boolean, "confidence": number (0-1), "evidence": string }.\n\n${styleText}`,
      },
    ],
    response_format: { type: 'json_object' },
  })

  const raw = completion.choices[0].message.content ?? '{}'
  const parsed = JSON.parse(raw) as StyleAiDraft

  const visual = {
    totalScenes: scenes.length,
    averageSceneDuration: avgSceneDuration,
    medianSceneDuration: median(durations),
    minimumSceneDuration: durations.length > 0 ? Math.min(...durations) : 0,
    maximumSceneDuration: durations.length > 0 ? Math.max(...durations) : 0,
    sceneDurationStandardDeviation: stddev(durations),
    sceneChangesPerMinute: durationMin > 0 ? scenes.length / durationMin : 0,
    firstMinuteSceneChanges: scenes.filter((s) => s.startSec < 60).length,
    lastMinuteSceneChanges: scenes.filter((s) => s.startSec >= Math.max(0, durationSec - 60)).length,
    dominantAssetTypes: dominant(categoryDist),
    assetTypeDistribution: categoryDist,
    dominantMotion: dominant(motionDist),
    motionDistribution: motionDist,
    dominantTransition: dominant(transitionDist),
    transitionDistribution: transitionDist,
    textOverlayRate: scenes.length > 0 ? scenes.filter((s) => s.category === 'TEXT_CARD').length / scenes.length : 0,
    imageRepeatRate,
    staticSceneRate: scenes.length > 0 ? scenes.filter((s) => s.motion === 'STATIC').length / scenes.length : 0,
    zoomRate: scenes.length > 0 ? scenes.filter((s) => s.motion === 'SLOW_ZOOM' || s.motion === 'ZOOM_OUT').length / scenes.length : 0,
    panRate: scenes.length > 0 ? scenes.filter((s) => s.motion === 'PAN').length / scenes.length : 0,
    visualRhythmPattern: stddev(durations) > avgSceneDuration * 0.5 ? 'variable' : 'steady',
    visualDensity: durationMin > 0 ? scenes.length / durationMin : 0,
    visualNarrativeSync,
    visualPatternInterruptCount: patternInterruptScenes.length,
    representativeStyleSummary: parsed.representativeStyleSummary,
    styleCategory: parsed.styleCategory,
    possiblyGeneratedImages: parsed.possiblyGeneratedImages ?? false,
    confidence: parsed.confidence ?? 0.5,
    evidence: parsed.evidence,
  }

  await prisma.viralDnaProfile.update({
    where: { id: workingProfile.id },
    data: {
      visual,
      dominantMotion: (dominant(motionDist) as never) ?? undefined,
      dominantTransition: visual.dominantTransition,
    },
  })

  if (parsed.evidence) {
    await addEvidence(workingProfile.id, [
      {
        evidenceId: 'visual.styleCategory',
        sourceType: 'VISUAL_SCENE',
        explanation: `Visual style classified as ${parsed.styleCategory}`,
        transcriptExcerpt: parsed.evidence,
      },
    ])
  }

  const usage = completion.usage
  if (usage) {
    await logApiUsage({
      profileId: ownerProfile.id,
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
