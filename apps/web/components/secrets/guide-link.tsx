import { BookOpenTextIcon } from "@phosphor-icons/react/ssr"
import Link from "next/link"

// A quiet pointer into the "Connect your apps" guide.
export function GuideLink({ to, children = "How to use it in your apps" }: { to: string; children?: React.ReactNode }) {
  return (
    <Link
      href={`/secrets/connect#${to}`}
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
    >
      <BookOpenTextIcon className="size-3.5" />
      {children}
    </Link>
  )
}
