import type { VideoModel as Video } from '../generated/prisma/models.js'
import type { HypothesisType } from '../generated/prisma/enums.js'
import { prisma } from '../lib/prisma.js'
import { getOpenAiClientForProfile } from '../lib/openai.js'
import { logApiUsage, RATES } from '../lib/apiUsage.js'
import { getVideoContext, getWorkingProfile } from './common.js'

const HYPOTHESIS_TYPES: HypothesisType[] = [
  'HOOK', 'TOPIC', 'TITLE', 'THUMBNAIL', 'NARRATIVE', 'PACING', 'VISUAL', 'VOICE',
  'DURATION', 'TIMING', 'AUDIENCE', 'FORMAT',
]

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}
/** How close `value` is to `ideal` (0-1 scale), falling off linearly to 0 at `ideal ± tolerance`. */
function durationFit(value: number, ideal: number, tolerance: number): number {
  return clamp01(1 - Math.abs(value - ideal) / tolerance)
}
function rateFit(value: number, target: number): number {
  return clamp01(value / target)
}
function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length
}

const FORMULA_VERSION = '1.0.0'

interface ScoreEntry {
  scoreName: string
  value: number // 0-100
  inputs: Record<string, unknown>
}

/**
 * Module 12: deterministic 0-100 scores from the metrics/sub-profiles already generated —
 * see the inline formula for each. AI never invents these; it only produces the hypotheses
 * layer below. All ideal-value targets are first-pass estimates (documented, versioned via
 * FORMULA_VERSION) meant to be tuned once real comparative data exists across many videos.
 */
