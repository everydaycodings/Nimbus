"use client"

import "@xterm/xterm/css/xterm.css"

import { ArrowClockwiseIcon, ClipboardTextIcon, CopyIcon } from "@phosphor-icons/react"
import { useCallback, useEffect, useRef, useState } from "react"

import { api, errorText } from "@/components/secrets/client"
import { Modal } from "@/components/secrets/ui"
import { Button } from "@/components/ui/button"
import type { Terminal } from "@xterm/xterm"

type Phase = "connecting" | "ready" | "closed"

// A shell on a saved host: xterm.js here, a WebSocket to the terminal sidecar
// (scripts/ssh-terminal.ts), ssh2 there. Each connect asks the app for a one-use ticket.
export function SshTerminal({ projectId, host, onClose }: { projectId: string; host: { id: string; name: string }; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null)
  const term = useRef<Terminal | null>(null)
  const ws = useRef<WebSocket | null>(null)
  const fit = useRef<{ fit: () => void } | null>(null)
  const [phase, setPhase] = useState<Phase>("connecting")
  const [note, setNote] = useState("Starting…")
  const [failed, setFailed] = useState(false)

  const connect = useCallback(async () => {
    const t = term.current
    if (!t) return
    setPhase("connecting")
    setFailed(false)
    setNote("Starting…")
    t.reset()
    try {
      const r = await api<{ ticket: string; url: string }>(`/projects/${projectId}/ssh/hosts/${host.id}/terminal`, "POST")
      const sock = new WebSocket(r.url)
      sock.binaryType = "arraybuffer"
      ws.current = sock
      sock.onopen = () => sock.send(JSON.stringify({ type: "open", ticket: r.ticket, cols: t.cols, rows: t.rows }))
      sock.onmessage = (m) => {
        if (typeof m.data !== "string") return t.write(new Uint8Array(m.data as ArrayBuffer))
        const j = JSON.parse(m.data) as { type: string; message?: string }
        if (j.type === "status") setNote(j.message ?? "")
        else if (j.type === "ready") {
          setPhase("ready")
          setNote("Connected")
          t.focus()
        } else if (j.type === "error") {
          setFailed(true)
          setNote(j.message ?? "Couldn't connect.")
        }
      }
      sock.onclose = () => {
        setPhase("closed")
        setNote((n) => (n === "Connected" ? "Session ended." : n))
      }
    } catch (e) {
      setPhase("closed")
      setFailed(true)
      setNote(errorText(e))
    }
  }, [projectId, host.id])

  useEffect(() => {
    let dead = false
    let ro: ResizeObserver | undefined
    ;(async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([import("@xterm/xterm"), import("@xterm/addon-fit")])
      if (dead || !box.current) return
      const t = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        theme: { background: "#0e1116", foreground: "#d7dde6", cursor: "#d7dde6" },
        scrollback: 5000,
      })
      const f = new FitAddon()
      t.loadAddon(f)
      t.open(box.current)
      f.fit()
      term.current = t
      fit.current = f
      const enc = new TextEncoder()
      t.onData((d) => ws.current?.readyState === 1 && ws.current.send(enc.encode(d)))
      t.onResize(({ cols, rows }) => ws.current?.readyState === 1 && ws.current.send(JSON.stringify({ type: "resize", cols, rows })))
      ro = new ResizeObserver(() => f.fit())
      ro.observe(box.current)
      connect()
    })()
    return () => {
      dead = true
      ro?.disconnect()
      ws.current?.close()
      term.current?.dispose()
      term.current = null
    }
  }, [connect])

  return (
    <Modal title={`Terminal: ${host.name}`} onClose={onClose} wide>
      <div className="flex flex-wrap items-center gap-2">
        <p role="status" aria-live="polite" className={failed ? "flex-1 text-sm text-destructive" : "flex-1 text-sm text-muted-foreground"} data-testid="term-status">
          {note}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const s = term.current?.getSelection()
            if (s) navigator.clipboard.writeText(s)
          }}
        >
          <CopyIcon />
          Copy selection
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            try {
              term.current?.paste(await navigator.clipboard.readText())
            } catch {}
            term.current?.focus()
          }}
        >
          <ClipboardTextIcon />
          Paste
        </Button>
        {phase === "closed" && (
          <Button size="sm" onClick={() => { ws.current?.close(); connect() }}>
            <ArrowClockwiseIcon />
            Reconnect
          </Button>
        )}
      </div>
      <div ref={box} data-testid="term-box" className="h-[min(26rem,60dvh)] w-full overflow-hidden rounded-lg bg-[#0e1116] p-2" />
    </Modal>
  )
}
