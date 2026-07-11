import type { JobStage } from '../generated/prisma/enums.js'
import type { StageHandler } from './stages.js'
import { downloadStage } from './download.js'
import { extractAudioStage } from './extractAudio.js'
import { transcribeStage } from './transcribe.js'
import { translateStage } from './translate.js'
import { narrateStage } from './narrate.js'
import { slidesStage } from './slides.js'
import { renderVideoStage } from './renderVideo.js'
import { quizStage } from './quiz.js'
import { flashcardsStage } from './flashcards.js'
import { exportStage } from './exportStage.js'

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
