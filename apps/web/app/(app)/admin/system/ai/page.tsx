import {
  AdminPage,
  SELECT,
  SettingRow,
  SettingsForm,
  resettable,
} from "@/components/admin/setting"
import { ConfirmButton } from "@/components/admin/confirm-button"
import { Input } from "@/components/ui/input"
import { hasVector, mlApi } from "@/lib/ai"
import { ML_KEY, redis } from "@/lib/redis"
import { getSettings } from "@/lib/signup"
import type { MlFeature, MlHealth } from "@/lib/ml"
import type { MlStatus } from "../../../../../scripts/ml"
import {
  reindexClip,
  reindexFaces,
  reindexSpeech,
  setAiAccess,
  setMlClip,
  setMlConnection,
  setMlFaces,
  setMlSpeech,
} from "../../actions"

export const metadata = { title: "AI features · Admin · Nimbus" }

const eta = (backlog: number, perMin: number) => {
  if (!backlog) return ""
  if (!perMin) return ""
  const min = Math.ceil(backlog / perMin)
  return `, about ${min < 90 ? `${min} min` : `${Math.round(min / 60)} h`} left`
}

export default async function AiPage() {
  const s = await getSettings()
  const reset = resettable(s)
  const [vector, raw, health] = await Promise.all([
    hasVector(),
    redis.get(ML_KEY).catch(() => null),
    mlApi(s)
      .health()
      .then((h): MlHealth | string => h)
      .catch((e: Error) => e.message),
  ])
  const sweep = raw ? (JSON.parse(raw) as MlStatus & { at: number }) : null
  const up = typeof health !== "string"
  const none = !vector ? "Your database needs pgvector (the pgvector/pgvector image) for this." : null

  // One line of progress for a feature.
  const chosen: Record<MlFeature, string> = { speech: s.whisperModel, clip: s.clipModel, faces: "default" }
  // The chosen model's state: on disk, downloading (with progress), failed, or not downloaded yet.
  const modelState = (f: MlFeature) => {
    if (!up) return null
    const want = chosen[f]
    const name = f === "faces" ? "Models" : `Model ${want}`
    if (health.ready?.[f]?.includes(want)) return `${name}: ready`
    const m = health.models[f]
    if (m?.model === want && m.state === "downloading") return `${name}: downloading ${Math.round((m.progress ?? 0) * 100)}%`
    if (m?.model === want && m.state === "failed") return `${name}: download failed${m.error ? ` (${m.error})` : ""}`
    return `${name}: not downloaded yet (saving starts it)`
  }
  const state = (f: MlFeature, on: boolean) => {
    if (!on) return "Off."
    const f1 = sweep?.features[f]
    const parts = [
      modelState(f),
      f1
        ? `${f1.backlog} waiting${eta(f1.backlog, f1.perMin)}${f1.failed ? `, ${f1.failed} failed` : ""}`
        : sweep
          ? null
          : "No sweep from the worker yet",
    ].filter(Boolean)
    return `${parts.join(". ")}.`
  }

  return (
    <AdminPage
      title="AI features"
      description="An optional nimbus-ml service runs on this server's CPU. It turns speech into searchable text, finds photos by what is in them, and groups faces into people. Everything stays on your servers, and it is off until you turn a feature on."
    >
      <SettingsForm
        action={setMlConnection}
        title="Connection"
        description={
          <>
            {up
              ? `Connected. nimbus-ml ${health.version}, using ${Math.round(health.rssMb)} MB${health.loaded.length ? ` with ${health.loaded.map(([f, m]) => (f === "faces" ? "the face models" : `${m} (${f === "clip" ? "photos" : "speech"})`)).join(", ")} loaded` : ", nothing loaded"}. One model is loaded at a time and unloaded after 5 idle minutes; set the limit with NIMBUS_ML_MEMORY (3 GB by default).`
              : `Not reachable: ${health}. Start the ml profile (COMPOSE_PROFILES=ml) or set the address of a service on another machine.`}
          </>
        }
      >
        <SettingRow
          id="ml-url"
          label="Service address"
          htmlFor="mlUrl"
          hint="Blank uses the ML_URL the server was started with, http://ml:8000 in the compose file. Save to test it."
          tip={{
            does: "Where the app and the worker reach nimbus-ml. A remote machine works if it can read your storage.",
            affects: "The next request or sweep.",
            default: "ML_URL from the environment",
            example: "http://192.168.1.20:8000",
          }}
          reset={reset("mlUrl")}
        >
          <Input id="mlUrl" name="mlUrl" defaultValue={s.mlUrl} placeholder="http://ml:8000" autoComplete="off" spellCheck={false} />
        </SettingRow>
      </SettingsForm>

      <SettingsForm action={setAiAccess} title="Who can use it">
        <SettingRow
          id="ai-access"
          label="Access"
          htmlFor="aiAccess"
          hint="Files of members who are not allowed are skipped, and they see none of these features. Choose members on their page under Members; the owner and admins are always included."
          tip={{
            does: "Everyone, or only the members you allow one by one.",
            affects: "What the worker processes from the next sweep, and what each member sees.",
            default: "Everyone",
          }}
          reset={reset("aiAccess")}
        >
          <select key={s.aiAccess} id="aiAccess" name="aiAccess" defaultValue={s.aiAccess} className={SELECT}>
            <option value="everyone">Everyone</option>
            <option value="chosen">Only chosen members</option>
          </select>
        </SettingRow>
      </SettingsForm>

      <SettingsForm
        action={setMlSpeech}
        title="Speech search"
        description={`Whisper writes down what is said in videos and audio (the first ${s.ocrVideoMaxMin} minutes, set under Text in images), skips files with no speech, and adds captions and a transcript. ${state("speech", s.mlSpeech)}`}
      >
        <SettingRow
          id="ml-speech"
          label="Transcribe speech"
          htmlFor="speechOn"
          reset={reset("mlSpeech")}
          tip={{ does: "Lets the worker transcribe videos and audio, a few a minute.", affects: "Files from the next sweep.", default: "Off" }}
        >
          <input type="checkbox" id="speechOn" name="enabled" defaultChecked={s.mlSpeech} className="size-4 shrink-0 accent-primary self-start sm:self-end" />
        </SettingRow>
        <SettingRow
          id="whisper-model"
          label="Model"
          htmlFor="whisperModel"
          hint="Bigger is more accurate and slower. Changing it transcribes everything again."
          tip={{ does: "The Whisper size: tiny, base, small or medium.", affects: "Every file is transcribed again with it.", default: "Base" }}
          reset={reset("whisperModel")}
        >
          <select key={s.whisperModel} id="whisperModel" name="whisperModel" defaultValue={s.whisperModel} className={SELECT}>
            <option value="tiny">Tiny (fastest)</option>
            <option value="base">Base</option>
            <option value="small">Small</option>
            <option value="medium">Medium (most accurate)</option>
          </select>
        </SettingRow>
      </SettingsForm>
      <ReindexRow
        action={reindexSpeech}
        label="Transcribe again"
        message="Every transcript is cleared and the worker makes them again, a few files a minute. Speech search finds less until it catches up."
      />

      <SettingsForm
        action={setMlClip}
        title="Search by what's in a photo"
        description={`CLIP looks at photos and video frames (every 5 seconds and at scene changes) so a search like "dog on a beach" finds them, tagged "Looks like". The multilingual model needs NIMBUS_ML_MEMORY of 4g or more: its text encoder alone is 1.1 GB and the service reaches about 2.5 GB in memory. ${none ?? state("clip", s.mlClip)}`}
        disabled={!vector}
      >
        <SettingRow
          id="ml-clip"
          label="Look at pictures"
          htmlFor="clipOn"
          reset={reset("mlClip")}
          tip={{ does: "Lets the worker index photos and videos for picture search.", affects: "Files from the next sweep.", default: "Off" }}
        >
          <input type="checkbox" id="clipOn" name="enabled" defaultChecked={s.mlClip} className="size-4 shrink-0 accent-primary self-start sm:self-end" />
        </SettingRow>
        <SettingRow
          id="clip-model"
          label="Model"
          htmlFor="clipModel"
          hint="Changing it looks at every picture again."
          tip={{ does: "English is more accurate for English words; multilingual understands many languages.", affects: "Every picture is indexed again with it.", default: "English" }}
          reset={reset("clipModel")}
        >
          <select key={s.clipModel} id="clipModel" name="clipModel" defaultValue={s.clipModel} className={SELECT}>
            <option value="vitb32">English (ViT-B/32)</option>
            <option value="multilingual">Multilingual</option>
          </select>
        </SettingRow>
      </SettingsForm>
      <ReindexRow
        action={reindexClip}
        label="Look again"
        message="Every picture is looked at again, a few a minute. Picture search finds less until it catches up."
      />

      <SettingsForm
        action={setMlFaces}
        title="People"
        description={`Faces in members' own photos are grouped into people, who they can name. Faces are never shared between accounts. Members can turn it off for themselves, which deletes their face data. ${none ?? state("faces", s.mlFaces)}`}
        disabled={!vector}
      >
        <SettingRow
          id="ml-faces"
          label="Group faces"
          htmlFor="facesOn"
          reset={reset("mlFaces")}
          tip={{ does: "Lets the worker find faces in photos.", affects: "Photos from the next sweep.", default: "Off" }}
        >
          <input type="checkbox" id="facesOn" name="enabled" defaultChecked={s.mlFaces} className="size-4 shrink-0 accent-primary self-start sm:self-end" />
        </SettingRow>
        <SettingRow
          id="faces-default"
          label="For members who haven't chosen"
          htmlFor="facesDefault"
          hint="Opt-in: nobody is scanned until they turn it on. Opt-out: everyone is, until they turn it off."
          tip={{ does: "The starting choice for each member's face grouping.", affects: "Members who haven't picked one.", default: "Opt-in" }}
          reset={reset("facesDefault")}
        >
          <select key={s.facesDefault ? "on" : "off"} id="facesDefault" name="facesDefault" defaultValue={s.facesDefault ? "on" : "off"} className={SELECT}>
            <option value="off">Opt-in (off until they turn it on)</option>
            <option value="on">Opt-out (on until they turn it off)</option>
          </select>
        </SettingRow>
      </SettingsForm>
      <ReindexRow
        action={reindexFaces}
        label="Find faces again"
        message="Every face and person is deleted, including the names members gave, and the worker finds them again."
      />
    </AdminPage>
  )
}

function ReindexRow({ action, label, message }: { action: () => Promise<void>; label: string; message: string }) {
  return (
    <div className="-mt-6 flex max-w-3xl items-center gap-4">
      <ConfirmButton action={action} label={label} title={`${label}?`} message={message} />
    </div>
  )
}
