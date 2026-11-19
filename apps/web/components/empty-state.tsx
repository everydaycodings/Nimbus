// The dashed "nothing here" box. No client features, so server components can use it too
// (registry-ui.tsx is "use client", and a server component can't hand its icon component across).
export function Empty({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-12 text-center">
      <Icon className="size-8 text-muted-foreground" />
      <h2 className="font-medium">{title}</h2>
      <div className="flex w-full max-w-lg flex-col items-center gap-3 text-sm text-pretty text-muted-foreground">{children}</div>
    </div>
  )
}
