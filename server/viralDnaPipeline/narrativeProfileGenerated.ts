import type { VideoModel as Video } from '../generated/prisma/models.js'
import type { NarrativePattern } from '../generated/prisma/enums.js'
import { prisma } from '../lib/prisma.js'
import { getOpenAiClientForProfile } from '../lib/openai.js'
import { logApiUsage, RATES } from '../lib/apiUsage.js'
import { getVideoContext, getWorkingProfile, addEvidence } from './common.js'

const NARRATIVE_PATTERNS: NarrativePattern[] = [
  'DOCUMENTARY', 'MYSTERY_REVEAL', 'CHRONOLOGICAL', 'EDUCATIONAL', 'TRANSFORMATION',
  'INVESTIGATION', 'CONFLICT', 'BIOGRAPHY', 'TIMELINE', 'PROBLEM_SOLUTION', 'LIST',
  'ESCALATING_REVELATION', 'CONFLICT_RESOLUTION', 'BEFORE_AND_AFTER', 'CASE_STUDY',
  'MYTH_VS_REALITY', 'QUESTION_AND_ANSWER', 'COUNTDOWN', 'CAUSE_AND_EFFECT',
]

interface NarrativeAiDraft {
  primaryNarrativePattern: NarrativePattern
  secondaryNarrativePatterns?: NarrativePattern[]
  CTAType?: string
  chronologicalStructure?: boolean
  conflictPresence?: boolean
  protagonistPresence?: boolean
  antagonistOrObstacle?: string
  transformationPresence?: boolean
  mysteryPresence?: boolean
  narrativeSymmetry?: number
  closureStrength?: number
  confidence?: number
  evidence?: string
  // Module 9 (AI half): counted per the same window, converted to per-minute below.
  factCount?: number
  claimCount?: number
  exampleCount?: number
  namedEntityCount?: number
  dateCount?: number
  cognitiveLoadEstimate?: number
}

/** Module 4 (+ AI half of Module 9): narrative-structure profile plus fact/claim/example/
 * entity density, from the compact timeline (never the raw transcript). */
