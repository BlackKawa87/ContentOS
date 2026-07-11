import type { VideoModel as Video } from '../generated/prisma/models.ts'
import { prisma } from '../lib/prisma.ts'
import { getOpenAiClientForProfile } from '../lib/openai.ts'
import { uploadAsset } from '../lib/storage.ts'
import { logApiUsage, RATES } from '../lib/apiUsage.ts'
import { getVideoContext } from './common.ts'

interface QuizQuestionDraft {
  question: string
  options: string[]
  correctOption: number
  explanation?: string
}

export async function quizStage(video: Video): Promise<void> {
  const { projectId, profile } = await getVideoContext(video)
  const openai = await getOpenAiClientForProfile(profile.id)

  const translation = await prisma.translation.findUniqueOrThrow({ where: { videoId: video.id } })

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content:
          'You write multiple-choice quizzes to test comprehension of educational transcripts. Base every question strictly on the given text — never invent facts.',
      },
      {
        role: 'user',
        content: `Generate 5 multiple-choice questions (4 options each) from this text. Respond with a JSON
object { "questions": [{ "question": string, "options": string[4], "correctOption": number (0-3), "explanation": string }] }.\n\n${translation.content}`,
      },
    ],
    response_format: { type: 'json_object' },
  })

  const raw = completion.choices[0].message.content ?? '{}'
  const parsed = JSON.parse(raw) as { questions: QuizQuestionDraft[] }

  const quiz = await prisma.quiz.upsert({
    where: { videoId: video.id },
    create: { videoId: video.id },
    update: {},
  })
  await prisma.quizQuestion.deleteMany({ where: { quizId: quiz.id } })
  await prisma.quizQuestion.createMany({
    data: parsed.questions.map((q, order) => ({
      quizId: quiz.id,
      question: q.question,
      options: q.options,
      correctOption: q.correctOption,
      explanation: q.explanation,
      order,
    })),
  })

  await uploadAsset({
    bucket: 'GENERATED',
    ownerId: profile.id,
    projectId,
    videoId: video.id,
    filename: 'quiz.json',
    data: Buffer.from(JSON.stringify(parsed.questions, null, 2), 'utf-8'),
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
