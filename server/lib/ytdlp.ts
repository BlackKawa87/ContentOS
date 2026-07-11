import YtDlpWrap from 'yt-dlp-wrap'
import { readFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

let ytDlpWrap: InstanceType<typeof YtDlpWrap> | null = null

async function getYtDlp() {
  if (ytDlpWrap) return ytDlpWrap
  const binaryPath = path.join(tmpdir(), 'yt-dlp')
  try {
    await readFile(binaryPath)
  } catch {
    await YtDlpWrap.downloadFromGithub(binaryPath)
  }
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
