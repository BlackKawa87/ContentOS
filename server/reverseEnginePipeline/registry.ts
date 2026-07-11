import type { JobStage } from '../generated/prisma/enums.js'
import type { ChannelStageHandler } from './stages.js'
import { channelMetadataStage } from './channelMetadata.js'
import { videosListedStage } from './videosListed.js'
import { videosMetadataStage } from './videosMetadata.js'
import { statsCalculatedStage } from './statsCalculated.js'

/** Maps the stage a channel-import job is moving INTO to the handler that performs that work. */
export const channelStageRegistry: Partial<Record<JobStage, ChannelStageHandler>> = {
  CHANNEL_METADATA_FETCHED: channelMetadataStage,
  VIDEOS_LISTED: videosListedStage,
  VIDEOS_METADATA_FETCHED: videosMetadataStage,
  STATS_CALCULATED: statsCalculatedStage,
  COMPLETED: async () => {},
}
