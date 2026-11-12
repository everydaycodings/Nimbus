// The sleep timer's choices, shared by the video settings and the audio player.
import { Check } from "phosphor-react-native"

import { PromptDialog } from "@/components/dialog"
import { SheetRow } from "@/components/sheet"
import { Text } from "@/components/ui"
import type { Sleep } from "@/lib/playback"
import { customMinutes, SLEEP_MINUTES } from "@/lib/playback-rules"
import { c } from "@/lib/theme"

export const sleepDetail = (sleep: Sleep, endLabel: string) =>
  sleep === null ? "Off" : sleep === "end" ? endLabel : `Pauses in ${Math.max(1, Math.round((sleep - Date.now()) / 60_000))} min`

export function SleepRows({ sleep, endLabel, onSleep, onCustom }: { sleep: Sleep; endLabel: string; onSleep: (s: Sleep) => void; onCustom: () => void }) {
  const tick = (on: boolean) => (on ? <Check size={20} color={c.brand} weight="bold" /> : undefined)
  return (
    <>
      <SheetRow label="Off" selected={sleep === null} trailing={tick(sleep === null)} onPress={() => onSleep(null)} />
      {SLEEP_MINUTES.map((m) => <SheetRow key={m} label={`${m} minutes`} onPress={() => onSleep(Date.now() + m * 60_000)} />)}
      <SheetRow label="Custom…" onPress={onCustom} />
      <SheetRow label={endLabel} selected={sleep === "end"} trailing={tick(sleep === "end")} onPress={() => onSleep("end")} />
    </>
  )
}

export function CustomSleep({ onSet, onClose }: { onSet: (minutes: number) => void; onClose: () => void }) {
  return (
    <PromptDialog
      title="Sleep timer"
      label="Minutes"
      confirm="Start"
      canSubmit={(v) => customMinutes(v) !== null}
      onSubmit={async (v) => onSet(customMinutes(v)!)}
      onClose={onClose}
    >
      <Text variant="caption" color={c.mutedForeground}>Playback fades out over the last 10 seconds.</Text>
    </PromptDialog>
  )
}
