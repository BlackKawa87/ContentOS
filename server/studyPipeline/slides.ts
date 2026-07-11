import PptxGenJS from 'pptxgenjs'
import type { VideoModel as Video } from '../generated/prisma/models.ts'
import { prisma } from '../lib/prisma.ts'
import { uploadAsset } from '../lib/storage.ts'
import { getVideoContext } from './common.ts'
import { buildSlidePlan } from './slidePlan.ts'

export async function slidesStage(video: Video): Promise<void> {
  const { projectId, profile } = await getVideoContext(video)

  const translation = await prisma.translation.findUniqueOrThrow({ where: { videoId: video.id } })
  const narration = await prisma.narrationAsset.findUniqueOrThrow({ where: { videoId: video.id } })
  const plan = buildSlidePlan(translation.content, narration.durationSec ?? 60)

  const pptx = new PptxGenJS()
  for (const slide of plan) {
    const s = pptx.addSlide()
    s.addText(slide.title, { x: 0.5, y: 0.4, w: 9, h: 1, fontSize: 28, bold: true })
    if (slide.bullets.length > 0) {
      s.addText(
        slide.bullets.map((b) => ({ text: b, options: { bullet: true, breakLine: true } })),
        { x: 0.5, y: 1.5, w: 9, h: 4, fontSize: 18 },
      )
    }
  }

  const pptxBuffer = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer

  const pptxPath = await uploadAsset({
    bucket: 'SLIDES',
    ownerId: profile.id,
    projectId,
    videoId: video.id,
    filename: 'slides.pptx',
    data: pptxBuffer,
    contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  })

  await prisma.slideDeck.upsert({
    where: { videoId: video.id },
    create: { videoId: video.id, slideCount: plan.length, pptxPath },
    update: { slideCount: plan.length, pptxPath },
  })
}
