import type { JobStage } from '../generated/prisma/enums.ts'
import type { StageHandler } from './stages.ts'
import { downloadStage } from './download.ts'
import { extractAudioStage } from './extractAudio.ts'
import { transcribeStage } from './transcribe.ts'
import { translateStage } from './translate.ts'
import { narrateStage } from './narrate.ts'
import { slidesStage } from './slides.ts'
import { renderVideoStage } from './renderVideo.ts'
import { quizStage } from './quiz.ts'
import { flashcardsStage } from './flashcards.ts'
import { exportStage } from './exportStage.ts'

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
