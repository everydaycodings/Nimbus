// Casting on screen: the Cast button, the remote shown while a file plays on the TV, the small bar for photos,
// and the hook each previewer page uses to send its file. The mechanics are in lib/cast.ts.
import type { Item } from "@nimbus/shared/api"
import { useQuery } from "@tanstack/react-query"
import { Image } from "expo-image"
import { ArrowClockwise, ArrowCounterClockwise, Screencast, Check, Pause, Play, SkipBack, SkipForward, SpeakerHigh, SpeakerX } from "phosphor-react-native"
import { useEffect, useRef, useState } from "react"
import { Pressable, ScrollView, View, type GestureResponderEvent } from "react-native"

import { FileIcon } from "@/components/file-icon"
import { Sheet, SheetDivider, SheetRow } from "@/components/sheet"
import { useSnack } from "@/components/snackbar"
import { Button, Text } from "@/components/ui"
import { errorText } from "@/lib/api"
import { castLoad, castLoaded, castPosition, isNoCopy, NativeCastButton, noteCastPosition, stopCasting, useCastDevice, useCasting, useCastSession, useCastShown, useMediaStatus, useStreamPosition, type CastKind } from "@/lib/cast"
import { useApi } from "@/lib/files"
import { getPlayback, makeCopy, putPosition } from "@/lib/playback"
import { clock } from "@/lib/time"
import { c, radius } from "@/lib/theme"

const SKIP = 10

// The system's Cast button: it picks the TV itself, and is not drawn without Play services or a TV nearby.
export function CastBtn() {
  const shown = useCastShown()
  if (!shown || !NativeCastButton) return null
  return (
    <View style={{ width: 48, height: 48, alignItems: "center", justifyContent: "center" }}>
      <NativeCastButton style={{ width: 24, height: 24, tintColor: c.foreground }} accessibilityLabel="Cast to TV" />
    </View>
  )
}

type Send = {
  item: Item
  kind: CastKind
  // Only the page on screen sends.
  active: boolean
  // Where the local player is and how long the file is, when it has a player.
  time?: () => number
  duration?: () => number
  // The TV has it: stop playing here.
  onTaken?: () => void
  // Casting stopped: the local player takes over from the TV's position.
  onEnded?: (position: number) => void
}

// Sends the page's file to the TV while a cast is on, and again whenever the page changes to another file
// (the TV follows swipes). Returns whether it is casting, and a sheet to show when a video has no castable copy.
export function useCastItem({ item, kind, active, time, duration, onTaken, onEnded }: Send) {
  const api = useApi()
  const snack = useSnack()
  const casting = useCasting()
  const [noCopy, setNoCopy] = useState(false)
  const latest = useRef({ time, duration, onTaken, onEnded })
  latest.current = { time, duration, onTaken, onEnded }

  useEffect(() => {
    if (!casting || !active) return
    let live = true
    castLoad(api, { item, kind, startAt: latest.current.time?.() ?? 0, duration: latest.current.duration?.() ?? 0 }).then(
      () => live && latest.current.onTaken?.(),
      (e) => {
        if (!live) return
        if (isNoCopy(e)) setNoCopy(true)
        else snack({ text: errorText(e), error: true })
      }
    )
    return () => {
      live = false
    }
  }, [casting, active, item, kind, api, snack])

  const was = useRef(false)
  useEffect(() => {
    if (was.current && !casting && active) latest.current.onEnded?.(castPosition())
    was.current = casting
  }, [casting, active])

  return { casting: casting && active, sheet: noCopy ? <NoCopySheet item={item} onClose={() => setNoCopy(false)} /> : null }
}

