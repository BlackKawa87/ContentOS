import ffmpeg from 'fluent-ffmpeg'
import ffmpegPath from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'
import { writeFile, readFile, unlink, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath)
ffmpeg.setFfprobePath(ffprobeStatic.path)

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
