import type { VideoModel as Video } from '../generated/prisma/models.js'
import { prisma } from '../lib/prisma.js'
import { getOpenAiClientForProfile } from '../lib/openai.js'
import { logApiUsage, RATES } from '../lib/apiUsage.js'
import { getVideoContext, getWorkingProfile, addEvidence } from './common.js'

const NARRATION_STYLES = [
  'Serious Documentary', 'Conversational', 'High Energy', 'Calm Educational', 'Suspenseful',
  'Authoritative', 'Emotional', 'Investigative', 'News Style', 'Storytelling', 'Motivational',
  'Neutral Informational',
]

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length
}
function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}
function stddev(values: number[]): number {
  if (values.length === 0) return 0
  const m = mean(values)
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)))
}

interface AudioAiDraft {
  narrationStyle?: string
  tone?: string
  backgroundMusicPresence?: boolean
  soundEffectPresence?: boolean
  confidence?: number
  evidence?: string
}

/** Module 7: voice/pace profile — mostly deterministic from AudioMetric + TranscriptSegment
 * (Phase 2 outputs), plus one light AI call over a transcript text sample for narration
 * style/tone (no audio re-sent). No speaker identity recognition, per spec. */
export async function audioProfileGeneratedStage(video: Video): Promise<void> {
  const { projectId, profile: ownerProfile } = await getVideoContext(video)
  const workingProfile = await getWorkingProfile(video.id)
  const openai = await getOpenAiClientForProfile(ownerProfile.id)

  const [audioMetric, transcript, timelineSegments] = await Promise.all([
    prisma.audioMetric.findUniqueOrThrow({ where: { videoId: video.id } }),
    prisma.videoTranscript.findUniqueOrThrow({
      where: { videoId: video.id },
      include: { segments: { orderBy: { index: 'asc' } } },
    }),
    prisma.timelineSegment.findMany({ where: { videoId: video.id }, orderBy: { index: 'asc' } }),
  ])

  const segmentPaces = transcript.segments.map((s) => {
    const min = (s.endSec - s.startSec) / 60
    const words = s.text.trim().split(/\s+/).filter(Boolean).length
    return min > 0 ? words / min : 0
  })

  const energyCurve = (audioMetric.energyCurve as { t: number; meanVolumeDb: number }[] | null) ?? []
  let energyPattern = 'unknown'
  if (energyCurve.length > 2) {
    const first = energyCurve[0].meanVolumeDb
    const last = energyCurve.at(-1)!.meanVolumeDb
    const delta = last - first
    const volatility = stddev(energyCurve.map((p) => p.meanVolumeDb))
    if (volatility > 6) energyPattern = 'oscillating'
    else if (delta > 3) energyPattern = 'rising'
    else if (delta < -3) energyPattern = 'falling'
    else energyPattern = 'stable'
  }

  const transcriptBoundaries = transcript.segments.map((s) => s.startSec)
  const timelineBoundaries = timelineSegments.map((s) => s.startSec)
  const syncedCount = transcriptBoundaries.filter((t) => timelineBoundaries.some((b) => Math.abs(t - b) <= 1.5)).length
  const voiceNarrativeSync = transcriptBoundaries.length > 0 ? syncedCount / transcriptBoundaries.length : 0

  const sampleText = [
    ...transcript.segments.slice(0, 5).map((s) => s.text),
    ...transcript.segments.slice(-5).map((s) => s.text),
  ].join(' ')

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `You classify the narration style and tone of a short-form video from a transcript sample. narrationStyle must be one of: ${NARRATION_STYLES.join(', ')}. Do not attempt speaker identity recognition. If background music/sound effects can't be confirmed from text alone, set the presence flags with low confidence rather than guessing definitively.`,
      },
      {
        role: 'user',
        content: `Classify this narration sample (opening + closing lines). Respond with JSON: { "narrationStyle": string, "tone": string, "backgroundMusicPresence": boolean, "soundEffectPresence": boolean, "confidence": number (0-1), "evidence": string }.\n\n${sampleText}`,
      },
    ],
    response_format: { type: 'json_object' },
  })

  const raw = completion.choices[0].message.content ?? '{}'
  const parsed = JSON.parse(raw) as AudioAiDraft

  const audio = {
    averageWordsPerMinute: audioMetric.averagePaceWpm ?? mean(segmentPaces),
    medianWordsPerMinute: audioMetric.medianPaceWpm ?? median(segmentPaces),
    minimumWordsPerMinute: segmentPaces.length > 0 ? Math.min(...segmentPaces) : null,
    maximumWordsPerMinute: segmentPaces.length > 0 ? Math.max(...segmentPaces) : null,
    paceVariation: mean(segmentPaces) > 0 ? stddev(segmentPaces) / mean(segmentPaces) : 0,
    speechDensity: audioMetric.speechDensity,
    pauseFrequency: audioMetric.pauseCount,
    averagePauseDuration: audioMetric.avgPauseDurationSec,
    // Approximation: per-pause durations aren't persisted individually (only the aggregate
    // average) — re-running silence detection here would mean re-downloading the audio for a
    // single field, which isn't worth the cost. Documented limitation, not a hard number.
    longestPause: audioMetric.avgPauseDurationSec,
    silenceRate: audioMetric.silenceRatio,
    volumeVariation: audioMetric.volumeVariation,
    energyPattern,
    narrationStyle: NARRATION_STYLES.includes(parsed.narrationStyle ?? '') ? parsed.narrationStyle : 'Neutral Informational',
    tone: parsed.tone,
    intensityCurve: energyCurve,
    voiceVisualSync: audioMetric.sceneSyncScore,
    voiceNarrativeSync,
    backgroundMusicPresence: parsed.backgroundMusicPresence ?? null,
    soundEffectPresence: parsed.soundEffectPresence ?? null,
    confidence: parsed.confidence ?? 0.4,
    evidence: parsed.evidence,
  }

  await prisma.viralDnaProfile.update({
    where: { id: workingProfile.id },
    data: { audio },
  })

  if (parsed.evidence) {
    await addEvidence(workingProfile.id, [
      {
        evidenceId: 'audio.narrationStyle',
        sourceType: 'AUDIO_METRIC',
        explanation: `Narration style classified as ${audio.narrationStyle}`,
        transcriptExcerpt: parsed.evidence,
      },
    ])
  }

  const usage = completion.usage
  if (usage) {
    await logApiUsage({
      profileId: ownerProfile.id,
      projectId,
      videoId: video.id,
      provider: 'OPENAI',
      unit: 'tokens',
      quantity: usage.total_tokens,
      estimatedCostUsd:
        (usage.prompt_tokens / 1000) * RATES.OPENAI_INPUT_PER_1K_TOKENS +
        (usage.completion_tokens / 1000) * RATES.OPENAI_OUTPUT_PER_1K_TOKENS,
    })
  }
}
