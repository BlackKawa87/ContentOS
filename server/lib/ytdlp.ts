import * as YtDlpWrapModule from 'yt-dlp-wrap'
import { readFile, writeFile, unlink, chmod, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { unwrapDefault } from './interop.js'

const YtDlpWrap = unwrapDefault<typeof import('yt-dlp-wrap').default>(YtDlpWrapModule)

/**
 * yt-dlp-wrap's own downloadFromGithub always fetches the generic `yt-dlp`
 * asset (a Python zipapp requiring Python 3.10+), which isn't reliably
 * available on either a dev machine or Vercel's Linux runtime. We instead
 * fetch the platform-specific standalone binary (no Python dependency).
 */
function standaloneAssetName(): string {
  if (process.platform === 'darwin') return 'yt-dlp_macos'
  if (process.platform === 'win32') return 'yt-dlp.exe'
  return 'yt-dlp_linux'
}

async function downloadStandaloneBinary(filePath: string): Promise<void> {
  const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${standaloneAssetName()}`
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok || !response.body) throw new Error(`Failed to download yt-dlp: ${response.status}`)

  const buffer = Buffer.from(await response.arrayBuffer())
  const expectedSize = Number(response.headers.get('content-length') ?? 0)
  if (expectedSize > 0 && buffer.byteLength !== expectedSize) {
    throw new Error(`yt-dlp download truncated: got ${buffer.byteLength} bytes, expected ${expectedSize}`)
  }

  await writeFile(filePath, buffer)
  await chmod(filePath, 0o755)
}

let ytDlpWrap: InstanceType<typeof YtDlpWrap> | null = null

async function getYtDlp() {
  if (ytDlpWrap) return ytDlpWrap
  const binaryPath = path.join(tmpdir(), 'yt-dlp-standalone')

  let needsDownload = true
  try {
    const s = await stat(binaryPath)
    needsDownload = s.size === 0
  } catch {
    needsDownload = true
  }
  if (needsDownload) await downloadStandaloneBinary(binaryPath)

  ytDlpWrap = new YtDlpWrap(binaryPath)
  return ytDlpWrap
}

export interface DownloadResult {
  buffer: Buffer
  title: string
  durationSec: number
  ext: string
}

/** Downloads a YouTube (or direct MP4/MP3) URL to a temp file, returns its bytes + basic metadata. */
export async function downloadVideo(sourceUrl: string): Promise<DownloadResult> {
  const ytDlp = await getYtDlp()
  const outPath = path.join(tmpdir(), `${randomUUID()}.mp4`)

  await ytDlp.execPromise([
    sourceUrl,
    '-f',
    'best[ext=mp4]/best',
    '-o',
    outPath,
    '--no-playlist',
  ])

  const metadataRaw = await ytDlp.execPromise([sourceUrl, '--dump-json', '--no-playlist'])
  const metadata = JSON.parse(metadataRaw)

  const buffer = await readFile(outPath)
  await unlink(outPath).catch(() => {})

  return {
    buffer,
    title: metadata.title ?? 'Untitled',
    durationSec: Math.round(metadata.duration ?? 0),
    ext: 'mp4',
  }
}

// ---------------------------------------------------------------------------
// Reverse Engineering Engine: metadata-only fetchers (no download)
// ---------------------------------------------------------------------------

export type YoutubeInputType = 'CHANNEL' | 'PLAYLIST' | 'VIDEO'

/** Detects channel / playlist / single-video URLs without ever asking the user to choose. */
export function detectYoutubeInputType(rawUrl: string): YoutubeInputType {
  const url = new URL(rawUrl)

  if (url.hostname === 'youtu.be') return 'VIDEO'
  if (url.pathname === '/watch' && url.searchParams.has('v')) return 'VIDEO'
  if (url.pathname === '/playlist' && url.searchParams.has('list')) return 'PLAYLIST'
  if (/^\/(@|channel\/|c\/|user\/)/.test(url.pathname)) return 'CHANNEL'

  throw new Error(`Unrecognized YouTube URL: ${rawUrl}`)
}

interface RawThumbnail {
  url?: string
}

function pickThumbnail(thumbnails: unknown): string | null {
  if (!Array.isArray(thumbnails) || thumbnails.length === 0) return null
  const last = thumbnails[thumbnails.length - 1] as RawThumbnail
  return typeof last?.url === 'string' ? last.url : null
}

export interface FlatEntry {
  youtubeVideoId: string
  title: string
  url: string
  thumbnailUrl: string | null
  durationSec: number | null
}

export interface ChannelListing {
  youtubeChannelId: string | null
  handle: string | null
  title: string | null
  description: string | null
  thumbnailUrl: string | null
  channelUrl: string | null
  entries: FlatEntry[]
}

export interface PlaylistListing extends ChannelListing {
  youtubePlaylistId: string
  playlistTitle: string | null
  playlistThumbnailUrl: string | null
}

async function dumpFlatJson(url: string, maxItems: number): Promise<Record<string, unknown>> {
  const ytDlp = await getYtDlp()
  const raw = await ytDlp.execPromise([
    url,
    '--flat-playlist',
    '--dump-single-json',
    '--playlist-end',
    String(Math.max(1, maxItems)),
    '--no-warnings',
  ])
  return JSON.parse(raw)
}

interface RawFlatEntry {
  id?: string
  title?: string
  url?: string
  thumbnails?: unknown
  duration?: number
}

function mapEntries(raw: unknown): FlatEntry[] {
  if (!Array.isArray(raw)) return []
  return (raw as RawFlatEntry[])
    .filter((e) => typeof e?.id === 'string')
    .map((e) => ({
      youtubeVideoId: e.id!,
      title: e.title ?? 'Untitled',
      url: e.url ?? `https://www.youtube.com/watch?v=${e.id}`,
      thumbnailUrl: pickThumbnail(e.thumbnails),
      durationSec: typeof e.duration === 'number' ? Math.round(e.duration) : null,
    }))
}

