import type { VideoModel as Video } from '../generated/prisma/models.ts'
import { prisma } from '../lib/prisma.ts'
import { getOpenAiClientForProfile } from '../lib/openai.ts'
import { uploadAsset } from '../lib/storage.ts'
import { logApiUsage, RATES } from '../lib/apiUsage.ts'
import { getVideoContext } from './common.ts'

const LANGUAGE_NAMES: Record<string, string> = { EN: 'English', PT: 'Portuguese', ES: 'Spanish' }

const SYSTEM_PROMPT = `You are a faithful educational translator. You translate transcripts for a study
platform whose mission is to PRESERVE the original educational content, never to create new content.

Rules (never break these):
- Never summarize. Translate the full text, preserving its length and structure.
- Never change facts, numbers, or dates.
- Never alter names of people, places, or institutions.
- Never reorganize or reorder information.
- Never simplify historical facts.
- When a proper noun / institution from the source language appears, preserve BOTH forms in the
  translated text, translated form first: "Câmara dos Comuns (House of Commons)".
The translated version must preserve 100% of the source's educational value.`

export async function translateStage(video: Video): Promise<void> {
  const { projectId, profile } = await getVideoContext(video)
  const openai = await getOpenAiClientForProfile(profile.id)

  const transcript = await prisma.transcript.findUniqueOrThrow({ where: { videoId: video.id } })
  const targetLanguage = LANGUAGE_NAMES[profile.translationLang] ?? 'Portuguese'

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Translate the following transcript into ${targetLanguage}. Respond with a JSON object
with keys "translation" (the full translated text) and "glossary" (an array of
{ "term": string, "translated": string, "original": string } for every preserved proper
noun/institution). Transcript:\n\n${transcript.content}`,
      },
    ],
    response_format: { type: 'json_object' },
  })

  const raw = completion.choices[0].message.content ?? '{}'
  const parsed = JSON.parse(raw) as {
    translation: string
    glossary: { term: string; translated: string; original: string }[]
  }

  await prisma.translation.upsert({
    where: { videoId: video.id },
    create: { videoId: video.id, language: profile.translationLang, content: parsed.translation },
    update: { content: parsed.translation, language: profile.translationLang },
  })

  await prisma.glossary.upsert({
    where: { videoId: video.id },
    create: { videoId: video.id, terms: parsed.glossary ?? [] },
    update: { terms: parsed.glossary ?? [] },
  })

  await uploadAsset({
    bucket: 'DOCUMENTS',
    ownerId: profile.id,
    projectId,
    videoId: video.id,
    filename: `translation-${profile.translationLang.toLowerCase()}.md`,
    data: Buffer.from(parsed.translation, 'utf-8'),
    contentType: 'text/markdown',
  })

  await uploadAsset({
    bucket: 'GENERATED',
    ownerId: profile.id,
    projectId,
    videoId: video.id,
    filename: 'glossary.json',
    data: Buffer.from(JSON.stringify(parsed.glossary ?? [], null, 2), 'utf-8'),
    contentType: 'application/json',
  })

  const usage = completion.usage
  if (usage) {
    const cost =
      (usage.prompt_tokens / 1000) * RATES.OPENAI_INPUT_PER_1K_TOKENS +
      (usage.completion_tokens / 1000) * RATES.OPENAI_OUTPUT_PER_1K_TOKENS
    await logApiUsage({
      profileId: profile.id,
      projectId,
      videoId: video.id,
      provider: 'OPENAI',
      unit: 'tokens',
      quantity: usage.total_tokens,
      estimatedCostUsd: cost,
    })
  }
}
