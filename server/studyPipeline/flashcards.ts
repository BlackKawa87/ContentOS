import type { VideoModel as Video } from '../generated/prisma/models'
import { prisma } from '../lib/prisma'
import { getOpenAiClientForProfile } from '../lib/openai'
import { uploadAsset } from '../lib/storage'
import { logApiUsage, RATES } from '../lib/apiUsage'
import { getVideoContext } from './common'

export async function flashcardsStage(video: Video): Promise<void> {
  const { projectId, profile } = await getVideoContext(video)
  const openai = await getOpenAiClientForProfile(profile.id)

  const translation = await prisma.translation.findUniqueOrThrow({ where: { videoId: video.id } })

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content:
          'You write study flashcards (front/back) strictly grounded in the given text — never invent facts.',
      },
      {
        role: 'user',
        content: `Generate 10 flashcards from this text. Respond with a JSON object
{ "flashcards": [{ "front": string, "back": string }] }.\n\n${translation.content}`,
      },
    ],
    response_format: { type: 'json_object' },
  })

  const raw = completion.choices[0].message.content ?? '{}'
  const parsed = JSON.parse(raw) as { flashcards: { front: string; back: string }[] }

  await prisma.flashcard.deleteMany({ where: { videoId: video.id } })
  await prisma.flashcard.createMany({
    data: parsed.flashcards.map((f, order) => ({
      videoId: video.id,
      front: f.front,
      back: f.back,
      order,
    })),
  })

  await uploadAsset({
    bucket: 'GENERATED',
    ownerId: profile.id,
    projectId,
    videoId: video.id,
    filename: 'flashcards.json',
    data: Buffer.from(JSON.stringify(parsed.flashcards, null, 2), 'utf-8'),
    contentType: 'application/json',
  })

  const usage = completion.usage
  if (usage) {
    await logApiUsage({
      profileId: profile.id,
      projectId,
      videoId: video.id,
      provider: 'OPENAI',
      unit: 'tokens',
      quantity: usage.total_tokens,
      estimatedCostUsd:
        (usage.prompt_tokens / 1000) * RATES.OPENAI_INPUT_PER_1K_TOKENS +
        (usage.completion_tokens / 1000) * RATES.OPENAI_OUTPUT_PER_1K_TOKENS,
    })
  }
}
