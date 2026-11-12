import type { PhotoItem, PlacesItemsResponse } from "@nimbus/shared/api"
import { router } from "expo-router"
import { ArrowLeft } from "phosphor-react-native"
import { useMemo, useRef, useState } from "react"
import { View, useWindowDimensions } from "react-native"

import { GAP, PhotoTile } from "@/components/photo-grid"
import { Sheet } from "@/components/sheet"
import { useSnack } from "@/components/snackbar"
import { Bar, IconButton, Spinner, Text } from "@/components/ui"
import { errorText } from "@/lib/api"
import { useApi, useInstance } from "@/lib/files"
import { loadMaps, mapsAvailable } from "@/lib/maps"
import { boxOf, boxQuery, pad, startView } from "@/lib/places-rules"
import { usePlaces } from "@/lib/photos"
import { openPreview } from "@/lib/preview-session"
import { c } from "@/lib/theme"

type Result = { items: PhotoItem[]; total: number }

// The photos under a tapped pin or cluster, as a grid; a tile opens the previewer.
function PlaceSheet({ result, onClose }: { result: Result; onClose: () => void }) {
  const { account } = useApi()
  const { width } = useWindowDimensions()
  const perRow = 3
  const size = Math.floor((Math.min(width, 640) - GAP * (perRow - 1)) / perRow)
  return (
    <Sheet
      tall
      onClose={onClose}
      header={
        <View style={{ paddingHorizontal: 20, paddingBottom: 8 }}>
          <Text variant="titleSmall" accessibilityRole="header">{result.total} {result.total === 1 ? "photo" : "photos"} here</Text>
          {result.total > result.items.length && <Text variant="caption" color={c.mutedForeground}>Showing the newest {result.items.length}. Zoom in for the rest.</Text>}
        </View>
      }
    >
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: GAP }}>
        {result.items.map((p, i) => (
          <PhotoTile key={p.id} photo={p} size={size} account={account} onPress={() => (onClose(), openPreview({ items: result.items, index: i, role: "owner" }))} />
        ))}
      </View>
    </Sheet>
  )
}

function PlacesMap() {
  // Only reached when the native module is there, so the library is safe to load.
  const { Map: MapView, Camera, GeoJSONSource, Layer } = loadMaps()
  const api = useApi()
  const snack = useSnack()
  const instance = useInstance()
  const places = usePlaces(true)
  const source = useRef<React.ComponentRef<typeof GeoJSONSource>>(null)
  const [result, setResult] = useState<Result | null>(null)
  const points = places.data

  const data = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: (points ?? []).map((p) => ({ type: "Feature" as const, id: p.id, properties: { id: p.id }, geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] } })),
    }),
    [points]
  )
  const view = useMemo(() => startView(points ?? []), [points])
  const style = instance.data?.map?.styleUrl

  const show = async (box: ReturnType<typeof boxOf>) => {
    try {
      setResult(await api.get<PlacesItemsResponse>(`/photos/places?items=1&bbox=${boxQuery(pad(box))}`))
    } catch (e) {
      snack({ text: errorText(e), error: true })
    }
  }

  if (places.isPending || !style) return <Spinner />
  if (places.isError) return <Text color={c.mutedForeground} style={{ padding: 16 }}>{places.error.message}</Text>
  if (!points?.length)
    return (
      <View style={{ padding: 24, gap: 8 }}>
        <Text variant="titleSmall">No places yet</Text>
        <Text variant="bodySmall" color={c.mutedForeground}>Photos with a location show up on the map. New ones are read in the background, so give it a few minutes.</Text>
      </View>
    )

  return (
    <View style={{ flex: 1 }} accessibilityLabel="Map of your photos">
      <MapView mapStyle={style} style={{ flex: 1 }} compass={false}>
        <Camera initialViewState={"bounds" in view ? { bounds: view.bounds, padding: { top: 48, right: 48, bottom: 48, left: 48 } } : view} />
        <GeoJSONSource
          ref={source}
          id="photos"
          data={data}
          cluster
          clusterRadius={48}
          clusterMaxZoom={15}
          onPress={async (e) => {
            const f = e.nativeEvent.features[0]
            if (!f || f.geometry.type !== "Point") return
            const props = f.properties ?? {}
            if (props.cluster_id === undefined) {
              const [lng, lat] = f.geometry.coordinates
              return void show([lng, lat, lng, lat])
            }
            const leaves = await source.current?.getClusterLeaves(props.cluster_id, Math.min(Number(props.point_count) || 200, 5000), 0)
            const coords = (leaves ?? []).flatMap((l) => (l.geometry.type === "Point" ? [[l.geometry.coordinates[0], l.geometry.coordinates[1]] as [number, number]] : []))
            if (coords.length) show(boxOf(coords))
          }}
        >
          <Layer
            id="clusters"
            type="circle"
            filter={["has", "point_count"]}
            paint={{
              "circle-color": c.brand,
              "circle-opacity": 0.92,
              "circle-radius": ["step", ["get", "point_count"], 18, 10, 22, 100, 28, 1000, 34],
              "circle-stroke-width": 3,
              "circle-stroke-color": "#ffffff",
            }}
          />
          <Layer
            id="cluster-count"
            type="symbol"
            filter={["has", "point_count"]}
            layout={{ "text-field": ["get", "point_count_abbreviated"], "text-size": 13, "text-font": ["Noto Sans Bold"], "text-allow-overlap": true }}
            paint={{ "text-color": "#0a0a0a" }}
          />
          <Layer
            id="pins"
            type="circle"
            filter={["!", ["has", "point_count"]]}
            paint={{ "circle-color": c.brand, "circle-radius": 8, "circle-stroke-width": 3, "circle-stroke-color": "#ffffff" }}
          />
        </GeoJSONSource>
      </MapView>
      {result && <PlaceSheet result={result} onClose={() => setResult(null)} />}
    </View>
  )
}

export default function Places() {
  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <Bar>
        <IconButton icon={ArrowLeft} label="Back" onPress={() => router.back()} />
        <Text variant="title" numberOfLines={1} accessibilityRole="header" style={{ flex: 1 }}>Places</Text>
      </Bar>
      {mapsAvailable ? <PlacesMap /> : <Text color={c.mutedForeground} style={{ padding: 16 }}>The map needs the full Nimbus app. It isn&apos;t in Expo Go.</Text>}
    </View>
  )
}
