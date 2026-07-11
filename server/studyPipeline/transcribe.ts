import { toFile } from 'openai'
import type { VideoModel as Video } from '../generated/prisma/models'
import { prisma } from '../lib/prisma'
import { getOpenAiClientForProfile } from '../lib/openai'
import { uploadAsset } from '../lib/storage'
import { logApiUsage, RATES } from '../lib/apiUsage'
import { downloadAsset, getVideoContext } from './common'

export async function transcribeStage(video: Video): Promise<void> {
  const { projectId, profile } = await getVideoContext(video)
  const openai = await getOpenAiClientForProfile(profile.id)

  const audioBuffer = await downloadAsset('AUDIO', `${profile.id}/${video.id}/source-audio.mp3`)
  const file = await toFile(audioBuffer, 'audio.mp3')

  const transcription = await openai.audio.transcriptions.create({
    file,
    model: 'whisper-1',
    response_format: 'text',
  })
  const content = String(transcription)

  await prisma.transcript.upsert({
    where: { videoId: video.id },
    create: { videoId: video.id, language: 'EN', content },
    update: { content },
  })

  await uploadAsset({
    bucket: 'DOCUMENTS',
    ownerId: profile.id,
    projectId,
    videoId: video.id,
    filename: 'transcript-en.md',
    data: Buffer.from(content, 'utf-8'),
    contentType: 'text/markdown',
  })

  const minutes = (video.durationSec ?? 0) / 60
  await logApiUsage({
    profileId: profile.id,
    projectId,
    videoId: video.id,
    provider: 'OPENAI',
    unit: 'audio_minutes',
    quantity: minutes,
    estimatedCostUsd: minutes * RATES.OPENAI_AUDIO_PER_MINUTE,
  })
}
