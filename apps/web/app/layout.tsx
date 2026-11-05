import type { Metadata, Viewport } from "next"
import { Geist, Geist_Mono } from "next/font/google"

import "./globals.css"
import { cn } from "@/lib/utils"

const fontSans = Geist({ subsets: ["latin"], variable: "--font-sans" })

// Mono is for data only: sizes, hashes, paths, code previews.
const fontMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" })

export const metadata: Metadata = {
  title: "Nimbus",
  description: "Open-source, self-hosted file storage you own.",
}

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
  colorScheme: "dark",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={cn("dark antialiased", fontSans.variable, fontMono.variable)}
    >
      {/* Extensions like Grammarly stamp attributes on body before React loads. */}
      <body suppressHydrationWarning>{children}</body>
    </html>
  )
}
