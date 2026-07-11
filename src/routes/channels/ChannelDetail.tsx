import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabaseClient'

interface ChannelRow {
  id: string
  title: string | null
  handle: string | null
  description: string | null
  thumbnailUrl: string | null
  sourceUrl: string
  status: string
  lastSyncAt: string | null
}

interface VideoRow {
  id: string
  title: string | null
  thumbnailUrl: string | null
  publishedAt: string | null
  durationSec: number | null
  views: number | null
  viewsPerDay: number | null
  outlierScore: number | null
  outlierClass: string | null
  status: string
}

interface Job {
  id: string
  stage: string
  status: string
  attempts: number
  lastError: string | null
  createdAt: string
}

type Tab = 'overview' | 'videos' | 'statistics' | 'outliers' | 'processing'
type Filter = 'all' | 'ready' | 'analyzed' | 'pending' | 'failed' | 'aboveAverage' | 'viral'

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

function formatDuration(sec: number | null): string {
  if (sec == null) return '—'
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function ChannelDetail() {
  const { t } = useTranslation()
  const { channelId } = useParams<{ channelId: string }>()
  const navigate = useNavigate()
  const [channel, setChannel] = useState<ChannelRow | null>(null)
  const [videos, setVideos] = useState<VideoRow[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [tab, setTab] = useState<Tab>('overview')
  const [filter, setFilter] = useState<Filter>('all')
  const [processing, setProcessing] = useState(false)
  const [autoRun, setAutoRun] = useState(false)

  const load = useCallback(async () => {
    if (!channelId) return
    const [{ data: c }, { data: v }, { data: j }] = await Promise.all([
      supabase
        .from('channels')
        .select('id, title, handle, description, thumbnailUrl, sourceUrl, status, lastSyncAt')
        .eq('id', channelId)
        .single(),
      supabase
        .from('videos')
        .select('id, title, thumbnailUrl, publishedAt, durationSec, views, viewsPerDay, outlierScore, outlierClass, status')
        .eq('channelId', channelId)
        .order('publishedAt', { ascending: false, nullsFirst: false }),
      supabase
        .from('processing_jobs')
        .select('id, stage, status, attempts, lastError, createdAt')
        .eq('channelId', channelId)
        .order('createdAt', { ascending: true }),
    ])
    setChannel(c as ChannelRow)
    setVideos((v as VideoRow[]) ?? [])
    setJobs((j as Job[]) ?? [])
  }, [channelId])

  useEffect(() => {
    load()
    if (!channelId) return
    const ch = supabase
      .channel(`channel-${channelId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'processing_jobs', filter: `channelId=eq.${channelId}` },
        () => load(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'videos', filter: `channelId=eq.${channelId}` },
        () => load(),
      )
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [channelId, load])

  const processNext = useCallback(async () => {
    setProcessing(true)
    await authedFetch('/api/reverse/worker', {
      method: 'POST',
      body: JSON.stringify({ channelId }),
    })
    setProcessing(false)
    await load()
  }, [channelId, load])

  useEffect(() => {
    if (!autoRun || channel?.status === 'READY' || channel?.status === 'FAILED') {
      setAutoRun(false)
      return
    }
    const timer = setTimeout(() => processNext(), 1500)
    return () => clearTimeout(timer)
  }, [autoRun, channel?.status, processNext])

  async function retryFailed() {
    const failed = jobs.find((j) => j.status === 'FAILED')
    if (!failed) return
    await authedFetch('/api/reverse/retry', { method: 'POST', body: JSON.stringify({ jobId: failed.id }) })
    await load()
  }

  const filteredVideos = useMemo(() => {
    switch (filter) {
      case 'ready':
        return videos.filter((v) => v.status === 'READY')
      case 'analyzed':
        return videos.filter((v) => v.status === 'COMPLETED')
      case 'pending':
        return videos.filter((v) => v.status === 'NOT_IMPORTED' || v.status === 'QUEUED')
      case 'failed':
        return videos.filter((v) => v.status === 'FAILED')
      case 'aboveAverage':
        return videos.filter((v) => v.outlierClass === 'ABOVE_AVERAGE')
      case 'viral':
        return videos.filter((v) => v.outlierClass === 'VIRAL_OUTLIER' || v.outlierClass === 'STRONG_OUTLIER')
      default:
        return videos
    }
  }, [videos, filter])

  const stats = useMemo(() => {
    const views = videos.map((v) => v.views).filter((v): v is number => v != null).sort((a, b) => a - b)
    const average = views.length ? views.reduce((s, v) => s + v, 0) / views.length : 0
    const mid = Math.floor(views.length / 2)
    const median = views.length === 0 ? 0 : views.length % 2 === 0 ? (views[mid - 1] + views[mid]) / 2 : views[mid]
    return { average, median, count: views.length }
  }, [videos])

  const outlierCounts = useMemo(() => {
    const counts: Record<string, number> = { NORMAL: 0, ABOVE_AVERAGE: 0, STRONG_OUTLIER: 0, VIRAL_OUTLIER: 0 }
    for (const v of videos) if (v.outlierClass) counts[v.outlierClass] = (counts[v.outlierClass] ?? 0) + 1
    return counts
  }, [videos])

  if (!channel) return null

  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: t('channels.tabs.overview') },
    { id: 'videos', label: t('channels.tabs.videos') },
    { id: 'statistics', label: t('channels.tabs.statistics') },
    { id: 'outliers', label: t('channels.tabs.outliers') },
    { id: 'processing', label: t('channels.tabs.processing') },
  ]

  const filters: { id: Filter; label: string }[] = [
    { id: 'all', label: t('channels.filters.all') },
    { id: 'ready', label: t('channels.filters.ready') },
    { id: 'analyzed', label: t('channels.filters.analyzed') },
    { id: 'pending', label: t('channels.filters.pending') },
    { id: 'failed', label: t('channels.filters.failed') },
    { id: 'aboveAverage', label: t('channels.filters.aboveAverage') },
    { id: 'viral', label: t('channels.filters.viral') },
  ]

  return (
    <div>
      <div className="mb-1 flex items-center gap-3">
        {channel.thumbnailUrl && (
          <img src={channel.thumbnailUrl} alt="" className="h-10 w-10 rounded-full object-cover" />
        )}
        <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
          {channel.title ?? channel.handle ?? channel.sourceUrl}
        </h1>
      </div>
      <p className="mb-6 text-sm text-neutral-500 dark:text-neutral-400">Status: {channel.status}</p>

      <div className="mb-6 flex gap-2">
        <button
          onClick={() => processNext()}
          disabled={processing || channel.status === 'READY'}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
        >
          Process next stage
        </button>
        <button
          onClick={() => setAutoRun(true)}
          disabled={autoRun || channel.status === 'READY'}
          className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300"
        >
          {autoRun ? 'Running…' : 'Run to completion'}
        </button>
        {channel.status === 'FAILED' && (
          <button
            onClick={retryFailed}
            className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-600 dark:border-red-700 dark:text-red-400"
          >
            Retry failed stage
          </button>
        )}
      </div>

      <div className="mb-6 flex gap-1 border-b border-neutral-200 dark:border-neutral-800">
        {tabs.map((tb) => (
          <button
            key={tb.id}
            onClick={() => setTab(tb.id)}
            className={`px-3 py-2 text-sm font-medium transition ${
              tab === tb.id
                ? 'border-b-2 border-neutral-900 text-neutral-900 dark:border-neutral-100 dark:text-neutral-100'
                : 'text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200'
            }`}
          >
            {tb.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-neutral-700 dark:text-neutral-300">
            {channel.description ?? '—'}
          </p>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            {videos.length} videos · last synced{' '}
            {channel.lastSyncAt ? new Date(channel.lastSyncAt).toLocaleString() : 'never'}
          </p>
        </div>
      )}

      {tab === 'videos' && (
        <div>
          <div className="mb-4 flex flex-wrap gap-2">
            {filters.map((f) => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                  filter === f.id
                    ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
                    : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs uppercase text-neutral-500 dark:text-neutral-400">
                  <th className="py-2 pr-3">{t('channels.columns.thumbnail')}</th>
                  <th className="py-2 pr-3">{t('channels.columns.title')}</th>
                  <th className="py-2 pr-3">{t('channels.columns.published')}</th>
                  <th className="py-2 pr-3">{t('channels.columns.duration')}</th>
                  <th className="py-2 pr-3">{t('channels.columns.views')}</th>
                  <th className="py-2 pr-3">{t('channels.columns.viewsPerDay')}</th>
                  <th className="py-2 pr-3">{t('channels.columns.outlierScore')}</th>
                  <th className="py-2 pr-3">{t('channels.columns.status')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredVideos.map((v) => (
                  <tr
                    key={v.id}
                    onClick={() => navigate(`/channels/${channelId}/videos/${v.id}`)}
                    className="cursor-pointer border-t border-neutral-200 transition hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900"
                  >
                    <td className="py-2 pr-3">
                      {v.thumbnailUrl && <img src={v.thumbnailUrl} alt="" className="h-8 w-14 rounded object-cover" />}
                    </td>
                    <td className="py-2 pr-3 text-neutral-900 dark:text-neutral-100">{v.title ?? '—'}</td>
                    <td className="py-2 pr-3 text-neutral-500 dark:text-neutral-400">
                      {v.publishedAt ? new Date(v.publishedAt).toLocaleDateString() : '—'}
                    </td>
                    <td className="py-2 pr-3 text-neutral-500 dark:text-neutral-400">{formatDuration(v.durationSec)}</td>
                    <td className="py-2 pr-3 text-neutral-500 dark:text-neutral-400">
                      {v.views?.toLocaleString() ?? '—'}
                    </td>
                    <td className="py-2 pr-3 text-neutral-500 dark:text-neutral-400">
                      {v.viewsPerDay ? Math.round(v.viewsPerDay).toLocaleString() : '—'}
                    </td>
                    <td className="py-2 pr-3 text-neutral-500 dark:text-neutral-400">
                      {v.outlierScore ? v.outlierScore.toFixed(2) : '—'}
                    </td>
                    <td className="py-2 pr-3 text-neutral-500 dark:text-neutral-400">{v.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredVideos.length === 0 && (
              <p className="py-4 text-sm text-neutral-500 dark:text-neutral-400">No videos.</p>
            )}
          </div>
        </div>
      )}

      {tab === 'statistics' && (
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
            <p className="text-xs uppercase text-neutral-500 dark:text-neutral-400">{t('channels.averageViews')}</p>
            <p className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
              {Math.round(stats.average).toLocaleString()}
            </p>
          </div>
          <div className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
            <p className="text-xs uppercase text-neutral-500 dark:text-neutral-400">{t('channels.medianViews')}</p>
            <p className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
              {Math.round(stats.median).toLocaleString()}
            </p>
          </div>
          <div className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
            <p className="text-xs uppercase text-neutral-500 dark:text-neutral-400">Videos analyzed</p>
            <p className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">{stats.count}</p>
          </div>
        </div>
      )}

      {tab === 'outliers' && (
        <div className="grid grid-cols-4 gap-4">
          {(['NORMAL', 'ABOVE_AVERAGE', 'STRONG_OUTLIER', 'VIRAL_OUTLIER'] as const).map((cls) => (
            <div key={cls} className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
              <p className="text-xs uppercase text-neutral-500 dark:text-neutral-400">{cls.replace('_', ' ')}</p>
              <p className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">{outlierCounts[cls]}</p>
            </div>
          ))}
        </div>
      )}

      {tab === 'processing' && (
        <div className="flex flex-col gap-1">
          {jobs.map((job) => (
            <div
              key={job.id}
              className="flex items-center justify-between rounded-md border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800"
            >
              <span className="text-neutral-700 dark:text-neutral-300">{job.stage}</span>
              <span className="text-xs text-neutral-500 dark:text-neutral-400">
                {job.status}
                {job.attempts > 0 ? ` · attempt ${job.attempts}` : ''}
                {job.lastError ? ` · ${job.lastError}` : ''}
              </span>
            </div>
          ))}
          {jobs.length === 0 && <p className="text-sm text-neutral-500 dark:text-neutral-400">No jobs yet.</p>}
        </div>
      )}
    </div>
  )
}
