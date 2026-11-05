import { desc, eq } from "drizzle-orm"
import Link from "next/link"

import { AdminPage, FRAME } from "@/components/admin/setting"
import { SubmitButton } from "@/components/submit-button"
import { UserAvatar } from "@/components/user-avatar"
import { db } from "@/lib/db"
import { user } from "@/lib/db/schema"
import { getSettings } from "@/lib/signup"
import { setStatus, setStatusMany } from "../members/actions"
import { SelectAll } from "./select-all"

export const metadata = { title: "Approvals · Admin · Nimbus" }

const asked = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
})

export default async function ApprovalsPage() {
  const { signupMode } = await getSettings()
  const people = await db
    .select()
    .from(user)
    .where(eq(user.status, "pending"))
    .orderBy(desc(user.createdAt))

  return (
    <AdminPage
      wide
      title="Approvals"
      description="People who signed up and are waiting for an admin before they can store files. Approved members get an email if email is on."
    >
      {people.length === 0 ? (
        <p className="rounded-xl border border-dashed border-input px-6 py-12 text-center text-sm text-pretty text-muted-foreground">
          No one is waiting for approval.
          {signupMode !== "approval" && (
            <>
              {" "}
              New sign-ups don&apos;t need it right now; change that on{" "}
              <Link
                href="/admin/signups"
                className="text-foreground underline underline-offset-4"
              >
                Sign-ups &amp; invites
              </Link>
              .
            </>
          )}
        </p>
      ) : (
        <form className={FRAME}>
          <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
            <SelectAll count={people.length} />
            <span className="text-sm text-muted-foreground tabular-nums">
              {people.length} waiting
            </span>
            <div className="ml-auto flex gap-2">
              <SubmitButton
                size="sm"
                formAction={setStatusMany.bind(null, "active")}
              >
                Approve selected
              </SubmitButton>
              <SubmitButton
                size="sm"
                variant="destructive"
                formAction={setStatusMany.bind(null, "rejected")}
              >
                Decline selected
              </SubmitButton>
            </div>
          </div>
          <ul className="flex flex-col divide-y">
            {people.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3"
              >
                <input
                  type="checkbox"
                  name="id"
                  value={p.id}
                  aria-label={`Select ${p.name}`}
                  className="size-4 shrink-0 accent-primary"
                />
                <UserAvatar name={p.name} image={p.image} />
                <div className="min-w-0 flex-1 basis-48">
                  <p className="truncate text-sm font-medium">{p.name}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    {p.email}
                  </p>
                </div>
                <span className="text-sm text-muted-foreground tabular-nums">
                  Asked {asked.format(p.createdAt)}
                </span>
                <div className="flex items-center gap-2">
                  <SubmitButton
                    size="sm"
                    formAction={setStatus.bind(null, p.id, "active")}
                  >
                    Approve
                  </SubmitButton>
                  <SubmitButton
                    size="sm"
                    variant="destructive"
                    formAction={setStatus.bind(null, p.id, "rejected")}
                  >
                    Decline
                  </SubmitButton>
                </div>
              </li>
            ))}
          </ul>
        </form>
      )}
    </AdminPage>
  )
}
