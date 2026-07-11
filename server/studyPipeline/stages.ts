import type { JobStage } from '../generated/prisma/enums.ts'
import type { VideoModel as Video } from '../generated/prisma/models.ts'

/** Ordered pipeline: QUEUED is the entry point, COMPLETED/FAILED are terminal. */
export const STAGE_ORDER: JobStage[] = [
  'QUEUED',
  'DOWNLOADED',
  'EXTRACTED',
  'TRANSCRIBED',
  'TRANSLATED',
  'NARRATED',
  'SLIDES_GENERATED',
  'VIDEO_RENDERED',
  'QUIZ_GENERATED',
  'FLASHCARDS_GENERATED',
  'EXPORTED',
  'COMPLETED',
]

export function nextStage(stage: JobStage): JobStage | null {
  const idx = STAGE_ORDER.indexOf(stage)
  if (idx === -1 || idx === STAGE_ORDER.length - 1) return null
  return STAGE_ORDER[idx + 1]
}

/**
 * A stage handler performs the work for moving a video INTO `stage` (e.g. the
 * handler registered under 'DOWNLOADED' downloads the source video). It should
 * throw to signal failure (the queue engine handles retry/backoff) and may
 * write ApiUsageLog / StorageAsset / stage-specific rows itself.
 */
export type StageHandler = (video: Video) => Promise<void>
