import { Browser } from "@/components/browser"
import { useTab, type TabGroup } from "@/lib/tab"

const KIND = { "(files)": "files", "(recent)": "recent", "(shared)": "shared", "(starred)": "starred" } as const satisfies Record<TabGroup, string>

export default function Home() {
  return <Browser source={{ kind: KIND[useTab()] }} />
}
