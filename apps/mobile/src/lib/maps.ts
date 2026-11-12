import { TurboModuleRegistry } from "react-native"

// MapLibre is native code, so Expo Go and APKs from before Phase 15 don't have it. Nothing imports the library
// until a screen asks, so those never evaluate it.
export const mapsAvailable = (() => {
  try {
    return TurboModuleRegistry.get("MLRNMapViewModule") != null
  } catch {
    return false
  }
})()

// eslint-disable-next-line @typescript-eslint/no-require-imports
export const loadMaps = () => require("@maplibre/maplibre-react-native") as typeof import("@maplibre/maplibre-react-native")
