import type { LinkInfo, ShareState, UpdateLinkRequest } from "@nimbus/shared/api"
import { DateTimePickerAndroid } from "@react-native-community/datetimepicker"
import { useQueryClient } from "@tanstack/react-query"
import { router, useLocalSearchParams } from "expo-router"
import { CalendarBlank, Check, ClockCounterClockwise, Copy, LockSimple, ShareNetwork, Trash } from "phosphor-react-native"
import { useState } from "react"
import { Keyboard, View } from "react-native"

import { ConfirmDialog, PromptDialog } from "@/components/dialog"
import { Caret, Group, Loaded, Page, Row, Section, SwitchRow } from "@/components/page"
import { Sheet, SheetDivider, SheetRow } from "@/components/sheet"
import { useSnack } from "@/components/snackbar"
import { Button, Field, Text } from "@/components/ui"
import { errorText } from "@/lib/api"
import { useApi, useFileActions, useLinks, useShareState } from "@/lib/files"
import { c, font } from "@/lib/theme"

const DAY = 86_400_000
const PRESETS = [1, 7, 30, 90]
const medium = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" })
const longDate = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
// End of the chosen day, local time, as on the web.
const endOfDay = (d: Date) => {
  const end = new Date(d)
  end.setHours(23, 59, 59, 0)
  return end.toISOString()
}

