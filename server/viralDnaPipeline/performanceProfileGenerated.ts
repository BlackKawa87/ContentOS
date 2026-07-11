import type { VideoModel as Video } from '../generated/prisma/models.js'
import { prisma } from '../lib/prisma.js'
import { getWorkingProfile } from './common.js'

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/** Module 10: attaches Phase 1's performance metrics — pure code, no AI, and no causal
 * claims (this module only ever states "this pattern co-occurs with X performance", never
 * "this caused X" — see hypothesesStage / viralDnaSynthesizedStage for the hypothesis layer
 * where that distinction is enforced explicitly). */
export async function performanceProfileGeneratedStage(video: Video): Promise<void> {
  const workingProfile = await getWorkingProfile(video.id)

  const missingMetrics: string[] = []
  if (video.views === null) missingMetrics.push('views')
  if (video.likes === null) missingMetrics.push('likes')
  if (video.comments === null) missingMetrics.push('comments')
  if (video.outlierScore === null) missingMetrics.push('outlierScore')

  let channelMedianViews: number | null = null
  let channelMedianViewsPerDay: number | null = null
  if (video.channelId) {
    const siblings = await prisma.video.findMany({
      where: { channelId: video.channelId, status: 'READY', views: { not: null } },
      select: { views: true, viewsPerDay: true },
    })
    if (siblings.length > 0) {
      channelMedianViews = median(siblings.map((s) => s.views!))
      channelMedianViewsPerDay = median(siblings.filter((s) => s.viewsPerDay !== null).map((s) => s.viewsPerDay!))
    }
  }

  const engagementRate =
    video.views && video.views > 0 && (video.likes !== null || video.comments !== null)
      ? ((video.likes ?? 0) + (video.comments ?? 0)) / video.views
      : null

  const ageDays = (Date.now() - video.updatedAt.getTime()) / 86_400_000
  const dataFreshness = ageDays < 1 ? 'fresh' : ageDays < 7 ? 'recent' : ageDays < 30 ? 'aging' : 'stale'

  const performance = {
    views: video.views,
    likes: video.likes,
    comments: video.comments,
    viewsPerDay: video.viewsPerDay,
    viewsPerHour: video.viewsPerHour,
    videoAgeDays: video.ageInDays,
    channelMedianViews,
    channelMedianViewsPerDay,
    outlierScore: video.outlierScore,
    outlierClassification: video.outlierClass,
    engagementRate,
    metricsCollectedAt: video.updatedAt,
    dataFreshness,
    missingMetrics,
  }

  await prisma.viralDnaProfile.update({
    where: { id: workingProfile.id },
    data: { performance, outlierScoreSnapshot: video.outlierScore },
  })
}
