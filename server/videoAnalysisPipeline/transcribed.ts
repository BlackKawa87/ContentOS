import { toFile } from 'openai'
import type { VideoModel as Video } from '../generated/prisma/models.js'
import { prisma } from '../lib/prisma.js'
import { getOpenAiClientForProfile } from '../lib/openai.js'
import { logApiUsage, RATES } from '../lib/apiUsage.js'
import { downloadAsset, getVideoContext } from './common.js'

interface WhisperSegment {
  start: number
  end: number
  text: string
  avg_logprob?: number
}

interface WhisperVerboseResponse {
  text: string
  language?: string
  segments?: WhisperSegment[]
}

/** Module 2: transcribes the audio with word-level timestamps (needed for timeline/narrative segmentation). */
export async function transcribedStage(video: Video): Promise<void> {
  const { projectId, profile } = await getVideoContext(video)
  const openai = await getOpenAiClientForProfile(profile.id)

  const audioBuffer = await downloadAsset('AUDIO', `${profile.id}/${video.id}/source-audio.mp3`)
  const file = await toFile(audioBuffer, 'audio.mp3')

  const transcription = (await openai.audio.transcriptions.create({
    file,
    model: 'whisper-1',
    response_format: 'verbose_json',
    timestamp_granularities: ['segment'],
  })) as unknown as WhisperVerboseResponse

  const segments = transcription.segments ?? []
  const audioMinutes = (video.durationSec ?? 0) / 60
  const wordsPerMinute =
    audioMinutes > 0 ? transcription.text.trim().split(/\s+/).filter(Boolean).length / audioMinutes : null
  const confidences = segments
    .map((s) => (typeof s.avg_logprob === 'number' ? Math.exp(s.avg_logprob) : null))
    .filter((c): c is number => c !== null)
  const confidence = confidences.length > 0 ? confidences.reduce((a, b) => a + b, 0) / confidences.length : null

  const transcript = await prisma.videoTranscript.upsert({
    where: { videoId: video.id },
    create: {
      videoId: video.id,
      rawText: transcription.text,
      language: transcription.language ?? null,
      model: 'whisper-1',
      audioMinutes,
      wordsPerMinute,
      confidence,
    },
    update: {
      rawText: transcription.text,
      language: transcription.language ?? null,
      model: 'whisper-1',
      audioMinutes,
      wordsPerMinute,
      confidence,
    },
  })

  await prisma.transcriptSegment.deleteMany({ where: { transcriptId: transcript.id } })
  if (segments.length > 0) {
    await prisma.transcriptSegment.createMany({
      data: segments.map((s, index) => ({
        transcriptId: transcript.id,
        index,
        startSec: s.start,
        endSec: s.end,
        text: s.text.trim(),
        confidence: typeof s.avg_logprob === 'number' ? Math.exp(s.avg_logprob) : null,
      })),
    })
  }

  await logApiUsage({
    profileId: profile.id,
    projectId,
    videoId: video.id,
    provider: 'OPENAI',
    unit: 'audio_minutes',
    quantity: audioMinutes,
    estimatedCostUsd: audioMinutes * RATES.OPENAI_AUDIO_PER_MINUTE,
  })
}
