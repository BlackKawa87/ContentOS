import type { JobStage } from '../generated/prisma/enums.js'
import type { VideoModel as Video } from '../generated/prisma/models.js'

/** Ordered pipeline for per-video analysis: VIDEO_SELECTED entry, READY_FOR_VIRAL_DNA terminal.
 * Stops here deliberately — Viral DNA synthesis is Phase 3, not built yet. */
export const VIDEO_ANALYSIS_STAGE_ORDER: JobStage[] = [
  'VIDEO_SELECTED',
  'VIDEO_DOWNLOADED',
  'AUDIO_EXTRACTED',
  'TRANSCRIBED',
  'TIMELINE_SEGMENTED',
  'NARRATIVE_ANALYZED',
  'VISUAL_ANALYZED',
  'AUDIO_ANALYZED',
  'READY_FOR_VIRAL_DNA',
]

export function nextVideoAnalysisStage(stage: JobStage): JobStage | null {
  const idx = VIDEO_ANALYSIS_STAGE_ORDER.indexOf(stage)
  if (idx === -1 || idx === VIDEO_ANALYSIS_STAGE_ORDER.length - 1) return null
  return VIDEO_ANALYSIS_STAGE_ORDER[idx + 1]
}

/** Used by "restart from stage X" (partial reprocessing): the job's `stage` column records the
 * last COMPLETED stage, so restarting stage X means creating a job at X's predecessor. */
export function previousVideoAnalysisStage(stage: JobStage): JobStage | null {
  const idx = VIDEO_ANALYSIS_STAGE_ORDER.indexOf(stage)
  if (idx <= 0) return null
  return VIDEO_ANALYSIS_STAGE_ORDER[idx - 1]
}

export type VideoAnalysisStageHandler = (video: Video) => Promise<void>
