import type { VideoModel as Video } from '../generated/prisma/models.js'
import type { EmotionalArcType } from '../generated/prisma/enums.js'
import { prisma } from '../lib/prisma.js'
import { getOpenAiClientForProfile } from '../lib/openai.js'
import { logApiUsage, RATES } from '../lib/apiUsage.js'
import { getVideoContext, getWorkingProfile, addEvidence } from './common.js'

const ARC_TYPES: EmotionalArcType[] = [
  'RISING_TENSION', 'FALL_AND_RECOVERY', 'MYSTERY_TO_REVELATION', 'CONSTANT_ESCALATION',
  'SHOCK_TO_EXPLANATION', 'PROBLEM_TO_RELIEF', 'STABLE_EDUCATIONAL', 'MULTIPLE_PEAKS',
  'EMOTIONAL_TRANSFORMATION', 'UNKNOWN',
]

interface EmotionPointDraft {
  index: number
  dominantEmotion: string
  secondaryEmotion?: string
  intensity: number
  sourceSignals?: string
}

interface EmotionAiDraft {
  points: EmotionPointDraft[]
  emotionalArcType?: EmotionalArcType
  numberOfEmotionalShifts?: number
}

/** Module 8: an inferred (never claimed as objective fact) emotion curve, sampled at each
 * timeline segment — one AI call over the compact timeline, no re-transcription. */
export async function emotionProfileGeneratedStage(video: Video): Promise<void> {
  const { projectId, profile: ownerProfile } = await getVideoContext(video)
  const workingProfile = await getWorkingProfile(video.id)
  const openai = await getOpenAiClientForProfile(ownerProfile.id)
  const durationSec = video.durationSec ?? 0

  const timelineSegments = await prisma.timelineSegment.findMany({
    where: { videoId: video.id },
    orderBy: { index: 'asc' },
  })
  const timelineText = timelineSegments.map((s) => `[${s.index}] [${s.startSec.toFixed(1)}-${s.endSec.toFixed(1)}] (${s.type}) ${s.text}`).join('\n')

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `You infer the emotional arc of a short-form video from its timeline, one point per segment. This is an interpretation, not a measured fact — track: curiosity, tension, surprise, fear, hope, sadness, excitement, inspiration, urgency, relief, trust. emotionalArcType must be one of: ${ARC_TYPES.join(', ')}.`,
      },
      {
        role: 'user',
        content: `Infer one emotion point per timeline segment below (same index). Respond with JSON: { "points": [{ "index": number, "dominantEmotion": string, "secondaryEmotion": string, "intensity": number (0-1), "sourceSignals": string }], "emotionalArcType": string, "numberOfEmotionalShifts": number }.\n\n${timelineText}`,
      },
    ],
    response_format: { type: 'json_object' },
  })

  const raw = completion.choices[0].message.content ?? '{}'
  const parsed = JSON.parse(raw) as EmotionAiDraft
  const pointsByIndex = new Map(parsed.points.map((p) => [p.index, p]))

  const curve = timelineSegments.map((seg) => {
    const p = pointsByIndex.get(seg.index)
    return {
      normalizedPosition: durationSec > 0 ? seg.startSec / durationSec : 0,
      timestamp: seg.startSec,
      dominantEmotion: p?.dominantEmotion ?? 'neutral',
      secondaryEmotion: p?.secondaryEmotion ?? null,
      intensity: p?.intensity ?? 0.5,
      sourceSignals: p?.sourceSignals ?? null,
      confidence: 0.5, // all emotion inference is a lower-confidence interpretive signal by nature
    }
  })

  let shifts = parsed.numberOfEmotionalShifts ?? 0
  if (!parsed.numberOfEmotionalShifts) {
    for (let i = 1; i < curve.length; i++) if (curve[i].dominantEmotion !== curve[i - 1].dominantEmotion) shifts++
  }
  const intensities = curve.map((p) => p.intensity)
  const peak = curve.reduce((max, p) => (p.intensity > (max?.intensity ?? -1) ? p : max), curve[0])
  const mean = intensities.length > 0 ? intensities.reduce((a, b) => a + b, 0) / intensities.length : 0
  const emotionalVariation =
    intensities.length > 0 ? Math.sqrt(intensities.reduce((sum, v) => sum + (v - mean) ** 2, 0) / intensities.length) : 0

  const emotion = {
    curve,
    openingEmotion: curve[0]?.dominantEmotion ?? null,
    peakEmotion: peak?.dominantEmotion ?? null,
    peakTimestamp: peak?.timestamp ?? null,
    endingEmotion: curve.at(-1)?.dominantEmotion ?? null,
    numberOfEmotionalShifts: shifts,
    emotionalVariation,
    emotionalArcType: ARC_TYPES.includes(parsed.emotionalArcType as EmotionalArcType) ? parsed.emotionalArcType : 'UNKNOWN',
    inferred: true, // explicit disclaimer: this section is interpretive, not objective measurement
  }

  await prisma.viralDnaProfile.update({
    where: { id: workingProfile.id },
    data: { emotion },
  })

  await addEvidence(workingProfile.id, [
    {
      evidenceId: 'emotion.emotionalArcType',
      sourceType: 'TIMELINE_SEGMENT',
      explanation: `Inferred emotional arc: ${emotion.emotionalArcType} (interpretation, not measured fact)`,
    },
  ])

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
