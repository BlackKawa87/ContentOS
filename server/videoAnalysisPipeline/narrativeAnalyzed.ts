import type { VideoModel as Video } from '../generated/prisma/models.js'
import type { HookType, NarrativePattern } from '../generated/prisma/enums.js'
import { prisma } from '../lib/prisma.js'
import { getOpenAiClientForProfile } from '../lib/openai.js'
import { logApiUsage, RATES } from '../lib/apiUsage.js'
import { getVideoContext } from './common.js'

const HOOK_TYPES: HookType[] = [
  'UNEXPECTED_FACT',
  'QUESTION',
  'CONTRARIAN',
  'MYSTERY',
  'STORY_OPENING',
  'AUTHORITY',
  'PROBLEM_FIRST',
  'FUTURE_PROMISE',
  'EMOTIONAL',
]

const NARRATIVE_PATTERNS: NarrativePattern[] = [
  'DOCUMENTARY',
  'MYSTERY_REVEAL',
  'CHRONOLOGICAL',
  'EDUCATIONAL',
  'TRANSFORMATION',
  'INVESTIGATION',
  'CONFLICT',
  'BIOGRAPHY',
  'TIMELINE',
]

interface NarrativeAnalysisDraft {
  hookType?: HookType
  hookDurationSec?: number
  promise?: string
  openLoopCount?: number
  payoffCount?: number
  revealFrequency?: number
  storyStructure?: string
  informationDensity?: number
  curiosityScore?: number
  narrativeStyle?: string
  narrativePattern?: NarrativePattern
  retentionMechanisms?: string
  evidence?: string
}

/** Module 4: draws narrative-craft conclusions from the timeline (hook type, open loops, retention mechanisms). */
export async function narrativeAnalyzedStage(video: Video): Promise<void> {
  const { projectId, profile } = await getVideoContext(video)
  const openai = await getOpenAiClientForProfile(profile.id)

  const timelineSegments = await prisma.timelineSegment.findMany({
    where: { videoId: video.id },
    orderBy: { index: 'asc' },
  })

  const timelineText = timelineSegments
    .map((s) => `[${s.startSec.toFixed(1)}-${s.endSec.toFixed(1)}] (${s.type}) ${s.text}`)
    .join('\n')

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `You analyze the narrative craft of short-form videos for viral-video reverse engineering. hookType must be one of: ${HOOK_TYPES.join(', ')}. narrativePattern must be one of: ${NARRATIVE_PATTERNS.join(', ')}. Every conclusion must be backed by a quoted or closely paraphrased line from the timeline in the "evidence" field.`,
      },
      {
        role: 'user',
        content: `Analyze this narrative timeline. Respond with a JSON object matching: { "hookType": string, "hookDurationSec": number, "promise": string, "openLoopCount": number, "payoffCount": number, "revealFrequency": number, "storyStructure": string, "informationDensity": number (0-1), "curiosityScore": number (0-1), "narrativeStyle": string, "narrativePattern": string, "retentionMechanisms": string, "evidence": string }.\n\n${timelineText}`,
      },
    ],
    response_format: { type: 'json_object' },
  })

  const raw = completion.choices[0].message.content ?? '{}'
  const parsed = JSON.parse(raw) as NarrativeAnalysisDraft

  // The model occasionally drifts and returns a value from the other enum listed in the
  // prompt (e.g. a HookType value in narrativePattern) — Prisma rejects unknown enum
  // values outright, so validate against the allowed set rather than trust the model.
  if (parsed.hookType && !HOOK_TYPES.includes(parsed.hookType)) parsed.hookType = undefined
  if (parsed.narrativePattern && !NARRATIVE_PATTERNS.includes(parsed.narrativePattern)) {
    parsed.narrativePattern = undefined
  }

  await prisma.narrativeAnalysis.upsert({
    where: { videoId: video.id },
    create: { videoId: video.id, ...parsed },
    update: { ...parsed },
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
