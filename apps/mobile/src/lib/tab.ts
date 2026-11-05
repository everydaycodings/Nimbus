import { createContext, use } from "react"

// Which tab's stack a shared screen is in. `useSegments` can't tell: it follows
// the focused route, not the clone this screen belongs to.
export type TabGroup = "(files)" | "(recent)" | "(shared)" | "(starred)"

export const TabContext = createContext<TabGroup>("(files)")
export const useTab = () => use(TabContext)

export const folderHref = (tab: TabGroup, id: string) => `/(tabs)/${tab}/folder/${id}` as const
export const homeHref = (tab: TabGroup) => `/(tabs)/${tab}/home` as const
