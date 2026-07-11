import type { VideoModel as Video } from '../generated/prisma/models.ts'
import { prisma } from '../lib/prisma.ts'
import { getElevenLabsClientForProfile, DEFAULT_VOICE_ID } from '../lib/elevenlabs.ts'
import { uploadAsset } from '../lib/storage.ts'
import { logApiUsage, RATES } from '../lib/apiUsage.ts'
import { getMediaDurationSec } from '../lib/ffmpeg.ts'
import { getVideoContext } from './common.ts'

export async function narrateStage(video: Video): Promise<void> {
  const { projectId, profile } = await getVideoContext(video)
  const elevenlabs = await getElevenLabsClientForProfile(profile.id)

  const translation = await prisma.translation.findUniqueOrThrow({ where: { videoId: video.id } })
  const voiceId = profile.defaultVoiceId ?? DEFAULT_VOICE_ID

  const audioStream = await elevenlabs.textToSpeech.convert(voiceId, {
    text: translation.content,
    model_id: 'eleven_multilingual_v2',
  })

  const chunks: Buffer[] = []
  for await (const chunk of audioStream as unknown as AsyncIterable<Buffer>) {
    chunks.push(Buffer.from(chunk))
  }
  const audioBuffer = Buffer.concat(chunks)
  const durationSec = Math.round(await getMediaDurationSec(audioBuffer, 'mp3'))

  await uploadAsset({
    bucket: 'AUDIO',
    ownerId: profile.id,
    projectId,
    videoId: video.id,
    filename: 'narration.mp3',
    data: audioBuffer,
    contentType: 'audio/mpeg',
  })

  await prisma.narrationAsset.upsert({
    where: { videoId: video.id },
    create: {
      videoId: video.id,
      voiceId,
      language: profile.translationLang,
      script: translation.content,
      storagePath: `${profile.id}/${video.id}/narration.mp3`,
      durationSec,
    },
    update: { voiceId, script: translation.content, durationSec },
  })

  await logApiUsage({
    profileId: profile.id,
    projectId,
    videoId: video.id,
    provider: 'ELEVENLABS',
    unit: 'characters',
    quantity: translation.content.length,
    estimatedCostUsd: (translation.content.length / 1000) * RATES.ELEVENLABS_PER_1K_CHARS,
  })
}
