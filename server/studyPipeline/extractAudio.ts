import type { VideoModel as Video } from '../generated/prisma/models'
import { extractAudio as ffmpegExtractAudio } from '../lib/ffmpeg'
import { uploadAsset } from '../lib/storage'
import { downloadAsset, getVideoContext } from './common'

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
