import { useTranslation } from 'react-i18next'

export default function Dashboard() {
  const { t } = useTranslation()
  return (
    <div>
      <h1 className="mb-6 text-xl font-semibold text-neutral-900 dark:text-neutral-100">
        {t('dashboard.title')}
      </h1>
      <p className="text-sm text-neutral-500 dark:text-neutral-400">Coming together in M4.</p>
    </div>
  )
}
