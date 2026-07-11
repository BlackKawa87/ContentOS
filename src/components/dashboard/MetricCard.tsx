import type { LucideIcon } from 'lucide-react'

interface MetricCardProps {
  label: string
  value: string | number
  icon: LucideIcon
  accent?: boolean
}

export default function MetricCard({ label, value, icon: Icon, accent }: MetricCardProps) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          {label}
        </span>
        <Icon
          size={16}
          className={accent ? 'text-emerald-500' : 'text-neutral-400 dark:text-neutral-500'}
        />
      </div>
      <span className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
        {value}
      </span>
    </div>
  )
}
