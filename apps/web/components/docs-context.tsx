"use client"

import { createContext, useContext } from "react"

// Whether the Documents section is on (the app layout fills it in): file menus and the previewer
// only offer document actions when it is.
const DocsContext = createContext(false)
export const DocsProvider = ({
  enabled,
  children,
}: {
  enabled: boolean
  children: React.ReactNode
}) => <DocsContext.Provider value={enabled}>{children}</DocsContext.Provider>
export const useDocsEnabled = () => useContext(DocsContext)
