import 'dotenv/config'
import { supabaseAdmin } from '../lib/supabaseAdmin.ts'

const BUCKETS = [
  'videos',
  'audio',
  'slides',
  'exports',
  'images',
  'documents',
  'generated',
  'thumbnails',
] as const

async function main() {
  const { data: existing, error: listError } = await supabaseAdmin.storage.listBuckets()
  if (listError) throw listError
  const existingNames = new Set((existing ?? []).map((b) => b.name))

  for (const name of BUCKETS) {
    if (existingNames.has(name)) {
      console.log(`bucket "${name}" already exists, skipping`)
      continue
    }
    const { error } = await supabaseAdmin.storage.createBucket(name, { public: false })
    if (error) throw error
    console.log(`created bucket "${name}"`)
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err)
    process.exit(1)
  },
)
