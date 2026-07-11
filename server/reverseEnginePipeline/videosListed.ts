import type { ChannelModel as Channel } from '../generated/prisma/models.js'
import { prisma } from '../lib/prisma.js'
import {
  detectYoutubeInputType,
  getChannelListing,
  getPlaylistListing,
  toChannelVideosUrl,
  type FlatEntry,
} from '../lib/ytdlp.js'
import { getChannelContext } from './common.js'

async function upsertEntries(channel: Channel, entries: FlatEntry[], playlistId: string | null) {
  for (const entry of entries) {
    const existing = await prisma.video.findFirst({
      where: { channelId: channel.id, youtubeVideoId: entry.youtubeVideoId },
    })

    if (existing) {
      await prisma.video.update({
        where: { id: existing.id },
        data: { playlistId: playlistId ?? existing.playlistId },
      })
      continue
    }

    await prisma.video.create({
      data: {
        projectId: channel.projectId,
        channelId: channel.id,
        playlistId,
        sourceUrl: entry.url,
        sourceType: 'YOUTUBE_VIDEO',
        youtubeVideoId: entry.youtubeVideoId,
        title: entry.title,
        thumbnailUrl: entry.thumbnailUrl,
        durationSec: entry.durationSec,
        status: 'NOT_IMPORTED',
      },
    })
  }
}

async function upsertPlaylist(
  channel: Channel,
  youtubePlaylistId: string,
  title: string | null,
  thumbnailUrl: string | null,
  videoCount: number,
) {
  const existing = await prisma.playlist.findFirst({
    where: { channelId: channel.id, youtubePlaylistId },
  })

  if (existing) {
    return prisma.playlist.update({
      where: { id: existing.id },
      data: { title, thumbnailUrl, videoCount, importedAt: new Date() },
    })
  }

  return prisma.playlist.create({
    data: { channelId: channel.id, youtubePlaylistId, title, thumbnailUrl, videoCount, importedAt: new Date() },
  })
}

export async function videosListedStage(channel: Channel): Promise<void> {
  const { profile } = await getChannelContext(channel)
  const maxVideos = Math.min(profile.reverseDefaultImportLimit, profile.reverseMaxVideos)
  const inputType = detectYoutubeInputType(channel.sourceUrl)

  if (inputType === 'PLAYLIST') {
    const listing = await getPlaylistListing(channel.sourceUrl, maxVideos)
    const playlist = await upsertPlaylist(
      channel,
      listing.youtubePlaylistId,
      listing.playlistTitle,
      listing.playlistThumbnailUrl,
      listing.entries.length,
    )
    await upsertEntries(channel, listing.entries, playlist.id)
    return
  }

  if (inputType === 'VIDEO') {
    const url = new URL(channel.sourceUrl)
    const videoId = url.hostname === 'youtu.be' ? url.pathname.slice(1) : url.searchParams.get('v')
    if (!videoId) throw new Error(`Could not extract video id from ${channel.sourceUrl}`)

    await upsertEntries(
      channel,
      [{ youtubeVideoId: videoId, title: 'Untitled', url: channel.sourceUrl, thumbnailUrl: null, durationSec: null }],
      null,
    )
    return
  }

  const listing = await getChannelListing(toChannelVideosUrl(channel.sourceUrl), maxVideos)
  await upsertEntries(channel, listing.entries, null)
}
