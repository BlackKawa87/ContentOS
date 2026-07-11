import { prisma } from './prisma.js'
import { nextStage } from '../studyPipeline/stages.js'
import { stageRegistry } from '../studyPipeline/registry.js'
import { nextChannelStage } from '../reverseEnginePipeline/stages.js'
import { channelStageRegistry } from '../reverseEnginePipeline/registry.js'

const MAX_ATTEMPTS = 3

export interface AdvanceResult {
  jobId: string
  stage: string
  outcome: 'succeeded' | 'failed' | 'retry_scheduled'
  error?: string
}

/** Advances a single ProcessingJob by exactly one stage. Never chains stages.
 * Dispatches on `job.pipeline`: STUDY jobs use the Study Engine's video-scoped
 * stages/registry exactly as before; REVERSE_CHANNEL_IMPORT jobs use the
 * channel-scoped equivalent. The retry/attempts/audit-log mechanics below are
 * shared by both pipelines. */
export async function advanceJob(jobId: string): Promise<AdvanceResult> {
  const job = await prisma.processingJob.findUniqueOrThrow({
    where: { id: jobId },
    include: { video: true, channel: true },
  })

  const isChannelPipeline = job.pipeline === 'REVERSE_CHANNEL_IMPORT'
  const targetStage = isChannelPipeline ? nextChannelStage(job.stage) : nextStage(job.stage)

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

  const handler = isChannelPipeline ? channelStageRegistry[targetStage] : stageRegistry[targetStage]
  if (!handler) {
    throw new Error(`No handler registered for stage ${targetStage}`)
  }

  try {
    if (isChannelPipeline) {
      if (!job.channel) throw new Error(`ProcessingJob ${job.id} has no channel`)
      await channelStageRegistry[targetStage]!(job.channel)
    } else {
      if (!job.video) throw new Error(`ProcessingJob ${job.id} has no video`)
      await stageRegistry[targetStage]!(job.video)
    }

    const entityUpdate = isChannelPipeline
      ? prisma.channel.update({
          where: { id: job.channelId! },
          data: { status: targetStage === 'COMPLETED' ? 'READY' : 'IMPORTING' },
        })
      : prisma.video.update({
          where: { id: job.videoId! },
          data: { status: targetStage === 'COMPLETED' ? 'COMPLETED' : 'PROCESSING' },
        })

    await prisma.$transaction([
      prisma.processingJob.update({
        where: { id: job.id },
        data: { stage: targetStage, status: 'SUCCEEDED', completedAt: new Date() },
      }),
      entityUpdate,
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
        data: {
          pipeline: job.pipeline,
          videoId: job.videoId,
          channelId: job.channelId,
          stage: targetStage,
          status: 'PENDING',
        },
      })
    }

    return { jobId, stage: targetStage, outcome: 'succeeded' }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const attempts = job.attempts + 1
    const willRetry = attempts < job.maxAttempts

    const entityFailUpdate = isChannelPipeline
      ? prisma.channel.update({
          where: { id: job.channelId! },
          data: { status: willRetry ? 'IMPORTING' : 'FAILED' },
        })
      : prisma.video.update({
          where: { id: job.videoId! },
          data: { status: willRetry ? 'PROCESSING' : 'FAILED' },
        })

    await prisma.$transaction([
      prisma.processingJob.update({
        where: { id: job.id },
        data: {
          attempts,
          lastError: message,
          status: willRetry ? 'PENDING' : 'FAILED',
        },
      }),
      entityFailUpdate,
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

/** Advances the given channel's oldest PENDING job. Returns null if it has none queued. */
export async function advanceNextPendingJobForChannel(channelId: string): Promise<AdvanceResult | null> {
  const job = await prisma.processingJob.findFirst({
    where: { channelId, status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
  })
  if (!job) return null
  return advanceJob(job.id)
}

export { MAX_ATTEMPTS }
