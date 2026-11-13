"use client"

import { createContext, useContext } from "react"

import type { AiFlags } from "@nimbus/shared/api"

const OFF: AiFlags = { speech: false, picture: false, faces: false, facesOn: false }
const AiContext = createContext<AiFlags>(OFF)

// Which AI features are on for me (the app layout fills it in); everything is off outside it.
export const AiProvider = ({ flags, children }: { flags: AiFlags; children: React.ReactNode }) => (
  <AiContext.Provider value={flags}>{children}</AiContext.Provider>
)
export const useAi = () => useContext(AiContext)
