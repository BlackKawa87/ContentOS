import { supabaseAdmin } from './supabaseAdmin.js'
import { prisma } from './prisma.js'
import type { StorageBucket } from '../generated/prisma/enums.js'

/** Uploads a buffer to Supabase Storage under `${ownerId}/${videoId}/${filename}` and records a StorageAsset row. */
export async function uploadAsset(opts: {
  bucket: StorageBucket
  ownerId: string
  videoId: string
  projectId: string
  filename: string
  data: Buffer | Uint8Array
  contentType: string
}): Promise<string> {
  const path = `${opts.ownerId}/${opts.videoId}/${opts.filename}`
  const bucketName = opts.bucket.toLowerCase()

  const { error } = await supabaseAdmin.storage
    .from(bucketName)
    .upload(path, opts.data, { contentType: opts.contentType, upsert: true })
  if (error) throw error

  await prisma.storageAsset.create({
    data: {
      bucket: opts.bucket,
      path,
      mimeType: opts.contentType,
      sizeBytes: opts.data.byteLength,
      projectId: opts.projectId,
      videoId: opts.videoId,
    },
  })

  return path
}
