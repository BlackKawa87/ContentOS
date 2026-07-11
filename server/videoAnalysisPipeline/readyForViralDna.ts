import type { VideoModel as Video } from '../generated/prisma/models.js'
import { prisma } from '../lib/prisma.js'

/** Terminal marker: every analysis module has run. Viral DNA synthesis itself is Phase 3. */
export async function readyForViralDnaStage(video: Video): Promise<void> {
  await prisma.videoAnalysis.update({
    where: { videoId: video.id },
    data: { readyForViralDnaAt: new Date() },
  })
}
