import type { JobStage } from '../generated/prisma/enums'
import type { StageHandler } from './stages'
import { downloadStage } from './download'
import { extractAudioStage } from './extractAudio'
import { transcribeStage } from './transcribe'
import { translateStage } from './translate'
import { narrateStage } from './narrate'
import { slidesStage } from './slides'
import { renderVideoStage } from './renderVideo'
import { quizStage } from './quiz'
import { flashcardsStage } from './flashcards'
import { exportStage } from './exportStage'

/** Maps the stage a job is moving INTO to the handler that performs that work. */
export const stageRegistry: Partial<Record<JobStage, StageHandler>> = {
  DOWNLOADED: downloadStage,
  EXTRACTED: extractAudioStage,
  TRANSCRIBED: transcribeStage,
  TRANSLATED: translateStage,
  NARRATED: narrateStage,
  SLIDES_GENERATED: slidesStage,
  VIDEO_RENDERED: renderVideoStage,
  QUIZ_GENERATED: quizStage,
  FLASHCARDS_GENERATED: flashcardsStage,
  EXPORTED: exportStage,
  COMPLETED: async () => {},
}
