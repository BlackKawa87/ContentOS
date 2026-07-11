import type { ChannelModel as Channel } from '../generated/prisma/models.js'
import type { OutlierClass } from '../generated/prisma/enums.js'
import { prisma } from '../lib/prisma.js'
import { getChannelContext } from './common.js'

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function classify(
  score: number,
  thresholds: { aboveAvg: number; strong: number; viral: number },
): OutlierClass {
  if (score >= thresholds.viral) return 'VIRAL_OUTLIER'
  if (score >= thresholds.strong) return 'STRONG_OUTLIER'
  if (score >= thresholds.aboveAvg) return 'ABOVE_AVERAGE'
  return 'NORMAL'
}

/** Deterministic outlier detection — no AI. Compares each video's age-normalized
 * ("adjusted") view count against the channel's median, so recently-published
 * videos aren't unfairly flagged as underperforming next to older ones. */
export async function statsCalculatedStage(channel: Channel): Promise<void> {
  const { profile } = await getChannelContext(channel)
  const videos = await prisma.video.findMany({
    where: { channelId: channel.id, status: 'READY', views: { not: null }, publishedAt: { not: null } },
  })

  if (videos.length === 0) {
    await prisma.channel.update({ where: { id: channel.id }, data: { lastSyncAt: new Date() } })
    return
  }

  const now = Date.now()
  const withAge = videos.map((video) => {
    const ageInDays = Math.max(1, Math.floor((now - video.publishedAt!.getTime()) / 86_400_000))
    const views = video.views ?? 0
    return {
      video,
      ageInDays,
      viewsPerDay: views / ageInDays,
      viewsPerHour: ageInDays <= 2 ? views / (ageInDays * 24) : null,
    }
  })

  const medianAgeInDays = median(withAge.map((v) => v.ageInDays))
  const adjustedViews = withAge.map((v) => v.viewsPerDay * medianAgeInDays)
  const medianAdjustedViews = median(adjustedViews)

  const thresholds = {
    aboveAvg: profile.outlierAboveAvgMultiplier,
    strong: profile.outlierStrongMultiplier,
    viral: profile.outlierViralMultiplier,
  }

  for (let i = 0; i < withAge.length; i++) {
    const { video, ageInDays, viewsPerDay, viewsPerHour } = withAge[i]
    const score = medianAdjustedViews > 0 ? adjustedViews[i] / medianAdjustedViews : 0

    await prisma.video.update({
      where: { id: video.id },
      data: {
        ageInDays,
        viewsPerDay,
        viewsPerHour,
        outlierScore: score,
        outlierClass: classify(score, thresholds),
      },
    })
  }

  await prisma.channel.update({ where: { id: channel.id }, data: { lastSyncAt: new Date() } })
}
