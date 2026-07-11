import type { VideoModel as Video } from '../generated/prisma/models.js'
import { prisma } from '../lib/prisma.js'
import { getWorkingProfile } from './common.js'

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length
}

function stddev(values: number[]): number {
  if (values.length === 0) return 0
  const m = mean(values)
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)))
}

function coefficientOfVariation(values: number[]): number {
  const m = mean(values)
  return m === 0 ? 0 : stddev(values) / m
}

function rate(count: number, total: number): number {
  return total === 0 ? 0 : count / total
}

/** Module 2 (+ deterministic half of Module 9): pure-code absolute and normalized metrics
 * every later stage reuses instead of re-deriving from raw transcript/timeline data.
 * Every formula here is documented inline — this is the single source of truth for them. */
export async function metricsNormalizedStage(video: Video): Promise<void> {
  const profile = await getWorkingProfile(video.id)
  const durationSec = video.durationSec ?? 0
  const durationMin = durationSec / 60

  const [transcript, timelineSegments, visualScenes, audioMetric, narrative] = await Promise.all([
    prisma.videoTranscript.findUniqueOrThrow({
      where: { videoId: video.id },
      include: { segments: { orderBy: { index: 'asc' } } },
    }),
    prisma.timelineSegment.findMany({ where: { videoId: video.id }, orderBy: { index: 'asc' } }),
    prisma.visualScene.findMany({ where: { videoId: video.id }, orderBy: { index: 'asc' } }),
    prisma.audioMetric.findUniqueOrThrow({ where: { videoId: video.id } }),
    prisma.narrativeAnalysis.findUniqueOrThrow({ where: { videoId: video.id } }),
  ])

  const byType = (type: string) => timelineSegments.filter((s) => s.type === type)
  const sceneDurations = visualScenes.map((s) => s.durationSec)
  const segmentPacesWpm = transcript.segments.map((s) => {
    const min = (s.endSec - s.startSec) / 60
    const words = s.text.trim().split(/\s+/).filter(Boolean).length
    return min > 0 ? words / min : 0
  })

  const hookDurationSec = narrative.hookDurationSec ?? byType('HOOK').reduce((sum, s) => sum + s.durationSec, 0)
  const ctaDurationSec = byType('CTA').reduce((sum, s) => sum + s.durationSec, 0)
  const openLoopCount = narrative.openLoopCount ?? byType('OPEN_LOOP').length
  const payoffCount = narrative.payoffCount ?? byType('PAYOFF').length

  const segmentDistribution: Record<string, number> = {}
  for (const seg of timelineSegments) {
    segmentDistribution[seg.type] = (segmentDistribution[seg.type] ?? 0) + 1
  }

  const totalWords = transcript.rawText.trim().split(/\s+/).filter(Boolean).length
  const uniqueWords = new Set(
    transcript.rawText
      .toLowerCase()
      .split(/\s+/)
      .map((w) => w.replace(/[^a-z0-9']/g, ''))
      .filter(Boolean),
  ).size
  const questionCount = (transcript.rawText.match(/\?/g) ?? []).length

  const metrics = {
    // Absolute
    durationSec,
    totalScenes: visualScenes.length,
    totalTimelineSegments: timelineSegments.length,
    hookDurationSec,
    ctaDurationSec,
    openLoopCount,
    payoffCount,
    pauseCount: audioMetric.pauseCount ?? 0,
    totalWords,
    questionCount,

    // Normalized (per minute)
    scenesPerMinute: rate(visualScenes.length, durationMin),
    visualChangesPerMinute: rate(visualScenes.length, durationMin),
    revealsPerMinute: rate(byType('REVEAL').length, durationMin),
    openLoopsPerMinute: rate(openLoopCount, durationMin),
    pausesPerMinute: rate(audioMetric.pauseCount ?? 0, durationMin),
    wordsPerMinute: transcript.wordsPerMinute ?? rate(totalWords, durationMin),
    informationUnitsPerMinute: rate(openLoopCount + byType('REVEAL').length + payoffCount, durationMin),
    questionsPerMinute: rate(questionCount, durationMin),
    patternInterruptsPerMinute: rate(byType('PATTERN_INTERRUPT').length, durationMin),

    // Rates (0-1)
    textOverlayRate: rate(visualScenes.filter((s) => s.category === 'TEXT_CARD').length, visualScenes.length),
    zoomRate: rate(visualScenes.filter((s) => s.motion === 'SLOW_ZOOM' || s.motion === 'ZOOM_OUT').length, visualScenes.length),
    panRate: rate(visualScenes.filter((s) => s.motion === 'PAN').length, visualScenes.length),
    staticSceneRate: rate(visualScenes.filter((s) => s.motion === 'STATIC').length, visualScenes.length),
    payoffRate: rate(payoffCount, openLoopCount),
    openLoopResolutionRate: rate(payoffCount, openLoopCount),
    hookDurationPercentage: rate(hookDurationSec, durationSec),
    ctaDurationPercentage: rate(ctaDurationSec, durationSec),
    // Coarse proxies — a real dedup/near-duplicate-sentence pass is out of scope for Phase 3 v1.
    repetitionRate: totalWords === 0 ? 0 : 1 - uniqueWords / totalWords,
    redundancyRate: totalWords === 0 ? 0 : 1 - uniqueWords / totalWords,
    summaryRate: rate(byType('SUMMARY').length, timelineSegments.length),

    narrativeSegmentDistribution: segmentDistribution,

    // Coefficients of variation
    sceneDurationCoefficientOfVariation: coefficientOfVariation(sceneDurations),
    narrationSpeedCoefficientOfVariation: coefficientOfVariation(segmentPacesWpm),

    averageSceneDurationSec: mean(sceneDurations),
  }

  await prisma.viralDnaProfile.update({
    where: { id: profile.id },
    data: {
      metrics,
      averageWordsPerMinute: metrics.wordsPerMinute,
      averageSceneDurationSec: metrics.averageSceneDurationSec,
      sceneChangesPerMinute: metrics.scenesPerMinute,
      openLoopCount: metrics.openLoopCount,
      patternInterruptsPerMinute: metrics.patternInterruptsPerMinute,
      textOverlayRate: metrics.textOverlayRate,
    },
  })
}
