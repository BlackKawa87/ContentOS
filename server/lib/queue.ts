import { prisma } from './prisma.js'
import { nextStage } from '../studyPipeline/stages.js'
import { stageRegistry } from '../studyPipeline/registry.js'
import { nextChannelStage } from '../reverseEnginePipeline/stages.js'
import { channelStageRegistry } from '../reverseEnginePipeline/registry.js'
import { nextVideoAnalysisStage } from '../videoAnalysisPipeline/stages.js'
import { videoAnalysisStageRegistry } from '../videoAnalysisPipeline/registry.js'
import { nextViralDnaStage } from '../viralDnaPipeline/stages.js'
import { viralDnaStageRegistry } from '../viralDnaPipeline/registry.js'
import type { VideoStatus } from '../generated/prisma/enums.js'

const MAX_ATTEMPTS = 3

export interface AdvanceResult {
  jobId: string
  stage: string
  outcome: 'succeeded' | 'failed' | 'retry_scheduled'
  error?: string
}

/** Video-scoped pipelines each have their own terminal VideoStatus — VIDEO_ANALYSIS and STUDY
 * both use the generic 'COMPLETED', but VIRAL_DNA has its own distinct terminal status since
 * a video can complete both pipelines independently and the UI needs to tell them apart. */
function videoTerminalStatus(pipeline: string): VideoStatus {
  return pipeline === 'VIRAL_DNA' ? 'VIRAL_DNA_COMPLETED' : 'COMPLETED'
}

/** Advances a single ProcessingJob by exactly one stage. Never chains stages.
 * Dispatches on `job.pipeline`: STUDY, VIDEO_ANALYSIS, and VIRAL_DNA jobs are video-scoped
 * (each has its own stages/registry — never shared, per the "never share business logic"
 * rule); REVERSE_CHANNEL_IMPORT jobs are channel-scoped. The retry/attempts/audit-log
 * mechanics below are shared by all four pipelines. */
export async function advanceJob(jobId: string): Promise<AdvanceResult> {
  const job = await prisma.processingJob.findUniqueOrThrow({
    where: { id: jobId },
    include: { video: true, channel: true },
  })

  const isChannelPipeline = job.pipeline === 'REVERSE_CHANNEL_IMPORT'
  const isVideoAnalysisPipeline = job.pipeline === 'VIDEO_ANALYSIS'
  const isViralDnaPipeline = job.pipeline === 'VIRAL_DNA'
  const pipelineNextStage = isChannelPipeline
    ? nextChannelStage
    : isVideoAnalysisPipeline
      ? nextVideoAnalysisStage
      : isViralDnaPipeline
        ? nextViralDnaStage
        : nextStage
  const targetStage = pipelineNextStage(job.stage)

  if (!targetStage) {
    await prisma.processingJob.update({
      where: { id: job.id },
      data: { status: 'SUCCEEDED', completedAt: new Date() },
    })
    return { jobId, stage: job.stage, outcome: 'succeeded' }
  }

  // A pipeline's own STAGE_ORDER (not the hardcoded 'COMPLETED' string) decides terminality,
  // since VIDEO_ANALYSIS deliberately ends at READY_FOR_VIRAL_DNA rather than 'COMPLETED'.
  const isFinalStage = pipelineNextStage(targetStage) === null

  await prisma.processingJob.update({
    where: { id: job.id },
    data: { status: 'RUNNING', startedAt: job.startedAt ?? new Date() },
  })

  const handler = isChannelPipeline
    ? channelStageRegistry[targetStage]
    : isVideoAnalysisPipeline
      ? videoAnalysisStageRegistry[targetStage]
      : isViralDnaPipeline
        ? viralDnaStageRegistry[targetStage]
        : stageRegistry[targetStage]
  if (!handler) {
    throw new Error(`No handler registered for stage ${targetStage}`)
  }

  try {
    if (isChannelPipeline) {
      if (!job.channel) throw new Error(`ProcessingJob ${job.id} has no channel`)
      await channelStageRegistry[targetStage]!(job.channel)
    } else if (isVideoAnalysisPipeline) {
      if (!job.video) throw new Error(`ProcessingJob ${job.id} has no video`)
      await videoAnalysisStageRegistry[targetStage]!(job.video)
    } else if (isViralDnaPipeline) {
      if (!job.video) throw new Error(`ProcessingJob ${job.id} has no video`)
      await viralDnaStageRegistry[targetStage]!(job.video)
    } else {
      if (!job.video) throw new Error(`ProcessingJob ${job.id} has no video`)
      await stageRegistry[targetStage]!(job.video)
    }

    const entityUpdate = isChannelPipeline
      ? prisma.channel.update({
          where: { id: job.channelId! },
          data: { status: isFinalStage ? 'READY' : 'IMPORTING' },
        })
      : prisma.video.update({
          where: { id: job.videoId! },
          data: { status: isFinalStage ? videoTerminalStatus(job.pipeline) : 'PROCESSING' },
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

    if (!isFinalStage) {
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