function Settings({ item, link, state }: { item: string; link: LinkInfo; state: ShareState }) {
  const api = useApi()
  const links = useLinks()
  const actions = useFileActions()
  const client = useQueryClient()
  const snack = useSnack()
  const [name, setName] = useState(link.name)
  const [cap, setCap] = useState(link.uploadCapBytes ? String(+(link.uploadCapBytes / 2 ** 30).toFixed(2)) : "")
  const [open, setOpen] = useState<"expiry" | "password" | "delete" | null>(null)
  const key = [api.id, "shares", item]
  const close = () => setOpen(null)

  // Answers at once, so a switch doesn't lag behind the finger; a refused change snaps back.
  const patch = async (change: UpdateLinkRequest, local: Partial<LinkInfo>, done?: string) => {
    client.setQueryData<ShareState>(key, (s) => s && { ...s, links: s.links.map((l) => (l.id === link.id ? { ...l, ...local } : l)) })
    try {
      await api.patch(`/links/${link.id}`, change)
      if (done) snack({ text: done })
    } catch (e) {
      snack({ text: errorText(e), error: true })
    }
    actions.refresh()
  }
  // A Save button, not on blur: Back leaves without blurring, which would drop what was typed.
  const saveName = () => {
    const next = name.trim()
    if (next && next !== link.name) {
      Keyboard.dismiss()
      patch({ name: next }, { name: next }, "Saved the name.")
    }
  }
  const capBytes = cap.trim() ? Math.round(Number(cap) * 2 ** 30) : null
  const capBad = capBytes !== null && !(capBytes > 0)
  const capChanged = capBytes !== link.uploadCapBytes
  const saveCap = () => {
    if (capBad || !capChanged) return
    Keyboard.dismiss()
    patch({ uploadCapBytes: capBytes }, { uploadCapBytes: capBytes }, "Saved the upload limit.")
  }
  const expire = (expiresAt: string | null) =>
    patch({ expiresAt }, { expiresAt }, expiresAt ? `This link now stops working on ${medium(expiresAt)}.` : "This link no longer expires.")

  const max = state.maxLinkDays
  const pickDate = () =>
    DateTimePickerAndroid.open({
      mode: "date",
      value: link.expiresAt ? new Date(link.expiresAt) : new Date(Date.now() + 7 * DAY),
      minimumDate: new Date(Date.now() + DAY),
      maximumDate: max ? new Date(Date.now() + max * DAY) : undefined,
      onValueChange: (_, date) => date && expire(endOfDay(date)),
    })

  const stats = [
    `${link.viewCount} ${link.viewCount === 1 ? "view" : "views"}`,
    `${link.downloadCount} ${link.downloadCount === 1 ? "download" : "downloads"}`,
    link.lastOpenedAt && `last opened ${longDate(link.lastOpenedAt)}`,
  ].filter(Boolean).join(" · ")
  const expired = !!link.expiresAt && Date.parse(link.expiresAt) < Date.now()

  return (
    <>
      <View style={{ gap: 12 }}>
        <Text selectable style={{ fontFamily: font.mono, fontSize: 13, lineHeight: 20 }}>{links.url(link)}</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Button label="Share" icon={<ShareNetwork size={18} color={c.primaryForeground} />} onPress={() => links.sendTo(link)} />
          </View>
          <View style={{ flex: 1 }}>
            <Button variant="outlined" label="Copy" icon={<Copy size={18} color={c.foreground} />} onPress={() => links.copy(link)} />
          </View>
        </View>
      </View>

      {link.canManage && (
        <>
          <Field label="Name" value={name} maxLength={80} returnKeyType="done" onChangeText={setName} onSubmitEditing={saveName} />
          {!!name.trim() && name.trim() !== link.name && (
            <View style={{ alignSelf: "flex-end" }}>
              <Button variant="outlined" label="Save name" onPress={saveName} />
            </View>
          )}
          <Group>
            <Row
              label="Expires"
              detail={link.expiresAt ? `${expired ? "Expired" : "On"} ${medium(link.expiresAt)}` : "Never"}
              icon={<CalendarBlank size={24} color={c.mutedForeground} />}
              trailing={<Caret />}
              onPress={() => setOpen("expiry")}
            />
            <Row
              label="Password"
              detail={link.hasPassword ? "Set. Changing it signs out everyone who unlocked the link." : "None"}
              icon={<LockSimple size={24} color={c.mutedForeground} />}
              trailing={<Caret />}
              onPress={() => setOpen("password")}
            />
          </Group>
          <Section title="People with the link can">
            <Group>
              <SwitchRow
                label={state.kind === "folder" ? "See the files in it" : "See the file"}
                value={link.allowView}
                onChange={(allowView) => patch({ allowView }, { allowView })}
              />
              <SwitchRow
                label="Download"
                detail="Off: preview only. Anyone can still screenshot what they see."
                value={link.allowDownload}
                disabled={!link.allowView}
                onChange={(allowDownload) => patch({ allowDownload }, { allowDownload })}
              />
              {state.kind === "folder" && (
                <SwitchRow
                  label="Upload files (file drop)"
                  detail="Uploads land here, belong to you and count against your storage."
                  value={link.allowUpload}
                  onChange={(allowUpload) => patch({ allowUpload }, { allowUpload })}
                />
              )}
            </Group>
            {state.kind === "folder" && link.allowUpload && (
              <>
                <Field
                  label="Stop taking uploads after (GB)"
                  placeholder="No limit"
                  keyboardType="decimal-pad"
                  returnKeyType="done"
                  value={cap}
                  onChangeText={setCap}
                  onSubmitEditing={saveCap}
                  error={capBad ? "Enter a number of gigabytes, or leave it empty for no limit." : null}
                />
                {capChanged && (
                  <View style={{ alignSelf: "flex-end" }}>
                    <Button variant="outlined" label="Save limit" disabled={capBad} onPress={saveCap} />
                  </View>
                )}
              </>
            )}
          </Section>
        </>
      )}

      <Group>
        <Row
          label="Activity"
          detail={stats}
          icon={<ClockCounterClockwise size={24} color={c.mutedForeground} />}
          trailing={<Caret />}
          onPress={() => router.push({ pathname: "/share/log/[id]", params: { id: link.id, name: link.name } })}
        />
      </Group>

      {link.canManage && (
        <Group>
          <Row label="Delete link" danger icon={<Trash size={24} color={c.destructive} />} onPress={() => setOpen("delete")} />
        </Group>
      )}

      {open === "expiry" && (
        <Sheet onClose={close}>
          {!max && (
            <SheetRow
              label="Never"
              selected={!link.expiresAt}
              trailing={!link.expiresAt ? <Check size={24} color={c.brand} /> : undefined}
              onPress={() => expire(null)}
            />
          )}
          {PRESETS.filter((n) => !max || n <= max).map((n) => (
            <SheetRow key={n} label={n === 1 ? "1 day" : `${n} days`} onPress={() => expire(endOfDay(new Date(Date.now() + n * DAY)))} />
          ))}
          <SheetDivider />
          <SheetRow label="Pick a date" icon={<CalendarBlank size={24} color={c.mutedForeground} />} onPress={pickDate} />
        </Sheet>
      )}
      {open === "password" && (
        <PromptDialog
          title={link.hasPassword ? "Change the password" : "Set a password"}
          label={link.hasPassword ? "New password" : "Password"}
          confirm="Save"
          secret
          canSubmit={(v) => !!v}
          onClose={close}
          onSubmit={async (password) => {
            try {
              await api.patch(`/links/${link.id}`, { password })
              actions.refresh()
              snack({ text: "Saved the link's password." })
            } catch (e) {
              return errorText(e)
            }
          }}
        >
          {link.hasPassword && !state.requireLinkPassword && (
            <Button
              variant="text"
              danger
              label="Remove the password"
              onPress={() => {
                close()
                patch({ password: "" }, { hasPassword: false }, "Removed the link's password.")
              }}
            />
          )}
        </PromptDialog>
      )}
      {open === "delete" && (
        <ConfirmDialog
          title={`Delete “${link.name}”?`}
          body="Anyone with this link loses access right away. You can't undo this."
          confirm="Delete link"
          onClose={close}
          onConfirm={async () => {
            try {
              await api.del(`/links/${link.id}`)
              actions.refresh()
              snack({ text: `Deleted “${link.name}”.` })
              router.back()
            } catch (e) {
              snack({ text: errorText(e), error: true })
            }
          }}
        />
      )}
    </>
  )
}

export default function LinkSettings() {
  const { id, item } = useLocalSearchParams<{ id: string; item: string }>()
  const state = useShareState(item)
  const link = state.data?.links.find((l) => l.id === id)
  return (
    <Page title={link?.name ?? "Link"} caption={state.data?.name}>
      <Loaded query={state}>
        {(s) => (link ? <Settings item={item} link={link} state={s} /> : <Text color={c.mutedForeground}>This link is gone.</Text>)}
      </Loaded>
    </Page>
  )
}
