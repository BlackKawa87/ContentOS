import type { VideoModel as Video } from '../generated/prisma/models.js'
import { extractAudio as ffmpegExtractAudio } from '../lib/ffmpeg.js'
import { uploadAsset } from '../lib/storage.js'
import { downloadAsset, getVideoContext } from './common.js'

export async function extractAudioStage(video: Video): Promise<void> {
  const { projectId, profile } = await getVideoContext(video)

  const videoBuffer = await downloadAsset('VIDEOS', `${profile.id}/${video.id}/source.mp4`)
  const audioBuffer = await ffmpegExtractAudio(videoBuffer)

  await uploadAsset({
    bucket: 'AUDIO',
    ownerId: profile.id,
    projectId,
    videoId: video.id,
    filename: 'source-audio.mp3',
    data: audioBuffer,
    contentType: 'audio/mpeg',
  })
}
