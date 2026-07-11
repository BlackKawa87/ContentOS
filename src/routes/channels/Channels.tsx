import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Users, Video, ListChecks, Eye, BarChart3 } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import MetricCard from '../../components/dashboard/MetricCard'

interface ChannelRow {
  id: string
  title: string | null
  handle: string | null
  thumbnailUrl: string | null
  sourceUrl: string
  status: string
  createdAt: string
}

interface Metrics {
  importedChannels: number
  importedVideos: number
  readyForAnalysis: number
  averageViews: number
  medianViews: number
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

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
  IMPORTING: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  READY: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  FAILED: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
}

async function loadMetrics(): Promise<Metrics> {
  const [channels, videos, ready, viewsRows] = await Promise.all([
    supabase.from('channels').select('id', { count: 'exact', head: true }),
    supabase.from('videos').select('id', { count: 'exact', head: true }).not('channelId', 'is', null),
    supabase
      .from('videos')
      .select('id', { count: 'exact', head: true })
      .not('channelId', 'is', null)
      .in('status', ['READY', 'COMPLETED']),
    supabase.from('videos').select('views').not('channelId', 'is', null).not('views', 'is', null),
  ])

  const views = ((viewsRows.data ?? []) as { views: number }[]).map((v) => v.views).sort((a, b) => a - b)
  const averageViews = views.length ? views.reduce((sum, v) => sum + v, 0) / views.length : 0
  const mid = Math.floor(views.length / 2)
  const medianViews = views.length === 0 ? 0 : views.length % 2 === 0 ? (views[mid - 1] + views[mid]) / 2 : views[mid]

  return {
    importedChannels: channels.count ?? 0,
    importedVideos: videos.count ?? 0,
    readyForAnalysis: ready.count ?? 0,
    averageViews,
    medianViews,
  }
}

export default function Channels() {
  const { t } = useTranslation()
  const [sourceUrl, setSourceUrl] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [channels, setChannels] = useState<ChannelRow[]>([])
  const [metrics, setMetrics] = useState<Metrics | null>(null)

  async function loadChannels() {
    const { data } = await supabase
      .from('channels')
      .select('id, title, handle, thumbnailUrl, sourceUrl, status, createdAt')
      .order('createdAt', { ascending: false })
    setChannels((data as ChannelRow[]) ?? [])
  }

  async function refresh() {
    await Promise.all([loadChannels(), loadMetrics().then(setMetrics)])
  }

  useEffect(() => {
    refresh()
  }, [])

  async function handleImport(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    const res = await authedFetch('/api/reverse/import', {
      method: 'POST',
      body: JSON.stringify({ sourceUrl }),
    })
    setSubmitting(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Import failed')
      return
    }
    setSourceUrl('')
    await refresh()
  }

  return (
    <div>
      <h1 className="mb-6 text-xl font-semibold text-neutral-900 dark:text-neutral-100">
        {t('channels.title')}
      </h1>

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-5">
        <MetricCard label={t('channels.importedChannels')} value={metrics?.importedChannels ?? '—'} icon={Users} />
        <MetricCard label={t('channels.importedVideos')} value={metrics?.importedVideos ?? '—'} icon={Video} />
        <MetricCard
          label={t('channels.readyForAnalysis')}
          value={metrics?.readyForAnalysis ?? '—'}
          icon={ListChecks}
          accent={(metrics?.readyForAnalysis ?? 0) > 0}
        />
        <MetricCard
          label={t('channels.averageViews')}
          value={metrics ? Math.round(metrics.averageViews).toLocaleString() : '—'}
          icon={Eye}
        />
        <MetricCard
          label={t('channels.medianViews')}
          value={metrics ? Math.round(metrics.medianViews).toLocaleString() : '—'}
          icon={BarChart3}
        />
      </div>

      <form
        onSubmit={handleImport}
        className="mb-8 flex gap-2 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800"
      >
        <input
          type="url"
          required
          placeholder={t('channels.importPlaceholder')}
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          className="flex-1 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
        />
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        >
          {t('channels.importButton')}
        </button>
      </form>

      {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex flex-col gap-2">
        {channels.map((channel) => (
          <Link
            key={channel.id}
            to={`/channels/${channel.id}`}
            className="flex items-center justify-between gap-3 rounded-lg border border-neutral-200 p-4 transition hover:border-neutral-400 dark:border-neutral-800 dark:hover:border-neutral-600"
          >
            <div className="flex items-center gap-3">
              {channel.thumbnailUrl && (
                <img src={channel.thumbnailUrl} alt="" className="h-10 w-10 rounded-full object-cover" />
              )}
              <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                {channel.title ?? channel.handle ?? channel.sourceUrl}
              </span>
            </div>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[channel.status] ?? ''}`}
            >
              {channel.status}
            </span>
          </Link>
        ))}
        {channels.length === 0 && (
          <p className="text-sm text-neutral-500 dark:text-neutral-400">{t('channels.noChannels')}</p>
        )}
      </div>
    </div>
  )
}
