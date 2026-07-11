import type { VideoModel as Video } from '../generated/prisma/models.js'
import { prisma } from '../lib/prisma.js'
import { getWorkingProfile } from './common.js'

/** How far a video's actual duration may diverge from its analyzed content's span before
 * it's treated as a hard mismatch rather than a tolerable rounding/trim difference. */
const DURATION_TOLERANCE_RATIO = 0.15
const STALE_PERFORMANCE_DAYS = 30

/** Module 1: confirms Phase 2's outputs are present and internally consistent before any
 * synthesis runs. Throws (blocking, job fails with a specific message) on missing/invalid
 * mandatory inputs — never lets an incomplete profile proceed silently. Non-blocking issues
 * are recorded as warnings on the profile being built. */
export async function inputsValidatedStage(video: Video): Promise<void> {
  const profile = await getWorkingProfile(video.id)
  const warnings: string[] = []
  const missing: string[] = []

  const [videoAnalysis, transcript, timelineSegments, narrative, visualScenes, audioMetric] = await Promise.all([
    prisma.videoAnalysis.findUnique({ where: { videoId: video.id } }),
    prisma.videoTranscript.findUnique({
      where: { videoId: video.id },
      include: { segments: { orderBy: { index: 'asc' } } },
    }),
    prisma.timelineSegment.findMany({ where: { videoId: video.id }, orderBy: { index: 'asc' } }),
    prisma.narrativeAnalysis.findUnique({ where: { videoId: video.id } }),
    prisma.visualScene.findMany({ where: { videoId: video.id }, orderBy: { index: 'asc' } }),
    prisma.audioMetric.findUnique({ where: { videoId: video.id } }),
  ])

  if (!videoAnalysis?.readyForViralDnaAt) missing.push('VIDEO_ANALYSIS pipeline has not completed (readyForViralDnaAt is unset)')
  if (!transcript || transcript.rawText.trim().length === 0) missing.push('transcript (TRANSCRIBED stage)')
  if (timelineSegments.length === 0) missing.push('timeline segments (TIMELINE_SEGMENTED stage)')
  if (!narrative) missing.push('narrative analysis (NARRATIVE_ANALYZED stage)')
  if (visualScenes.length === 0) missing.push('visual scenes (VISUAL_ANALYZED stage)')
  if (!audioMetric) missing.push('audio metrics (AUDIO_ANALYZED stage)')

  if (missing.length > 0) {
    throw new Error(`Viral DNA inputs incomplete — missing: ${missing.join('; ')}. Rerun the corresponding VIDEO_ANALYSIS stage(s) before retrying.`)
  }

  // Transcript segment timestamps ordered, non-decreasing.
  for (let i = 1; i < transcript!.segments.length; i++) {
    if (transcript!.segments[i].startSec < transcript!.segments[i - 1].startSec) {
      throw new Error(`Transcript segments out of order at index ${i} (${transcript!.segments[i].startSec}s before ${transcript!.segments[i - 1].startSec}s)`)
    }
  }

  // Timeline segments must not overlap by more than a rounding tolerance.
  for (let i = 1; i < timelineSegments.length; i++) {
    const gap = timelineSegments[i].startSec - timelineSegments[i - 1].endSec
    if (gap < -0.5) {
      throw new Error(`Timeline segments overlap at index ${i} (segment ${i - 1} ends ${timelineSegments[i - 1].endSec}s, segment ${i} starts ${timelineSegments[i].startSec}s)`)
    }
  }

  // Visual scenes: valid, ordered start/end timestamps.
  for (const scene of visualScenes) {
    if (scene.endSec <= scene.startSec) {
      throw new Error(`Visual scene ${scene.index} has invalid timestamps (start=${scene.startSec}, end=${scene.endSec})`)
    }
  }

  // Duration consistency: video's known duration vs. the furthest analyzed timestamp.
  const analyzedSpan = Math.max(
    timelineSegments.at(-1)?.endSec ?? 0,
    visualScenes.at(-1)?.endSec ?? 0,
    transcript!.segments.at(-1)?.endSec ?? 0,
  )
  if (video.durationSec && analyzedSpan > 0) {
    const divergence = Math.abs(video.durationSec - analyzedSpan) / video.durationSec
    if (divergence > DURATION_TOLERANCE_RATIO) {
      warnings.push(
        `Analyzed content spans ${analyzedSpan.toFixed(1)}s but the video's known duration is ${video.durationSec}s (${(divergence * 100).toFixed(0)}% divergence)`,
      )
    }
  }

  // Performance data freshness.
  const ageDays = (Date.now() - video.updatedAt.getTime()) / 86_400_000
  if (video.outlierScore === null) {
    warnings.push('No outlier score available — performance profile will be limited')
  } else if (ageDays > STALE_PERFORMANCE_DAYS) {
    warnings.push(`Performance metrics are ${Math.round(ageDays)} days old — may be stale`)
  }

  if (warnings.length > 0) {
    await prisma.viralDnaProfile.update({
      where: { id: profile.id },
      data: { warnings: [...((profile.warnings as string[] | null) ?? []), ...warnings] },
    })
  }
}
