import type { Member, MembersResponse, PartnerShare } from "@nimbus/shared/api"
import { DateTimePickerAndroid } from "@react-native-community/datetimepicker"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { CalendarBlank, Check, Trash, UserMinus } from "phosphor-react-native"
import { useEffect, useState } from "react"
import { Keyboard, View } from "react-native"

import { Avatar } from "@/components/avatar"
import { Actions, ConfirmDialog, Frame } from "@/components/dialog"
import { Caret, Group, Loaded, Page, Row, Section, SwitchRow } from "@/components/page"
import { Sheet, SheetRow } from "@/components/sheet"
import { useSnack } from "@/components/snackbar"
import { Button, Field, Text } from "@/components/ui"
import { errorText } from "@/lib/api"
import { useApi } from "@/lib/files"
import { usePartner } from "@/lib/photos"
import { c } from "@/lib/theme"

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" })
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString()
const sinceText = (since: string | null) => (since ? `Photos taken since ${day(since)}` : "All photos")

// "From" for an invite or a change: everything, or photos taken on or after a date.
function SinceRow({ since, onChange }: { since: string | null; onChange: (since: string | null) => void }) {
  const [open, setOpen] = useState(false)
  const pick = () =>
    DateTimePickerAndroid.open({
      mode: "date",
      value: since ? new Date(since) : new Date(),
      maximumDate: new Date(),
      onValueChange: (_, d) => d && onChange(startOfDay(d)),
    })
  return (
    <>
      <Row label="Photos to share" detail={sinceText(since)} icon={<CalendarBlank size={24} color={c.mutedForeground} />} trailing={<Caret />} onPress={() => setOpen(true)} />
      {open && (
        <Sheet onClose={() => setOpen(false)} header={<Text variant="titleSmall" style={{ paddingHorizontal: 20, paddingBottom: 8 }}>Photos to share</Text>}>
          <SheetRow label="All photos" selected={!since} trailing={!since ? <Check size={24} color={c.brand} /> : undefined} onPress={() => onChange(null)} />
          <SheetRow label="Only from a date on…" selected={!!since} trailing={since ? <Check size={24} color={c.brand} /> : undefined} detail="Older photos stay private" onPress={pick} />
        </Sheet>
      )}
    </>
  )
}

// Pick a member and a start date, then invite.
function Invite({ onDone }: { onDone: () => void }) {
  const api = useApi()
  const snack = useSnack()
  const [text, setText] = useState("")
  const [q, setQ] = useState("")
  const [picked, setPicked] = useState<Member | null>(null)
  const [since, setSince] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 150)
    return () => clearTimeout(t)
  }, [text])
  const members = useQuery({
    queryKey: [api.id, "members", q],
    enabled: !picked && q.length >= 2,
    queryFn: () => api.get<MembersResponse>(`/members?q=${encodeURIComponent(q)}`),
  })
  const found = !picked && text.trim().length >= 2 ? (members.data?.members ?? []) : []

  const invite = async () => {
    if (!picked) return
    setBusy(true)
    try {
      await api.post("/partner", { userId: picked.id, since })
      snack({ text: `Invited ${picked.name}. Your photos show up for them once they accept.` })
      Keyboard.dismiss()
      setPicked(null)
      setText("")
      onDone()
    } catch (e) {
      snack({ text: errorText(e), error: true })
    }
    setBusy(false)
  }

  return (
    <View style={{ gap: 12 }}>
      <Field
        label="Find a person by name"
        value={text}
        onChangeText={(v) => {
          setText(v)
          setPicked(null)
        }}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="done"
        hint="Your partner sees your photos in their timeline, with a badge. They can save any of them to their own files."
      />
      {found.length > 0 && (
        <Group>
          {found.map((m) => (
            <Row
              key={m.id}
              label={m.name}
              detail={m.email}
              icon={<Avatar account={api.account} name={m.name} image={m.image} size={40} />}
              onPress={() => {
                Keyboard.dismiss()
                setPicked(m)
                setText(m.name)
              }}
            />
          ))}
        </Group>
      )}
      {picked && (
        <>
          <Group>
            <SinceRow since={since} onChange={setSince} />
          </Group>
          <View style={{ alignSelf: "flex-end" }}>
            <Button label={`Invite ${picked.name}`} busy={busy} onPress={invite} />
          </View>
        </>
      )}
    </View>
  )
}

