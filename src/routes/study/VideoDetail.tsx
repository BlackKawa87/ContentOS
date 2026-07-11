import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'

interface Job {
  id: string
  stage: string
  status: string
  attempts: number
  lastError: string | null
  createdAt: string
}

interface Asset {
  id: string
  bucket: string
  path: string
  mimeType: string | null
}

interface VideoRow {
  id: string
  title: string | null
  sourceUrl: string
  status: string
}

async function authedFetch(path: string, init: RequestInit = {}) {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  return fetch(path, {
    ...init,
    headers: {
      ...init.headers,
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token ?? ''}`,
    },
  })
}

export default function VideoDetail() {
  const { videoId } = useParams<{ videoId: string }>()
  const [video, setVideo] = useState<VideoRow | null>(null)
  const [jobs, setJobs] = useState<Job[]>([])
  const [assets, setAssets] = useState<Asset[]>([])
  const [processing, setProcessing] = useState(false)
  const [autoRun, setAutoRun] = useState(false)

  const load = useCallback(async () => {
    if (!videoId) return
    const [{ data: v }, { data: j }, { data: a }] = await Promise.all([
      supabase.from('videos').select('id, title, sourceUrl, status').eq('id', videoId).single(),
      supabase
        .from('processing_jobs')
        .select('id, stage, status, attempts, lastError, createdAt')
        .eq('videoId', videoId)
        .order('createdAt', { ascending: true }),
      supabase.from('storage_assets').select('id, bucket, path, mimeType').eq('videoId', videoId),
    ])
    setVideo(v as VideoRow)
    setJobs((j as Job[]) ?? [])
    setAssets((a as Asset[]) ?? [])
  }, [videoId])

  useEffect(() => {
    load()
    if (!videoId) return
    const channel = supabase
      .channel(`video-${videoId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'processing_jobs', filter: `videoId=eq.${videoId}` },
        () => load(),
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [videoId, load])

  const processNext = useCallback(async () => {
    setProcessing(true)
    const res = await authedFetch('/api/study/worker', {
      method: 'POST',
      body: JSON.stringify({ videoId }),
    })
    setProcessing(false)
    const body = await res.json().catch(() => ({}))
    await load()
    return body
  }, [videoId, load])

  useEffect(() => {
    if (!autoRun || video?.status === 'COMPLETED' || video?.status === 'FAILED') {
      setAutoRun(false)
      return
    }
    const timer = setTimeout(() => processNext(), 1500)
    return () => clearTimeout(timer)
  }, [autoRun, video?.status, processNext])

  async function downloadAsset(asset: Asset) {
    const { data } = await supabase.storage
      .from(asset.bucket.toLowerCase())
      .createSignedUrl(asset.path, 60)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  async function retryFailed() {
    const failed = jobs.find((j) => j.status === 'FAILED')
    if (!failed) return
    await authedFetch('/api/study/retry', { method: 'POST', body: JSON.stringify({ jobId: failed.id }) })
    await load()
  }

  if (!video) return null

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-neutral-900 dark:text-neutral-100">
        {video.title ?? video.sourceUrl}
      </h1>
      <p className="mb-6 text-sm text-neutral-500 dark:text-neutral-400">Status: {video.status}</p>

      <div className="mb-8 flex gap-2">
        <button
          onClick={() => processNext()}
          disabled={processing || video.status === 'COMPLETED'}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
        >
          Process next stage
        </button>
        <button
          onClick={() => setAutoRun(true)}
          disabled={autoRun || video.status === 'COMPLETED'}
          className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300"
        >
          {autoRun ? 'Running…' : 'Run to completion'}
        </button>
        {video.status === 'FAILED' && (
          <button
            onClick={retryFailed}
            className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-600 dark:border-red-700 dark:text-red-400"
          >
            Retry failed stage
          </button>
        )}
      </div>

      <h2 className="mb-2 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
        Processing queue
      </h2>
      <div className="mb-8 flex flex-col gap-1">
        {jobs.map((job) => (
          <div
            key={job.id}
            className="flex items-center justify-between rounded-md border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800"
          >
            <span className="text-neutral-700 dark:text-neutral-300">{job.stage}</span>
            <span className="text-xs text-neutral-500 dark:text-neutral-400">
              {job.status}
              {job.attempts > 0 ? ` · attempt ${job.attempts}` : ''}
            </span>
          </div>
        ))}
      </div>

      <h2 className="mb-2 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
        Generated assets
      </h2>
      <div className="flex flex-col gap-1">
        {assets.map((asset) => (
          <button
            key={asset.id}
            onClick={() => downloadAsset(asset)}
            className="flex items-center justify-between rounded-md border border-neutral-200 px-3 py-2 text-left text-sm text-neutral-700 hover:border-neutral-400 dark:border-neutral-800 dark:text-neutral-300 dark:hover:border-neutral-600"
          >
            <span>{asset.path.split('/').pop()}</span>
            <span className="text-xs text-neutral-500 dark:text-neutral-400">{asset.bucket}</span>
          </button>
        ))}
        {assets.length === 0 && (
          <p className="text-sm text-neutral-500 dark:text-neutral-400">No assets yet.</p>
        )}
      </div>
    </div>
  )
}
