import { useLocalSearchParams } from "expo-router"

import { Browser } from "@/components/browser"

export default function TagScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  return <Browser source={{ kind: "tag", id }} />
}
