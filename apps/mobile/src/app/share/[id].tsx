import type { Member, MembersResponse, Person, ShareState } from "@nimbus/shared/api"
import { useQuery } from "@tanstack/react-query"
import { router, useLocalSearchParams } from "expo-router"
import { CaretDown, Check, Copy, CrownSimple, EnvelopeSimple, Link, LockSimple, Plus, Trash, UploadSimple } from "phosphor-react-native"
import { useEffect, useRef, useState } from "react"
import { Keyboard, Pressable, View } from "react-native"

import { Avatar } from "@/components/avatar"
import { PromptDialog } from "@/components/dialog"
import { Caret, Group, Loaded, Page, Row, Section, SwitchRow } from "@/components/page"
import { Sheet, SheetDivider, SheetRow } from "@/components/sheet"
import { useSnack } from "@/components/snackbar"
import { Button, ErrorText, Field, IconButton, Text } from "@/components/ui"
import { errorText } from "@/lib/api"
import { useApi, useFileActions, useLinks, useShareState } from "@/lib/files"
import { linkSummary } from "@/lib/share"
import { c } from "@/lib/theme"

type Role = Person["role"]
const ROLE: Record<Role, string> = { viewer: "Viewer", editor: "Editor" }
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// A small pill with the current role, opening its sheet.
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
      {(["viewer", "editor"] as const).map((r) => (
        <SheetRow
          key={r}
          label={ROLE[r]}
          detail={r === "viewer" ? "Can open and download" : "Can also add, rename, move and trash"}
          selected={r === role}
          trailing={r === role ? <Check size={24} color={c.brand} /> : undefined}
          onPress={() => onPick(r)}
        />
      ))}
    </Sheet>
  )
}

// Find a member or type an email, choose a role, Share.
function AddPeople({ id, state, run }: { id: string; state: ShareState; run: Run }) {
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
  const found = !picked && text.trim().length >= 2 ? (members.data?.members ?? []) : []
  const email = EMAIL.test(text.trim())
  const ready = !!picked || email
  const invites = state.canInvite && state.emailOn

  const share = async () => {
    setBusy(true)
    setError(null)
    const problem = await run(() => api.post(`/items/${id}/shares`, { target: picked?.id ?? text.trim(), role }), `Shared with ${picked?.name ?? text.trim()}.`)
    setBusy(false)
    if (problem) return setError(problem)
    Keyboard.dismiss()
    setText("")
    setPicked(null)
  }

  return (
    <View style={{ gap: 12 }}>
      <Field
        label={invites ? "Add people by name or email" : "Add people by name"}
        value={text}
        onChangeText={(v) => {
          setText(v)
          setPicked(null)
        }}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        returnKeyType="done"
        error={error}
        hint={email && !picked ? (invites ? "If they don't have an account, they'll get an email invite to join." : "They need an account on this Nimbus first.") : undefined}
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
      {ready && (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
          <RoleButton role={role} name="New person" onPress={() => setChoosing(true)} />
          <Button label="Share" busy={busy} onPress={share} />
        </View>
      )}
      {choosing && <RoleSheet role={role} onPick={setRole} onClose={() => setChoosing(false)} />}
    </View>
  )
}

// Runs a change and refreshes everything that shows it. Returns the error, if any.
type Run = (task: () => Promise<unknown>, done?: string) => Promise<string | undefined>

