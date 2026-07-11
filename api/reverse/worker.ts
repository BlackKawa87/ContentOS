import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireUser, HttpError } from '../../server/lib/auth.js'
import {
  advanceJob,
  advanceNextPendingJob,
  advanceNextPendingJobForChannel,
} from '../../server/lib/queue.js'

export const config = { maxDuration: 300 }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    await requireUser(req)

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST')
      return res.status(405).json({ error: 'Method not allowed' })
    }

    const { jobId, channelId } = req.body ?? {}
    const result =
      typeof jobId === 'string'
        ? await advanceJob(jobId)
        : typeof channelId === 'string'
          ? await advanceNextPendingJobForChannel(channelId)
          : await advanceNextPendingJob()

    if (!result) return res.status(200).json({ message: 'queue empty' })
    return res.status(200).json(result)
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message })
    console.error(err)
    return res.status(500).json({ error: 'Internal error' })
  }
}
