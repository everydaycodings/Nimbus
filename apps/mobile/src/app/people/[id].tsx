import type { FileFacesResponse, PersonResult, PersonSuggestion } from "@nimbus/shared/api"
import { router, useFocusEffect, useLocalSearchParams } from "expo-router"
import { ArrowLeft, ArrowsLeftRight, DotsThreeVertical, Eye, EyeSlash, GitMerge, PencilSimple, Sparkle, UserCircle, UserMinus, X } from "phosphor-react-native"
import { useCallback, useState } from "react"
import { BackHandler, Pressable, ScrollView, View } from "react-native"

import { ConfirmDialog, PromptDialog } from "@/components/dialog"
import { PersonFace, PersonPickSheet, FaceCrop, personName } from "@/components/people-ui"
import { usePhotoSheet } from "@/components/photo-sheets"
import { PhotoGrid } from "@/components/photo-grid"
import { Sheet, SheetDivider, SheetRow } from "@/components/sheet"
import { useSnack } from "@/components/snackbar"
import { Bar, Button, IconButton, Spinner, Text } from "@/components/ui"
import { errorText } from "@/lib/api"
import { useApi } from "@/lib/files"
import { photosText, usePeopleRefresh, usePerson, usePersonFaces, useSuggestions } from "@/lib/people"
import { openPreview } from "@/lib/preview-session"
import { c, radius } from "@/lib/theme"

type Dialog = "rename" | "merge" | "not" | "move" | "review" | "cover" | null

