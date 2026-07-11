import sharp from 'sharp'
import type { VideoModel as Video } from '../generated/prisma/models'
import { prisma } from '../lib/prisma'
import { composeStudyVideo } from '../lib/ffmpeg'
import { uploadAsset } from '../lib/storage'
import { downloadAsset, getVideoContext } from './common'
import { buildSlidePlan, type SlidePlanItem } from './slidePlan'

const WIDTH = 1280
const HEIGHT = 720

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function slideToSvg(slide: SlidePlanItem): string {
  const bulletLines = slide.bullets
    .map((b, i) => `<text x="80" y="${260 + i * 60}" font-size="32" fill="#1a1a1a">• ${escapeXml(b.slice(0, 90))}</text>`)
    .join('\n')

  return `<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#ffffff" />
    <rect width="100%" height="12" fill="#00d084" />
    <text x="80" y="150" font-size="48" font-weight="bold" fill="#0a0a0a">${escapeXml(slide.title.slice(0, 70))}</text>
    ${bulletLines}
  </svg>`
}

export async function renderVideoStage(video: Video): Promise<void> {
  const { projectId, profile } = await getVideoContext(video)

  const translation = await prisma.translation.findUniqueOrThrow({ where: { videoId: video.id } })
  const narration = await prisma.narrationAsset.findUniqueOrThrow({ where: { videoId: video.id } })
  const plan = buildSlidePlan(translation.content, narration.durationSec ?? 60)

  const narrationBuffer = await downloadAsset('AUDIO', `${profile.id}/${video.id}/narration.mp3`)

  const slides = await Promise.all(
    plan.map(async (slide) => ({
      imageBuffer: await sharp(Buffer.from(slideToSvg(slide))).png().toBuffer(),
      durationSec: slide.durationSec,
    })),
  )

  const videoBuffer = await composeStudyVideo(slides, narrationBuffer)

  await uploadAsset({
    bucket: 'VIDEOS',
    ownerId: profile.id,
    projectId,
    videoId: video.id,
    filename: 'study-video.mp4',
    data: videoBuffer,
    contentType: 'video/mp4',
  })

  await prisma.studyVideoAsset.upsert({
    where: { videoId: video.id },
    create: {
      videoId: video.id,
      storagePath: `${profile.id}/${video.id}/study-video.mp4`,
      durationSec: narration.durationSec,
    },
    update: { durationSec: narration.durationSec },
  })
}
