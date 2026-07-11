import type { VideoModel as Video } from '../generated/prisma/models.js'
import type { TimelineSegmentType } from '../generated/prisma/enums.js'
import { prisma } from '../lib/prisma.js'
import { getOpenAiClientForProfile } from '../lib/openai.js'
import { logApiUsage, RATES } from '../lib/apiUsage.js'
import { getVideoContext } from './common.js'

const SEGMENT_TYPES: TimelineSegmentType[] = [
  'HOOK',
  'SETUP',
  'CONTEXT',
  'PROBLEM',
  'OPEN_LOOP',
  'ESCALATION',
  'EVIDENCE',
  'STORY_DEVELOPMENT',
  'TRANSITION',
  'PATTERN_INTERRUPT',
  'REVEAL',
  'PAYOFF',
  'SUMMARY',
  'CTA',
  'OUTRO',
]

interface TimelineSegmentDraft {
  type: TimelineSegmentType
  startSec: number
  endSec: number
  text: string
  purpose?: string
  emotion?: string
  intensity?: number
  confidence?: number
  evidence?: string
}

/** Module 3: splits the timestamped transcript into narrative blocks (hook, setup, reveal, ...). User-editable afterward. */
export async function timelineSegmentedStage(video: Video): Promise<void> {
  const { projectId, profile } = await getVideoContext(video)
  const openai = await getOpenAiClientForProfile(profile.id)

  const transcript = await prisma.videoTranscript.findUniqueOrThrow({
    where: { videoId: video.id },
    include: { segments: { orderBy: { index: 'asc' } } },
  })

  const transcriptText =
    transcript.segments.length > 0
      ? transcript.segments.map((s) => `[${s.startSec.toFixed(1)}-${s.endSec.toFixed(1)}] ${s.text}`).join('\n')
      : transcript.rawText

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `You segment short-form video transcripts into narrative timeline blocks for viral-video reverse engineering. Each block must be one of: ${SEGMENT_TYPES.join(', ')}. Segments must be contiguous, in ascending time order, and cover the full transcript without gaps or overlaps.`,
      },
      {
        role: 'user',
        content: `Segment this timestamped transcript into an ordered sequence of narrative blocks. Respond with a JSON object { "segments": [{ "type": string, "startSec": number, "endSec": number, "text": string, "purpose": string, "emotion": string, "intensity": number (0-1), "confidence": number (0-1), "evidence": string }] }.\n\n${transcriptText}`,
      },
    ],
    response_format: { type: 'json_object' },
  })

  const raw = completion.choices[0].message.content ?? '{}'
  const parsed = JSON.parse(raw) as { segments: TimelineSegmentDraft[] }

  await prisma.timelineSegment.deleteMany({ where: { videoId: video.id } })
  if (parsed.segments?.length > 0) {
    await prisma.timelineSegment.createMany({
      data: parsed.segments.map((s, index) => ({
        videoId: video.id,
        index,
        type: s.type,
        startSec: s.startSec,
        endSec: s.endSec,
        durationSec: s.endSec - s.startSec,
        text: s.text,
        purpose: s.purpose,
        emotion: s.emotion,
        intensity: s.intensity,
        confidence: s.confidence,
        evidence: s.evidence,
      })),
    })
  }

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
