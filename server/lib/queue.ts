import { prisma } from './prisma.ts'
import { nextStage } from '../studyPipeline/stages.ts'
import { stageRegistry } from '../studyPipeline/registry.ts'

const MAX_ATTEMPTS = 3

export interface AdvanceResult {
  jobId: string
  stage: string
  outcome: 'succeeded' | 'failed' | 'retry_scheduled'
  error?: string
}

/** Advances a single ProcessingJob by exactly one stage. Never chains stages. */
export async function advanceJob(jobId: string): Promise<AdvanceResult> {
  const job = await prisma.processingJob.findUniqueOrThrow({
    where: { id: jobId },
    include: { video: true },
  })

  const targetStage = nextStage(job.stage)
  if (!targetStage) {
    await prisma.processingJob.update({
      where: { id: job.id },
      data: { status: 'SUCCEEDED', completedAt: new Date() },
    })
    return { jobId, stage: job.stage, outcome: 'succeeded' }
  }

  await prisma.processingJob.update({
    where: { id: job.id },
    data: { status: 'RUNNING', startedAt: job.startedAt ?? new Date() },
  })

  const handler = stageRegistry[targetStage]
  if (!handler) {
    throw new Error(`No handler registered for stage ${targetStage}`)
  }

  try {
    await handler(job.video)

    await prisma.$transaction([
      prisma.processingJob.update({
        where: { id: job.id },
        data: { stage: targetStage, status: 'SUCCEEDED', completedAt: new Date() },
      }),
      prisma.video.update({
        where: { id: job.videoId },
        data: {
          status: targetStage === 'COMPLETED' ? 'COMPLETED' : 'PROCESSING',
        },
      }),
      prisma.auditLog.create({
        data: {
          action: 'stage_advanced',
          entity: 'ProcessingJob',
          entityId: job.id,
          after: { stage: targetStage },
        },
      }),
    ])

    if (targetStage !== 'COMPLETED') {
      await prisma.processingJob.create({
        data: { videoId: job.videoId, stage: targetStage, status: 'PENDING' },
      })
    }

    return { jobId, stage: targetStage, outcome: 'succeeded' }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const attempts = job.attempts + 1
    const willRetry = attempts < job.maxAttempts

    await prisma.$transaction([
      prisma.processingJob.update({
        where: { id: job.id },
        data: {
          attempts,
          lastError: message,
          status: willRetry ? 'PENDING' : 'FAILED',
        },
      }),
      prisma.video.update({
        where: { id: job.videoId },
        data: { status: willRetry ? 'PROCESSING' : 'FAILED' },
      }),
      prisma.auditLog.create({
        data: {
          action: willRetry ? 'stage_retry_scheduled' : 'stage_failed',
          entity: 'ProcessingJob',
          entityId: job.id,
          after: { targetStage, attempts, error: message },
        },
      }),
    ])

    return { jobId, stage: targetStage, outcome: willRetry ? 'retry_scheduled' : 'failed', error: message }
  }
}

/** Picks the oldest PENDING job across all videos and advances it. Returns null if the queue is empty. */
export async function advanceNextPendingJob(): Promise<AdvanceResult | null> {
  const job = await prisma.processingJob.findFirst({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
  })
  if (!job) return null
  return advanceJob(job.id)
}

/** Advances the given video's oldest PENDING job. Returns null if it has none queued. */
export async function advanceNextPendingJobForVideo(videoId: string): Promise<AdvanceResult | null> {
  const job = await prisma.processingJob.findFirst({
    where: { videoId, status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
  })
  if (!job) return null
  return advanceJob(job.id)
}

export { MAX_ATTEMPTS }
