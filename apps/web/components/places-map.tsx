"use client"

import { ImageIcon, MapPinIcon, XIcon } from "@phosphor-icons/react"
import "maplibre-gl/dist/maplibre-gl.css"
import type { GeoJSONSource, Map as MapLibre, Marker } from "maplibre-gl"
import { useEffect, useRef, useState } from "react"

import { getPlaceItems, getPlaces } from "@/app/(app)/photo-actions"
import { PhotoChips } from "@/components/photos-timeline"
import { canEditItem, Previewer } from "@/components/previewer"
import { Thumb } from "@/components/thumb"
import { Button } from "@/components/ui/button"
import type { PhotoItem, PlacePoint } from "@nimbus/shared/api"

const SOURCE = "photos"
type Props = { id: string; version: string | null; thumb: string | null; cluster?: boolean; point_count?: number; cluster_id?: number }

// A round photo marker, with the number of photos when it stands for a cluster.
function pin(count: number, src: string | null) {
  const el = document.createElement("button")
  el.type = "button"
  el.dataset.cluster = String(count)
  el.setAttribute("aria-label", count > 1 ? `${count} photos here` : "1 photo here")
  const size = count > 1 ? 56 : 44
  el.className =
    "relative rounded-full border-2 border-white bg-muted shadow-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
  el.style.width = el.style.height = `${size}px`
  if (src) {
    const img = document.createElement("img")
    img.src = src
    img.alt = ""
    img.draggable = false
    img.className = "size-full rounded-full object-cover"
    el.append(img)
  }
  if (count > 1) {
    const n = document.createElement("span")
    n.textContent = count > 999 ? "999+" : String(count)
    n.className =
      "absolute -top-1 -right-1 min-w-5 rounded-full bg-primary px-1 text-center text-[11px] leading-5 font-semibold text-primary-foreground tabular-nums"
    el.append(n)
  }
  return el
}

const thumbSrc = (p: Props) => (p.version && p.thumb ? `/api/files/${p.id}/thumb?v=${p.version}&r=${p.thumb}` : null)

