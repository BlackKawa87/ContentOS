import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireUser, HttpError } from '../../server/lib/auth.js'
import { prisma } from '../../server/lib/prisma.js'
import { detectYoutubeInputType } from '../../server/lib/ytdlp.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const user = await requireUser(req)

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST')
      return res.status(405).json({ error: 'Method not allowed' })
    }

    const { sourceUrl } = req.body ?? {}
    if (typeof sourceUrl !== 'string' || sourceUrl.length === 0) {
      return res.status(400).json({ error: 'sourceUrl is required' })
    }

    try {
      detectYoutubeInputType(sourceUrl)
    } catch {
      return res.status(400).json({ error: 'Unrecognized YouTube URL' })
    }

    const project = await prisma.project.create({
      data: { ownerId: user.id, title: sourceUrl, type: 'REVERSE_ENGINEERING' },
    })

    const channel = await prisma.channel.create({
      data: { projectId: project.id, sourceUrl, status: 'PENDING' },
    })

    const job = await prisma.processingJob.create({
      data: { pipeline: 'REVERSE_CHANNEL_IMPORT', channelId: channel.id, stage: 'QUEUED', status: 'PENDING' },
    })

    return res.status(201).json({ project, channel, job })
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message })
    console.error(err)
    return res.status(500).json({ error: 'Internal error' })
  }
}
