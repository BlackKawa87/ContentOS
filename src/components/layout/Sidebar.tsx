import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  LayoutDashboard,
  Sparkles,
  Wand2,
  Library,
  Settings as SettingsIcon,
} from 'lucide-react'

const items = [
  { to: '/', labelKey: 'nav.dashboard', icon: LayoutDashboard, end: true },
  { to: '/channels', labelKey: 'nav.reverseEngineering', icon: Sparkles },
  { to: '/content-builder', labelKey: 'nav.contentBuilder', icon: Wand2 },
  { to: '/knowledge-base', labelKey: 'nav.knowledgeBase', icon: Library },
]

export default function Sidebar() {
  const { t } = useTranslation()

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
      <div className="px-5 py-5">
        <span className="text-lg font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
          {t('app.name')}
        </span>
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-3">
        {items.map(({ to, labelKey, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${
                isActive
                  ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
                  : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-900'
              }`
            }
          >
            <Icon size={16} />
            {t(labelKey)}
          </NavLink>
        ))}
      </nav>

      <div className="px-3 pb-4">
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            `flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${
              isActive
                ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
                : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-900'
            }`
          }
        >
          <SettingsIcon size={16} />
          {t('nav.settings')}
        </NavLink>
      </div>
    </aside>
  )
}
