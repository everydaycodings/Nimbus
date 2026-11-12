import type { PlacePoint } from "@nimbus/shared/api"

// west, south, east, north
export type Box = [number, number, number, number]

export const boxOf = (coords: [number, number][]): Box =>
  coords.reduce<Box>((b, [lng, lat]) => [Math.min(b[0], lng), Math.min(b[1], lat), Math.max(b[2], lng), Math.max(b[3], lat)], [180, 90, -180, -90])

// A few metres of room, so one photo's own point is inside its box.
export const pad = (b: Box, by = 0.0005): Box => [b[0] - by, b[1] - by, b[2] + by, b[3] + by]

// Where the map first looks: the box of all photos, or the one point (a box of nothing can't be fitted).
export function startView(points: Pick<PlacePoint, "lat" | "lng">[]): { bounds: Box } | { center: [number, number]; zoom: number } {
  if (!points.length) return { center: [0, 20], zoom: 1 }
  const b = boxOf(points.map((p) => [p.lng, p.lat]))
  if (b[0] === b[2] && b[1] === b[3]) return { center: [b[0], b[1]], zoom: 10 }
  return { bounds: b }
}

export const boxQuery = (b: Box) => b.map((n) => n.toFixed(6)).join(",")
