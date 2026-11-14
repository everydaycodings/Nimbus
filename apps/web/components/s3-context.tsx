"use client"

import { createContext, useContext } from "react"

// Whether this member can use folders as S3 buckets (the app layout fills it
// in): folder menus only offer it when they can.
const S3Context = createContext(false)
export const S3Provider = ({
  enabled,
  children,
}: {
  enabled: boolean
  children: React.ReactNode
}) => <S3Context.Provider value={enabled}>{children}</S3Context.Provider>
export const useS3Enabled = () => useContext(S3Context)
