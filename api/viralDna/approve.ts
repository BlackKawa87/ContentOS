import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireUser, HttpError } from '../../server/lib/auth.js'
import { prisma } from '../../server/lib/prisma.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const user = await requireUser(req)

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST')
      return res.status(405).json({ error: 'Method not allowed' })
    }

    const { profileId } = req.body ?? {}
    if (typeof profileId !== 'string') return res.status(400).json({ error: 'profileId is required' })

    const profile = await prisma.viralDnaProfile.findUniqueOrThrow({
      where: { id: profileId },
      include: { video: { include: { project: true } } },
    })
    if (profile.video.project.ownerId !== user.id) throw new HttpError(403, 'Forbidden')
    if (profile.status !== 'VALIDATED') {
      return res.status(400).json({ error: `Cannot approve a profile with status ${profile.status} — it must pass validation first` })
    }

    const updated = await prisma.viralDnaProfile.update({
      where: { id: profileId },
      data: { status: 'APPROVED' },
    })

    await prisma.auditLog.create({
      data: { actorId: user.id, action: 'viral_dna_approved', entity: 'ViralDnaProfile', entityId: profileId },
    })

    return res.status(200).json({ profile: updated })
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message })
    console.error(err)
    return res.status(500).json({ error: 'Internal error' })
  }
}
