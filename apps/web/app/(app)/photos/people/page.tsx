import Link from "next/link"

import { PhotoChips } from "@/components/photos-timeline"
import { PeopleGrid } from "@/components/people"
import { aiFlags } from "@/lib/ai"
import { listPeople } from "@/lib/services/people"
import { requireMember } from "@/lib/session"
import { getSettings } from "@/lib/signup"
import { UserIcon } from "@phosphor-icons/react/dist/ssr"

export const metadata = { title: "People · Nimbus" }

export default async function PeoplePage({ searchParams }: { searchParams: Promise<{ hidden?: string }> }) {
  const me = await requireMember()
  const hidden = (await searchParams).hidden === "1"
  const [ai, settings] = await Promise.all([aiFlags(me.id), getSettings()])
  const unavailable = !ai.faces
    ? "Face grouping isn't turned on for this server or your account, so there are no people to show."
    : !ai.facesOn
      ? "Face grouping is off for your account."
      : null
  const { people, hiddenCount } = unavailable ? { people: [], hiddenCount: 0 } : await listPeople(me, hidden)
  return (
    <div className="flex min-h-[calc(100svh-10rem)] flex-col gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{hidden ? "Hidden people" : "People"}</h1>
        <p className="text-sm text-muted-foreground">
          {hidden ? (
            <Link href="/photos/people" className="underline underline-offset-2 hover:text-foreground">
              Back to People
            </Link>
          ) : (
            "Faces in your photos, grouped on your server. Name someone to find their photos by name."
          )}
        </p>
      </div>
      <PhotoChips active="people" mapOn={settings.mapEnabled} />
      {unavailable ? (
        <div className="grid flex-1 place-items-center py-16 text-center">
          <div className="max-w-sm space-y-1">
            <UserIcon weight="light" className="mx-auto size-10 text-muted-foreground" />
            <p className="font-medium">People is off</p>
            <p className="text-sm text-muted-foreground">
              {unavailable}
              {ai.faces && (
                <>
                  {" "}
                  <Link href="/account#face-grouping" className="underline underline-offset-2 hover:text-foreground">
                    Turn it on in Account
                  </Link>
                  .
                </>
              )}
            </p>
          </div>
        </div>
      ) : (
        <PeopleGrid people={people} hiddenCount={hiddenCount} showingHidden={hidden} />
      )}
    </div>
  )
}
