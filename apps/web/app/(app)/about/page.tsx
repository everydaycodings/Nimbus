import {
  ArrowSquareOutIcon,
  CloudIcon,
  GithubLogoIcon,
  GlobeIcon,
} from "@phosphor-icons/react/dist/ssr"
import Image from "next/image"

import { requireMember } from "@/lib/session"

export const metadata = { title: "About · Nimbus" }

const SOURCE = "https://github.com/everydaycodings/Nimbus"

// Who made Nimbus. The photo ships with the app, so opening this page
// never asks github.com for anything.
const CREATOR = {
  name: "everydaycodings",
  photo: "/creator.webp",
  links: [
    {
      label: "GitHub",
      detail: "github.com/everydaycodings",
      href: "https://github.com/everydaycodings",
      icon: GithubLogoIcon,
    },
    {
      label: "Website",
      detail: "everydaycodings.com",
      href: "https://everydaycodings.com",
      icon: GlobeIcon,
    },
  ],
}

function LinkRow({
  href,
  label,
  detail,
  icon: Icon,
}: {
  href: string
  label: string
  detail: string
  icon: typeof GlobeIcon
}) {
  return (
    <li>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-3 px-4 py-3 outline-none hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
          <Icon className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{label}</span>
          <span className="block truncate text-sm text-muted-foreground">
            {detail}
          </span>
        </span>
        <ArrowSquareOutIcon
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground"
        />
        <span className="sr-only">(opens in a new tab)</span>
      </a>
    </li>
  )
}

export default async function AboutPage() {
  await requireMember()
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-10">
      <header className="flex items-center gap-4">
        <span className="grid size-14 shrink-0 place-items-center rounded-2xl border bg-card">
          <CloudIcon weight="fill" className="size-8 text-brand" />
        </span>
        <div className="grid gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Nimbus</h1>
          <p className="text-sm text-pretty text-muted-foreground">
            Open-source, self-hosted file storage you own.
          </p>
        </div>
      </header>

      <section aria-labelledby="creator-heading" className="flex flex-col gap-3">
        <h2 id="creator-heading" className="text-base font-semibold">
          Made by
        </h2>
        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="flex items-center gap-4 border-b px-4 py-4">
            <Image
              src={CREATOR.photo}
              alt=""
              width={56}
              height={56}
              className="size-14 shrink-0 rounded-full border object-cover"
            />
            <div className="min-w-0">
              <p className="truncate text-base font-semibold">{CREATOR.name}</p>
              <p className="text-sm text-muted-foreground">Creator of Nimbus</p>
            </div>
          </div>
          <ul className="flex flex-col divide-y">
            {CREATOR.links.map((l) => (
              <LinkRow key={l.href} {...l} />
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="project-heading" className="flex flex-col gap-3">
        <h2 id="project-heading" className="text-base font-semibold">
          Project
        </h2>
        <ul className="flex flex-col divide-y overflow-hidden rounded-xl border bg-card">
          <LinkRow
            href={SOURCE}
            label="Source code"
            detail="github.com/everydaycodings/Nimbus"
            icon={GithubLogoIcon}
          />
        </ul>
      </section>
    </div>
  )
}
