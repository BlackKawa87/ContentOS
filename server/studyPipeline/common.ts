import { prisma } from '../lib/prisma.js'
import { supabaseAdmin } from '../lib/supabaseAdmin.js'
import type { VideoModel as Video } from '../generated/prisma/models.js'
import type { ProfileModel as Profile } from '../generated/prisma/models.js'
import type { StorageBucket } from '../generated/prisma/enums.js'

/** Every stage handler needs the video's owning project + profile (for API keys / language prefs). */
export async function getVideoContext(video: Video): Promise<{ projectId: string; profile: Profile }> {
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: video.projectId },
    include: { owner: true },
  })
  return { projectId: project.id, profile: project.owner }
}

/** Downloads a previously uploaded asset's bytes back out of Supabase Storage. */
export async function downloadAsset(bucket: StorageBucket, path: string): Promise<Buffer> {
  const { data, error } = await supabaseAdmin.storage.from(bucket.toLowerCase()).download(path)
  if (error) throw error
  return Buffer.from(await data.arrayBuffer())
}
