import type { VideoModel as Video } from '../generated/prisma/models.js'
import { prisma } from '../lib/prisma.js'
import { extractAudio, getMediaDurationSec } from '../lib/ffmpeg.js'
import { uploadAsset } from '../lib/storage.js'
import { downloadAsset, getVideoContext } from './common.js'

/** Module 1 continued: pulls the audio track out of the downloaded video for transcription/audio analysis. */
export async function audioExtractedStage(video: Video): Promise<void> {
  const { projectId, profile } = await getVideoContext(video)

  const videoBuffer = await downloadAsset('VIDEOS', `${profile.id}/${video.id}/source.mp4`)
  const audioBuffer = await extractAudio(videoBuffer)
  const audioDurationMs = Math.round((await getMediaDurationSec(audioBuffer, 'mp3')) * 1000)

  const audioStoragePath = await uploadAsset({
    bucket: 'AUDIO',
    ownerId: profile.id,
    projectId,
    videoId: video.id,
    filename: 'source-audio.mp3',
    data: audioBuffer,
    contentType: 'audio/mpeg',
  })

  await prisma.videoAnalysis.update({
    where: { videoId: video.id },
    data: { audioStoragePath, audioDurationMs },
  })
}
