import type { VideoModel as Video } from '../generated/prisma/models.js'
import { prisma } from '../lib/prisma.js'
import { downloadVideo } from '../lib/ytdlp.js'
import { uploadAsset } from '../lib/storage.js'
import { getVideoContext } from './common.js'

/** Module 1: downloads the source video and records it as the pipeline's starting asset. */
export async function videoDownloadedStage(video: Video): Promise<void> {
  const { projectId, profile } = await getVideoContext(video)

  const startedAt = Date.now()
  const result = await downloadVideo(video.sourceUrl)
  const downloadDurationMs = Date.now() - startedAt

  const videoStoragePath = await uploadAsset({
    bucket: 'VIDEOS',
    ownerId: profile.id,
    projectId,
    videoId: video.id,
    filename: 'source.mp4',
    data: result.buffer,
    contentType: 'video/mp4',
  })

  await prisma.video.update({
    where: { id: video.id },
    data: {
      title: video.title ?? result.title,
      durationSec: video.durationSec ?? result.durationSec,
    },
  })

  await prisma.videoAnalysis.upsert({
    where: { videoId: video.id },
    create: {
      videoId: video.id,
      videoStoragePath,
      fileSizeBytes: result.buffer.byteLength,
      downloadDurationMs,
      downloadFormat: result.ext,
    },
    update: {
      videoStoragePath,
      fileSizeBytes: result.buffer.byteLength,
      downloadDurationMs,
      downloadFormat: result.ext,
    },
  })
}