// One person's photos, with rename, hide, merge, "Is this them?" review and fixes for photos they aren't in.
export default function PersonScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>()
  const api = useApi()
  const snack = useSnack()
  const refresh = usePeopleRefresh()
  const query = usePerson(id)
  const person = query.person
  const suggestions = useSuggestions(id, !!person && person.suggestions > 0)
  const [menu, setMenu] = useState(false)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  // "Select photos" from the menu: selecting with nothing picked yet.
  const [picking, setPicking] = useState(false)
  const items = query.items
  const selecting = picking || chosen.size > 0
  const clear = useCallback(() => {
    setChosen(new Set())
    setPicking(false)
  }, [])
  const title = person ? personName(person) : name || "Person"

  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        if (!chosen.size && !picking) return false
        clear()
        return true
      })
      return () => sub.remove()
    }, [chosen.size, picking, clear])
  )

  const toggle = (p: { id: string }) =>
    setChosen((s) => {
      const next = new Set(s)
      if (!next.delete(p.id)) next.add(p.id)
      return next
    })

  const run = async (task: () => Promise<unknown>, done?: string) => {
    setBusy(true)
    try {
      await task()
      await refresh()
      if (done) snack({ text: done })
      return true
    } catch (e) {
      snack({ text: errorText(e), error: true })
      return false
    } finally {
      setBusy(false)
    }
  }

  // The selected photos' faces that belong to this person: what Not and Move act on.
  const faceIds = async () => {
    const all = await Promise.all([...chosen].map((n) => api.get<FileFacesResponse>(`/files/${n}/faces`)))
    return all.flatMap((r) => r.faces.filter((f) => f.personId === id).map((f) => f.id))
  }
  const withFaces = async (act: (ids: string[]) => Promise<unknown>, done: (n: number) => string) => {
    let n = 0
    const ok = await run(async () => {
      const ids = await faceIds()
      if (!ids.length) throw new Error("Couldn't find their face in those photos.")
      n = ids.length
      await act(ids)
    })
    if (ok) {
      snack({ text: done(n) })
      clear()
    }
  }

  const sheets = usePhotoSheet()
  const open = (index: number) => openPreview({ items, index, role: "owner" })

  const header = (back: boolean) => (
    <Bar>
      {back && <IconButton icon={ArrowLeft} label="Back" onPress={() => router.back()} />}
      {!back && <View style={{ width: 12 }} />}
      <Text variant="title" numberOfLines={1} accessibilityRole="header" style={{ flex: 1 }}>{title}</Text>
    </Bar>
  )

  if (query.isPending)
    return (
      <View style={{ flex: 1, backgroundColor: c.background }}>
        {header(true)}
        <Spinner />
      </View>
    )
  if (!person)
    return (
      <View style={{ flex: 1, backgroundColor: c.background }}>
        {header(true)}
        <View style={{ alignItems: "center", padding: 24, gap: 12 }}>
          <Text variant="bodySmall" color={c.mutedForeground} style={{ textAlign: "center" }}>
            {(query.error as { status?: number } | null)?.status === 404 ? "This person isn't here any more. They may have been merged into someone else." : query.error?.message}
          </Text>
          <Button variant="outlined" label="Try again" busy={query.isFetching} onPress={() => query.refetch()} />
        </View>
      </View>
    )

  const who = person.name ?? "this person"
  const review = person.suggestions > 0 && (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Review ${person.suggestions} ${person.suggestions === 1 ? "suggestion" : "suggestions"}. Is this ${who}?`}
      android_ripple={{ color: c.ripple }}
      onPress={() => setDialog("review")}
      style={{ minHeight: 56, margin: 16, marginBottom: 12, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, borderRadius: radius.card, backgroundColor: c.brandWash, borderWidth: 1, borderColor: c.border }}
    >
      <Text style={{ flex: 1 }}>Review {person.suggestions} {person.suggestions === 1 ? "suggestion" : "suggestions"}</Text>
      <Text variant="label" color={c.brand}>Is this {who}?</Text>
    </Pressable>
  )

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      {selecting ? (
        <Bar>
          <IconButton icon={X} label="Clear selection" onPress={clear} />
          <Text variant="title" style={{ flex: 1, fontVariant: ["tabular-nums"] }}>{chosen.size ? `${chosen.size} selected` : "Select photos"}</Text>
          {chosen.size === 1 && <IconButton icon={DotsThreeVertical} label="More actions" onPress={() => sheets.show(items.find((p) => chosen.has(p.id))!)} />}
          {chosen.size > 0 && <IconButton icon={UserMinus} label={`Not ${person.name ?? "this person"}`} onPress={() => setDialog("not")} />}
          {chosen.size > 0 && <IconButton icon={ArrowsLeftRight} label="Move to another person" onPress={() => setDialog("move")} />}
        </Bar>
      ) : (
        <Bar>
          <IconButton icon={ArrowLeft} label="Back" onPress={() => router.back()} />
          <Pressable onPress={() => setDialog("cover")} accessibilityRole="button" accessibilityLabel="Change their picture" hitSlop={4} style={{ borderRadius: 999 }}>
            <PersonFace person={person} size={40} />
          </Pressable>
          <View style={{ flex: 1, paddingLeft: 8 }}>
            <Text variant="title" numberOfLines={1} accessibilityRole="header" color={person.name ? c.foreground : c.mutedForeground}>{title}</Text>
            <Text variant="caption" color={c.mutedForeground} numberOfLines={1}>{photosText(person.photos)}{person.hidden ? " · Hidden" : ""}{person.name && !person.memories ? " · Not in memories" : ""}</Text>
          </View>
          <IconButton icon={PencilSimple} label="Rename" onPress={() => setDialog("rename")} />
          <IconButton icon={DotsThreeVertical} label="More actions" onPress={() => setMenu(true)} />
        </Bar>
      )}

      <PhotoGrid
        items={items}
        selected={selecting ? chosen : undefined}
        onOpen={(i) => (selecting ? toggle(items[i]) : open(i))}
        onLongPress={toggle}
        header={review || undefined}
        empty={
          <View style={{ alignItems: "center", paddingVertical: 64, paddingHorizontal: 24, gap: 8 }}>
            <Text variant="titleSmall" style={{ textAlign: "center" }}>No photos left</Text>
            <Text variant="bodySmall" color={c.mutedForeground} style={{ textAlign: "center" }}>Their photos were moved, trashed or removed.</Text>
          </View>
        }
      />

      {sheets.element}
      {menu && (
        <Sheet onClose={() => setMenu(false)} header={<Text variant="titleSmall" numberOfLines={1} style={{ paddingHorizontal: 20, paddingBottom: 8 }}>{title}</Text>}>
          <SheetRow label={person.name ? "Rename" : "Add a name"} icon={<PencilSimple size={24} color={c.mutedForeground} />} onPress={() => setDialog("rename")} />
          <SheetRow label="Change picture" detail="Pick which face to show" icon={<UserCircle size={24} color={c.mutedForeground} />} onPress={() => setDialog("cover")} />
          <SheetRow label="Merge into another person" detail="They are the same person" icon={<GitMerge size={24} color={c.mutedForeground} />} onPress={() => setDialog("merge")} />
          <SheetRow
            label={person.hidden ? "Show in People" : "Hide from People"}
            icon={person.hidden ? <Eye size={24} color={c.mutedForeground} /> : <EyeSlash size={24} color={c.mutedForeground} />}
            onPress={() => run(() => api.patch(`/people/${id}`, { hidden: !person.hidden }), person.hidden ? "They are back in People." : "Hidden from People.")}
          />
          {person.name && (
            <SheetRow
              label={person.memories ? "No memories of them" : "Show in memories"}
              detail={person.memories ? "No \"With\" memory cards for them" : undefined}
              icon={<Sparkle size={24} color={c.mutedForeground} />}
              onPress={() => run(() => api.patch(`/people/${id}`, { memories: !person.memories }), person.memories ? "No more memories of them." : "Memories of them are back.")}
            />
          )}
          <SheetDivider />
          <SheetRow label="Select photos" detail="To say they aren't in them, or move them" icon={<UserMinus size={24} color={c.mutedForeground} />} onPress={() => setPicking(true)} />
        </Sheet>
      )}

      {dialog === "rename" && (
        <PromptDialog
          title="Name this person"
          label="Name"
          confirm="Save"
          initial={person.name ?? ""}
          canSubmit={() => true}
          onClose={() => setDialog(null)}
          onSubmit={async (next) => {
            try {
              await api.patch(`/people/${id}`, { name: next || null })
              await refresh()
            } catch (e) {
              return errorText(e)
            }
          }}
        />
      )}
      {dialog === "merge" && (
        <PersonPickSheet
          title={`Merge ${title} into…`}
          exclude={id}
          onClose={() => setDialog(null)}
          onPick={(into) =>
            // Merging moves everyone from this person to the other, so this screen has nothing left to show.
            run(() => api.post(`/people/${id}/merge`, { intoId: into.id }), `Merged into ${personName(into)}.`).then((ok) => {
              if (ok) router.replace({ pathname: "/people/[id]", params: { id: into.id, name: into.name ?? "" } })
            })
          }
        />
      )}
      {dialog === "not" && (
        <ConfirmDialog
          title={`Not ${person.name ?? "this person"}?`}
          body={`Takes the face out of ${chosen.size === 1 ? "this photo" : `these ${chosen.size} photos`} and Nimbus won't put it back with ${who}. The photo stays in your library.`}
          confirm="Remove"
          danger={false}
          onClose={() => setDialog(null)}
          onConfirm={() => withFaces((ids) => api.post(`/people/${id}/not`, { faceIds: ids }), (n) => `Removed ${n === 1 ? "a face" : `${n} faces`} from ${who}.`)}
        />
      )}
      {dialog === "move" && (
        <PersonPickSheet
          title="Move to…"
          exclude={id}
          onClose={() => setDialog(null)}
          onPick={(to) => withFaces((ids) => api.post(`/people/${id}/move`, { faceIds: ids, toId: to.id }), (n) => `Moved ${n === 1 ? "a face" : `${n} faces`} to ${personName(to)}.`)}
          onNew={async (n) => {
            let problem: string | undefined
            await withFaces(
              async (ids) => {
                try {
                  const { person: made } = await api.post<PersonResult>(`/people/${id}/split`, { faceIds: ids })
                  await api.patch(`/people/${made.id}`, { name: n })
                } catch (e) {
                  problem = errorText(e)
                  throw e
                }
              },
              (k) => `Moved ${k === 1 ? "a face" : `${k} faces`} to ${n}.`
            )
            return problem
          }}
        />
      )}
      {dialog === "cover" && (
        <CoverSheet
          personId={id}
          current={person.coverFaceId}
          who={who}
          onClose={() => setDialog(null)}
          onPick={(faceId) =>
            run(() => api.patch(`/people/${id}`, { coverFaceId: faceId }), "Picture changed.").then((ok) => ok && setDialog(null))
          }
        />
      )}
      {dialog === "review" && (
        <Review personId={id} who={who} suggestions={suggestions.data} loading={suggestions.isPending} error={suggestions.isError ? suggestions.error.message : null} retry={() => suggestions.refetch()} onClose={() => { setDialog(null); void refresh() }} />
      )}
      {busy && <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, backgroundColor: c.brand }} />}
    </View>
  )
}

