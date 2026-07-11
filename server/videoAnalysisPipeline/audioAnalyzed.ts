import type { VideoModel as Video } from '../generated/prisma/models.js'
import { prisma } from '../lib/prisma.js'
import { detectSilences, getEnergyCurve } from '../lib/ffmpeg.js'
import { downloadAsset, getVideoContext } from './common.js'

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function stddev(values: number[]): number {
  if (values.length === 0) return 0
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

/** How close (seconds) a scene cut must land to a local energy-curve delta to count as "synced". */
const SYNC_TOLERANCE_SEC = 1.5

/** Module 6: deterministic (no AI) audio metrics — pace, pauses, energy curve, and how well
 * visual cuts line up with audio energy shifts. */
export async function audioAnalyzedStage(video: Video): Promise<void> {
  const { profile } = await getVideoContext(video)

  const audioBuffer = await downloadAsset('AUDIO', `${profile.id}/${video.id}/source-audio.mp3`)
  const durationSec = video.durationSec ?? 0

  const [silences, energyCurve, transcript, scenes] = await Promise.all([
    detectSilences(audioBuffer),
    getEnergyCurve(audioBuffer),
    prisma.videoTranscript.findUnique({
      where: { videoId: video.id },
      include: { segments: { orderBy: { index: 'asc' } } },
    }),
    prisma.visualScene.findMany({ where: { videoId: video.id }, orderBy: { index: 'asc' } }),
  ])

  const segmentPaces = (transcript?.segments ?? [])
    .map((s) => {
      const segDurationMin = (s.endSec - s.startSec) / 60
      const words = s.text.trim().split(/\s+/).filter(Boolean).length
      return segDurationMin > 0 ? words / segDurationMin : null
    })
    .filter((p): p is number => p !== null)

  const averagePaceWpm =
    segmentPaces.length > 0 ? segmentPaces.reduce((a, b) => a + b, 0) / segmentPaces.length : null
  const medianPaceWpm = segmentPaces.length > 0 ? median(segmentPaces) : null

  const pauseCount = silences.length
  const avgPauseDurationSec =
    pauseCount > 0 ? silences.reduce((sum, s) => sum + (s.endSec - s.startSec), 0) / pauseCount : null
  const silenceSec = silences.reduce((sum, s) => sum + (s.endSec - s.startSec), 0)
  const silenceRatio = durationSec > 0 ? silenceSec / durationSec : null
  const speechDensity = silenceRatio !== null ? 1 - silenceRatio : null

  const volumes = energyCurve.map((p) => p.meanVolumeDb)
  const volumeVariation = stddev(volumes)

  let syncedCuts = 0
  for (const scene of scenes) {
    if (scene.index === 0) continue
    const nearbyDelta = energyCurve.some((point, i) => {
      if (i === 0) return false
      const prev = energyCurve[i - 1]
      const withinWindow = Math.abs(point.t - scene.startSec) <= SYNC_TOLERANCE_SEC
      const hasDelta = Math.abs(point.meanVolumeDb - prev.meanVolumeDb) >= 3
      return withinWindow && hasDelta
    })
    if (nearbyDelta) syncedCuts++
  }
  const cutCount = scenes.length > 0 ? scenes.length - 1 : 0
  const sceneSyncScore = cutCount > 0 ? syncedCuts / cutCount : null

  await prisma.audioMetric.upsert({
    where: { videoId: video.id },
    create: {
      videoId: video.id,
      wordsPerMinute: transcript?.wordsPerMinute ?? null,
      averagePaceWpm,
      medianPaceWpm,
      pauseCount,
      avgPauseDurationSec,
      speechDensity,
      energyCurve: energyCurve as unknown as object,
      volumeVariation,
      silenceRatio,
      narrationSpeed: averagePaceWpm,
      sceneSyncScore,
    },
    update: {
      wordsPerMinute: transcript?.wordsPerMinute ?? null,
      averagePaceWpm,
      medianPaceWpm,
      pauseCount,
      avgPauseDurationSec,
      speechDensity,
      energyCurve: energyCurve as unknown as object,
      volumeVariation,
      silenceRatio,
      narrationSpeed: averagePaceWpm,
      sceneSyncScore,
    },
  })
}
