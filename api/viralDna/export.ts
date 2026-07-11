import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireUser, HttpError } from '../../server/lib/auth.js'
import { prisma } from '../../server/lib/prisma.js'

/** Assembles the schema-versioned JSON export (Module 13's shape) for a profile version —
 * relational columns + JSON sections + child tables, all in one document. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const user = await requireUser(req)

    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET')
      return res.status(405).json({ error: 'Method not allowed' })
    }

    const { videoId, version } = req.query
    if (typeof videoId !== 'string') return res.status(400).json({ error: 'videoId is required' })

    const video = await prisma.video.findUniqueOrThrow({ where: { id: videoId }, include: { project: true } })
    if (video.project.ownerId !== user.id) throw new HttpError(403, 'Forbidden')

    const profile = await prisma.viralDnaProfile.findFirst({
      where: {
        videoId,
        ...(typeof version === 'string' ? { profileVersion: Number(version) } : { isCurrent: true }),
      },
      include: { scores: true, hypotheses: true, evidence: true, validationResults: { orderBy: { createdAt: 'desc' }, take: 1 } },
    })
    if (!profile) return res.status(404).json({ error: 'Viral DNA profile not found' })

    const document = {
      schemaVersion: profile.schemaVersion,
      profileVersion: profile.profileVersion,
      videoId: profile.videoId,
      channelId: video.channelId,
      generatedAt: profile.generatedAt,
      status: profile.status,
      sourceVersions: profile.sourceSnapshot,
      metrics: profile.metrics,
      hook: profile.hook,
      narrative: profile.narrative,
      retention: profile.retention,
      visual: profile.visual,
      audio: profile.audio,
      emotion: profile.emotion,
      informationDensity: profile.informationDensity,
      performance: profile.performance,
      hypotheses: profile.hypotheses,
      scorecard: Object.fromEntries(profile.scores.map((s) => [s.scoreName, s.value])),
      confidence: {
        overallConfidenceScore: profile.overallConfidenceScore,
        overallRetentionScore: profile.overallRetentionScore,
      },
      evidenceIndex: profile.evidence,
      warnings: profile.warnings,
      limitations: profile.limitations,
      validation: profile.validationResults[0] ?? null,
    }

    res.setHeader('Content-Disposition', `attachment; filename="viral-dna-${videoId}-v${profile.profileVersion}.json"`)
    return res.status(200).json(document)
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message })
    console.error(err)
    return res.status(500).json({ error: 'Internal error' })
  }
}
