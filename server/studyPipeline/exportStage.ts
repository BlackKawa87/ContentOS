import type { VideoModel as Video } from '../generated/prisma/models.js'
import { prisma } from '../lib/prisma.js'
import { uploadAsset } from '../lib/storage.js'
import { getVideoContext } from './common.js'

export async function exportStage(video: Video): Promise<void> {
  const { projectId, profile } = await getVideoContext(video)

  const [transcript, translation, narration, slideDeck, studyVideo, glossary, quiz, flashcards] =
    await Promise.all([
      prisma.transcript.findUnique({ where: { videoId: video.id } }),
      prisma.translation.findUnique({ where: { videoId: video.id } }),
      prisma.narrationAsset.findUnique({ where: { videoId: video.id } }),
      prisma.slideDeck.findUnique({ where: { videoId: video.id } }),
      prisma.studyVideoAsset.findUnique({ where: { videoId: video.id } }),
      prisma.glossary.findUnique({ where: { videoId: video.id } }),
      prisma.quiz.findUnique({ where: { videoId: video.id }, include: { questions: true } }),
      prisma.flashcard.findMany({ where: { videoId: video.id } }),
    ])

  const metadata = {
    video: { id: video.id, title: video.title, sourceUrl: video.sourceUrl, durationSec: video.durationSec },
    transcript: transcript ? { language: transcript.language } : null,
    translation: translation ? { language: translation.language } : null,
    narration: narration ? { voiceId: narration.voiceId, durationSec: narration.durationSec } : null,
    slideDeck: slideDeck ? { slideCount: slideDeck.slideCount } : null,
    studyVideo: studyVideo ? { durationSec: studyVideo.durationSec } : null,
    glossaryTermCount: Array.isArray(glossary?.terms) ? glossary.terms.length : 0,
    quizQuestionCount: quiz?.questions.length ?? 0,
    flashcardCount: flashcards.length,
    generatedAt: new Date().toISOString(),
  }

  await uploadAsset({
    bucket: 'EXPORTS',
    ownerId: profile.id,
    projectId,
    videoId: video.id,
    filename: 'metadata.json',
    data: Buffer.from(JSON.stringify(metadata, null, 2), 'utf-8'),
    contentType: 'application/json',
  })

  const entries: { title: string; entryType: string; refTable: string; refId: string }[] = []
  if (transcript) entries.push({ title: `Transcript: ${video.title}`, entryType: 'transcript', refTable: 'transcripts', refId: transcript.id })
  if (translation) entries.push({ title: `Translation: ${video.title}`, entryType: 'translation', refTable: 'translations', refId: translation.id })
  if (narration) entries.push({ title: `Narration: ${video.title}`, entryType: 'narration', refTable: 'narration_assets', refId: narration.id })
  if (slideDeck) entries.push({ title: `Slides: ${video.title}`, entryType: 'slides', refTable: 'slide_decks', refId: slideDeck.id })
  if (studyVideo) entries.push({ title: `Study Video: ${video.title}`, entryType: 'study_video', refTable: 'study_video_assets', refId: studyVideo.id })
  if (quiz) entries.push({ title: `Quiz: ${video.title}`, entryType: 'quiz', refTable: 'quizzes', refId: quiz.id })

  for (const entry of entries) {
    await prisma.knowledgeBaseEntry.create({
      data: { projectId, title: entry.title, entryType: entry.entryType, refTable: entry.refTable, refId: entry.refId },
    })
  }
}
