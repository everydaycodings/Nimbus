import {
  AdminPage,
  SELECT,
  SettingRow,
  SettingsForm,
  resettable,
  sizeField,
} from "@/components/admin/setting"
import { SubmitButton } from "@/components/submit-button"
import { Input } from "@/components/ui/input"
import { formatBytes } from "@/lib/file-rules"
import { getSettings } from "@/lib/signup"
import { copyStats } from "@/lib/video-copies"
import { ConfirmButton } from "@/components/admin/confirm-button"
import {
  deleteVideoCopies,
  rereadAll,
  setDerive,
  setOcrLangs,
  setOcrMode,
  setOcrVideoMax,
  setVideoCopies,
} from "../../actions"

export const metadata = { title: "Text in images · Admin · Nimbus" }

export default async function OcrPage() {
  const s = await getSettings()
  const reset = resettable(s)
  const max = sizeField(s.deriveMaxBytes, "MB", "GB")
  const cap = sizeField(s.videoCopyCapBytes, "MB", "GB")
  const copies = await copyStats()

  return (
    <AdminPage
      title="Text in images"
      description="The worker reads the words in photos, scanned PDF pages and video frames, so search finds them and opens at the right place. Nothing is read in anyone's browser."
    >
      <SettingsForm action={setOcrMode}>
        <SettingRow
          id="ocr-mode"
          label="Read text from"
          htmlFor="ocrMode"
          hint="PDF text that can be selected, and documents, are always searchable. This only decides what needs OCR."
          tip={{
            does: "Picks which files the worker runs text recognition on. Off reads none, and images only skips PDFs and videos.",
            affects: "Files read from now on. Text already found stays until you re-read.",
            default: "Everything",
          }}
          reset={reset("ocrMode")}
        >
          <select key={s.ocrMode} id="ocrMode" name="ocrMode" defaultValue={s.ocrMode} className={SELECT}>
            <option value="off">Off</option>
            <option value="images">Images only</option>
            <option value="images_pdfs">Images and PDFs</option>
            <option value="all">Everything (images, PDFs, videos)</option>
          </select>
        </SettingRow>
      </SettingsForm>

      <SettingsForm action={setOcrVideoMax}>
        <SettingRow
          id="ocr-video-max"
          label="Longest video part to read"
          htmlFor="videoMax"
          hint="Minutes from the start of each video. A frame every 5 seconds and at scene changes."
          tip={{
            does: "Caps how much of each video the worker reads for on-screen text.",
            affects: "Videos read from now on.",
            default: "120 minutes",
            example: "30",
          }}
          reset={reset("ocrVideoMaxMin")}
        >
          <Input
            id="videoMax"
            name="videoMax"
            type="number"
            min={1}
            max={1440}
            step={1}
            defaultValue={s.ocrVideoMaxMin}
          />
        </SettingRow>
      </SettingsForm>

      <SettingsForm action={setOcrLangs}>
        <SettingRow
          id="ocr-languages"
          label="Languages"
          htmlFor="ocrLangs"
          hint={`Tesseract codes, separated by commas. Up to 5. Each extra language makes reading slower. Saving downloads them and re-reads images.${
            // Empty until the first save; the worker fetches the default language on first use.
            Object.keys(s.ocrLangStatus).length
              ? ` ${s.ocrLangs
                  .split("+")
                  .map((l) => `${l}: ${s.ocrLangStatus[l] ?? "waiting for the worker"}`)
                  .join(". ")}.`
              : ""
          }`}
          tip={{
            does: "Tells text recognition which languages to expect, so search can find words inside images.",
            affects:
              "Images read from now on. Ones already read keep their text.",
            default: "eng",
            example: "eng, deu, fra, chi_sim",
          }}
          reset={reset("ocrLangs")}
        >
          <Input
            id="ocrLangs"
            name="ocrLangs"
            defaultValue={s.ocrLangs.split("+").join(", ")}
            placeholder="eng"
            autoComplete="off"
            spellCheck={false}
          />
        </SettingRow>
      </SettingsForm>

      <div className="flex max-w-3xl items-center gap-4">
        <ConfirmButton
          action={rereadAll}
          label="Re-read all"
          title="Read every file again?"
          message="Search text for all files is cleared and the worker reads it again, a few files a minute. Search finds less until it catches up; Admin, Health shows the backlog."
        />
        <p className="text-sm text-muted-foreground">
          Reads all text again, for example after changing what is read.
        </p>
      </div>

      <SettingsForm
        action={setDerive}
        title="Background thumbnails & text"
        description="Files no browser handled, like WebDAV and API uploads, get their thumbnail from the worker a couple of minutes later. Images, PDFs and text files get thumbnails here. Search text for every file comes from the worker, as set above."
      >
        <SettingRow
          id="derive-jobs"
          label="Jobs at a time"
          htmlFor="deriveJobs"
          hint="Up to 8. More finishes a big upload sooner but takes more of the server's memory and CPU."
          tip={{
            does: "How many files the worker reads at once to make thumbnails and search text.",
            affects: "The worker, within a minute of saving.",
            default: "1",
            example: "2",
          }}
          reset={reset("deriveConcurrency")}
        >
          <Input
            id="deriveJobs"
            name="deriveJobs"
            type="number"
            min={1}
            max={8}
            step={1}
            defaultValue={s.deriveConcurrency}
          />
        </SettingRow>
        <SettingRow
          id="derive-max"
          label="Largest file to process"
          htmlFor="deriveMax"
          hint="Bigger files are skipped and get a thumbnail when someone opens them in a browser."
          tip={{
            does: "Caps the size of a file the worker reads whole into memory.",
            affects: "Files processed from now on.",
            default: "200 MB",
            example: "1 GB",
          }}
          reset={reset("deriveMaxBytes")}
        >
          <div className="grid grid-cols-[1fr_5rem] gap-2">
            <Input
              id="deriveMax"
              name="deriveMax"
              type="number"
              min={1}
              step="any"
              defaultValue={max.value}
            />
            <select
              key={max.unit}
              aria-label="Unit"
              name="unit"
              defaultValue={max.unit}
              className={SELECT}
            >
              <option value="MB">MB</option>
              <option value="GB">GB</option>
            </select>
          </div>
        </SettingRow>
      </SettingsForm>

      <SettingsForm
        action={setVideoCopies}
        title="Video copies"
        description={`The worker makes 720p and 480p data-saver copies of videos, one at a time, for phones on mobile data, slow connections and Cast. Needs ffmpeg next to the worker. ${copies.count} ready (${formatBytes(copies.bytes)}), ${copies.pending} waiting${copies.failed ? `, ${copies.failed} failed` : ""}. Copies don't count against anyone's storage.`}
      >
        <SettingRow
          id="video-copies"
          label="Make data-saver copies"
          htmlFor="enabled"
          hint="New videos get copies within a few minutes; existing ones slowly, in the background."
          tip={{
            does: "Lets the worker re-encode videos to 720p and 480p, and lets owners tap Make data-saver copy.",
            affects: "Videos from now on. Off keeps the copies that exist.",
            default: "Off",
          }}
          reset={reset("videoCopies")}
        >
          <input
            type="checkbox"
            id="enabled"
            name="enabled"
            defaultChecked={s.videoCopies}
            className="size-4 shrink-0 accent-primary self-start sm:self-end"
          />
        </SettingRow>
        <SettingRow
          id="video-copy-cap"
          label="Size limit for all copies"
          htmlFor="cap"
          hint="Blank: no limit. New copies stop once the copies together reach it."
          tip={{
            does: "Caps the total size of all video copies.",
            affects: "Copies made from now on.",
            default: "No limit",
            example: "200 GB",
          }}
          reset={reset("videoCopyCapBytes")}
        >
          <div className="grid grid-cols-[1fr_5rem] gap-2">
            <Input id="cap" name="cap" type="number" min={1} step="any" defaultValue={cap.value} />
            <select key={cap.unit} aria-label="Unit" name="unit" defaultValue={cap.unit} className={SELECT}>
              <option value="MB">MB</option>
              <option value="GB">GB</option>
            </select>
          </div>
        </SettingRow>
      </SettingsForm>
      <form action={deleteVideoCopies} className="flex max-w-3xl items-center gap-4">
        <SubmitButton variant="outline">Delete all copies</SubmitButton>
        <p className="text-sm text-muted-foreground">
          Removes every copy and turns copies off. Originals are untouched.
        </p>
      </form>
    </AdminPage>
  )
}
