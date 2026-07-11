import type { ChannelModel as Channel } from '../generated/prisma/models.js'
import { prisma } from '../lib/prisma.js'
import {
  detectYoutubeInputType,
  getChannelListing,
  getPlaylistListing,
  getVideoMetadata,
} from '../lib/ytdlp.js'

/** Resolves the channel a given input URL belongs to, regardless of whether the
 * user pasted a channel, playlist, or single-video URL. */
async function resolveChannelUrl(sourceUrl: string): Promise<string> {
  const inputType = detectYoutubeInputType(sourceUrl)
  if (inputType === 'CHANNEL') return sourceUrl

  const derived =
    inputType === 'PLAYLIST'
      ? (await getPlaylistListing(sourceUrl, 1)).channelUrl
      : (await getVideoMetadata(sourceUrl)).channelUrl

  return derived ?? sourceUrl
}

export async function channelMetadataStage(channel: Channel): Promise<void> {
  const channelUrl = await resolveChannelUrl(channel.sourceUrl)
  const listing = await getChannelListing(channelUrl, 1)

  await prisma.channel.update({
    where: { id: channel.id },
    data: {
      youtubeChannelId: listing.youtubeChannelId,
      handle: listing.handle,
      title: listing.title,
      description: listing.description,
      thumbnailUrl: listing.thumbnailUrl,
    },
  })
}
