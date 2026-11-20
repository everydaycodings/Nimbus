import { WarningIcon } from "@phosphor-icons/react/dist/ssr"

import { BROWSER_STEPS } from "./format"

// Shown while no browser service is set up or it isn't answering. Pages saved earlier stay readable.
export function NeedsBrowser({ state, admin }: { state: "off" | "down"; admin: boolean }) {
  return (
    <section aria-labelledby="needs-browser" className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <div className="flex items-start gap-3">
        <WarningIcon aria-hidden className="mt-0.5 size-5 shrink-0 text-warning" />
        <div className="grid gap-1">
          <h2 id="needs-browser" className="font-medium">Needs the browser service</h2>
          <p className="max-w-prose text-sm text-pretty text-muted-foreground">
            {state === "down"
              ? "The browser service is set up but isn't answering, so pages can't be captured right now. Pages you saved before stay readable."
              : "Pages are opened in a separate browser container so nothing runs inside Nimbus itself. It isn't set up on this server yet."}
          </p>
        </div>
      </div>
      {admin ? (
        <ol className="ml-8 grid list-decimal gap-1.5 text-sm text-pretty text-muted-foreground">
          {BROWSER_STEPS.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      ) : (
        <p className="ml-8 text-sm text-pretty text-muted-foreground">Ask an admin to turn it on. It&apos;s under Admin, More tools.</p>
      )}
    </section>
  )
}
