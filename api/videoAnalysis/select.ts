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

    const { videoId } = req.body ?? {}
    if (typeof videoId !== 'string' || videoId.length === 0) {
      return res.status(400).json({ error: 'videoId is required' })
    }

    const video = await prisma.video.findUniqueOrThrow({
      where: { id: videoId },
      include: { project: true },
    })
    if (video.project.ownerId !== user.id) throw new HttpError(403, 'Forbidden')

    const job = await prisma.processingJob.create({
      data: { pipeline: 'VIDEO_ANALYSIS', videoId: video.id, stage: 'VIDEO_SELECTED', status: 'PENDING' },
    })

    return res.status(201).json({ video, job })
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message })
    console.error(err)
    return res.status(500).json({ error: 'Internal error' })
  }
}
