import { useLocalSearchParams } from "expo-router"

import { Browser } from "@/components/browser"

export default function FolderScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>()
  return <Browser source={{ kind: "folder", id }} name={name} />
}
