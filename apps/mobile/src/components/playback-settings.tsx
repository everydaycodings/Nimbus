// A setting with a few choices, as a row and the sheet it opens. Used for the playback settings.
import { useState } from "react"
import { View } from "react-native"

import { Row } from "@/components/page"
import { Sheet, SheetRow } from "@/components/sheet"
import { Text } from "@/components/ui"
import { c } from "@/lib/theme"

export function ChoiceRow<T extends string | number>({ label, detail, options, get, set }: { label: string; detail: string; options: { value: T; label: string }[]; get: () => T; set: (v: T) => void }) {
  const [value, setValue] = useState(get)
  const [open, setOpen] = useState(false)
  return (
    <>
      <Row label={label} detail={detail} trailing={<Text color={c.mutedForeground}>{options.find((o) => o.value === value)?.label}</Text>} onPress={() => setOpen(true)} />
      {open && (
        <Sheet onClose={() => setOpen(false)} header={<View style={{ paddingHorizontal: 20, paddingBottom: 8 }}><Text variant="titleSmall">{label}</Text></View>}>
          {options.map((o) => (
            <SheetRow
              key={String(o.value)}
              label={o.label}
              selected={o.value === value}
              trailing={o.value === value ? <Text color={c.brand}>Current</Text> : undefined}
              onPress={() => {
                set(o.value)
                setValue(o.value)
              }}
            />
          ))}
        </Sheet>
      )}
    </>
  )
}
