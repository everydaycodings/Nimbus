import type { AlbumLink, AlbumPerson, AlbumSharesResponse, Member, MembersResponse } from "@nimbus/shared/api"
import { DateTimePickerAndroid } from "@react-native-community/datetimepicker"
import { useQuery } from "@tanstack/react-query"
import * as Clipboard from "expo-clipboard"
import { useLocalSearchParams } from "expo-router"
import { CalendarBlank, CaretDown, Check, Copy, Link as LinkIcon, LockSimple, Plus, ShareNetwork, Trash } from "phosphor-react-native"
import { useEffect, useState } from "react"
import { Keyboard, Pressable, Share, View } from "react-native"

import { useAlbumRefresh } from "@/components/album-sheets"
import { Avatar } from "@/components/avatar"
import { PromptDialog } from "@/components/dialog"
import { Group, Loaded, Page, Row, Section } from "@/components/page"
import { Sheet, SheetDivider, SheetRow } from "@/components/sheet"
import { useSnack } from "@/components/snackbar"
import { Button, ErrorText, Field, Text } from "@/components/ui"
import { errorText } from "@/lib/api"
import { useApi } from "@/lib/files"
import { c } from "@/lib/theme"

type Role = AlbumPerson["role"]
const ROLE: Record<Role, string> = { viewer: "Viewer", contributor: "Contributor" }
const ROLE_NOTE: Record<Role, string> = { viewer: "Can look at the photos and comment", contributor: "Can also add their own photos" }
const DAY = 86_400_000
const PRESETS = [1, 7, 30, 90]
const medium = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" })
// End of the chosen day, local time, as on Share.
const endOfDay = (d: Date) => {
  const end = new Date(d)
  end.setHours(23, 59, 59, 0)
  return end.toISOString()
}