// "Is this X?", one face at a time. Each answer is saved straight away.
function Review({ personId, who, suggestions, loading, error, retry, onClose }: { personId: string; who: string; suggestions: PersonSuggestion[] | undefined; loading: boolean; error: string | null; retry: () => void; onClose: () => void }) {
  const api = useApi()
  const snack = useSnack()
  const [at, setAt] = useState(0)
  const [busy, setBusy] = useState(false)
  const list = suggestions ?? []
  const current = list[at]
  const answer = async (accept: boolean) => {
    if (!current || busy) return
    setBusy(true)
    try {
      await api.post(`/faces/${current.faceId}/suggestion`, { accept })
      setAt((n) => n + 1)
    } catch (e) {
      snack({ text: errorText(e), error: true })
    }
    setBusy(false)
  }
  return (
    <Sheet onClose={onClose} header={<Text variant="titleSmall" style={{ paddingHorizontal: 20, paddingBottom: 8 }}>Is this {who}?</Text>}>
      <View style={{ alignItems: "center", gap: 16, paddingHorizontal: 20, paddingVertical: 16 }}>
        {loading ? (
          <View style={{ height: 160 }}><Spinner /></View>
        ) : error ? (
          <>
            <Text color={c.destructive} style={{ textAlign: "center" }}>{error}</Text>
            <Button variant="outlined" label="Try again" onPress={retry} />
          </>
        ) : !current ? (
          <>
            <Text variant="titleSmall">{list.length ? "All done" : "Nothing to review"}</Text>
            <Text color={c.mutedForeground} style={{ textAlign: "center" }}>{list.length ? "Thanks. Nimbus learns from your answers." : "No new faces look like them right now."}</Text>
            <Button label="Done" onPress={onClose} />
          </>
        ) : (
          <>
            <Text variant="caption" color={c.mutedForeground} style={{ fontVariant: ["tabular-nums"] }}>{at + 1} of {list.length}</Text>
            <ReviewFace key={current.faceId} suggestion={current} />
            <View style={{ flexDirection: "row", gap: 12, alignSelf: "stretch" }}>
              <View style={{ flex: 1 }}><Button variant="outlined" label="No" disabled={busy} onPress={() => answer(false)} /></View>
              <View style={{ flex: 1 }}><Button label="Yes" disabled={busy} onPress={() => answer(true)} /></View>
            </View>
            <Button variant="text" label="Skip" disabled={busy} onPress={() => setAt((n) => n + 1)} />
          </>
        )}
      </View>
    </Sheet>
  )
}

