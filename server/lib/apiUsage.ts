import { prisma } from './prisma.ts'
import type { ApiProvider } from '../generated/prisma/enums.ts'

/** OpenAI pricing (USD) — gpt-4o-mini class rates, approximate, per 1M tokens/chars. Update as needed. */
export const RATES = {
  OPENAI_INPUT_PER_1K_TOKENS: 0.00015,
  OPENAI_OUTPUT_PER_1K_TOKENS: 0.0006,
  OPENAI_AUDIO_PER_MINUTE: 0.006,
  ELEVENLABS_PER_1K_CHARS: 0.03,
}

export async function logApiUsage(opts: {
  profileId: string
  projectId?: string
  videoId?: string
  provider: ApiProvider
  unit: string
  quantity: number
  estimatedCostUsd: number
}) {
  await prisma.apiUsageLog.create({
    data: {
      profileId: opts.profileId,
      projectId: opts.projectId,
      videoId: opts.videoId,
      provider: opts.provider,
      unit: opts.unit,
      quantity: opts.quantity,
      estimatedCostUsd: opts.estimatedCostUsd,
    },
  })
}
