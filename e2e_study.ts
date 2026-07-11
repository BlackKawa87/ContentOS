import 'dotenv/config'
import { prisma } from './server/lib/prisma.ts'
import { advanceJob } from './server/lib/queue.ts'

const SOURCE_URL = 'https://www.youtube.com/watch?v=nDfPZUpB-6Y'

const owner = await prisma.profile.findFirstOrThrow({ where: { email: process.env.TEST_USER_EMAIL! } })

const project = await prisma.project.create({
  data: { ownerId: owner.id, title: 'E2E Study Test', type: 'STUDY' },
})
const video = await prisma.video.create({
  data: { projectId: project.id, sourceUrl: SOURCE_URL, sourceType: 'YOUTUBE_VIDEO', status: 'QUEUED' },
})
let job = await prisma.processingJob.create({
  data: { videoId: video.id, stage: 'QUEUED', status: 'PENDING' },
})

console.log('project:', project.id, 'video:', video.id)

for (let i = 0; i < 15; i++) {
  const start = Date.now()
  const result = await advanceJob(job.id)
  console.log(`[${((Date.now() - start) / 1000).toFixed(1)}s] -> ${result.stage} :: ${result.outcome}${result.error ? ' :: ' + result.error : ''}`)

  if (result.outcome === 'failed') {
    console.error('PIPELINE FAILED at stage', result.stage)
    process.exit(1)
  }
  if (result.stage === 'COMPLETED' && result.outcome === 'succeeded') {
    console.log('PIPELINE COMPLETE')
    break
  }

  const next = await prisma.processingJob.findFirst({
    where: { videoId: video.id, status: 'PENDING' },
    orderBy: { createdAt: 'desc' },
  })
  if (!next) {
    console.log('No more pending jobs, stopping.')
    break
  }
  job = next
}

process.exit(0)