function People({ id, state, run }: { id: string; state: ShareState; run: Run }) {
  const api = useApi()
  const { account } = api
  const [open, setOpen] = useState<Person | null>(null)
  const [changing, setChanging] = useState<Person | null>(null)
  const [transfer, setTransfer] = useState(false)
  const candidates = state.people.filter((p) => p.userId && !p.through)
  const offer = (p: Person) =>
    run(() => api.post(`/items/${id}/ownership`, { to: p.userId }), `Offered ownership to ${p.name}. It changes once they accept.`)

  return (
    <Section title="Who has access">
      <Group>
        <Row
          label={state.owner.name + (state.isOwner ? " (you)" : "")}
          detail={state.owner.email}
          icon={<Avatar account={account} name={state.owner.name} image={state.owner.image} size={40} />}
          trailing={<Text variant="label" color={c.mutedForeground}>Owner</Text>}
        />
        {state.people.map((p) => (
          <Row
            key={p.shareId + (p.through ?? "")}
            label={p.invited ? p.email : p.name}
            detail={p.invited ? "Invited, no account yet" : p.through ? `${p.email} · through “${p.through}”` : p.email}
            icon={
              p.invited ? (
                <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.muted, alignItems: "center", justifyContent: "center" }}>
                  <EnvelopeSimple size={20} color={c.mutedForeground} />
                </View>
              ) : (
                <Avatar account={account} name={p.name} image={p.image} size={40} />
              )
            }
            trailing={
              p.canManage ? (
                <RoleButton role={p.role} name={p.name} onPress={() => setOpen(p)} />
              ) : (
                <Text variant="label" color={c.mutedForeground}>{ROLE[p.role]}</Text>
              )
            }
          />
        ))}
      </Group>

      {state.transferTo ? (
        <Group>
          <Row
            label={`Waiting for ${state.transferTo.name} to accept ownership.`}
            icon={<CrownSimple size={24} color={c.mutedForeground} />}
            trailing={state.isOwner ? <Button variant="text" label="Cancel offer" onPress={() => run(() => api.del(`/items/${id}/ownership`), "Cancelled the offer.")} /> : undefined}
          />
        </Group>
      ) : (
        state.isOwner && (
          <Group>
            <Row
              label="Transfer ownership"
              detail={candidates.length ? "They choose whether to accept. You stay on as an editor." : "Share it with them first."}
              icon={<CrownSimple size={24} color={c.mutedForeground} />}
              trailing={candidates.length ? <Caret /> : undefined}
              disabled={!candidates.length}
              onPress={() => setTransfer(true)}
            />
          </Group>
        )
      )}

      {state.isOwner && (
        <Group>
          <SwitchRow
            label="Editors can share it too"
            detail={`Off: only you can add people or make links${state.kind === "folder" ? ", here and inside" : ""}.`}
            value={state.allowReshare}
            onChange={(allowReshare) => run(() => api.patch(`/items/${id}/shares`, { allowReshare }))}
          />
        </Group>
      )}

      {open && (
        <Sheet
          onClose={() => setOpen(null)}
          header={<Text variant="titleSmall" numberOfLines={1} style={{ paddingHorizontal: 20, paddingBottom: 8 }}>{open.invited ? open.email : open.name}</Text>}
        >
          <SheetRow
            label="Change access"
            detail={ROLE[open.role]}
            icon={<CaretDown size={24} color={c.mutedForeground} />}
            onPress={() => setChanging(open)}
          />
          {state.isOwner && open.userId && !state.transferTo && (
            <SheetRow label="Offer ownership" icon={<CrownSimple size={24} color={c.mutedForeground} />} onPress={() => offer(open)} />
          )}
          <SheetDivider />
          <SheetRow
            label="Remove access"
            danger
            icon={<Trash size={24} color={c.destructive} />}
            onPress={() => run(() => api.del(`/shares/${open.shareId}`), `Removed ${open.invited ? open.email : open.name}.`)}
          />
        </Sheet>
      )}
      {changing && (
        <RoleSheet
          role={changing.role}
          onPick={(role) => role !== changing.role && run(() => api.patch(`/shares/${changing.shareId}`, { role }), `${changing.name} is now ${role === "viewer" ? "a viewer" : "an editor"}.`)}
          onClose={() => setChanging(null)}
        />
      )}
      {transfer && (
        <Sheet onClose={() => setTransfer(false)} header={<Text variant="titleSmall" style={{ paddingHorizontal: 20, paddingBottom: 8 }}>Offer ownership to</Text>}>
          {candidates.map((p) => (
            <SheetRow key={p.shareId} label={p.name} detail={p.email} icon={<Avatar account={account} name={p.name} image={p.image} size={40} />} onPress={() => offer(p)} />
          ))}
        </Sheet>
      )}
    </Section>
  )
}

