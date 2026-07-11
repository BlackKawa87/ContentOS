import type { VideoModel as Video } from '../generated/prisma/models.js'
import type { RetentionMechanismType } from '../generated/prisma/enums.js'
import { prisma } from '../lib/prisma.js'
import { getOpenAiClientForProfile } from '../lib/openai.js'
import { logApiUsage, RATES } from '../lib/apiUsage.js'
import { getVideoContext, getWorkingProfile, addEvidence } from './common.js'

const MECHANISM_TYPES: RetentionMechanismType[] = [
  'OPEN_LOOP', 'DELAYED_PAYOFF', 'PATTERN_INTERRUPT', 'PROGRESSIVE_REVELATION', 'CURIOSITY_GAP',
  'ESCALATION', 'CLIFFHANGER', 'QUESTION', 'SURPRISE', 'CONTRAST', 'EMOTIONAL_SHIFT',
  'VISUAL_CHANGE', 'PACE_CHANGE', 'INFORMATION_GAP', 'STAKES_INCREASE', 'CALLBACK',
  'FORESHADOWING', 'MICRO_PAYOFF', 'AUTHORITY_REINFORCEMENT', 'DIRECT_VIEWER_ADDRESS',
]

interface MechanismDraft {
  type: RetentionMechanismType
  start: number
  end: number
  strength?: number
  purpose?: string
  evidence?: string
  confidence?: number
}

interface RetentionAiDraft {
  mechanisms: MechanismDraft[]
  resolvedOpenLoopCount?: number
  unresolvedOpenLoopCount?: number
}

/** Module 5: identifies retention mechanisms across the timeline (reusing the hook/narrative
 * sub-profiles already generated — no re-transcription) and computes their aggregate stats. */
export async function retentionProfileGeneratedStage(video: Video): Promise<void> {
  const { projectId, profile: ownerProfile } = await getVideoContext(video)
  const workingProfile = await getWorkingProfile(video.id)
  const openai = await getOpenAiClientForProfile(ownerProfile.id)
  const metrics = workingProfile.metrics as Record<string, number> | null
  const durationSec = video.durationSec ?? 0
  const durationMin = durationSec / 60

  const timelineSegments = await prisma.timelineSegment.findMany({
    where: { videoId: video.id },
    orderBy: { index: 'asc' },
  })
  const timelineText = timelineSegments.map((s) => `[${s.startSec.toFixed(1)}-${s.endSec.toFixed(1)}] (${s.type}) ${s.text}`).join('\n')
  const narrative = workingProfile.narrative as { openLoopCount?: number } | null

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `You identify retention mechanisms in a short-form video's timeline for viral-video reverse engineering. Each mechanism's "type" must be one of: ${MECHANISM_TYPES.join(', ')}. Every mechanism must be backed by "evidence" (a quoted or closely paraphrased line).`,
      },
      {
        role: 'user',
        content: `Identify every retention mechanism in this timeline, in time order. Respond with JSON: { "mechanisms": [{ "type": string, "start": number, "end": number, "strength": number (0-1), "purpose": string, "evidence": string, "confidence": number (0-1) }], "resolvedOpenLoopCount": number, "unresolvedOpenLoopCount": number }.\n\n${timelineText}`,
      },
    ],
    response_format: { type: 'json_object' },
  })

  const raw = completion.choices[0].message.content ?? '{}'
  const parsed = JSON.parse(raw) as RetentionAiDraft
  const mechanisms = (parsed.mechanisms ?? []).filter((m) => MECHANISM_TYPES.includes(m.type))

  const openLoopCount = narrative?.openLoopCount ?? 0
  const resolvedOpenLoopCount = parsed.resolvedOpenLoopCount ?? 0
  const unresolvedOpenLoopCount = parsed.unresolvedOpenLoopCount ?? Math.max(0, openLoopCount - resolvedOpenLoopCount)
  const openLoops = mechanisms.filter((m) => m.type === 'OPEN_LOOP')
  const averageOpenLoopDuration =
    openLoops.length > 0 ? openLoops.reduce((sum, m) => sum + (m.end - m.start), 0) / openLoops.length : 0

  const sortedTimes = mechanisms.map((m) => m.start).sort((a, b) => a - b)
  let longestGap = sortedTimes.length > 0 ? sortedTimes[0] : durationSec
  for (let i = 1; i < sortedTimes.length; i++) longestGap = Math.max(longestGap, sortedTimes[i] - sortedTimes[i - 1])
  if (sortedTimes.length > 0) longestGap = Math.max(longestGap, durationSec - sortedTimes.at(-1)!)

  const retention = {
    mechanisms: mechanisms.map((m) => ({
      type: m.type,
      start: m.start,
      end: m.end,
      strength: m.strength ?? 0.5,
      purpose: m.purpose,
      evidence: m.evidence,
      confidence: m.confidence ?? 0.5,
    })),
    openLoopCount,
    resolvedOpenLoopCount,
    unresolvedOpenLoopCount,
    openLoopResolutionRate: openLoopCount > 0 ? resolvedOpenLoopCount / openLoopCount : 0,
    averageOpenLoopDuration,
    patternInterruptsPerMinute: metrics?.patternInterruptsPerMinute ?? 0,
    revealsPerMinute: metrics?.revealsPerMinute ?? 0,
    microPayoffsPerMinute: durationMin > 0 ? mechanisms.filter((m) => m.type === 'MICRO_PAYOFF').length / durationMin : 0,
    retentionEventDensity: durationMin > 0 ? mechanisms.length / durationMin : 0,
    firstRetentionEventTime: sortedTimes[0] ?? null,
    longestPeriodWithoutRetentionEvent: longestGap,
  }

  await prisma.viralDnaProfile.update({
    where: { id: workingProfile.id },
    data: { retention, overallRetentionScore: retention.retentionEventDensity > 0 ? Math.min(1, retention.retentionEventDensity / 5) : 0 },
  })

  await addEvidence(
    workingProfile.id,
    mechanisms
      .filter((m) => m.evidence)
      .map((m, i) => ({
        evidenceId: `retention.mechanism.${i}`,
        sourceType: 'TIMELINE_SEGMENT' as const,
        timestampStart: m.start,
        timestampEnd: m.end,
        transcriptExcerpt: m.evidence,
        explanation: `${m.type} retention mechanism`,
      })),
  )

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
