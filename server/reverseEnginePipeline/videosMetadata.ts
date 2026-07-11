import type { ChannelModel as Channel } from '../generated/prisma/models.js'
import { prisma } from '../lib/prisma.js'
import { getVideoMetadata } from '../lib/ytdlp.js'

export async function videosMetadataStage(channel: Channel): Promise<void> {
  const pending = await prisma.video.findMany({
    where: { channelId: channel.id, status: 'NOT_IMPORTED' },
  })

  for (const video of pending) {
    const meta = await getVideoMetadata(video.sourceUrl)

    await prisma.video.update({
      where: { id: video.id },
      data: {
        title: meta.title,
        thumbnailUrl: meta.thumbnailUrl ?? video.thumbnailUrl,
        durationSec: meta.durationSec,
        publishedAt: meta.publishedAt,
        language: meta.language,
        tags: meta.tags ?? undefined,
        chapters: meta.chapters ?? undefined,
        views: meta.views,
        likes: meta.likes,
        comments: meta.comments,
        status: 'READY',
      },
    })
  }
}