function NoCopySheet({ item, onClose }: { item: Item; onClose: () => void }) {
  const api = useApi()
  const snack = useSnack()
  const info = useQuery({ queryKey: [api.id, "playback", item.id], queryFn: () => getPlayback(api, item.id) })
  const can = info.data?.canMakeCopy && !info.data.copies.some((x) => x.status === "pending")
  return (
    <Sheet
      onClose={onClose}
      header={
        <View style={{ paddingHorizontal: 20, paddingBottom: 8, gap: 4 }}>
          <Text variant="titleSmall">This video can&apos;t be cast yet.</Text>
          <Text variant="bodySmall" color={c.mutedForeground}>
            The TV can&apos;t play this format. A smaller copy made for mobile data plays on it.
          </Text>
        </View>
      }
    >
      {can ? (
        <SheetRow
          label="Make copy"
          detail="Cast it again once the copy is ready"
          onPress={() =>
            makeCopy(api, item.id).then(
              () => snack({ text: "Making a copy. Cast again when it's ready." }),
              (e) => snack({ text: errorText(e), error: true })
            )
          }
        />
      ) : (
        <SheetRow label="OK" onPress={() => {}} />
      )}
    </Sheet>
  )
}

// A bar for photos and slideshows: the TV is showing them, and this is the way to stop.
export function CastBar({ bottom }: { bottom: number }) {
  const casting = useCasting()
  const device = useCastDevice()
  if (!casting) return null
  return (
    <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, bottom, alignItems: "center" }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingLeft: 16, borderRadius: 24, backgroundColor: "rgba(23,23,23,0.92)", borderWidth: 1, borderColor: c.border }}>
        <Screencast size={20} color={c.brand} weight="fill" />
        <Text variant="bodySmall" color="#fff" numberOfLines={1} style={{ maxWidth: 200, marginLeft: 4 }}>
          {device ? `Casting to ${device.friendlyName}` : "Casting"}
        </Text>
        <Pressable onPress={() => void stopCasting()} accessibilityRole="button" style={{ height: 44, paddingHorizontal: 12, justifyContent: "center" }}>
          <Text variant="label" color={c.brand}>Stop</Text>
        </Pressable>
      </View>
    </View>
  )
}

// ---- The remote ----

function Slider({ value, onDrag, onCommit, label, valueText }: { value: number; onDrag?: (v: number) => void; onCommit: (v: number) => void; label: string; valueText?: string }) {
  const [w, setW] = useState(1)
  const [drag, setDrag] = useState<number | null>(null)
  const at = (e: GestureResponderEvent) => Math.max(0, Math.min(1, e.nativeEvent.locationX / w))
  const shown = drag ?? value
  return (
    <View
      onLayout={(e) => setW(e.nativeEvent.layout.width || 1)}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={(e) => {
        setDrag(at(e))
        onDrag?.(at(e))
      }}
      onResponderMove={(e) => {
        setDrag(at(e))
        onDrag?.(at(e))
      }}
      onResponderRelease={(e) => {
        onCommit(at(e))
        setDrag(null)
      }}
      onResponderTerminate={() => setDrag(null)}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text: valueText }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(e) => onCommit(Math.max(0, Math.min(1, shown + (e.nativeEvent.actionName === "increment" ? 0.05 : -0.05))))}
      style={{ height: 48, justifyContent: "center" }}
    >
      <View pointerEvents="none" style={{ height: 4, borderRadius: 2, backgroundColor: c.mutedStrong }}>
        <View style={{ height: 4, borderRadius: 2, width: `${shown * 100}%`, backgroundColor: c.foreground }} />
      </View>
      <View pointerEvents="none" style={{ position: "absolute", left: `${shown * 100}%`, marginLeft: -7, width: 14, height: 14, borderRadius: 7, backgroundColor: c.foreground }} />
    </View>
  )
}

const Tap = ({ icon: I, label, onPress, big }: { icon: typeof Play; label: string; onPress: () => void; big?: boolean }) => {
  const size = big ? 64 : 48
  return (
    <View style={{ borderRadius: size / 2, overflow: "hidden" }}>
      <Pressable
        onPress={onPress}
        android_ripple={{ color: big ? "rgba(0,0,0,0.12)" : c.ripple }}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={{ width: size, height: size, alignItems: "center", justifyContent: "center", backgroundColor: big ? c.primary : "transparent" }}
      >
        <I size={big ? 28 : 24} weight={big ? "fill" : "regular"} color={big ? c.primaryForeground : c.foreground} />
      </Pressable>
    </View>
  )
}