function Links({ id, state, newLink }: { id: string; state: ShareState; newLink: boolean }) {
  const links = useLinks()
  const snack = useSnack()
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)

  const make = async (password?: string) => {
    // Not awaited: Android may never say the share menu closed, which would leave this busy.
    links.sendTo(await links.create(id, password))
  }
  const start = async () => {
    // A field left focused brings the keyboard back when the share menu closes.
    Keyboard.dismiss()
    if (state.requireLinkPassword) return setAsking(true)
    setBusy(true)
    try {
      await make()
    } catch (e) {
      snack({ text: errorText(e), error: true })
    }
    setBusy(false)
  }

  // Sent here by Copy link, on a server that won't make a link without a password.
  const asked = useRef(false)
  useEffect(() => {
    if (newLink && !asked.current && state.publicLinks && state.requireLinkPassword) {
      asked.current = true
      setAsking(true)
    }
  }, [newLink, state.publicLinks, state.requireLinkPassword])

  const kind = state.kind === "folder" ? "browse this folder" : "open this file"
  return (
    <Section
      title="Public links"
      note={
        !state.publicLinks
          ? `Your admin turned public links off${state.links.length ? ", so these links don't open." : "."}`
          : !state.links.length
            ? `Anyone with a link can ${kind} without signing in. Each link gets its own expiry, password and permissions.`
            : undefined
      }
      trailing={state.publicLinks ? <Button variant="outlined" label="New link" busy={busy} icon={<Plus size={18} color={c.foreground} />} onPress={start} /> : undefined}
    >
      <Group>
        {state.links.map((l) => {
          const expired = !!l.expiresAt && Date.parse(l.expiresAt) < Date.now()
          const Icon = l.allowUpload && !l.allowView ? UploadSimple : Link
          return (
            <View key={l.id} style={{ flexDirection: "row", alignItems: "center" }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${l.name}${l.hasPassword ? ", password protected" : ""}, ${linkSummary(l)}. Link settings`}
                android_ripple={{ color: c.ripple }}
                onPress={() => router.push({ pathname: "/share/link/[id]", params: { id: l.id, item: id } })}
                style={{ flex: 1, minHeight: 56, flexDirection: "row", alignItems: "center", gap: 16, paddingLeft: 16, paddingVertical: 8 }}
              >
                <Icon size={24} color={c.mutedForeground} />
                <View style={{ flex: 1, gap: 2 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text numberOfLines={1} style={{ flexShrink: 1 }}>{l.name}</Text>
                    {l.hasPassword && <LockSimple size={14} color={c.mutedForeground} />}
                  </View>
                  <Text variant="caption" color={expired ? c.destructive : c.mutedForeground} numberOfLines={1}>{linkSummary(l)}</Text>
                </View>
              </Pressable>
              <IconButton icon={Copy} label={`Copy ${l.name}`} color={c.mutedForeground} onPress={() => links.copy(l)} />
            </View>
          )
        })}
      </Group>
      {asking && (
        <PromptDialog
          title="Password for the new link"
          label="Password"
          confirm="Create"
          secret
          canSubmit={(v) => !!v}
          onClose={() => setAsking(false)}
          onSubmit={async (password) => {
            try {
              await make(password)
            } catch (e) {
              return errorText(e)
            }
          }}
        />
      )}
    </Section>
  )
}

export default function Share() {
  const { id, name, newLink } = useLocalSearchParams<{ id: string; name?: string; newLink?: string }>()
  const state = useShareState(id)
  const actions = useFileActions()
  const snack = useSnack()
  const [problem, setProblem] = useState<string | null>(null)

  const run: Run = async (task, done) => {
    setProblem(null)
    try {
      await task()
      actions.refresh()
      if (done) snack({ text: done })
    } catch (e) {
      const text = errorText(e)
      setProblem(text)
      return text
    }
  }

  // 404 is "you may not share this", the web's wording for it.
  const blocked = (state.error as { status?: number } | null)?.status === 404
  return (
    <Page title="Share" caption={state.data?.name ?? name}>
      {blocked ? (
        <Text color={c.mutedForeground}>You can&apos;t share this. Its owner may have turned sharing off for editors.</Text>
      ) : (
        <Loaded query={state}>
          {(s) => (
            <>
              <AddPeople id={id} state={s} run={run} />
              {problem && <ErrorText>{problem}</ErrorText>}
              <People id={id} state={s} run={run} />
              <Links id={id} state={s} newLink={!!newLink} />
            </>
          )}
        </Loaded>
      )}
    </Page>
  )
}
