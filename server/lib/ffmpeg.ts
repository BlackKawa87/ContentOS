import ffmpeg from 'fluent-ffmpeg'
import * as ffmpegStaticModule from 'ffmpeg-static'
import * as ffprobeStaticModule from 'ffprobe-static'
import { writeFile, readFile, unlink, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { unwrapDefault } from './interop.js'

// Both packages' default exports get inconsistently unwrapped across
// tsx/local vs Vercel's build — see the interop note in CLAUDE.md.
const ffmpegPath = unwrapDefault<string>(ffmpegStaticModule)
const ffprobePath = unwrapDefault<{ path: string }>(ffprobeStaticModule).path

if (typeof ffmpegPath === 'string' && ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath)
if (typeof ffprobePath === 'string' && ffprobePath) ffmpeg.setFfprobePath(ffprobePath)

/** Returns the duration (seconds) of an audio/video buffer via ffprobe. */
export async function getMediaDurationSec(buffer: Buffer, ext: string): Promise<number> {
  const filePath = path.join(tmpdir(), `${randomUUID()}.${ext}`)
  await writeFile(filePath, buffer)
  try {
    return await new Promise<number>((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, data) => {
        if (err) return reject(err)
        resolve(data.format.duration ?? 0)
      })
    })
  } finally {
    await unlink(filePath).catch(() => {})
  }
}

/** Extracts the audio track from a video buffer as an MP3 buffer. */
export async function extractAudio(videoBuffer: Buffer): Promise<Buffer> {
  const inPath = path.join(tmpdir(), `${randomUUID()}.mp4`)
  const outPath = path.join(tmpdir(), `${randomUUID()}.mp3`)
  await writeFile(inPath, videoBuffer)

  await new Promise<void>((resolve, reject) => {
    ffmpeg(inPath)
      .noVideo()
      .audioCodec('libmp3lame')
      .format('mp3')
      .on('end', () => resolve())
      .on('error', reject)
      .save(outPath)
  })

  const buffer = await readFile(outPath)
  await Promise.all([unlink(inPath).catch(() => {}), unlink(outPath).catch(() => {})])
  return buffer
}

/**
 * Builds a study video from a sequence of slide images (each shown for its
 * given duration) with a narration audio track laid underneath, using pure
 * ffmpeg (concat + amix) rather than Remotion — see CLAUDE.md for why.
 */
export async function composeStudyVideo(
  slides: { imageBuffer: Buffer; durationSec: number }[],
  narrationBuffer: Buffer,
): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), 'study-video-'))
  const audioPath = path.join(dir, 'narration.mp3')
  await writeFile(audioPath, narrationBuffer)

  const concatListPath = path.join(dir, 'concat.txt')
  const imagePaths: string[] = []
  for (const [i, slide] of slides.entries()) {
    const imgPath = path.join(dir, `slide-${i}.png`)
    await writeFile(imgPath, slide.imageBuffer)
    imagePaths.push(imgPath)
  }
  const concatLines = slides
    .flatMap((slide, i) => [`file '${imagePaths[i]}'`, `duration ${slide.durationSec}`])
    .concat([`file '${imagePaths[imagePaths.length - 1]}'`])
    .join('\n')
  await writeFile(concatListPath, concatLines)

  const outPath = path.join(dir, 'study-video.mp4')

  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input(concatListPath)
      .inputOptions(['-f concat', '-safe 0'])
      .input(audioPath)
      .outputOptions(['-c:v libx264', '-pix_fmt yuv420p', '-c:a aac', '-shortest'])
      .on('end', () => resolve())
      .on('error', reject)
      .save(outPath)
  })

  const buffer = await readFile(outPath)
  await unlink(outPath).catch(() => {})
  return buffer
}

// ---------------------------------------------------------------------------
// Video Reverse Engineering Engine: deterministic visual/audio detection
// ---------------------------------------------------------------------------

