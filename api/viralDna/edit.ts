import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireUser, HttpError } from '../../server/lib/auth.js'
import { prisma } from '../../server/lib/prisma.js'

interface EditPayload {
  primaryHookType?: string
  primaryNarrativePattern?: string
  hookConfidence?: number
  narrativeConfidence?: number
  notes?: string
  rejectedHypothesisIds?: string[]
}

/** Manual edits create a new version rather than mutating history — the original
 * generated version stays intact, and every edit is audit-logged (spec's editing rules). */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const user = await requireUser(req)

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST')
      return res.status(405).json({ error: 'Method not allowed' })
    }

    const { videoId, edits } = req.body ?? {}
    if (typeof videoId !== 'string' || typeof edits !== 'object' || edits === null) {
      return res.status(400).json({ error: 'videoId and edits are required' })
    }
    const payload = edits as EditPayload

    const video = await prisma.video.findUniqueOrThrow({ where: { id: videoId }, include: { project: true } })
    if (video.project.ownerId !== user.id) throw new HttpError(403, 'Forbidden')

    const current = await prisma.viralDnaProfile.findFirst({
      where: { videoId, isCurrent: true },
      include: { scores: true, hypotheses: true, evidence: true },
    })
    if (!current) return res.status(400).json({ error: 'No current Viral DNA profile to edit' })

    const nextVersion = current.profileVersion + 1
    const hook = { ...((current.hook as Record<string, unknown>) ?? {}) }
    const narrative = { ...((current.narrative as Record<string, unknown>) ?? {}) }
    if (payload.primaryHookType) hook.primaryType = payload.primaryHookType
    if (payload.primaryNarrativePattern) narrative.primaryNarrativePattern = payload.primaryNarrativePattern
    if (typeof payload.hookConfidence === 'number') hook.confidence = payload.hookConfidence
    if (typeof payload.narrativeConfidence === 'number') narrative.confidence = payload.narrativeConfidence

    const result = await prisma.$transaction(async (tx) => {
      await tx.viralDnaProfile.update({ where: { id: current.id }, data: { isCurrent: false } })

      const created = await tx.viralDnaProfile.create({
        data: {
          videoId,
          profileVersion: nextVersion,
          isCurrent: true,
          status: 'VALIDATED', // edited, awaiting re-approval — not auto-approved
          schemaVersion: current.schemaVersion,
          generatedAt: current.generatedAt,
          sourceSnapshot: current.sourceSnapshot ?? undefined,
          metrics: current.metrics ?? undefined,
          primaryHookType: (payload.primaryHookType as never) ?? current.primaryHookType,
          primaryNarrativePattern: (payload.primaryNarrativePattern as never) ?? current.primaryNarrativePattern,
          averageWordsPerMinute: current.averageWordsPerMinute,
          averageSceneDurationSec: current.averageSceneDurationSec,
          sceneChangesPerMinute: current.sceneChangesPerMinute,
          openLoopCount: current.openLoopCount,
          revealFrequency: current.revealFrequency,
          patternInterruptsPerMinute: current.patternInterruptsPerMinute,
          textOverlayRate: current.textOverlayRate,
          dominantMotion: current.dominantMotion,
          dominantTransition: current.dominantTransition,
          outlierScoreSnapshot: current.outlierScoreSnapshot,
          overallRetentionScore: current.overallRetentionScore,
          overallConfidenceScore: current.overallConfidenceScore,
          hook: hook as never,
          narrative: narrative as never,
          retention: current.retention ?? undefined,
          visual: current.visual ?? undefined,
          audio: current.audio ?? undefined,
          emotion: current.emotion ?? undefined,
          informationDensity: current.informationDensity ?? undefined,
          performance: current.performance ?? undefined,
          warnings: current.warnings ?? undefined,
          limitations: current.limitations ?? undefined,
          notes: payload.notes ?? current.notes,
          createdById: user.id,
        },
      })

      if (current.scores.length > 0) {
        await tx.viralDnaScore.createMany({
          data: current.scores.map((s) => ({
            profileId: created.id,
            scoreName: s.scoreName,
            value: s.value,
            formulaVersion: s.formulaVersion,
            inputs: s.inputs ?? undefined,
            evidence: s.evidence,
          })),
        })
      }
      if (current.hypotheses.length > 0) {
        const rejectedIds = new Set(payload.rejectedHypothesisIds ?? [])
        await tx.viralDnaHypothesis.createMany({
          data: current.hypotheses.map((h) => ({
            profileId: created.id,
            statement: h.statement,
            supportingEvidence: h.supportingEvidence ?? undefined,
            contradictingEvidence: h.contradictingEvidence ?? undefined,
            confidence: h.confidence,
            hypothesisType: h.hypothesisType,
            testability: h.testability,
            recommendedValidation: h.recommendedValidation,
            status: rejectedIds.has(h.id) ? 'REJECTED' : h.status,
          })),
        })
      }
      if (current.evidence.length > 0) {
        await tx.viralDnaEvidence.createMany({
          data: current.evidence.map((e) => ({
            profileId: created.id,
            evidenceId: e.evidenceId,
            sourceType: e.sourceType,
            sourceId: e.sourceId,
            timestampStart: e.timestampStart,
            timestampEnd: e.timestampEnd,
            transcriptExcerpt: e.transcriptExcerpt,
            metricName: e.metricName,
            metricValue: e.metricValue,
            explanation: e.explanation,
          })),
        })
      }

      await tx.auditLog.create({
        data: { actorId: user.id, action: 'viral_dna_edited', entity: 'ViralDnaProfile', entityId: created.id, before: { profileVersion: current.profileVersion }, after: payload as never },
      })

      return created
    })

    return res.status(200).json({ profile: result })
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message })
    console.error(err)
    return res.status(500).json({ error: 'Internal error' })
  }
}
