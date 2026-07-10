export default function ComingSoon({ title }: { title: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
      <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">{title}</h1>
      <p className="text-sm text-neutral-500 dark:text-neutral-400">
        This module is planned but not built yet.
      </p>
    </div>
  )
}
