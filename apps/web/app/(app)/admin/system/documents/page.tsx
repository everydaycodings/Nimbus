import {
  AdminPage,
  SettingRow,
  SettingsForm,
  resettable,
} from "@/components/admin/setting"
import { ConfirmButton } from "@/components/admin/confirm-button"
import { DOCS_KEY, redis } from "@/lib/redis"
import { getSettings } from "@/lib/signup"
import { rerunDocsBackfill, setDocuments } from "../../actions"

export const metadata = { title: "Documents · Admin · Nimbus" }

const CHECK = "size-4 shrink-0 accent-primary self-start sm:self-end"

type Sweep = {
  at: number
  enabled: boolean
  backlog: number
  documents: number
  review: number
  lastError: string | null
}

export default async function DocumentsAdminPage() {
  const s = await getSettings()
  const reset = resettable(s)
  const raw = await redis.get(DOCS_KEY).catch(() => null)
  const sweep = raw ? (JSON.parse(raw) as Sweep) : null

  const status = !s.documentsEnabled
    ? "Off. The worker is not filing or reminding."
    : !sweep
      ? "No sweep from the worker yet. Start `npm run worker`."
      : [
          `${sweep.documents.toLocaleString()} documents, ${sweep.review.toLocaleString()} waiting for review`,
          sweep.backlog
            ? `${sweep.backlog.toLocaleString()} files still to read (a batch of 100 a minute)`
            : "everything has been read",
          sweep.lastError ? `last error: ${sweep.lastError}` : null,
        ]
          .filter(Boolean)
          .join(". ") + "."

  return (
    <AdminPage
      title="Documents"
      description="Documents is a section for PDFs and scans, with a type, sender, date, amount and expiry guessed from their text. Files stay where they are; the section is a view over them."
    >
      <SettingsForm
        action={setDocuments}
        title="Documents section"
        description={status}
      >
        <SettingRow
          id="documents-enabled"
          label="Turn on Documents"
          htmlFor="documentsEnabled"
          hint="Off hides the section on the web and in the app, and stops the worker from filing files and sending expiry reminders. Fields members entered are kept."
          tip={{
            does: "Shows the Documents section and files PDFs and scans in it.",
            affects: "Everyone, within a minute for the app.",
            default: "On",
          }}
          reset={reset("documentsEnabled")}
        >
          <input
            type="checkbox"
            id="documentsEnabled"
            name="documentsEnabled"
            defaultChecked={s.documentsEnabled}
            className={CHECK}
          />
        </SettingRow>
        <SettingRow
          id="docs-ml"
          label="Guess the type of pictures"
          htmlFor="docsMl"
          hint="With picture search turned on under AI features, nimbus-ml looks at a scanned picture and suggests whether it is a receipt, an ID card and so on. Text fields are always guessed by rules, never by a model."
          tip={{
            does: "Lets the picture model suggest a type for scans and photos of documents.",
            affects: "Pictures filed from the next sweep.",
            default: "On",
          }}
          reset={reset("docsMl")}
        >
          <input
            type="checkbox"
            id="docsMl"
            name="docsMl"
            defaultChecked={s.docsMl}
            className={CHECK}
          />
        </SettingRow>
      </SettingsForm>
      <div
        id="docs-backfill"
        className="-mt-6 flex max-w-3xl items-center gap-4"
      >
        <ConfirmButton
          action={rerunDocsBackfill}
          label="Read the documents in review again"
          title="Read again?"
          message="Documents still waiting for review are read again and their guesses replaced, a batch a minute. Confirmed documents and files marked “Not a document” are left alone."
        />
      </div>
    </AdminPage>
  )
}
