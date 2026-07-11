interface TabItem<T extends string> {
  id: T
  label: string
}

interface TabsProps<T extends string> {
  tabs: TabItem<T>[]
  active: T
  onChange: (id: T) => void
}

/** Shared tab-switcher — extracted from the pattern hand-rolled in ChannelDetail.tsx,
 * now reused by VideoDetail.tsx's Overview/Viral DNA tabs. */
export default function Tabs<T extends string>({ tabs, active, onChange }: TabsProps<T>) {
  return (
    <div className="mb-6 flex gap-1 border-b border-neutral-200 dark:border-neutral-800">
      {tabs.map((tb) => (
        <button
          key={tb.id}
          onClick={() => onChange(tb.id)}
          className={`px-3 py-2 text-sm font-medium transition ${
            active === tb.id
              ? 'border-b-2 border-neutral-900 text-neutral-900 dark:border-neutral-100 dark:text-neutral-100'
              : 'text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200'
          }`}
        >
          {tb.label}
        </button>
      ))}
    </div>
  )
}
