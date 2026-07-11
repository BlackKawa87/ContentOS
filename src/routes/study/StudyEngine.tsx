import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabaseClient'

interface VideoRow {
  id: string
  title: string | null
  sourceUrl: string
  status: string
  createdAt: string
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
  QUEUED: 'bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
  PROCESSING: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  COMPLETED: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  FAILED: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
}

export default function StudyEngine() {
  const { t } = useTranslation()
  const [sourceUrl, setSourceUrl] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [videos, setVideos] = useState<VideoRow[]>([])

  async function loadVideos() {
    const { data } = await supabase
      .from('videos')
      .select('id, title, sourceUrl, status, createdAt')
      .order('createdAt', { ascending: false })
    setVideos((data as VideoRow[]) ?? [])
  }

  useEffect(() => {
    loadVideos()
  }, [])

  async function handleImport(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    const res = await authedFetch('/api/study/import', {
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
    await loadVideos()
  }

  return (
    <div>
      <h1 className="mb-6 text-xl font-semibold text-neutral-900 dark:text-neutral-100">
        {t('nav.studyEngine')}
      </h1>

      <form
        onSubmit={handleImport}
        className="mb-8 flex gap-2 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800"
      >
        <input
          type="url"
          required
          placeholder="https://www.youtube.com/watch?v=..."
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          className="flex-1 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
        />
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        >
          Import
        </button>
      </form>

      {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex flex-col gap-2">
        {videos.map((video) => (
          <Link
            key={video.id}
            to={`/study/${video.id}`}
            className="flex items-center justify-between rounded-lg border border-neutral-200 p-4 transition hover:border-neutral-400 dark:border-neutral-800 dark:hover:border-neutral-600"
          >
            <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
              {video.title ?? video.sourceUrl}
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[video.status] ?? ''}`}
            >
              {video.status}
            </span>
          </Link>
        ))}
        {videos.length === 0 && (
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            No videos imported yet — paste a YouTube URL above to start.
          </p>
        )}
      </div>
    </div>
  )
}
