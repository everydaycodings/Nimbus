// Runs an upload from choice to queue: the plan, the conflict sheet and the mobile data question.
import type { Conflict, Instance, Me } from "@nimbus/shared/api"
import { formatBytes } from "@nimbus/shared/file-rules"
import { useQueryClient } from "@tanstack/react-query"
import { File } from "expo-file-system"
import * as Network from "expo-network"
import { createContext, use, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { Pressable, Switch, View } from "react-native"

import { Actions, Frame } from "@/components/dialog"
import { Sheet, useDismiss } from "@/components/sheet"
import { useSnack } from "@/components/snackbar"
import { Button, Text } from "@/components/ui"
import { errorText, json, send as request, type Account } from "@/lib/api"
import { native, type NativeJob } from "@/lib/native"
import { canEditPhoto } from "@/lib/photo-edit-rules"
import { editShot } from "@/lib/photo-edit-session"
import { c } from "@/lib/theme"
import { applyAnswers, askBeforeData, pendingConflicts, scanName, type Answers, type Choice, type Entry } from "@/lib/upload-plan"
import { engine, localStamp, plan } from "@/lib/uploads"

type Ctx = {
  // True once something is queued.
  send: (account: Account, parentId: string | null, entries: Entry[]) => Promise<boolean>
  scan: () => Promise<Entry[]>
  // The conflict sheet on its own, for a vault, which finds its own clashes. `replace`: Replace in place of New version.
  ask: (conflicts: Conflict[], replace?: boolean) => Promise<Answers | null>
  // A single new photo: offers Edit before it goes up. Returns the entries to send, edited or as they were.
  review: (entries: Entry[]) => Promise<Entry[]>
}
const Uploader = createContext<Ctx | null>(null)
export const useUploader = () => use(Uploader)!

type Prompt =
  | { kind: "conflicts"; conflicts: Conflict[]; replace?: boolean; done: (a: Answers | null) => void }
  | { kind: "data"; bytes: number; done: (wifiOnly: boolean) => void }
  | { kind: "edit"; name: string; done: (edit: boolean) => void }

export function UploaderProvider({ children }: { children: ReactNode }) {
  const snack = useSnack()
  const client = useQueryClient()
  const [prompt, setPrompt] = useState<Prompt | null>(null)

  // A finished file changes whatever list is showing.
  const finished = useRef(0)
  useEffect(() => {
    const check = () => {
      const count = engine.rows().filter((r) => r.status === "done").length
      if (count !== finished.current) client.invalidateQueries()
      finished.current = count
    }
    check()
    return engine.subscribe(check)
  }, [client])

  const send = useCallback<Ctx["send"]>(
    async (account, parentId, entries) => {
      if (!entries.length) return false
      try {
        const answer = await plan(account, parentId, entries)
        if (answer.error || !answer.token) {
          snack({ text: answer.error ?? "Couldn't start the upload. Try again.", error: true })
          return false
        }
        for (const r of answer.rejected) engine.refuse(account.id, r.path.split("/").pop()!, r.reason)
        const refused = new Set(answer.rejected.map((r) => r.path))
        const allowed = entries.filter((e) => !refused.has(e.path))

        const answers = answer.conflicts.length
          ? await new Promise<Answers | null>((done) => setPrompt({ kind: "conflicts", conflicts: answer.conflicts, done }))
          : new Map<string, Choice>()
        setPrompt(null)
        if (!answers) return false
        const { list, versions } = applyAnswers(allowed, answer.conflicts, answers)

        const dirs = list.filter((e) => !e.uri).map((e) => e.path)
        if (dirs.length) {
          const r = await request(account.server, "/api/v1/uploads/folders", { method: "POST", token: account.token, body: JSON.stringify({ parentId, paths: dirs }) })
          if (!r.ok) snack({ text: "Couldn't create the empty folders.", error: true })
          else client.invalidateQueries({ queryKey: [account.id] })
        }

        const files = list.filter((e) => e.uri)
        if (!files.length) return dirs.length > 0
        const bytes = files.reduce((n, e) => n + e.size, 0)
        const network = await Network.getNetworkStateAsync()
        const wifiOnly =
          askBeforeData(bytes, network.type === Network.NetworkStateType.CELLULAR) &&
          (await new Promise<boolean>((done) => setPrompt({ kind: "data", bytes, done })))
        setPrompt(null)

        const auth = { token: account.token }
        const [instance, me] = await Promise.all([json<Instance>(account.server, "/api/v1/instance"), json<Me>(account.server, "/api/v1/me", auth)])
        const jobs: NativeJob[] = files.map((e) => ({
          accountId: account.id,
          server: account.server,
          tusUrl: instance.tusUrl,
          uri: e.uri!,
          name: e.path.split("/").pop()!,
          size: e.size,
          mime: e.mime ?? "",
          path: e.path,
          planToken: answer.token!,
          parentId,
          onConflict: versions.has(e.path) ? "version" : "rename",
          wifiOnly,
          speedCap: me.uploadSpeedBytes ?? null,
        }))
        await engine.add(jobs, account.token)
        shareTo(account, parentId)
        return true
      } catch (e) {
        setPrompt(null)
        snack({ text: errorText(e), error: true })
        return false
      }
    },
    [client, snack]
  )

  const scan = useCallback(async (): Promise<Entry[]> => {
    const uri = await native?.scan()
    if (!uri) return []
    const name = scanName(localStamp())
    return [{ path: name, size: new File(uri).size ?? 0, uri, mime: "application/pdf" }]
  }, [])

  const ask = useCallback<Ctx["ask"]>(async (conflicts, replace) => {
    if (!conflicts.length) return new Map<string, Choice>()
    const answers = await new Promise<Answers | null>((done) => setPrompt({ kind: "conflicts", conflicts, replace, done }))
    setPrompt(null)
    return answers
  }, [])

  const review = useCallback<Ctx["review"]>(async (entries) => {
    const [e] = entries
    if (entries.length !== 1 || !e.uri || !canEditPhoto(e.mime ?? null)) return entries
    const edit = await new Promise<boolean>((done) => setPrompt({ kind: "edit", name: e.path, done }))
    setPrompt(null)
    if (!edit) return entries
    const out = await editShot({ uri: e.uri, name: e.path, mime: e.mime! })
    return out ? [{ ...e, uri: out.uri, size: out.size, mime: out.mime }] : entries
  }, [])

  const value = useMemo(() => ({ send, scan, ask, review }), [send, scan, ask, review])
  return (
    <Uploader value={value}>
      {children}
      {prompt?.kind === "conflicts" && <ConflictSheet conflicts={prompt.conflicts} replace={prompt.replace} onDone={prompt.done} />}
      {prompt?.kind === "data" && <DataDialog bytes={prompt.bytes} onDone={prompt.done} />}
      {prompt?.kind === "edit" && (
        <Frame title="Edit this photo?" onClose={() => prompt.done(false)}>
          <Text color={c.mutedForeground}>Crop, rotate or mark up “{prompt.name}” before it goes up, or upload it as it is.</Text>
          <Actions>
            <Button variant="text" label="Upload now" onPress={() => prompt.done(false)} />
            <Button label="Edit" onPress={() => prompt.done(true)} />
          </Actions>
        </Frame>
      )}
    </Uploader>
  )
}

// The folder joins Android's share sheet (direct share). Best effort: a missing name only skips it.
function shareTo(account: Account, parentId: string | null) {
  if (typeof native?.pushShareTarget !== "function") return
  const push = (name: string) => native!.pushShareTarget!(account.id, parentId, name)
  if (!parentId) return push("My files")
  json<{ item: { name: string } | null }>(account.server, `/api/v1/items/${parentId}`, { token: account.token })
    .then((r) => r.item && push(r.item.name))
    .catch(() => {})
}

// Back or the scrim cancels the upload, like the web's dialog.
function ConflictSheet({ conflicts, replace, onDone }: { conflicts: Conflict[]; replace?: boolean; onDone: (a: Answers | null) => void }) {
  const [answers, setAnswers] = useState<Answers>(new Map())
  const left = pendingConflicts(conflicts, answers)
  const finish = useRef<Answers | null>(null)
  if (!left[0]) return null
  return (
    <Sheet onClose={() => onDone(finish.current)}>
      <Question
        key={left[0].path}
        current={left[0]}
        remaining={left.length - 1}
        replace={replace}
        onAnswer={(choice, all) => {
          const next = new Map(answers)
          next.set(left[0].path, choice)
          if (all) for (let p = pendingConflicts(conflicts, next)[0]; p; p = pendingConflicts(conflicts, next)[0]) next.set(p.path, choice)
          if (pendingConflicts(conflicts, next).length) return setAnswers(next), false
          finish.current = next
          return true
        }}
      />
    </Sheet>
  )
}

function Question({ current, remaining, replace, onAnswer }: { current: Conflict; remaining: number; replace?: boolean; onAnswer: (c: Choice, all: boolean) => boolean }) {
  const dismiss = useDismiss()
  const [all, setAll] = useState(false)
  const folder = current.kind === "folder"
  const slash = current.path.lastIndexOf("/")
  const name = current.path.slice(slash + 1)
  const where = slash > 0 ? current.path.slice(0, slash) : null
  const answer = (choice: Choice) => {
    if (onAnswer(choice, all)) dismiss()
  }
  return (
    <View style={{ paddingHorizontal: 20, paddingBottom: 8, gap: 16 }}>
      <View style={{ gap: 4 }}>
        <Text variant="titleSmall" accessibilityRole="header">{folder ? `A folder named “${name}” already exists` : `“${name}” already exists`}</Text>
        <Text variant="bodySmall" color={c.mutedForeground}>
          {where ? `In ${where}. ` : ""}
          {folder
            ? `Merge adds what you're uploading to the existing folder. Keep both uploads it as “${current.freeName}”.`
            : replace
              ? `Replace puts the new file in place of the current one. Keep both uploads it as “${current.freeName}”.`
              : `New version keeps the current file in its version history. Keep both uploads it as “${current.freeName}”.`}
        </Text>
      </View>
      {remaining > 0 && (
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: all }}
          onPress={() => setAll(!all)}
          style={{ flexDirection: "row", alignItems: "center", minHeight: 48, gap: 16 }}
        >
          <Text style={{ flex: 1 }}>Apply to all remaining ({remaining})</Text>
          <View pointerEvents="none" importantForAccessibility="no-hide-descendants">
            <Switch value={all} trackColor={{ true: c.brand, false: c.mutedStrong }} thumbColor={c.foreground} />
          </View>
        </Pressable>
      )}
      <View style={{ gap: 8 }}>
        <Button label={folder ? "Merge" : replace ? "Replace" : "New version"} onPress={() => answer("version")} />
        <Button variant="outlined" label="Keep both" onPress={() => answer("keep")} />
        <Button variant="outlined" label="Skip" onPress={() => answer("skip")} />
        <Button variant="text" label="Cancel upload" onPress={() => dismiss()} />
      </View>
    </View>
  )
}

function DataDialog({ bytes, onDone }: { bytes: number; onDone: (wifiOnly: boolean) => void }) {
  return (
    <Frame title="Upload on mobile data?" onClose={() => onDone(true)}>
      <Text color={c.mutedForeground}>{`This upload is ${formatBytes(bytes)}. You can send it now, or have it wait until you're on Wi-Fi.`}</Text>
      <Actions>
        <Button variant="text" label="Wait for Wi-Fi" onPress={() => onDone(true)} />
        <Button label="Upload now" onPress={() => onDone(false)} />
      </Actions>
    </Frame>
  )
}