function computeScores(profile: {
  metrics: Record<string, number> | null
  hook: Record<string, unknown> | null
  narrative: Record<string, unknown> | null
  retention: Record<string, unknown> | null
  visual: Record<string, unknown> | null
  audio: Record<string, unknown> | null
  emotion: Record<string, unknown> | null
  informationDensity: Record<string, unknown> | null
}): ScoreEntry[] {
  const m = profile.metrics ?? {}
  const hook = profile.hook ?? {}
  const narrative = profile.narrative ?? {}
  const retention = profile.retention ?? {}
  const visual = profile.visual ?? {}
  const audio = profile.audio ?? {}
  const emotion = profile.emotion ?? {}

  const hookStrength =
    0.5 * ((hook.confidence as number) ?? 0.5) +
    0.3 * ((hook.openLoopCreated as boolean) ? 1 : 0) +
    0.2 * durationFit((m.hookDurationPercentage as number) ?? 0, 0.1, 0.1)

  const curiosity =
    0.5 * ((hook.curiosityGap as string) ? 1 : 0) +
    0.3 * ((narrative.mysteryPresence as boolean) ? 1 : 0) +
    0.2 * ((retention.openLoopResolutionRate as number) ?? 0)

  const narrativeClarity = 0.6 * ((narrative.confidence as number) ?? 0.5) + 0.4 * ((narrative.narrativeSymmetry as number) ?? 0.5)

  const narrativeMomentum = 0.5 * rateFit((m.revealsPerMinute as number) ?? 0, 2) + 0.5 * rateFit((m.scenesPerMinute as number) ?? 0, 8)

  const retentionMechanismDensity = rateFit((retention.retentionEventDensity as number) ?? 0, 5)
  const openLoopManagement = (retention.openLoopResolutionRate as number) ?? 0
  const payoffStrength = clamp01((m.payoffRate as number) ?? 0)
  const informationDensityScore = rateFit((m.informationUnitsPerMinute as number) ?? 0, 10)

  const visualRhythm = rateFit((visual.sceneChangesPerMinute as number) ?? 0, 10)
  const categoryCount = Object.keys((visual.assetTypeDistribution as Record<string, number>) ?? {}).length
  const motionCount = Object.keys((visual.motionDistribution as Record<string, number>) ?? {}).length
  const visualVariety = 0.5 * clamp01(categoryCount / 11) + 0.5 * clamp01(motionCount / 6)

  const voicePacing = durationFit((audio.averageWordsPerMinute as number) ?? 150, 155, 40)
  const emotionalProgression = 0.5 * rateFit((emotion.numberOfEmotionalShifts as number) ?? 0, 5) + 0.5 * ((emotion.emotionalVariation as number) ?? 0)
  const ctaIntegration = narrative.CTATiming !== null && narrative.CTATiming !== undefined ? durationFit(narrative.CTATiming as number, 0.9, 0.15) : 0
  const structuralConsistency = (narrative.closureStrength as number) ?? 0.5

  const sectionConfidences = [hook.confidence, narrative.confidence, visual.confidence, audio.confidence]
    .filter((c): c is number => typeof c === 'number')
  const evidenceConfidence = mean(sectionConfidences)

  const entries: ScoreEntry[] = [
    { scoreName: 'HOOK_STRENGTH', value: hookStrength, inputs: { hookConfidence: hook.confidence, openLoopCreated: hook.openLoopCreated, hookDurationPercentage: m.hookDurationPercentage } },
    { scoreName: 'CURIOSITY', value: curiosity, inputs: { curiosityGap: hook.curiosityGap, mysteryPresence: narrative.mysteryPresence, openLoopResolutionRate: retention.openLoopResolutionRate } },
    { scoreName: 'NARRATIVE_CLARITY', value: narrativeClarity, inputs: { narrativeConfidence: narrative.confidence, narrativeSymmetry: narrative.narrativeSymmetry } },
    { scoreName: 'NARRATIVE_MOMENTUM', value: narrativeMomentum, inputs: { revealsPerMinute: m.revealsPerMinute, scenesPerMinute: m.scenesPerMinute } },
    { scoreName: 'RETENTION_MECHANISM_DENSITY', value: retentionMechanismDensity, inputs: { retentionEventDensity: retention.retentionEventDensity } },
    { scoreName: 'OPEN_LOOP_MANAGEMENT', value: openLoopManagement, inputs: { openLoopResolutionRate: retention.openLoopResolutionRate } },
    { scoreName: 'PAYOFF_STRENGTH', value: payoffStrength, inputs: { payoffRate: m.payoffRate } },
    { scoreName: 'INFORMATION_DENSITY', value: informationDensityScore, inputs: { informationUnitsPerMinute: m.informationUnitsPerMinute } },
    { scoreName: 'VISUAL_RHYTHM', value: visualRhythm, inputs: { sceneChangesPerMinute: visual.sceneChangesPerMinute } },
    { scoreName: 'VISUAL_VARIETY', value: visualVariety, inputs: { categoryCount, motionCount } },
    { scoreName: 'VOICE_PACING', value: voicePacing, inputs: { averageWordsPerMinute: audio.averageWordsPerMinute } },
    { scoreName: 'EMOTIONAL_PROGRESSION', value: emotionalProgression, inputs: { numberOfEmotionalShifts: emotion.numberOfEmotionalShifts, emotionalVariation: emotion.emotionalVariation } },
    { scoreName: 'CTA_INTEGRATION', value: ctaIntegration, inputs: { ctaTiming: narrative.CTATiming } },
    { scoreName: 'STRUCTURAL_CONSISTENCY', value: structuralConsistency, inputs: { closureStrength: narrative.closureStrength } },
    { scoreName: 'EVIDENCE_CONFIDENCE', value: evidenceConfidence, inputs: { sectionConfidences } },
  ]

  const byName = Object.fromEntries(entries.map((e) => [e.scoreName, e.value]))
  const overallStructure = mean([byName.HOOK_STRENGTH, byName.NARRATIVE_CLARITY, byName.NARRATIVE_MOMENTUM, byName.STRUCTURAL_CONSISTENCY])
  const overallRetention = mean([byName.RETENTION_MECHANISM_DENSITY, byName.OPEN_LOOP_MANAGEMENT, byName.PAYOFF_STRENGTH, byName.CURIOSITY])
  const overallProductionPattern = mean([byName.VISUAL_RHYTHM, byName.VISUAL_VARIETY, byName.VOICE_PACING, byName.INFORMATION_DENSITY])
  const overallConfidence = byName.EVIDENCE_CONFIDENCE

  entries.push(
    { scoreName: 'OVERALL_STRUCTURE', value: overallStructure, inputs: { hookStrength, narrativeClarity, narrativeMomentum, structuralConsistency } },
    { scoreName: 'OVERALL_RETENTION', value: overallRetention, inputs: { retentionMechanismDensity, openLoopManagement, payoffStrength, curiosity } },
    { scoreName: 'OVERALL_PRODUCTION_PATTERN', value: overallProductionPattern, inputs: { visualRhythm, visualVariety, voicePacing, informationDensityScore } },
    { scoreName: 'OVERALL_CONFIDENCE', value: overallConfidence, inputs: { evidenceConfidence } },
  )

  // Scale every 0-1 value to 0-100 for storage.
  return entries.map((e) => ({ ...e, value: Math.round(clamp01(e.value) * 1000) / 10 }))
}

interface HypothesisDraft {
  statement: string
  supportingEvidence?: string[]
  contradictingEvidence?: string[]
  confidence?: number
  hypothesisType: HypothesisType
  testability?: string
  recommendedValidation?: string
}

