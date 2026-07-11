import type { VideoModel as Video } from '../generated/prisma/models'
import { prisma } from '../lib/prisma'
import { downloadVideo } from '../lib/ytdlp'
import { uploadAsset } from '../lib/storage'
import { getVideoContext } from './common'

export async function downloadStage(video: Video): Promise<void> {
  const { projectId, profile } = await getVideoContext(video)

  const result = await downloadVideo(video.sourceUrl)

  await uploadAsset({
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
    data: { title: video.title ?? result.title, durationSec: result.durationSec },
  })
}
