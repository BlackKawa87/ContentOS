import type { JobStage } from '../generated/prisma/enums.js'
import type { ChannelModel as Channel } from '../generated/prisma/models.js'

/** Ordered pipeline for the Channel Importer (Phase 1): QUEUED entry, COMPLETED terminal. */
export const CHANNEL_IMPORT_STAGE_ORDER: JobStage[] = [
  'QUEUED',
  'CHANNEL_METADATA_FETCHED',
  'VIDEOS_LISTED',
  'VIDEOS_METADATA_FETCHED',
  'STATS_CALCULATED',
  'COMPLETED',
]

export function nextChannelStage(stage: JobStage): JobStage | null {
  const idx = CHANNEL_IMPORT_STAGE_ORDER.indexOf(stage)
  if (idx === -1 || idx === CHANNEL_IMPORT_STAGE_ORDER.length - 1) return null
  return CHANNEL_IMPORT_STAGE_ORDER[idx + 1]
}

/**
 * A stage handler performs the work for moving a job INTO `stage` for a given Channel.
 * Mirrors server/studyPipeline's StageHandler contract: throw to signal failure (the
 * shared queue engine handles retry/backoff), and stay idempotent/self-contained —
 * re-derive everything from the DB rather than relying on state from a prior stage call.
 */
export type ChannelStageHandler = (channel: Channel) => Promise<void>
