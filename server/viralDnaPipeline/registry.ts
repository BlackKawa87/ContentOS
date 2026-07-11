import type { JobStage } from '../generated/prisma/enums.js'
import type { ViralDnaStageHandler } from './stages.js'
import { inputsValidatedStage } from './inputsValidated.js'
import { metricsNormalizedStage } from './metricsNormalized.js'
import { hookProfileGeneratedStage } from './hookProfileGenerated.js'
import { narrativeProfileGeneratedStage } from './narrativeProfileGenerated.js'
import { retentionProfileGeneratedStage } from './retentionProfileGenerated.js'
import { visualProfileGeneratedStage } from './visualProfileGenerated.js'
import { audioProfileGeneratedStage } from './audioProfileGenerated.js'
import { emotionProfileGeneratedStage } from './emotionProfileGenerated.js'
import { performanceProfileGeneratedStage } from './performanceProfileGenerated.js'
import { viralDnaSynthesizedStage } from './viralDnaSynthesized.js'
import { viralDnaValidatedStage } from './viralDnaValidated.js'
import { viralDnaCompletedStage } from './viralDnaCompleted.js'

/** Maps the stage a Viral DNA job is moving INTO to the handler that performs that work. */
export const viralDnaStageRegistry: Partial<Record<JobStage, ViralDnaStageHandler>> = {
  INPUTS_VALIDATED: inputsValidatedStage,
  METRICS_NORMALIZED: metricsNormalizedStage,
  HOOK_PROFILE_GENERATED: hookProfileGeneratedStage,
  NARRATIVE_PROFILE_GENERATED: narrativeProfileGeneratedStage,
  RETENTION_PROFILE_GENERATED: retentionProfileGeneratedStage,
  VISUAL_PROFILE_GENERATED: visualProfileGeneratedStage,
  AUDIO_PROFILE_GENERATED: audioProfileGeneratedStage,
  EMOTION_PROFILE_GENERATED: emotionProfileGeneratedStage,
  PERFORMANCE_PROFILE_GENERATED: performanceProfileGeneratedStage,
  VIRAL_DNA_SYNTHESIZED: viralDnaSynthesizedStage,
  VIRAL_DNA_VALIDATED: viralDnaValidatedStage,
  VIRAL_DNA_COMPLETED: viralDnaCompletedStage,
}
