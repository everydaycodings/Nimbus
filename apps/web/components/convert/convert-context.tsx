"use client"

import { createContext, useContext } from "react"

// Whether the Media converter is on (the app layout fills it in): file menus only offer Convert… when it is.
const ConvertContext = createContext(false)
export const ConvertProvider = ({ enabled, children }: { enabled: boolean; children: React.ReactNode }) => (
  <ConvertContext.Provider value={enabled}>{children}</ConvertContext.Provider>
)
export const useConvertEnabled = () => useContext(ConvertContext)