/** Detects hard scene cuts via ffmpeg's scene-change filter. Returns cut timestamps (seconds). */
export async function detectSceneCuts(videoBuffer: Buffer, threshold = 0.3): Promise<number[]> {
  const inPath = path.join(tmpdir(), `${randomUUID()}.mp4`)
  await writeFile(inPath, videoBuffer)

  const cuts: number[] = []
  try {
    await new Promise<void>((resolve, reject) => {
      ffmpeg(inPath)
        .videoFilters(`select='gt(scene,${threshold})',showinfo`)
        .outputOptions(['-f', 'null'])
        .output('/dev/null')
        .on('stderr', (line: string) => {
          const match = line.match(/pts_time:([\d.]+)/)
          if (match) cuts.push(Number(match[1]))
        })
        .on('end', () => resolve())
        .on('error', reject)
        .run()
    })
  } finally {
    await unlink(inPath).catch(() => {})
  }
  return cuts
}

/** Extracts a single JPEG frame at the given timestamp — the "representative frame" for a scene. */
export async function extractFrame(videoBuffer: Buffer, atSec: number): Promise<Buffer> {
  const inPath = path.join(tmpdir(), `${randomUUID()}.mp4`)
  const outPath = path.join(tmpdir(), `${randomUUID()}.jpg`)
  await writeFile(inPath, videoBuffer)

  try {
    await new Promise<void>((resolve, reject) => {
      ffmpeg(inPath)
        .seekInput(Math.max(0, atSec))
        .frames(1)
        .output(outPath)
        .on('end', () => resolve())
        .on('error', reject)
        .run()
    })
    return await readFile(outPath)
  } finally {
    await Promise.all([unlink(inPath).catch(() => {}), unlink(outPath).catch(() => {})])
  }
}

export interface SilenceInterval {
  startSec: number
  endSec: number
}

/** Detects silent stretches (pauses) via ffmpeg's silencedetect filter. */
export async function detectSilences(
  audioBuffer: Buffer,
  noiseFloorDb = -30,
  minDurationSec = 0.3,
): Promise<SilenceInterval[]> {
  const inPath = path.join(tmpdir(), `${randomUUID()}.mp3`)
  await writeFile(inPath, audioBuffer)

  const intervals: SilenceInterval[] = []
  let pendingStart: number | null = null

  try {
    await new Promise<void>((resolve, reject) => {
      ffmpeg(inPath)
        .audioFilters(`silencedetect=noise=${noiseFloorDb}dB:d=${minDurationSec}`)
        .outputOptions(['-f', 'null'])
        .output('/dev/null')
        .on('stderr', (line: string) => {
          const startMatch = line.match(/silence_start:\s*([\d.]+)/)
          const endMatch = line.match(/silence_end:\s*([\d.]+)/)
          if (startMatch) pendingStart = Number(startMatch[1])
          if (endMatch && pendingStart !== null) {
            intervals.push({ startSec: pendingStart, endSec: Number(endMatch[1]) })
            pendingStart = null
          }
        })
        .on('end', () => resolve())
        .on('error', reject)
        .run()
    })
  } finally {
    await unlink(inPath).catch(() => {})
  }
  return intervals
}

export interface EnergyPoint {
  t: number
  meanVolumeDb: number
}

/** Splits the track into equal windows and measures mean volume per window — a coarse energy curve. */
export async function getEnergyCurve(audioBuffer: Buffer, windows = 24): Promise<EnergyPoint[]> {
  const durationSec = await getMediaDurationSec(audioBuffer, 'mp3')
  const windowSec = durationSec / windows
  const inPath = path.join(tmpdir(), `${randomUUID()}.mp3`)
  await writeFile(inPath, audioBuffer)

  const points: EnergyPoint[] = []
  try {
    for (let i = 0; i < windows; i++) {
      const start = i * windowSec
      let meanVolumeDb = -91
      await new Promise<void>((resolve, reject) => {
        ffmpeg(inPath)
          .seekInput(start)
          .duration(windowSec)
          .audioFilters('volumedetect')
          .outputOptions(['-f', 'null'])
          .output('/dev/null')
          .on('stderr', (line: string) => {
            const match = line.match(/mean_volume:\s*(-?[\d.]+)\s*dB/)
            if (match) meanVolumeDb = Number(match[1])
          })
          .on('end', () => resolve())
          .on('error', reject)
          .run()
      })
      points.push({ t: start, meanVolumeDb })
    }
  } finally {
    await unlink(inPath).catch(() => {})
  }
  return points
}
