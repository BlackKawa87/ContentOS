import type { VideoModel as Video } from '../generated/prisma/models.js'
import { prisma } from '../lib/prisma.js'
import { getWorkingProfile } from './common.js'

const FORMULA_VERSION = '1.0.0'
const EXPECTED_SCORE_COUNT = 19 // 15 named scores + 4 overall scores

/** Module 15: the last gate before a profile can be marked COMPLETED. Blocking errors throw
 * (the job fails, no incomplete profile is ever silently marked done); non-blocking issues
 * are recorded on ViralDnaValidationResult and the profile proceeds as VALIDATED. */
export async function viralDnaValidatedStage(video: Video): Promise<void> {
  const profile = await getWorkingProfile(video.id)
  const errors: string[] = []
  const warnings: string[] = []
  const unsupportedClaims: string[] = []
  const missingEvidence: string[] = []

  const sections: [string, unknown][] = [
    ['hook', profile.hook],
    ['narrative', profile.narrative],
    ['retention', profile.retention],
    ['visual', profile.visual],
    ['audio', profile.audio],
    ['emotion', profile.emotion],
    ['informationDensity', profile.informationDensity],
    ['performance', profile.performance],
  ]
  for (const [name, value] of sections) {
    if (value === null || value === undefined) errors.push(`Missing mandatory section: ${name}`)
  }

  const [scores, hypotheses, evidence] = await Promise.all([
    prisma.viralDnaScore.findMany({ where: { profileId: profile.id } }),
    prisma.viralDnaHypothesis.findMany({ where: { profileId: profile.id } }),
    prisma.viralDnaEvidence.findMany({ where: { profileId: profile.id } }),
  ])

  if (scores.length < EXPECTED_SCORE_COUNT) errors.push(`Expected ${EXPECTED_SCORE_COUNT} scores, found ${scores.length}`)
  for (const score of scores) {
    if (score.value < 0 || score.value > 100) errors.push(`Score ${score.scoreName} out of range: ${score.value}`)
    if (score.formulaVersion !== FORMULA_VERSION) warnings.push(`Score ${score.scoreName} used stale formula version ${score.formulaVersion}`)
  }
  if (hypotheses.length === 0) warnings.push('No hypotheses were generated')
  if (evidence.length === 0) missingEvidence.push('No evidence rows recorded for this profile')

  // Timestamp / percentage sanity checks.
  const durationSec = video.durationSec ?? 0
  const hook = profile.hook as { hookEnd?: number; durationPercentage?: number; confidence?: number; evidence?: string } | null
  if (hook) {
    if (durationSec > 0 && (hook.hookEnd ?? 0) > durationSec) errors.push('Hook end timestamp exceeds video duration')
    if (hook.durationPercentage !== undefined && (hook.durationPercentage < 0 || hook.durationPercentage > 1)) {
      errors.push(`Impossible hookDurationPercentage: ${hook.durationPercentage}`)
    }
    if (hook.confidence === undefined || hook.confidence === null) warnings.push('Hook section missing confidence')
    if (!hook.evidence) unsupportedClaims.push('hook.primaryType has no recorded evidence text')
  }

  const emotion = profile.emotion as { curve?: { timestamp: number }[] } | null
  if (emotion?.curve) {
    for (let i = 1; i < emotion.curve.length; i++) {
      if (emotion.curve[i].timestamp < emotion.curve[i - 1].timestamp) {
        errors.push(`Emotion curve timestamps out of order at index ${i}`)
        break
      }
    }
  }

  for (const [name, value] of [
    ['narrative', profile.narrative],
    ['visual', profile.visual],
    ['audio', profile.audio],
  ] as const) {
    const confidence = (value as { confidence?: number } | null)?.confidence
    if (confidence === undefined || confidence === null) warnings.push(`${name} section missing confidence`)
  }

  // Evidence rows must belong to this profile only (defense-in-depth — the FK already
  // guarantees this structurally, but the spec calls it out explicitly as a check).
  const foreignEvidence = evidence.filter((e) => e.profileId !== profile.id)
  if (foreignEvidence.length > 0) errors.push(`${foreignEvidence.length} evidence row(s) reference a different profile`)

  const valid = errors.length === 0
  const confidenceSummary = {
    overallConfidenceScore: profile.overallConfidenceScore,
    sectionsWithConfidence: sections.filter(([, v]) => typeof (v as { confidence?: number } | null)?.confidence === 'number').length,
    totalSections: sections.length,
  }

  await prisma.viralDnaValidationResult.create({
    data: { profileId: profile.id, valid, errors, warnings, unsupportedClaims, missingEvidence, confidenceSummary },
  })

  if (!valid) {
    throw new Error(`Viral DNA validation failed: ${errors.join('; ')}`)
  }

  await prisma.viralDnaProfile.update({
    where: { id: profile.id },
    data: {
      status: 'VALIDATED',
      warnings: [...((profile.warnings as string[] | null) ?? []), ...warnings],
      limitations: [...unsupportedClaims, ...missingEvidence],
    },
  })
}
