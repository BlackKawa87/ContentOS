import type { VideoModel as Video } from '../generated/prisma/models.js'
import { prisma } from '../lib/prisma.js'
import { getWorkingProfile } from './common.js'

/** Terminal marker: flips the newly-validated profile to isCurrent (demoting whichever
 * version was previously current). The video's own status flip to VIRAL_DNA_COMPLETED is
 * handled by server/lib/queue.ts's generic pipeline-aware entityUpdate, not here — avoids
 * two competing writes to the same row within the same advanceJob transaction. */
export async function viralDnaCompletedStage(video: Video): Promise<void> {
  const profile = await getWorkingProfile(video.id)

  await prisma.$transaction([
    prisma.viralDnaProfile.updateMany({
      where: { videoId: video.id, isCurrent: true, id: { not: profile.id } },
      data: { isCurrent: false },
    }),
    prisma.viralDnaProfile.update({
      where: { id: profile.id },
      data: { isCurrent: true },
    }),
  ])
}
