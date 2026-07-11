import { prisma } from '../lib/prisma.js'
import type { VideoModel as Video } from '../generated/prisma/models.js'
import type { ProfileModel as Profile } from '../generated/prisma/models.js'
import type { ViralDnaProfileModel as ViralDnaProfile } from '../generated/prisma/models.js'
import type { EvidenceSourceType } from '../generated/prisma/enums.js'

/** Every stage handler needs the video's owning project + profile (for API keys / cost attribution). */
export async function getVideoContext(video: Video): Promise<{ projectId: string; profile: Profile }> {
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: video.projectId },
    include: { owner: true },
  })
  return { projectId: project.id, profile: project.owner }
}

/** The ViralDnaProfile row this pipeline run is building — always the highest
 * profileVersion for the video (isCurrent only flips at VIRAL_DNA_COMPLETED). */
export async function getWorkingProfile(videoId: string): Promise<ViralDnaProfile> {
  return prisma.viralDnaProfile.findFirstOrThrow({
    where: { videoId },
    orderBy: { profileVersion: 'desc' },
  })
}

export interface EvidenceInput {
  evidenceId: string
  sourceType: EvidenceSourceType
  sourceId?: string
  timestampStart?: number
  timestampEnd?: number
  transcriptExcerpt?: string
  metricName?: string
  metricValue?: number
  explanation?: string
}

/** Records the backing evidence for claims a stage just wrote into the profile's JSON. */
export async function addEvidence(profileId: string, entries: EvidenceInput[]): Promise<void> {
  if (entries.length === 0) return
  await prisma.viralDnaEvidence.createMany({
    data: entries.map((e) => ({ profileId, ...e })),
  })
}