/** Module 11 (hypotheses, one AI call) + Module 12 (scorecard, pure code) + Module 13
 * (assembles the schema-versioned profile row). This is the pipeline's synthesis stage. */
export async function viralDnaSynthesizedStage(video: Video): Promise<void> {
  const { projectId, profile: ownerProfile } = await getVideoContext(video)
  const workingProfile = await getWorkingProfile(video.id)
  const openai = await getOpenAiClientForProfile(ownerProfile.id)

  const scores = computeScores(workingProfile as never)

  const summary = {
    hook: workingProfile.hook,
    narrative: workingProfile.narrative,
    retention: workingProfile.retention,
    visual: workingProfile.visual,
    audio: workingProfile.audio,
    emotion: workingProfile.emotion,
    performance: workingProfile.performance,
    scores: Object.fromEntries(scores.map((s) => [s.scoreName, s.value])),
  }

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `You generate evidence-based hypotheses about why a short-form video's format may have performed well, from its already-computed structural profile. hypothesisType must be one of: ${HYPOTHESIS_TYPES.join(', ')}. Never state a structural element CAUSED the performance — only that a pattern co-occurs with the observed performance (e.g. "This pattern appears in a video with an outlier score of 4.2", never "This hook caused the video to go viral"). Every hypothesis needs supportingEvidence and, where applicable, contradictingEvidence.`,
      },
      {
        role: 'user',
        content: `Generate 3-6 hypotheses from this profile summary. Respond with JSON: { "hypotheses": [{ "statement": string, "supportingEvidence": string[], "contradictingEvidence": string[], "confidence": number (0-1), "hypothesisType": string, "testability": string, "recommendedValidation": string }] }.\n\n${JSON.stringify(summary)}`,
      },
    ],
    response_format: { type: 'json_object' },
  })

  const raw = completion.choices[0].message.content ?? '{}'
  const parsed = JSON.parse(raw) as { hypotheses: HypothesisDraft[] }
  const hypotheses = (parsed.hypotheses ?? []).filter((h) => HYPOTHESIS_TYPES.includes(h.hypothesisType))

  const [videoAnalysis, transcript, timelineSeg, narrativeRow, visualRow, audioRow] = await Promise.all([
    prisma.videoAnalysis.findUnique({ where: { videoId: video.id }, select: { updatedAt: true } }),
    prisma.videoTranscript.findUnique({ where: { videoId: video.id }, select: { updatedAt: true } }),
    prisma.timelineSegment.findFirst({ where: { videoId: video.id }, orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } }),
    prisma.narrativeAnalysis.findUnique({ where: { videoId: video.id }, select: { updatedAt: true } }),
    prisma.visualScene.findFirst({ where: { videoId: video.id }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    prisma.audioMetric.findUnique({ where: { videoId: video.id }, select: { updatedAt: true } }),
  ])

  await prisma.$transaction([
    prisma.viralDnaScore.deleteMany({ where: { profileId: workingProfile.id } }),
    prisma.viralDnaScore.createMany({
      data: scores.map((s) => ({
        profileId: workingProfile.id,
        scoreName: s.scoreName as never,
        value: s.value,
        formulaVersion: FORMULA_VERSION,
        inputs: s.inputs as never,
      })),
    }),
    prisma.viralDnaHypothesis.deleteMany({ where: { profileId: workingProfile.id } }),
    prisma.viralDnaHypothesis.createMany({
      data: hypotheses.map((h) => ({
        profileId: workingProfile.id,
        statement: h.statement,
        supportingEvidence: h.supportingEvidence ?? [],
        contradictingEvidence: h.contradictingEvidence ?? [],
        confidence: h.confidence ?? 0.5,
        hypothesisType: h.hypothesisType,
        testability: h.testability,
        recommendedValidation: h.recommendedValidation,
      })),
    }),
    prisma.viralDnaProfile.update({
      where: { id: workingProfile.id },
      data: {
        // status stays DRAFT here — viralDnaValidatedStage (Module 15) is the one that
        // decides VALIDATED vs. blocking, and approve.ts is the only path to APPROVED.
        overallConfidenceScore: summary.scores.OVERALL_CONFIDENCE / 100,
        overallRetentionScore: summary.scores.OVERALL_RETENTION / 100,
        sourceSnapshot: {
          videoAnalysis: videoAnalysis?.updatedAt,
          transcript: transcript?.updatedAt,
          timelineSegment: timelineSeg?.updatedAt,
          narrativeAnalysis: narrativeRow?.updatedAt,
          visualScene: visualRow?.createdAt,
          audioMetric: audioRow?.updatedAt,
        },
      },
    }),
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
