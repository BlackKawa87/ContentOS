import type { VideoModel as Video } from '../generated/prisma/models.js'
import type { HookType } from '../generated/prisma/enums.js'
import { prisma } from '../lib/prisma.js'
import { getOpenAiClientForProfile } from '../lib/openai.js'
import { logApiUsage, RATES } from '../lib/apiUsage.js'
import { getVideoContext, getWorkingProfile, addEvidence } from './common.js'

const HOOK_TYPES: HookType[] = [
  'UNEXPECTED_FACT', 'QUESTION', 'CONTRARIAN', 'MYSTERY', 'STORY_OPENING', 'AUTHORITY',
  'PROBLEM_FIRST', 'FUTURE_PROMISE', 'EMOTIONAL', 'SHOCKING_STATEMENT', 'CURIOSITY_GAP',
  'VISUAL_HOOK', 'RESULT_FIRST', 'WARNING', 'TRANSFORMATION_PROMISE',
]

interface HookAiDraft {
  primaryType: HookType
  secondaryTypes?: HookType[]
  openingSentence?: string
  centralPromise?: string
  curiosityGap?: string
  openLoopCreated?: boolean
  questionUsed?: boolean
  contrastUsed?: boolean
  surpriseUsed?: boolean
  authorityUsed?: boolean
  emotionalTrigger?: string
  firstPatternInterrupt?: number
  confidence?: number
  evidence?: string
}

/** Module 3: builds a detailed hook profile from the opening ~34% of the video (the
 * window narrativeAnalyzedStage already timed as the hook), backed by evidence. */
export async function hookProfileGeneratedStage(video: Video): Promise<void> {
  const { projectId, profile: ownerProfile } = await getVideoContext(video)
  const workingProfile = await getWorkingProfile(video.id)
  const openai = await getOpenAiClientForProfile(ownerProfile.id)
  const metrics = workingProfile.metrics as Record<string, number> | null
  const durationSec = video.durationSec ?? 0

  const [narrative, timelineSegments, visualScenes] = await Promise.all([
    prisma.narrativeAnalysis.findUniqueOrThrow({ where: { videoId: video.id } }),
    prisma.timelineSegment.findMany({ where: { videoId: video.id }, orderBy: { index: 'asc' } }),
    prisma.visualScene.findMany({ where: { videoId: video.id }, orderBy: { index: 'asc' } }),
  ])

  const hookEnd = narrative.hookDurationSec ?? metrics?.hookDurationSec ?? Math.min(durationSec * 0.34, 15)
  const hookWindow = timelineSegments.filter((s) => s.startSec < hookEnd)
  const visualsInWindow = visualScenes.filter((s) => s.startSec < hookEnd)
  const windowText = hookWindow.map((s) => `[${s.startSec.toFixed(1)}-${s.endSec.toFixed(1)}] (${s.type}) ${s.text}`).join('\n')

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `You analyze the opening hook of a short-form video for viral-video reverse engineering. primaryType must be one of: ${HOOK_TYPES.join(', ')}. secondaryTypes is an array of zero or more additional types from the same list. Every claim must be backed by a quoted or closely paraphrased line in "evidence".`,
      },
      {
        role: 'user',
        content: `Analyze this opening window (0s-${hookEnd.toFixed(1)}s). Respond with JSON: { "primaryType": string, "secondaryTypes": string[], "openingSentence": string, "centralPromise": string, "curiosityGap": string, "openLoopCreated": boolean, "questionUsed": boolean, "contrastUsed": boolean, "surpriseUsed": boolean, "authorityUsed": boolean, "emotionalTrigger": string, "firstPatternInterrupt": number|null (seconds), "confidence": number (0-1), "evidence": string }.\n\n${windowText}`,
      },
    ],
    response_format: { type: 'json_object' },
  })

  const raw = completion.choices[0].message.content ?? '{}'
  const parsed = JSON.parse(raw) as HookAiDraft
  if (!HOOK_TYPES.includes(parsed.primaryType)) parsed.primaryType = 'UNEXPECTED_FACT'
  parsed.secondaryTypes = (parsed.secondaryTypes ?? []).filter((t) => HOOK_TYPES.includes(t))

  const visualChangeRate = hookEnd > 0 ? visualsInWindow.length / (hookEnd / 60) : 0
  const informationDensity = metrics?.informationUnitsPerMinute ?? 0
  const narrationSpeed = metrics?.wordsPerMinute ?? 0

  const hook = {
    hookStart: 0,
    hookEnd,
    durationSeconds: hookEnd,
    durationPercentage: durationSec > 0 ? hookEnd / durationSec : 0,
    primaryType: parsed.primaryType,
    secondaryTypes: parsed.secondaryTypes,
    openingSentence: parsed.openingSentence,
    centralPromise: parsed.centralPromise,
    curiosityGap: parsed.curiosityGap,
    openLoopCreated: parsed.openLoopCreated ?? false,
    questionUsed: parsed.questionUsed ?? false,
    contrastUsed: parsed.contrastUsed ?? false,
    surpriseUsed: parsed.surpriseUsed ?? false,
    authorityUsed: parsed.authorityUsed ?? false,
    emotionalTrigger: parsed.emotionalTrigger,
    informationDensity,
    narrationSpeed,
    visualChangeCount: visualsInWindow.length,
    visualChangeRate,
    firstPatternInterrupt: parsed.firstPatternInterrupt ?? null,
    confidence: parsed.confidence ?? 0.5,
    evidence: parsed.evidence,
  }

  await prisma.viralDnaProfile.update({
    where: { id: workingProfile.id },
    data: { hook, primaryHookType: parsed.primaryType },
  })

  if (parsed.evidence) {
    await addEvidence(workingProfile.id, [
      {
        evidenceId: 'hook.primaryType',
        sourceType: 'TIMELINE_SEGMENT',
        sourceId: hookWindow[0]?.id,
        timestampStart: 0,
        timestampEnd: hookEnd,
        transcriptExcerpt: parsed.evidence,
        explanation: `Hook classified as ${parsed.primaryType}`,
      },
    ])
  }

  const usage = completion.usage
  if (usage) {
    await logApiUsage({
      profileId: ownerProfile.id,
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