export async function narrativeProfileGeneratedStage(video: Video): Promise<void> {
  const { projectId, profile: ownerProfile } = await getVideoContext(video)
  const workingProfile = await getWorkingProfile(video.id)
  const openai = await getOpenAiClientForProfile(ownerProfile.id)
  const metrics = workingProfile.metrics as Record<string, number | Record<string, number>> | null
  const durationSec = video.durationSec ?? 0
  const durationMin = durationSec / 60

  const timelineSegments = await prisma.timelineSegment.findMany({
    where: { videoId: video.id },
    orderBy: { index: 'asc' },
  })
  const timelineText = timelineSegments.map((s) => `[${s.startSec.toFixed(1)}-${s.endSec.toFixed(1)}] (${s.type}) ${s.text}`).join('\n')

  const durationByType = (type: string) => timelineSegments.filter((s) => s.type === type).reduce((sum, s) => sum + s.durationSec, 0)
  const countByType = (type: string) => timelineSegments.filter((s) => s.type === type).length
  const ctaSegment = timelineSegments.find((s) => s.type === 'CTA')

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `You analyze narrative structure and information density of short-form videos for viral-video reverse engineering. primaryNarrativePattern must be one of: ${NARRATIVE_PATTERNS.join(', ')}. secondaryNarrativePatterns is zero or more additional values from the same list. Count facts/claims/examples/named entities/dates as they occur across the whole timeline. Every structural claim must be backed by "evidence".`,
      },
      {
        role: 'user',
        content: `Analyze this narrative timeline. Respond with JSON: { "primaryNarrativePattern": string, "secondaryNarrativePatterns": string[], "CTAType": string, "chronologicalStructure": boolean, "conflictPresence": boolean, "protagonistPresence": boolean, "antagonistOrObstacle": string, "transformationPresence": boolean, "mysteryPresence": boolean, "narrativeSymmetry": number (0-1), "closureStrength": number (0-1), "confidence": number (0-1), "evidence": string, "factCount": number, "claimCount": number, "exampleCount": number, "namedEntityCount": number, "dateCount": number, "cognitiveLoadEstimate": number (0-1) }.\n\n${timelineText}`,
      },
    ],
    response_format: { type: 'json_object' },
  })

  const raw = completion.choices[0].message.content ?? '{}'
  const parsed = JSON.parse(raw) as NarrativeAiDraft
  if (!NARRATIVE_PATTERNS.includes(parsed.primaryNarrativePattern)) parsed.primaryNarrativePattern = 'CHRONOLOGICAL'
  parsed.secondaryNarrativePatterns = (parsed.secondaryNarrativePatterns ?? []).filter((p) => NARRATIVE_PATTERNS.includes(p))

  const revealCount = countByType('REVEAL')
  const narrative = {
    primaryNarrativePattern: parsed.primaryNarrativePattern,
    secondaryNarrativePatterns: parsed.secondaryNarrativePatterns,
    narrativeStages: timelineSegments.map((s) => ({ type: s.type, startSec: s.startSec, endSec: s.endSec })),
    segmentCount: timelineSegments.length,
    setupDuration: durationByType('SETUP'),
    developmentDuration: durationByType('STORY_DEVELOPMENT'),
    escalationDuration: durationByType('ESCALATION'),
    payoffDuration: durationByType('PAYOFF'),
    conclusionDuration: durationByType('SUMMARY') + durationByType('OUTRO'),
    CTAType: parsed.CTAType,
    CTATiming: ctaSegment ? ctaSegment.startSec / Math.max(durationSec, 1) : null,
    chronologicalStructure: parsed.chronologicalStructure ?? false,
    conflictPresence: parsed.conflictPresence ?? false,
    protagonistPresence: parsed.protagonistPresence ?? false,
    antagonistOrObstacle: parsed.antagonistOrObstacle,
    transformationPresence: parsed.transformationPresence ?? false,
    mysteryPresence: parsed.mysteryPresence ?? false,
    revealCount,
    revealFrequency: metrics?.revealsPerMinute ?? (durationMin > 0 ? revealCount / durationMin : 0),
    escalationCount: countByType('ESCALATION'),
    transitionCount: countByType('TRANSITION'),
    summaryCount: countByType('SUMMARY'),
    narrativeSymmetry: parsed.narrativeSymmetry ?? 0.5,
    closureStrength: parsed.closureStrength ?? 0.5,
    confidence: parsed.confidence ?? 0.5,
    evidence: parsed.evidence,
  }

  const informationDensity = {
    wordsPerMinute: metrics?.wordsPerMinute ?? null,
    factsPerMinute: durationMin > 0 ? (parsed.factCount ?? 0) / durationMin : 0,
    claimsPerMinute: durationMin > 0 ? (parsed.claimCount ?? 0) / durationMin : 0,
    examplesPerMinute: durationMin > 0 ? (parsed.exampleCount ?? 0) / durationMin : 0,
    namedEntitiesPerMinute: durationMin > 0 ? (parsed.namedEntityCount ?? 0) / durationMin : 0,
    datesPerMinute: durationMin > 0 ? (parsed.dateCount ?? 0) / durationMin : 0,
    questionsPerMinute: metrics?.questionsPerMinute ?? null,
    informationDensityScore: metrics?.informationUnitsPerMinute ?? null,
    cognitiveLoadEstimate: parsed.cognitiveLoadEstimate ?? 0.5,
    repetitionRate: metrics?.repetitionRate ?? null,
    redundancyRate: metrics?.redundancyRate ?? null,
    summaryRate: metrics?.summaryRate ?? null,
  }

  await prisma.viralDnaProfile.update({
    where: { id: workingProfile.id },
    data: {
      narrative,
      informationDensity,
      primaryNarrativePattern: parsed.primaryNarrativePattern,
      revealFrequency: narrative.revealFrequency,
    },
  })

  if (parsed.evidence) {
    await addEvidence(workingProfile.id, [
      {
        evidenceId: 'narrative.primaryNarrativePattern',
        sourceType: 'TIMELINE_SEGMENT',
        explanation: `Narrative pattern classified as ${parsed.primaryNarrativePattern}`,
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
