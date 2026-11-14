"use client"

import { CheckCircleIcon, CopyIcon } from "@phosphor-icons/react"
import { useState } from "react"

import { Button } from "@/components/ui/button"

// A code block with a Copy button.
export function CodeBlock({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  return (
    <div className="group relative min-w-0 rounded-lg border bg-muted/50">
      <Button
        variant="ghost"
        size="icon-sm"
        className="absolute top-1 right-1"
        aria-label="Copy code"
        onClick={() =>
          navigator.clipboard
            .writeText(text)
            .then(() => (setDone(true), setTimeout(() => setDone(false), 1500)))
            .catch(() => {})
        }
      >
        {done ? <CheckCircleIcon /> : <CopyIcon />}
      </Button>
      <pre tabIndex={0} className="overflow-x-auto py-3 pr-11 pl-3 font-mono text-xs leading-relaxed">
        <code>{text}</code>
      </pre>
    </div>
  )
}
