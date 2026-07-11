import type { JobStage } from '../generated/prisma/enums.js'
import type { VideoAnalysisStageHandler } from './stages.js'
import { videoDownloadedStage } from './videoDownloaded.js'
import { audioExtractedStage } from './audioExtracted.js'
import { transcribedStage } from './transcribed.js'
import { timelineSegmentedStage } from './timelineSegmented.js'
import { narrativeAnalyzedStage } from './narrativeAnalyzed.js'
import { visualAnalyzedStage } from './visualAnalyzed.js'
import { audioAnalyzedStage } from './audioAnalyzed.js'
import { readyForViralDnaStage } from './readyForViralDna.js'

/** Maps the stage a video-analysis job is moving INTO to the handler that performs that work. */
export const videoAnalysisStageRegistry: Partial<Record<JobStage, VideoAnalysisStageHandler>> = {
  VIDEO_DOWNLOADED: videoDownloadedStage,
  AUDIO_EXTRACTED: audioExtractedStage,
  TRANSCRIBED: transcribedStage,
  TIMELINE_SEGMENTED: timelineSegmentedStage,
  NARRATIVE_ANALYZED: narrativeAnalyzedStage,
  VISUAL_ANALYZED: visualAnalyzedStage,
  AUDIO_ANALYZED: audioAnalyzedStage,
  READY_FOR_VIRAL_DNA: readyForViralDnaStage,
}