export default function Partner() {
  const api = useApi()
  const partner = usePartner()
  const client = useQueryClient()
  const snack = useSnack()
  const [accepting, setAccepting] = useState<PartnerShare | null>(null)
  const [stopping, setStopping] = useState(false)

  const refresh = () => Promise.all([client.invalidateQueries({ queryKey: [api.id, "partner"] }), client.invalidateQueries({ queryKey: [api.id, "photos"] })])
  const patch = async (body: object, done?: string) => {
    try {
      await api.patch("/partner", body)
      await refresh()
      if (done) snack({ text: done })
    } catch (e) {
      snack({ text: errorText(e), error: true })
    }
  }

  return (
    <Page title="Partner sharing">
      <Loaded query={partner}>
        {({ outgoing, incoming }) => (
          <>
            <Section title="Your photos" note={outgoing ? undefined : "Share your whole library with one person, like a partner or family member."}>
              {outgoing ? (
                <Group>
                  <Row
                    label={outgoing.person.name}
                    detail={outgoing.status === "pending" ? "Invited, waiting for them to accept" : outgoing.person.email}
                    icon={<Avatar account={api.account} name={outgoing.person.name} image={outgoing.person.image} size={40} />}
                  />
                  <SinceRow since={outgoing.since} onChange={(since) => patch({ userId: outgoing.person.id, since }, "Changed what you share.")} />
                  <Row label={outgoing.status === "pending" ? "Cancel the invite" : "Stop sharing"} danger icon={<UserMinus size={24} color={c.destructive} />} onPress={() => setStopping(true)} />
                </Group>
              ) : (
                <Invite onDone={refresh} />
              )}
            </Section>

            {incoming.length > 0 && (
              <Section title="Shared with you">
                <Group>
                  {incoming.map((p) =>
                    p.status === "pending" ? (
                      <Row
                        key={p.person.id}
                        label={p.person.name}
                        detail={`Wants to share their photos. ${sinceText(p.since)}.`}
                        icon={<Avatar account={api.account} name={p.person.name} image={p.person.image} size={40} />}
                        trailing={
                          <View style={{ flexDirection: "row" }}>
                            <Button variant="text" label="Decline" onPress={() => patch({ userId: p.person.id, decline: true }, "Declined.")} />
                            <Button variant="text" label="Accept" onPress={() => setAccepting(p)} />
                          </View>
                        }
                      />
                    ) : (
                      <View key={p.person.id}>
                        <Row
                          label={p.person.name}
                          detail={`${p.person.email} · ${sinceText(p.since)}`}
                          icon={<Avatar account={api.account} name={p.person.name} image={p.person.image} size={40} />}
                        />
                        <SwitchRow
                          label={`Show ${p.person.name}'s photos in my timeline`}
                          value={!p.hidden}
                          onChange={(on) => patch({ userId: p.person.id, hidden: !on })}
                        />
                        <Row label={`Remove ${p.person.name}'s sharing`} danger icon={<Trash size={24} color={c.destructive} />} onPress={() => patch({ userId: p.person.id, decline: true }, "Removed.")} />
                      </View>
                    )
                  )}
                </Group>
              </Section>
            )}

            {accepting && (
              <Frame title={`Accept ${accepting.person.name}'s photos?`} onClose={() => setAccepting(null)}>
                <Text color={c.mutedForeground}>Their photos will show in your timeline with a badge. Do you want to share yours with them too?</Text>
                <Actions>
                  <Button
                    variant="text"
                    label="Just accept"
                    onPress={() => {
                      patch({ userId: accepting.person.id, accept: true, shareBack: false }, `Accepted ${accepting.person.name}.`)
                      setAccepting(null)
                    }}
                  />
                  <Button
                    label="Accept and share back"
                    onPress={() => {
                      patch({ userId: accepting.person.id, accept: true, shareBack: true }, `Accepted, and sharing yours with ${accepting.person.name}.`)
                      setAccepting(null)
                    }}
                  />
                </Actions>
              </Frame>
            )}
            {stopping && outgoing && (
              <ConfirmDialog
                title={outgoing.status === "pending" ? "Cancel the invite?" : `Stop sharing with ${outgoing.person.name}?`}
                body="Your photos disappear from their timeline right away. You can invite them again later."
                confirm={outgoing.status === "pending" ? "Cancel invite" : "Stop sharing"}
                onClose={() => setStopping(false)}
                onConfirm={() => patch({ userId: outgoing.person.id, stop: true }, "Stopped sharing.")}
              />
            )}
          </>
        )}
      </Loaded>
    </Page>
  )
}
