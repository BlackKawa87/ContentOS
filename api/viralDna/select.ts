import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireUser, HttpError } from '../../server/lib/auth.js'
import { prisma } from '../../server/lib/prisma.js'

/** Default safeguard (Module 20): don't let a user fan out unbounded concurrent generations. */
const MAX_CONCURRENT_JOBS = 3

/** Rough per-video cost heuristic (~7 lightweight gpt-4o-mini calls, none with images) —
 * a flat base plus a small duration-scaled component, shown to the user before they commit. */
function estimateCostUsd(durationSec: number): number {
  const base = 0.02
  const durationComponent = (durationSec / 3600) * 0.05
  return Math.round((base + durationComponent) * 1000) / 1000
}

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
      include: { project: true, videoAnalysis: true },
    })
    if (video.project.ownerId !== user.id) throw new HttpError(403, 'Forbidden')
    if (!video.videoAnalysis?.readyForViralDnaAt) {
      return res.status(400).json({ error: 'This video has not completed the Video Analysis pipeline yet' })
    }

    const activeJobCount = await prisma.processingJob.count({
      where: {
        pipeline: 'VIRAL_DNA',
        status: { in: ['PENDING', 'RUNNING'] },
        video: { project: { ownerId: user.id } },
      },
    })
    if (activeJobCount >= MAX_CONCURRENT_JOBS) {
      return res.status(429).json({ error: `Maximum ${MAX_CONCURRENT_JOBS} concurrent Viral DNA generations allowed` })
    }

    const latest = await prisma.viralDnaProfile.findFirst({
      where: { videoId },
      orderBy: { profileVersion: 'desc' },
    })
    const profileVersion = (latest?.profileVersion ?? 0) + 1

    const [profile, job] = await prisma.$transaction([
      prisma.viralDnaProfile.create({
        data: { videoId, profileVersion, isCurrent: false, status: 'DRAFT', createdById: user.id },
      }),
      prisma.processingJob.create({
        data: { pipeline: 'VIRAL_DNA', videoId, stage: 'VIRAL_DNA_QUEUED', status: 'PENDING' },
      }),
    ])

    return res.status(201).json({ profile, job, estimatedCostUsd: estimateCostUsd(video.durationSec ?? 0) })
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message })
    console.error(err)
    return res.status(500).json({ error: 'Internal error' })
  }
}