function ReviewFace({ suggestion }: { suggestion: PersonSuggestion }) {
  return <FaceCrop faceId={suggestion.faceId} size={160} />
}

// Their picture: a grid of their faces; the current one is ringed.
function CoverSheet({ personId, current, who, onClose, onPick }: { personId: string; current: string | null; who: string; onClose: () => void; onPick: (faceId: string) => void }) {
  const faces = usePersonFaces(personId, true)
  return (
    <Sheet
      onClose={onClose}
      header={
        <View style={{ paddingHorizontal: 20, paddingBottom: 8, gap: 2 }}>
          <Text variant="titleSmall">Choose a picture</Text>
          <Text variant="bodySmall" color={c.mutedForeground}>The face to show for {who} in People, search and memories.</Text>
        </View>
      }
    >
      {faces.isPending ? (
        <View style={{ padding: 24, alignItems: "center" }}><Spinner /></View>
      ) : faces.isError ? (
        <View style={{ padding: 20, gap: 12 }}>
          <Text variant="bodySmall" color={c.mutedForeground}>{faces.error.message}</Text>
          <Button label="Try again" variant="outlined" onPress={() => faces.refetch()} />
        </View>
      ) : !faces.data.length ? (
        <Text variant="bodySmall" color={c.mutedForeground} style={{ padding: 20 }}>No faces of them to choose from.</Text>
      ) : (
        <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ flexDirection: "row", flexWrap: "wrap", gap: 12, paddingHorizontal: 20, paddingVertical: 8 }}>
          {faces.data.map((f) => {
            const on = f.id === current
            return (
              <Pressable
                key={f.id}
                onPress={() => onPick(f.id)}
                accessibilityRole="button"
                accessibilityLabel={on ? "Current picture" : "Use this face"}
                accessibilityState={{ selected: on }}
                style={{ borderRadius: 999, borderWidth: 3, borderColor: on ? c.brand : "transparent", padding: 2 }}
              >
                <FaceCrop faceId={f.id} size={64} />
              </Pressable>
            )
          })}
        </ScrollView>
      )}
    </Sheet>
  )
}
