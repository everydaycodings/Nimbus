"use client"

import { CheckIcon, CopyIcon } from "@phosphor-icons/react"
import { useState } from "react"

import { Button } from "@/components/ui/button"

export function CopyButton({ value, label, className, text = "Copy" }: { value: string; label?: string; className?: string; text?: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Button type="button" variant="outline" size="sm" className={className} aria-label={label} onClick={copy}>
      {copied ? <CheckIcon /> : <CopyIcon />}
      <span aria-live="polite">{copied ? "Copied" : text}</span>
    </Button>
  )
}
