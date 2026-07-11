import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireUser, HttpError } from '../../server/lib/auth.js'
import { prisma } from '../../server/lib/prisma.js'
import { viralDnaStageRegistry } from '../../server/viralDnaPipeline/registry.js'
import { viralDnaValidatedStage } from '../../server/viralDnaPipeline/viralDnaValidated.js'
import type { JobStage } from '../../server/generated/prisma/enums.js'

export const config = { maxDuration: 120 }

/** Partial regeneration (Test 7): re-runs exactly one stage against the video's current
 * working profile, patching just that section in place — does not create a new
 * profileVersion, and does not touch any other section. Re-validates afterward. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const user = await requireUser(req)

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST')
      return res.status(405).json({ error: 'Method not allowed' })
    }

    const { videoId, stage } = req.body ?? {}
    if (typeof videoId !== 'string' || typeof stage !== 'string') {
      return res.status(400).json({ error: 'videoId and stage are required' })
    }

    const handler = viralDnaStageRegistry[stage as JobStage]
    if (!handler || stage === 'VIRAL_DNA_VALIDATED' || stage === 'VIRAL_DNA_COMPLETED') {
      return res.status(400).json({ error: `Stage ${stage} is not individually regenerable` })
    }

    const video = await prisma.video.findUniqueOrThrow({
      where: { id: videoId },
      include: { project: true },
    })
    if (video.project.ownerId !== user.id) throw new HttpError(403, 'Forbidden')

    await handler(video)
    await viralDnaValidatedStage(video)

    await prisma.auditLog.create({
      data: { actorId: user.id, action: 'partial_regeneration', entity: 'Video', entityId: video.id, after: { stage } },
    })

    const profile = await prisma.viralDnaProfile.findFirstOrThrow({
      where: { videoId },
      orderBy: { profileVersion: 'desc' },
    })

    return res.status(200).json({ profile })
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message })
    console.error(err)
    return res.status(500).json({ error: 'Internal error' })
  }
}
