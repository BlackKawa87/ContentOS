import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireUser, HttpError } from '../../server/lib/auth.ts'
import { prisma } from '../../server/lib/prisma.ts'

function detectSourceType(url: string): 'YOUTUBE_VIDEO' | 'YOUTUBE_PLAYLIST' | 'MP4' | 'MP3' {
  if (/[?&]list=/.test(url)) return 'YOUTUBE_PLAYLIST'
  if (/youtube\.com|youtu\.be/.test(url)) return 'YOUTUBE_VIDEO'
  if (/\.mp3(\?|$)/.test(url)) return 'MP3'
  return 'MP4'
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const user = await requireUser(req)

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST')
      return res.status(405).json({ error: 'Method not allowed' })
    }

    const { sourceUrl, title } = req.body ?? {}
    if (typeof sourceUrl !== 'string' || sourceUrl.length === 0) {
      return res.status(400).json({ error: 'sourceUrl is required' })
    }

    const project = await prisma.project.create({
      data: {
        ownerId: user.id,
        title: title || sourceUrl,
        type: 'STUDY',
      },
    })

    const video = await prisma.video.create({
      data: {
        projectId: project.id,
        sourceUrl,
        sourceType: detectSourceType(sourceUrl),
        title: title || null,
        status: 'QUEUED',
      },
    })

    const job = await prisma.processingJob.create({
      data: { videoId: video.id, stage: 'QUEUED', status: 'PENDING' },
    })

    return res.status(201).json({ project, video, job })
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message })
    console.error(err)
    return res.status(500).json({ error: 'Internal error' })
  }
}
