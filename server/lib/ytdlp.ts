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
