import { prisma } from '../lib/prisma.js'
import type { ChannelModel as Channel } from '../generated/prisma/models.js'
import type { ProfileModel as Profile } from '../generated/prisma/models.js'

/** Every stage handler needs the channel's owning project + profile (for import/outlier settings). */
export async function getChannelContext(channel: Channel): Promise<{ projectId: string; profile: Profile }> {
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: channel.projectId },
    include: { owner: true },
  })
  return { projectId: project.id, profile: project.owner }
}