function RoleButton({ role, name, onPress }: { role: Role; name: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}: ${ROLE[role]}. Change access`}
      android_ripple={{ color: c.ripple }}
      onPress={onPress}
      style={{ minHeight: 48, flexDirection: "row", alignItems: "center", gap: 4, paddingLeft: 8, paddingRight: 4 }}
    >
      <Text variant="label">{ROLE[role]}</Text>
      <CaretDown size={14} color={c.mutedForeground} />
    </Pressable>
  )
}

function RoleSheet({ role, onPick, onClose }: { role: Role; onPick: (r: Role) => void; onClose: () => void }) {
  return (
    <Sheet onClose={onClose}>
      {(["viewer", "contributor"] as const).map((r) => (
        <SheetRow key={r} label={ROLE[r]} detail={ROLE_NOTE[r]} selected={r === role} trailing={r === role ? <Check size={24} color={c.brand} /> : undefined} onPress={() => onPick(r)} />
      ))}
    </Sheet>
  )
}

type Run = (task: () => Promise<unknown>, done?: string) => Promise<string | undefined>

// Find a member by name, choose a role, Share.
function AddPeople({ id, run, taken }: { id: string; run: Run; taken: Set<string> }) {
  const api = useApi()
  const [text, setText] = useState("")
  const [q, setQ] = useState("")
  const [picked, setPicked] = useState<Member | null>(null)
  const [role, setRole] = useState<Role>("viewer")
  const [choosing, setChoosing] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
  const found = !picked && text.trim().length >= 2 ? (members.data?.members ?? []).filter((m) => !taken.has(m.id)) : []

  const share = async () => {
    if (!picked) return
    setBusy(true)
    setError(null)
    const problem = await run(() => api.post(`/albums/${id}/shares`, { userId: picked.id, role }), `Shared with ${picked.name}.`)
    setBusy(false)
    if (problem) return setError(problem)
    Keyboard.dismiss()
    setText("")
    setPicked(null)
  }

  return (
    <View style={{ gap: 12 }}>
      <Field
        label="Add people by name"
        value={text}
        onChangeText={(v) => {
          setText(v)
          setPicked(null)
        }}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="done"
        error={error}
        hint="They need an account on this Nimbus."
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
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
          <RoleButton role={role} name="New person" onPress={() => setChoosing(true)} />
          <Button label="Share" busy={busy} onPress={share} />
        </View>
      )}
      {choosing && <RoleSheet role={role} onPick={setRole} onClose={() => setChoosing(false)} />}
    </View>
  )
}

function People({ id, people, run }: { id: string; people: AlbumPerson[]; run: Run }) {
  const api = useApi()
  const [open, setOpen] = useState<AlbumPerson | null>(null)
  const [changing, setChanging] = useState<AlbumPerson | null>(null)
  if (!people.length) return null
  return (
    <Section title="Who has access">
      <Group>
        <Row label="You" detail={api.account.email} trailing={<Text variant="label" color={c.mutedForeground}>Owner</Text>} />
        {people.map((p) => (
          <Row
            key={p.shareId}
            label={p.name}
            detail={p.email}
            icon={<Avatar account={api.account} name={p.name} image={p.image} size={40} />}
            trailing={<RoleButton role={p.role} name={p.name} onPress={() => setOpen(p)} />}
          />
        ))}
      </Group>
      {open && (
        <Sheet onClose={() => setOpen(null)} header={<Text variant="titleSmall" numberOfLines={1} style={{ paddingHorizontal: 20, paddingBottom: 8 }}>{open.name}</Text>}>
          <SheetRow label="Change access" detail={ROLE[open.role]} icon={<CaretDown size={24} color={c.mutedForeground} />} onPress={() => setChanging(open)} />
          <SheetDivider />
          <SheetRow label="Remove access" danger icon={<Trash size={24} color={c.destructive} />} onPress={() => run(() => api.del(`/albums/${id}/shares/${open.shareId}`), `Removed ${open.name}.`)} />
        </Sheet>
      )}
      {changing && (
        <RoleSheet
          role={changing.role}
          onPick={(role) => role !== changing.role && run(() => api.patch(`/albums/${id}/shares/${changing.shareId}`, { role }), `${changing.name} is now a ${ROLE[role].toLowerCase()}.`)}
          onClose={() => setChanging(null)}
        />
      )}
    </Section>
  )
}

const summary = (l: AlbumLink) =>
  [l.expiresAt ? (Date.parse(l.expiresAt) < Date.now() ? "Expired" : `Until ${medium(l.expiresAt)}`) : "No expiry", l.hasPassword && "Password", !l.allowDownload && "No download", `${l.views} ${l.views === 1 ? "view" : "views"}`]
    .filter(Boolean)
    .join(" · ")

function Links({ id, links, run }: { id: string; links: AlbumLink[]; run: Run }) {
  const api = useApi()
  const snack = useSnack()
  const [open, setOpen] = useState<string | null>(null)
  const [panel, setPanel] = useState<"expiry" | "password" | null>(null)
  const [busy, setBusy] = useState(false)
  const link = links.find((l) => l.shareId === open)
  const url = (l: AlbumLink) => `${api.account.server}/a/${l.token}`
  const patch = (change: object, done?: string) => link && run(() => api.patch(`/albums/${id}/shares/${link.shareId}`, change), done)
  const expire = (expiresAt: string | null) => patch({ expiresAt }, expiresAt ? `This link now stops working on ${medium(expiresAt)}.` : "This link no longer expires.")
  const pickDate = () =>
    DateTimePickerAndroid.open({
      mode: "date",
      value: link?.expiresAt ? new Date(link.expiresAt) : new Date(Date.now() + 7 * DAY),
      minimumDate: new Date(Date.now() + DAY),
      onValueChange: (_, date) => date && expire(endOfDay(date)),
    })
  const copy = async (l: AlbumLink) => {
    await Clipboard.setStringAsync(url(l))
    snack({ text: "Copied the album link." })
  }

  return (
    <Section
      title="Public link"
      note={links.length ? undefined : "Anyone with the link can look at the album without signing in. Set an expiry or a password when you make it."}
      trailing={
        <Button
          variant="outlined"
          label="New link"
          busy={busy}
          icon={<Plus size={18} color={c.foreground} />}
          onPress={async () => {
            setBusy(true)
            await run(() => api.post(`/albums/${id}/shares/link`, {}), "Made a link.")
            setBusy(false)
          }}
        />
      }
    >
      <Group>
        {links.map((l) => (
          <Row
            key={l.shareId}
            label={l.name || "Album link"}
            detail={summary(l)}
            icon={l.hasPassword ? <LockSimple size={24} color={c.mutedForeground} /> : <LinkIcon size={24} color={c.mutedForeground} />}
            trailing={<CaretDown size={14} color={c.mutedForeground} />}
            onPress={() => setOpen(l.shareId)}
          />
        ))}
      </Group>
      {link && (
        <Sheet onClose={() => setOpen(null)} header={<Text variant="titleSmall" numberOfLines={1} style={{ paddingHorizontal: 20, paddingBottom: 8 }}>{link.name || "Album link"}</Text>}>
          <SheetRow label="Share link" icon={<ShareNetwork size={24} color={c.mutedForeground} />} onPress={() => void Share.share({ message: url(link) }).catch(() => {})} />
          <SheetRow label="Copy link" icon={<Copy size={24} color={c.mutedForeground} />} onPress={() => copy(link)} />
          <SheetRow label="Expires" detail={link.expiresAt ? medium(link.expiresAt) : "Never"} icon={<CalendarBlank size={24} color={c.mutedForeground} />} onPress={() => setPanel("expiry")} />
          <SheetRow label="Password" detail={link.hasPassword ? "Set" : "None"} icon={<LockSimple size={24} color={c.mutedForeground} />} onPress={() => setPanel("password")} />
          <SheetRow
            label="Allow downloads"
            stay
            selected={link.allowDownload}
            trailing={link.allowDownload ? <Check size={24} color={c.brand} /> : undefined}
            onPress={() => patch({ allowDownload: !link.allowDownload })}
          />
          <SheetDivider />
          <SheetRow label="Delete link" danger icon={<Trash size={24} color={c.destructive} />} onPress={() => run(() => api.del(`/albums/${id}/shares/${link.shareId}`), "Deleted the link.")} />
        </Sheet>
      )}
      {link && panel === "expiry" && (
        <Sheet onClose={() => setPanel(null)}>
          <SheetRow label="Never" selected={!link.expiresAt} trailing={!link.expiresAt ? <Check size={24} color={c.brand} /> : undefined} onPress={() => expire(null)} />
          {PRESETS.map((n) => (
            <SheetRow key={n} label={n === 1 ? "1 day" : `${n} days`} onPress={() => expire(endOfDay(new Date(Date.now() + n * DAY)))} />
          ))}
          <SheetDivider />
          <SheetRow label="Pick a date" icon={<CalendarBlank size={24} color={c.mutedForeground} />} onPress={pickDate} />
        </Sheet>
      )}
      {link && panel === "password" && (
        <PromptDialog
          title={link.hasPassword ? "Change the password" : "Set a password"}
          label={link.hasPassword ? "New password" : "Password"}
          confirm="Save"
          secret
          canSubmit={(v) => !!v}
          onClose={() => setPanel(null)}
          onSubmit={async (password) => (await run(() => api.patch(`/albums/${id}/shares/${link.shareId}`, { password }), "Saved the link's password.")) ?? undefined}
        >
          {link.hasPassword && (
            <Button
              variant="text"
              danger
              label="Remove the password"
              onPress={() => {
                setPanel(null)
                patch({ password: "" }, "Removed the link's password.")
              }}
            />
          )}
        </PromptDialog>
      )}
    </Section>
  )
}

// Who can see an album: people with a role, and public links. Only its owner gets here.
export default function AlbumShare() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>()
  const api = useApi()
  const refresh = useAlbumRefresh()
  const snack = useSnack()
  const [problem, setProblem] = useState<string | null>(null)
  const shares = useQuery({ queryKey: [api.id, "albums", id, "shares"], queryFn: () => api.get<AlbumSharesResponse>(`/albums/${id}/shares`) })

  const run: Run = async (task, done) => {
    setProblem(null)
    try {
      await task()
      await refresh()
      if (done) snack({ text: done })
    } catch (e) {
      const text = errorText(e)
      setProblem(text)
      return text
    }
  }

  return (
    <Page title="Share album" caption={name}>
      <Loaded query={shares}>
        {(s) => (
          <>
            <AddPeople id={id} run={run} taken={new Set(s.people.map((p) => p.userId))} />
            {problem && <ErrorText>{problem}</ErrorText>}
            <People id={id} people={s.people} run={run} />
            <Links id={id} links={s.links} run={run} />
          </>
        )}
      </Loaded>
    </Page>
  )
}
