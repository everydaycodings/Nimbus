import type { DocType } from "@nimbus/shared/documents-api"
import { DotsThreeVertical, PencilSimple, Plus, Trash } from "phosphor-react-native"
import { useState } from "react"

import { Actions, ConfirmDialog, Frame } from "@/components/dialog"
import { Group, Loaded, Page, Row } from "@/components/page"
import { Sheet, SheetRow } from "@/components/sheet"
import { useSnack } from "@/components/snackbar"
import { Button, Field, Text } from "@/components/ui"
import { useDocActions, useDocTypes } from "@/lib/documents"
import { c } from "@/lib/theme"

const remind = (t: DocType) => (t.remindDays == null ? "Never reminds" : `Reminds ${t.remindDays} days before`)

type Open = { kind: "menu"; t: DocType } | { kind: "edit"; t?: DocType } | { kind: "delete"; t: DocType }

export default function Types() {
  const q = useDocTypes()
  const actions = useDocActions()
  const snack = useSnack()
  const [open, setOpen] = useState<Open | null>(null)
  const close = () => setOpen(null)
  return (
    <Page title="Types" trailing={<Button variant="text" label="New type" icon={<Plus size={18} color={c.foreground} />} onPress={() => setOpen({ kind: "edit" })} />}>
      <Loaded query={q}>
        {(types) => (
          <Group>
            {types.map((t) =>
              t.preset ? (
                <Row key={t.id} label={t.name} detail={`${remind(t)} · Built in`} />
              ) : (
                <Row
                  key={t.id}
                  label={t.name}
                  detail={remind(t)}
                  onPress={() => setOpen({ kind: "menu", t })}
                  trailing={<DotsThreeVertical size={22} weight="bold" color={c.mutedForeground} />}
                />
              )
            )}
          </Group>
        )}
      </Loaded>
      <Text variant="bodySmall" color={c.mutedForeground}>A document can override its type&apos;s lead time in its details.</Text>
      {open?.kind === "menu" && (
        <Sheet onClose={close}>
          <SheetRow label="Edit" icon={<PencilSimple size={24} color={c.mutedForeground} />} onPress={() => setOpen({ kind: "edit", t: open.t })} />
          <SheetRow label="Delete" danger needsNet icon={<Trash size={24} color={c.destructive} />} onPress={() => setOpen({ kind: "delete", t: open.t })} />
        </Sheet>
      )}
      {open?.kind === "edit" && (
        <TypeDialog
          t={open.t}
          onClose={close}
          onSave={(name, remindDays) => (open.t ? actions.editType(open.t.id, { name, remindDays }) : actions.addType({ name, remindDays }))}
        />
      )}
      {open?.kind === "delete" && (
        <ConfirmDialog
          title={`Delete “${open.t.name}”?`}
          body="Documents with this type keep their other details and have no type."
          confirm="Delete type"
          onClose={close}
          onConfirm={async () => {
            const err = await actions.deleteType(open.t.id)
            snack(err ? { text: err, error: true } : { text: "Type deleted." })
          }}
        />
      )}
    </Page>
  )
}

function TypeDialog({ t, onClose, onSave }: { t?: DocType; onClose: () => void; onSave: (name: string, days: number | null) => Promise<string | void> }) {
  const [name, setName] = useState(t?.name ?? "")
  const [days, setDays] = useState(t?.remindDays == null ? "" : String(t.remindDays))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const bad = days.trim() !== "" && !/^\d{1,4}$/.test(days.trim())
  const submit = async () => {
    setBusy(true)
    const err = await onSave(name.trim(), days.trim() ? Number(days) : null)
    setBusy(false)
    if (err) setError(err)
    else onClose()
  }
  return (
    <Frame title={t ? "Edit type" : "New type"} onClose={onClose}>
      <Field label="Name" value={name} onChangeText={setName} autoFocus autoCapitalize="sentences" />
      <Field label="Remind before (days)" value={days} onChangeText={setDays} keyboardType="number-pad" placeholder="Never" hint="Leave empty for no reminders." error={bad ? "A whole number of days." : error} />
      <Actions>
        <Button variant="text" label="Cancel" onPress={onClose} />
        <Button label="Save" busy={busy} disabled={!name.trim() || bad} onPress={submit} />
      </Actions>
    </Frame>
  )
}
