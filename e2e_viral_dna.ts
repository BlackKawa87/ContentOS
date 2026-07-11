import { createClient } from '@supabase/supabase-js'
import { prisma } from './server/lib/prisma.js'
import { advanceJob } from './server/lib/queue.js'
import { viralDnaValidatedStage } from './server/viralDnaPipeline/viralDnaValidated.js'
import { emotionProfileGeneratedStage } from './server/viralDnaPipeline/emotionProfileGenerated.js'

const VIDEO_ID = process.argv[2]
if (!VIDEO_ID) {
  console.error('Usage: tsx --env-file=.env e2e_viral_dna.ts <videoId>')
  process.exit(1)
}

let passed = 0
let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    passed++
    console.log(`  PASS  ${name}`)
  } else {
    failed++
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

async function runToCompletion(jobId: string): Promise<void> {
  let currentJobId: string | null = jobId
  for (let i = 0; i < 20 && currentJobId; i++) {
    const startedAt = Date.now()
    const result = await advanceJob(currentJobId)
    console.log(`    stage=${result.stage} outcome=${result.outcome} (${((Date.now() - startedAt) / 1000).toFixed(1)}s)${result.error ? ` error=${result.error}` : ''}`)
    if (result.outcome === 'failed') throw new Error(`Job failed: ${result.error}`)
    const nextJob = await prisma.processingJob.findFirst({
      where: { videoId: VIDEO_ID, pipeline: 'VIRAL_DNA', status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    })
    currentJobId = nextJob?.id ?? null
  }
}

async function main() {
  const video = await prisma.video.findUniqueOrThrow({ where: { id: VIDEO_ID } })
  console.log(`\nVideo: ${video.title} (${video.durationSec}s)\n`)

  // --- Test 1: input validation (implicit — INPUTS_VALIDATED throws on missing deps) ---
  console.log('Test 1 — Input validation')
  const videoAnalysis = await prisma.videoAnalysis.findUnique({ where: { videoId: VIDEO_ID } })
  check('Phase 2 outputs ready', !!videoAnalysis?.readyForViralDnaAt)

  // --- Test 2: full generation ---
  console.log('\nTest 2 — Full Viral DNA generation')
  const latest = await prisma.viralDnaProfile.findFirst({ where: { videoId: VIDEO_ID }, orderBy: { profileVersion: 'desc' } })
  const profileVersion = (latest?.profileVersion ?? 0) + 1
  const profile = await prisma.viralDnaProfile.create({
    data: { videoId: VIDEO_ID, profileVersion, isCurrent: false, status: 'DRAFT' },
  })
  const job = await prisma.processingJob.create({
    data: { pipeline: 'VIRAL_DNA', videoId: VIDEO_ID, stage: 'VIRAL_DNA_QUEUED', status: 'PENDING' },
  })
  await runToCompletion(job.id)

  const completedVideo = await prisma.video.findUniqueOrThrow({ where: { id: VIDEO_ID } })
  check('Video marked VIRAL_DNA_COMPLETED', completedVideo.status === 'VIRAL_DNA_COMPLETED', completedVideo.status)

  const finalProfile = await prisma.viralDnaProfile.findUniqueOrThrow({ where: { id: profile.id } })
  check('Profile status VALIDATED', finalProfile.status === 'VALIDATED', finalProfile.status)
  check('isCurrent flipped true', finalProfile.isCurrent === true)
  check('hook section present', !!finalProfile.hook)
  check('narrative section present', !!finalProfile.narrative)
  check('retention section present', !!finalProfile.retention)
  check('visual section present', !!finalProfile.visual)
  check('audio section present', !!finalProfile.audio)
  check('emotion section present', !!finalProfile.emotion)
  check('performance section present', !!finalProfile.performance)

  const scores = await prisma.viralDnaScore.findMany({ where: { profileId: profile.id } })
  check('19 scores generated', scores.length === 19, `got ${scores.length}`)
  check('all scores 0-100', scores.every((s) => s.value >= 0 && s.value <= 100))

  const hypotheses = await prisma.viralDnaHypothesis.findMany({ where: { profileId: profile.id } })
  check('hypotheses generated', hypotheses.length > 0, `got ${hypotheses.length}`)

  // --- Test 3: evidence traceability ---
  console.log('\nTest 3 — Evidence traceability')
  const evidence = await prisma.viralDnaEvidence.findMany({ where: { profileId: profile.id } })
  check('evidence rows recorded', evidence.length > 0, `got ${evidence.length}`)
  check('all evidence belongs to this profile', evidence.every((e) => e.profileId === profile.id))

  // --- Test 4: validator blocks an intentionally invalid profile ---
  console.log('\nTest 4 — Validator blocks invalid profiles')
  const badScore = scores[0]
  await prisma.viralDnaScore.update({ where: { id: badScore.id }, data: { value: 500 } }) // out of range
  let validatorThrew = false
  try {
    await viralDnaValidatedStage(completedVideo)
  } catch {
    validatorThrew = true
  }
  check('validator rejects out-of-range score', validatorThrew)
  await prisma.viralDnaScore.update({ where: { id: badScore.id }, data: { value: badScore.value } }) // restore

  // --- Test 6: resume without repeating completed stages ---
  console.log('\nTest 6 — Resume / idempotency')
  const jobsForVideo = await prisma.processingJob.findMany({ where: { videoId: VIDEO_ID, pipeline: 'VIRAL_DNA' } })
  const succeededStages = jobsForVideo.filter((j) => j.status === 'SUCCEEDED').map((j) => j.stage)
  check('each stage appears at most once as SUCCEEDED', new Set(succeededStages).size === succeededStages.length)

  // --- Test 7: partial regeneration ---
  console.log('\nTest 7 — Partial regeneration')
  const beforeEmotion = finalProfile.emotion
  const beforeHook = finalProfile.hook
  await emotionProfileGeneratedStage(completedVideo)
  const afterPartial = await prisma.viralDnaProfile.findUniqueOrThrow({ where: { id: profile.id } })
  check('emotion section changed', JSON.stringify(afterPartial.emotion) !== JSON.stringify(beforeEmotion))
  check('hook section untouched by partial regen', JSON.stringify(afterPartial.hook) === JSON.stringify(beforeHook))

  // --- Test 8: cost tracking ---
  console.log('\nTest 8 — Cost tracking')
  const usageLogs = await prisma.apiUsageLog.findMany({ where: { videoId: VIDEO_ID, provider: 'OPENAI' } })
  const totalCost = usageLogs.reduce((sum, l) => sum + l.estimatedCostUsd, 0)
  check('api usage logged', usageLogs.length > 0, `${usageLogs.length} entries`)
  console.log(`    total OpenAI cost so far for this video: $${totalCost.toFixed(4)}`)

  // --- Test 9: RLS ---
  console.log('\nTest 9 — RLS (anon, unauthenticated)')
  const anon = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!)
  const { data: anonRows, error: anonError } = await anon.from('viral_dna_profiles').select('id').eq('videoId', VIDEO_ID)
  check('unauthenticated anon client sees zero rows', !anonError && (anonRows?.length ?? 0) === 0, JSON.stringify({ anonRows, anonError }))

  console.log(`\n${passed} passed, ${failed} failed\n`)
  await prisma.$disconnect()
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('FATAL', err)
  process.exit(1)
})
