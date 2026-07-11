import type { JobStage } from '../generated/prisma/enums.js'
import type { VideoModel as Video } from '../generated/prisma/models.js'

/** Ordered pipeline for the Viral DNA Engine (Phase 3): VIRAL_DNA_QUEUED entry
 * (created directly by api/viralDna/select.ts, no handler), VIRAL_DNA_COMPLETED terminal. */
export const VIRAL_DNA_STAGE_ORDER: JobStage[] = [
  'VIRAL_DNA_QUEUED',
  'INPUTS_VALIDATED',
  'METRICS_NORMALIZED',
  'HOOK_PROFILE_GENERATED',
  'NARRATIVE_PROFILE_GENERATED',
  'RETENTION_PROFILE_GENERATED',
  'VISUAL_PROFILE_GENERATED',
  'AUDIO_PROFILE_GENERATED',
  'EMOTION_PROFILE_GENERATED',
  'PERFORMANCE_PROFILE_GENERATED',
  'VIRAL_DNA_SYNTHESIZED',
  'VIRAL_DNA_VALIDATED',
  'VIRAL_DNA_COMPLETED',
]

export function nextViralDnaStage(stage: JobStage): JobStage | null {
  const idx = VIRAL_DNA_STAGE_ORDER.indexOf(stage)
  if (idx === -1 || idx === VIRAL_DNA_STAGE_ORDER.length - 1) return null
  return VIRAL_DNA_STAGE_ORDER[idx + 1]
}

/** Used by "regenerate from stage X" (partial regeneration): the job's `stage` column records
 * the last COMPLETED stage, so regenerating stage X means creating a job at X's predecessor. */
export function previousViralDnaStage(stage: JobStage): JobStage | null {
  const idx = VIRAL_DNA_STAGE_ORDER.indexOf(stage)
  if (idx <= 0) return null
  return VIRAL_DNA_STAGE_ORDER[idx - 1]
}

export type ViralDnaStageHandler = (video: Video) => Promise<void>