// My geotagged photos on a map. maplibre-gl is only fetched here, and clusters are
// drawn as photo markers: the map's own cluster source, with HTML markers on top.
export function PlacesMap({ styleUrl }: { styleUrl: string }) {
  const box = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<"loading" | "empty" | "ready" | "failed">("loading")
  const [count, setCount] = useState(0)
  const [sheet, setSheet] = useState<{ items: PhotoItem[]; total: number } | null>(null)
  const [open, setOpen] = useState<number | null>(null)

  useEffect(() => {
    let map: MapLibre | undefined
    let gone = false
    const markers = new globalThis.Map<string, Marker>()
    ;(async () => {
      const points: PlacePoint[] = await getPlaces().then(
        (p) => p,
        () => []
      )
      if (gone) return
      setCount(points.length)
      if (!points.length) return setState("empty")
      try {
        const ml = await import("maplibre-gl")
        if (gone || !box.current) return
        // Bundled, maplibre looks for its worker next to our chunk (a 404); let the bundler emit it.
        ml.setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).href)
        const bounds = new ml.LngLatBounds()
        for (const p of points) bounds.extend([p.lng, p.lat])
        map = new ml.Map({
          container: box.current,
          style: styleUrl,
          bounds,
          fitBoundsOptions: { padding: 80, maxZoom: 12, animate: false },
          attributionControl: { compact: true },
        })
        map.addControl(new ml.NavigationControl({ showCompass: false }), "top-right")
        const m = map
        m.on("load", () => {
          m.addSource(SOURCE, {
            type: "geojson",
            cluster: true,
            clusterRadius: 60,
            clusterMaxZoom: 14,
            data: {
              type: "FeatureCollection",
              features: points.map((p) => ({
                type: "Feature",
                geometry: { type: "Point", coordinates: [p.lng, p.lat] },
                properties: { id: p.id, version: p.version, thumb: p.thumb },
              })),
            },
          })
          // Invisible: the source needs a layer to load its tiles; the markers are the drawing.
          m.addLayer({ id: "photos-hit", type: "circle", source: SOURCE, paint: { "circle-radius": 1, "circle-opacity": 0 } })
          const src = m.getSource(SOURCE) as GeoJSONSource

          // The first photo of a cluster stands in for it.
          const covers = new globalThis.Map<number, Props>()
          const sync = async () => {
            const seen = new globalThis.Map<string, { p: Props; at: [number, number] }>()
            for (const f of m.querySourceFeatures(SOURCE)) {
              const p = f.properties as Props
              const at = (f.geometry as GeoJSON.Point).coordinates as [number, number]
              seen.set(p.cluster ? `c${p.cluster_id}` : p.id, { p, at })
            }
            for (const [key, mk] of markers)
              if (!seen.has(key)) {
                mk.remove()
                markers.delete(key)
              }
            for (const [key, { p, at }] of seen) {
              if (markers.has(key)) continue
              let cover = p
              if (p.cluster) {
                if (!covers.has(p.cluster_id!)) {
                  const [leaf] = await src.getClusterLeaves(p.cluster_id!, 1, 0)
                  if (gone) return
                  if (leaf) covers.set(p.cluster_id!, leaf.properties as Props)
                }
                cover = covers.get(p.cluster_id!) ?? p
              }
              if (markers.has(key)) continue
              const el = pin(p.cluster ? p.point_count! : 1, thumbSrc(cover))
              el.addEventListener("click", async () => {
                const leaves = p.cluster ? await src.getClusterLeaves(p.cluster_id!, 1000, 0) : []
                const ids = new Set(p.cluster ? leaves.map((l) => (l.properties as Props).id) : [p.id])
                const coords = p.cluster ? leaves.map((l) => (l.geometry as GeoJSON.Point).coordinates) : [at]
                // Padded: maplibre's worker hands back coordinates rounded in the last digits.
                const pad = 1e-5
                const w = Math.min(...coords.map((c) => c[0])) - pad
                const e = Math.max(...coords.map((c) => c[0])) + pad
                const s = Math.min(...coords.map((c) => c[1])) - pad
                const n = Math.max(...coords.map((c) => c[1])) + pad
                const res = await getPlaceItems([w, s, e, n].join(",")).catch(() => null)
                if (!res) return
                const items = res.items.filter((i) => ids.has(i.id))
                setSheet({ items, total: Math.max(ids.size, items.length) })
              })
              markers.set(key, new ml.Marker({ element: el }).setLngLat(at).addTo(m))
            }
          }
          m.on("render", () => {
            if (m.isSourceLoaded(SOURCE)) void sync()
          })
        })
        setState("ready")
      } catch {
        setState("failed")
      }
    })()
    return () => {
      gone = true
      for (const mk of markers.values()) mk.remove()
      map?.remove()
    }
  }, [styleUrl])

  const shown = sheet && open !== null ? sheet.items[open] : null
  const step = (by: number) => () => open !== null && setOpen(open + by)

  return (
    <div className="flex min-h-[calc(100svh-10rem)] flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Places</h1>
        <p className="text-sm text-muted-foreground tabular-nums">
          {state === "ready" ? `${count.toLocaleString()} photos with a location` : "Your photos on a map"}
        </p>
      </div>
      <PhotoChips active="places" mapOn />
      {state === "empty" || state === "failed" ? (
        <div className="grid flex-1 place-items-center text-center">
          <div className="max-w-sm space-y-1">
            <MapPinIcon weight="light" className="mx-auto size-10 text-muted-foreground" />
            <p className="font-medium">
              {state === "empty" ? "No photos with a location yet" : "Can't show the map"}
            </p>
            <p className="text-sm text-muted-foreground">
              {state === "empty"
                ? "Photos taken with location on show up here. Reading locations runs in the background, so new uploads can take a few minutes."
                : "This browser couldn't start the map. Check that WebGL is on and that the map style loads."}
            </p>
          </div>
        </div>
      ) : (
        <div className="relative isolate min-h-96 flex-1 overflow-hidden rounded-xl border bg-muted/30" data-testid="places-map">
          {/* maplibre's CSS makes its container position: relative, so the box sizes it from outside. */}
          <div className="absolute inset-0">
            <div ref={box} className="size-full" role="region" aria-label="Map of your photos" />
          </div>
          {sheet && (
            <aside
              aria-label="Photos here"
              className="absolute inset-x-0 bottom-0 z-10 flex max-h-[55%] flex-col rounded-t-xl border-t bg-popover text-popover-foreground shadow-lg sm:inset-y-0 sm:right-0 sm:left-auto sm:max-h-none sm:w-96 sm:rounded-none sm:border-t-0 sm:border-l"
              onKeyDown={(e) => e.key === "Escape" && !shown && setSheet(null)}
            >
              <header className="flex items-center gap-2 border-b px-4 py-2">
                <h2 className="flex-1 text-sm font-medium tabular-nums">
                  {sheet.total} {sheet.total === 1 ? "photo" : "photos"}
                  {sheet.items.length < sheet.total && ` (newest ${sheet.items.length})`}
                </h2>
                <Button variant="ghost" size="icon-sm" aria-label="Close photos" onClick={() => setSheet(null)}>
                  <XIcon />
                </Button>
              </header>
              <ul className="grid grid-cols-3 gap-1 overflow-y-auto p-1">
                {sheet.items.map((p, i) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      aria-label={p.name}
                      onClick={() => setOpen(i)}
                      className="relative block aspect-square w-full overflow-hidden rounded-md bg-muted/40 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      <Thumb item={p} make={false} className="absolute inset-0">
                        <ImageIcon weight="light" className="absolute inset-0 m-auto size-6 text-muted-foreground" />
                      </Thumb>
                    </button>
                  </li>
                ))}
              </ul>
            </aside>
          )}
        </div>
      )}
      <Previewer
        shown={shown ? { item: shown } : null}
        open={shown != null}
        onClose={() => setOpen(null)}
        onPrev={open ? step(-1) : undefined}
        onNext={sheet && open !== null && open < sheet.items.length - 1 ? step(1) : undefined}
        position={shown && sheet ? `${open! + 1} of ${sheet.items.length}` : undefined}
        editable={canEditItem(shown)}
      />
    </div>
  )
}