const Choice = ({ label, detail, onPress }: { label: string; detail: string; onPress: () => void }) => (
  <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label}, ${detail}`} style={{ minHeight: 48, justifyContent: "center", paddingHorizontal: 16, borderRadius: radius.pill, borderWidth: 1, borderColor: c.input }}>
    <Text variant="label" numberOfLines={1}>{label}: <Text variant="label" color={c.brand}>{detail}</Text></Text>
  </Pressable>
)

// Fills the page while a video or song plays on the TV.
export function CastRemote({ item, kind, top, nav }: { item: Item; kind: CastKind; top: number; nav?: { prev: boolean; next: boolean; go: (by: 1 | -1) => void } }) {
  const api = useApi()
  const device = useCastDevice()
  const session = useCastSession()
  const status = useMediaStatus()
  const position = useStreamPosition()
  const [volume, setVolume] = useState(1)
  const [menu, setMenu] = useState<"subs" | "audio" | null>(null)
  const loaded = castLoaded()
  const client = session?.client

  useEffect(() => {
    session?.getVolume().then(setVolume, () => {})
  }, [session])

  const playing = status?.playerState === "playing" || status?.playerState === "buffering"
  const duration = status?.mediaInfo?.streamDuration ?? 0
  const at = position ?? 0

  // The position goes to the account every so often, and is kept for handing back to this phone.
  const saved = useRef(0)
  useEffect(() => {
    noteCastPosition(at)
    if (Date.now() - saved.current > 15_000 && duration) {
      saved.current = Date.now()
      putPosition(api, item.id, at, duration)
    }
  }, [at, duration, api, item.id])

  // A song or video that finished moves on to the next in the list.
  const moved = useRef<string | null>(null)
  useEffect(() => {
    if (status?.idleReason !== "finished" || moved.current === item.id) return
    moved.current = item.id
    putPosition(api, item.id, 0, 0)
    if (nav?.next) nav.go(1)
  }, [status?.idleReason, item.id, nav, api])

  const textTracks = loaded?.id === item.id ? loaded.tracks : []
  const audioTracks = (status?.mediaInfo?.mediaTracks ?? []).filter((t) => t.type === "audio")
  const active = status?.activeTrackIds ?? []
  const setActive = (drop: number[], add?: number) => void client?.setActiveTrackIds([...active.filter((id) => !drop.includes(id)), ...(add ? [add] : [])])
  const subId = textTracks.findIndex((_, i) => active.includes(i + 1)) + 1
  const tick = (on: boolean) => (on ? <Check size={20} color={c.brand} weight="bold" /> : undefined)
  const textIds = textTracks.map((_, i) => i + 1)
  const audioIds = audioTracks.map((t) => t.id)

  return (
    <ScrollView style={{ position: "absolute", inset: 0, backgroundColor: c.background }} contentContainerStyle={{ flexGrow: 1, paddingTop: top, paddingBottom: 24, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, gap: 20 }}>
      <View style={{ width: 200, height: 200, maxWidth: "100%", borderRadius: radius.card, backgroundColor: c.card, alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
        {item.thumb ? (
          <Image
            source={{ uri: `${api.account.server}/api/files/${item.id}/thumb?v=${item.version}&r=${item.thumb}`, headers: { authorization: `Bearer ${api.account.token}` } }}
            style={{ width: "100%", height: "100%" }}
            contentFit="cover"
            accessibilityIgnoresInvertColors
          />
        ) : (
          <FileIcon item={item} size={72} />
        )}
      </View>
      <View style={{ alignItems: "center", gap: 4 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Screencast size={18} color={c.brand} weight="fill" />
          <Text variant="label" color={c.brand} accessibilityLiveRegion="polite">{device ? `Casting to ${device.friendlyName}` : "Connecting…"}</Text>
        </View>
        <Text variant="titleSmall" numberOfLines={2} style={{ textAlign: "center" }}>{item.name}</Text>
      </View>

      <View style={{ width: "100%", maxWidth: 480, gap: 0 }}>
        <Slider
          label="Position"
          valueText={`${clock(at)} of ${clock(duration)}`}
          value={duration ? Math.min(1, at / duration) : 0}
          onCommit={(v) => void client?.seek({ position: v * duration })}
        />
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Text variant="caption" color={c.mutedForeground} style={{ fontVariant: ["tabular-nums"] }}>{clock(at)}</Text>
          <Text variant="caption" color={c.mutedForeground} style={{ fontVariant: ["tabular-nums"] }}>{clock(duration)}</Text>
        </View>
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        {nav ? nav.prev ? <Tap icon={SkipBack} label="Previous" onPress={() => nav.go(-1)} /> : <View style={{ width: 48 }} /> : null}
        <Tap icon={ArrowCounterClockwise} label={`Back ${SKIP} seconds`} onPress={() => void client?.seek({ position: -SKIP, relative: true })} />
        <Tap big icon={playing ? Pause : Play} label={playing ? "Pause" : "Play"} onPress={() => void (playing ? client?.pause() : client?.play())} />
        <Tap icon={ArrowClockwise} label={`Forward ${SKIP} seconds`} onPress={() => void client?.seek({ position: SKIP, relative: true })} />
        {nav ? nav.next ? <Tap icon={SkipForward} label="Next" onPress={() => nav.go(1)} /> : <View style={{ width: 48 }} /> : null}
      </View>

      <View style={{ width: "100%", maxWidth: 480, flexDirection: "row", alignItems: "center", gap: 12 }}>
        {volume ? <SpeakerHigh size={22} color={c.mutedForeground} /> : <SpeakerX size={22} color={c.mutedForeground} />}
        <View style={{ flex: 1 }}>
          <Slider
            label="TV volume"
            valueText={`${Math.round(volume * 100)} percent`}
            value={volume}
            onDrag={(v) => session?.setVolume(v)}
            onCommit={(v) => {
              setVolume(v)
              session?.setVolume(v)
            }}
          />
        </View>
      </View>

      {(textTracks.length > 0 || audioTracks.length > 1) && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8 }}>
          {textTracks.length > 0 && <Choice label="Subtitles" detail={subId ? textTracks[subId - 1].label : "Off"} onPress={() => setMenu("subs")} />}
          {audioTracks.length > 1 && <Choice label="Audio" detail={audioTracks.find((t) => active.includes(t.id))?.name ?? "Default"} onPress={() => setMenu("audio")} />}
        </View>
      )}

      <Button variant="outlined" label="Stop casting" onPress={() => void stopCasting()} />

      {menu === "subs" && (
        <Sheet onClose={() => setMenu(null)}>
          <SheetRow label="Off" selected={!subId} trailing={tick(!subId)} onPress={() => setActive(textIds)} />
          <SheetDivider />
          {textTracks.map((t, i) => <SheetRow key={t.id} label={t.label} detail={t.source === "embedded" ? "In the video" : "Subtitle file"} selected={subId === i + 1} trailing={tick(subId === i + 1)} onPress={() => setActive(textIds, i + 1)} />)}
        </Sheet>
      )}
      {menu === "audio" && (
        <Sheet onClose={() => setMenu(null)}>
          {audioTracks.map((t, i) => <SheetRow key={t.id} label={t.name || t.language || `Track ${i + 1}`} detail={t.language} selected={active.includes(t.id)} trailing={tick(active.includes(t.id))} onPress={() => setActive(audioIds, t.id)} />)}
        </Sheet>
      )}
    </ScrollView>
  )
}
