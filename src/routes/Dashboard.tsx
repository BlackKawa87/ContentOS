import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderKanban, Video, ListChecks, DollarSign } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import MetricCard from '../components/dashboard/MetricCard'

interface Metrics {
  projects: number
  videos: number
  activeJobs: number
  estimatedCostUsd: number
}

async function loadMetrics(): Promise<Metrics> {
  const [projects, videos, activeJobs, usageLogs] = await Promise.all([
    supabase.from('projects').select('id', { count: 'exact', head: true }),
    supabase.from('videos').select('id', { count: 'exact', head: true }),
    supabase
      .from('processing_jobs')
      .select('id', { count: 'exact', head: true })
      .in('status', ['PENDING', 'RUNNING']),
    supabase.from('api_usage_logs').select('estimatedCostUsd'),
  ])

  const estimatedCostUsd = (usageLogs.data ?? []).reduce(
    (sum, row) => sum + (row.estimatedCostUsd ?? 0),
    0,
  )

  return {
    projects: projects.count ?? 0,
    videos: videos.count ?? 0,
    activeJobs: activeJobs.count ?? 0,
    estimatedCostUsd,
  }
}

export default function Dashboard() {
  const { t } = useTranslation()
  const [metrics, setMetrics] = useState<Metrics | null>(null)

  useEffect(() => {
    loadMetrics().then(setMetrics)
  }, [])

  return (
    <div>
      <h1 className="mb-6 text-xl font-semibold text-neutral-900 dark:text-neutral-100">
        {t('dashboard.title')}
      </h1>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <MetricCard label={t('dashboard.projects')} value={metrics?.projects ?? '—'} icon={FolderKanban} />
        <MetricCard label={t('dashboard.videos')} value={metrics?.videos ?? '—'} icon={Video} />
        <MetricCard
          label={t('dashboard.processingQueue')}
          value={metrics?.activeJobs ?? '—'}
          icon={ListChecks}
          accent={(metrics?.activeJobs ?? 0) > 0}
        />
        <MetricCard
          label={t('dashboard.estimatedCost')}
          value={metrics ? `$${metrics.estimatedCostUsd.toFixed(2)}` : '—'}
          icon={DollarSign}
        />
      </div>

      {metrics?.projects === 0 && (
        <p className="mt-8 text-sm text-neutral-500 dark:text-neutral-400">
          No projects yet — the Study Engine importer lands in M6/M7.
        </p>
      )}
    </div>
  )
}
