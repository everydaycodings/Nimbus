"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

const SECTIONS = [
  { href: "/admin/members", label: "Members" },
  { href: "/admin/settings", label: "Settings" },
  { href: "/admin/links", label: "Public links" },
  { href: "/admin/email", label: "Email" },
]

export function AdminNav() {
  const path = usePathname()
  return (
    <nav aria-label="Admin" className="flex gap-4 border-b">
      {SECTIONS.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          aria-current={path === href ? "page" : undefined}
          className="-mb-px border-b-2 border-transparent pb-2.5 text-sm font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:text-foreground focus-visible:underline aria-[current=page]:border-foreground aria-[current=page]:text-foreground"
        >
          {label}
        </Link>
      ))}
    </nav>
  )
}