function mapListing(data: Record<string, unknown>): ChannelListing {
  const uploaderId = typeof data.uploader_id === 'string' ? data.uploader_id : null
  return {
    youtubeChannelId:
      (typeof data.channel_id === 'string' ? data.channel_id : null) ?? uploaderId,
    handle: uploaderId?.startsWith('@') ? uploaderId : null,
    title:
      (typeof data.channel === 'string' ? data.channel : null) ??
      (typeof data.uploader === 'string' ? data.uploader : null) ??
      (typeof data.title === 'string' ? data.title : null),
    description: typeof data.description === 'string' ? data.description : null,
    thumbnailUrl: pickThumbnail(data.thumbnails),
    channelUrl: deriveChannelUrl(data),
    entries: mapEntries(data.entries),
  }
}

/** A bare channel URL (e.g. /@handle) resolves to a multi-tab page (Videos/Shorts/Live) —
 * yt-dlp's flat-playlist extraction returns each TAB as an entry, not actual videos.
 * Pointing at the channel's "videos" tab explicitly is required to list real videos. */
export function toChannelVideosUrl(channelUrl: string): string {
  const trimmed = channelUrl.replace(/\/+$/, '')
  return /\/(videos|shorts|streams)$/.test(trimmed) ? trimmed : `${trimmed}/videos`
}

/** Fetches a channel's identity + up to `maxVideos` of its uploaded videos (shallow entries), no downloads. */
export async function getChannelListing(url: string, maxVideos: number): Promise<ChannelListing> {
  const data = await dumpFlatJson(url, maxVideos)
  return mapListing(data)
}

/** Fetches a playlist's identity + up to `maxVideos` of its entries (shallow), no downloads. */
export async function getPlaylistListing(url: string, maxVideos: number): Promise<PlaylistListing> {
  const data = await dumpFlatJson(url, maxVideos)
  const listing = mapListing(data)
  return {
    ...listing,
    youtubePlaylistId:
      (typeof data.id === 'string' ? data.id : null) ??
      (typeof data.playlist_id === 'string' ? data.playlist_id : null) ??
      '',
    playlistTitle: typeof data.title === 'string' ? data.title : null,
    playlistThumbnailUrl: pickThumbnail(data.thumbnails),
  }
}

/** Resolves the parent channel URL from a video's or playlist's own metadata, if present. */
export function deriveChannelUrl(meta: Record<string, unknown>): string | null {
  if (typeof meta.channel_url === 'string') return meta.channel_url
  if (typeof meta.uploader_url === 'string') return meta.uploader_url
  if (typeof meta.channel_id === 'string') return `https://www.youtube.com/channel/${meta.channel_id}`
  return null
}

export interface VideoMetadata {
  youtubeVideoId: string
  title: string
  description: string | null
  thumbnailUrl: string | null
  durationSec: number | null
  publishedAt: Date | null
  language: string | null
  tags: string[] | null
  chapters: unknown | null
  views: number | null
  likes: number | null
  comments: number | null
  channelUrl: string | null
}

function parseUploadDate(uploadDate: unknown): Date | null {
  if (typeof uploadDate !== 'string' || uploadDate.length !== 8) return null
  const iso = `${uploadDate.slice(0, 4)}-${uploadDate.slice(4, 6)}-${uploadDate.slice(6, 8)}T00:00:00Z`
  const parsed = new Date(iso)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/** Fetches full metadata for a single video (no download, no --dump-json playlist expansion). */
export async function getVideoMetadata(url: string): Promise<VideoMetadata> {
  const ytDlp = await getYtDlp()
  const raw = await ytDlp.execPromise([url, '--dump-json', '--no-playlist', '--no-warnings'])
  const m = JSON.parse(raw) as Record<string, unknown>

  return {
    youtubeVideoId: String(m.id ?? ''),
    title: typeof m.title === 'string' ? m.title : 'Untitled',
    description: typeof m.description === 'string' ? m.description : null,
    thumbnailUrl: pickThumbnail(m.thumbnails) ?? (typeof m.thumbnail === 'string' ? m.thumbnail : null),
    durationSec: typeof m.duration === 'number' ? Math.round(m.duration) : null,
    publishedAt: parseUploadDate(m.upload_date),
    language: typeof m.language === 'string' ? m.language : null,
    tags: Array.isArray(m.tags) ? (m.tags as string[]) : null,
    chapters: Array.isArray(m.chapters) ? m.chapters : null,
    views: typeof m.view_count === 'number' ? m.view_count : null,
    likes: typeof m.like_count === 'number' ? m.like_count : null,
    comments: typeof m.comment_count === 'number' ? m.comment_count : null,
    channelUrl: deriveChannelUrl(m),
  }
}
