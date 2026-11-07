import type { Instance, Me, TransferResponse } from "@nimbus/shared/api"
import { formatBytes } from "@nimbus/shared/file-rules"
import { useQueryClient } from "@tanstack/react-query"
import * as Clipboard from "expo-clipboard"
import { router } from "expo-router"
import { CheckCircle, DeviceMobile, FolderSimple, X } from "phosphor-react-native"
import { useRef, useState } from "react"
import { Share, View } from "react-native"

import { Group, Page, Row, Section, SwitchRow } from "@/components/page"
import { useSnack } from "@/components/snackbar"
import { FileIcon } from "@/components/file-icon"
import { Button, ErrorText, Field, IconButton, Text } from "@/components/ui"
import { errorText, json } from "@/lib/api"
import { useApi } from "@/lib/files"
import { pickFromNimbus, takeStart, useSent, type Picked } from "@/lib/sent"
import { c } from "@/lib/theme"
import type { Entry } from "@/lib/upload-plan"
import { engine, pick } from "@/lib/uploads"

const wait = (ms: number) => new Promise((ok) => setTimeout(ok, ms))

// New transfer: files from Nimbus and/or this phone, who gets them, and the limits. Nimbus items are
// copied on the server; phone files upload with the normal uploader, then it's finalised and emailed.
export default function NewTransfer() {
  const api = useApi()
  const snack = useSnack()
  const client = useQueryClient()
  const sent = useSent()
  const options = sent.data?.options
  const [initial] = useState(takeStart)
  const [nimbus, setNimbus] = useState<Picked[]>(initial.nimbus)
  const [device, setDevice] = useState<Entry[]>(initial.device)
  const [emails, setEmails] = useState("")
  const [link, setLink] = useState(true)
  const [title, setTitle] = useState("")
  const [note, setNote] = useState("")
  const [days, setDays] = useState(7)
  const [password, setPassword] = useState("")
  const [limit, setLimit] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [done, setDone] = useState<{ url: string | null; people: number } | null>(null)
  const cancelled = useRef(false)
  const draft = useRef<string | null>(null)
  const mine = useRef<string[]>([])

  const choices = [1, 7, 30].filter((d) => d <= (options?.maxDays ?? 30))
  const day = choices.includes(days) ? days : (choices.at(-1) ?? 1)
  const people = emails.split(/[\s,;]+/).filter(Boolean)
  const useLink = link || !options?.email || !people.length
  const count = nimbus.length + device.length

  // Throws away the draft and stops this send's uploads.
  const abandon = async () => {
    for (const id of mine.current) engine.cancel(id)
    mine.current = []
    if (draft.current) await api.post(`/transfers/${draft.current}/revoke`).catch(() => {})
    draft.current = null
  }

  async function send() {
    setError(null)
    cancelled.current = false
    try {
      setBusy("Starting…")
      const made = await api.post<{ id: string }>("/transfers", {
        nodeIds: nimbus.map((p) => p.id),
        title,
        message: note,
        days: day,
        password,
        downloadLimit: limit.trim() ? Number(limit) : null,
        emails: people,
        link: useLink,
      })
      draft.current = made.id
      if (device.length) {
        const base = (await api.get<TransferResponse>(`/transfers/${made.id}`)).transfer.fileCount
        const [instance, me] = await Promise.all([json<Instance>(api.account.server, "/api/v1/instance"), api.get<Me>("/me")])
        const jobs = []
        for (const e of device) {
          const t = await api.post<{ token: string }>(`/transfers/${made.id}/files`, { name: e.path, size: e.size })
          jobs.push({
            accountId: api.id,
            server: api.account.server,
            tusUrl: instance.tusUrl,
            uri: e.uri!,
            name: e.path,
            size: e.size,
            mime: e.mime ?? "",
            path: e.path,
            planToken: t.token,
            parentId: null,
            onConflict: "rename" as const,
            wifiOnly: false,
            speedCap: me.uploadSpeedBytes ?? null,
          })
        }
        const before = new Set(engine.rows().map((r) => r.id))
        await engine.add(jobs, api.account.token)
        mine.current = engine.rows().filter((r) => !before.has(r.id)).map((r) => r.id)
        // ponytail: this screen has to stay open until the uploads land; leaving it drops the draft after a day.
        for (;;) {
          const rows = engine.rows().filter((r) => mine.current.includes(r.id))
          const failed = rows.find((r) => r.status === "failed" || r.status === "refused")
          if (failed) throw new Error(`“${failed.name}” didn't upload${failed.error ? `: ${failed.error}` : "."}`)
          if (cancelled.current) throw new Error("Cancelled.")
          const sentBytes = rows.reduce((n, r) => n + (r.status === "done" ? r.size : r.sent), 0)
          const total = rows.reduce((n, r) => n + r.size, 0)
          setBusy(`Uploading ${formatBytes(sentBytes)} of ${formatBytes(total)}`)
          const now = (await api.get<TransferResponse>(`/transfers/${made.id}`)).transfer.fileCount
          if (now >= base + device.length) break
          await wait(1500)
        }
      }
      setBusy("Sending…")
      const fin = await api.post<{ transfer: { linkToken: string | null } }>(`/transfers/${made.id}/finalise`)
      draft.current = null
      mine.current = []
      client.invalidateQueries({ queryKey: [api.id] })
      const token = fin.transfer.linkToken
      setDone({ url: token ? `${api.account.server}/t/${token}` : null, people: people.length })
    } catch (e) {
      await abandon()
      if (!cancelled.current) setError(errorText(e))
    } finally {
      setBusy(null)
    }
  }

  if (done)
    return (
      <Page title="Transfer sent" onBack={null}>
        <View style={{ alignItems: "center", gap: 12, paddingTop: 16 }}>
          <CheckCircle size={48} weight="fill" color={c.brand} />
          <Text variant="titleSmall">{done.people ? `Emailed ${done.people} ${done.people === 1 ? "person" : "people"}` : "Your files are ready to share"}</Text>
        </View>
        {done.url && (
          <Section title="Link" note={done.url}>
            <Button
              variant="outlined"
              label="Copy link"
              onPress={async () => {
                await Clipboard.setStringAsync(done.url!)
                snack({ text: "Copied the link." })
              }}
            />
            <Button variant="outlined" label="Share link" onPress={() => Share.share({ message: done.url! }).catch(() => {})} />
          </Section>
        )}
        <Button label="Done" onPress={() => router.back()} />
      </Page>
    )

  return (
    <Page title="New transfer" onBack={busy ? null : undefined}>
      <Section title="Files" note={count ? undefined : "Choose what to send."}>
        {count > 0 && (
          <Group>
            {nimbus.map((p) => (
              <Row
                key={p.id}
                label={p.name}
                detail={p.kind === "folder" ? "Folder from Nimbus" : `From Nimbus${p.size !== undefined ? ` · ${formatBytes(p.size)}` : ""}`}
                icon={<FileIcon item={{ kind: p.kind, mime: p.mime ?? null, name: p.name }} />}
                trailing={!busy && <IconButton icon={X} label={`Remove ${p.name}`} color={c.mutedForeground} onPress={() => setNimbus((l) => l.filter((x) => x.id !== p.id))} />}
              />
            ))}
            {device.map((e) => (
              <Row
                key={e.path}
                label={e.path}
                detail={`From this phone · ${formatBytes(e.size)}`}
                icon={<FileIcon item={{ kind: "file", mime: e.mime ?? null, name: e.path }} />}
                trailing={!busy && <IconButton icon={X} label={`Remove ${e.path}`} color={c.mutedForeground} onPress={() => setDevice((l) => l.filter((x) => x !== e))} />}
              />
            ))}
          </Group>
        )}
        <Group>
          <Row label="Add from Nimbus" icon={<FolderSimple size={24} color={c.mutedForeground} />} disabled={!!busy} onPress={() => pickFromNimbus(nimbus, setNimbus)} />
          <Row
            label="Add from this phone"
            icon={<DeviceMobile size={24} color={c.mutedForeground} />}
            disabled={!!busy}
            onPress={() =>
              pick.files().then(
                (picked) => setDevice((l) => [...l, ...picked.filter((p) => p.uri && !l.some((x) => x.path === p.path))]),
                (e) => snack({ text: errorText(e), error: true })
              )
            }
          />
        </Group>
      </Section>

      <Section title="Send to">
        {options?.email ? (
          <>
            <Field label="Emails" value={emails} onChangeText={setEmails} editable={!busy} autoCapitalize="none" keyboardType="email-address" hint="Separate with commas. Each person gets their own link." />
            <Group>
              <SwitchRow label="Also make a link to copy" value={useLink} onChange={setLink} />
            </Group>
          </>
        ) : (
          <Text variant="bodySmall" color={c.mutedForeground}>Email isn't set up on this Nimbus, so you'll copy a link after sending.</Text>
        )}
      </Section>

      <Section title="Details">
        <Field label="Title (optional)" value={title} onChangeText={setTitle} editable={!busy} maxLength={100} />
        <Field label="Message (optional)" value={note} onChangeText={setNote} editable={!busy} multiline maxLength={2000} style={{ minHeight: 96, textAlignVertical: "top" }} />
        <View style={{ gap: 6 }}>
          <Text variant="label">Lasts</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {choices.map((d) => (
              <View key={d} style={{ flex: 1 }}>
                <Button variant={d === day ? "filled" : "outlined"} label={d === 1 ? "1 day" : `${d} days`} disabled={!!busy} onPress={() => setDays(d)} />
              </View>
            ))}
          </View>
        </View>
        <Field label="Password (optional)" value={password} onChangeText={setPassword} editable={!busy} secret autoCapitalize="none" />
        <Field label="Download limit (optional)" value={limit} onChangeText={(t) => setLimit(t.replace(/\D/g, ""))} editable={!busy} keyboardType="number-pad" hint="A Download all counts once. Leave empty for no limit." />
        <Text variant="caption" color={c.mutedForeground}>
          Transfers keep their own copy, which counts against your storage until it expires.
          {options?.maxBytes ? ` Up to ${formatBytes(options.maxBytes)} each.` : ""}
        </Text>
      </Section>

      {error && <ErrorText>{error}</ErrorText>}
      <Button label={busy ?? "Send"} busy={!!busy} disabled={!count || !options || (!people.length && !useLink)} onPress={send} />
      {busy && (
        <Button
          variant="text"
          label="Cancel"
          onPress={() => {
            cancelled.current = true
          }}
        />
      )}
    </Page>
  )
}
