import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireUser, HttpError } from '../../server/lib/auth'
import { prisma } from '../../server/lib/prisma'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const user = await requireUser(req)

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST')
      return res.status(405).json({ error: 'Method not allowed' })
    }

    const { jobId } = req.body ?? {}
    if (typeof jobId !== 'string') return res.status(400).json({ error: 'jobId is required' })

    const job = await prisma.processingJob.update({
      where: { id: jobId },
      data: { status: 'PENDING', attempts: 0, lastError: null, retriedById: user.id },
    })

    await prisma.auditLog.create({
      data: { actorId: user.id, action: 'manual_retry', entity: 'ProcessingJob', entityId: job.id },
    })

    return res.status(200).json({ job })
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message })
    console.error(err)
    return res.status(500).json({ error: 'Internal error' })
  }
}
