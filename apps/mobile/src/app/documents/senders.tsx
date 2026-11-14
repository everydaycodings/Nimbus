import type { DocSender } from "@nimbus/shared/documents-api"
import { ArrowsMerge, DotsThreeVertical, PencilSimple, Trash } from "phosphor-react-native"
import { useState } from "react"

import { ConfirmDialog, PromptDialog } from "@/components/dialog"
import { Group, Loaded, Page, Row } from "@/components/page"
import { Sheet, SheetRow } from "@/components/sheet"
import { useSnack } from "@/components/snackbar"
import { Text } from "@/components/ui"
import { useDocActions, useDocSenders } from "@/lib/documents"
import { c } from "@/lib/theme"

type Open = { kind: "menu" | "rename" | "delete" | "pick"; s: DocSender } | { kind: "merge"; s: DocSender; into: DocSender }

export default function Senders() {
  const q = useDocSenders()
  const actions = useDocActions()
  const snack = useSnack()
  const [open, setOpen] = useState<Open | null>(null)
  const close = () => setOpen(null)
  const told = (err: string | void, text: string) => snack(err ? { text: err, error: true } : { text })
  return (
    <Page title="Senders">
      <Text variant="bodySmall" color={c.mutedForeground}>Nimbus learns senders from your documents. Merge two names that mean the same sender.</Text>
      <Loaded query={q}>
        {(senders) =>
          senders.length ? (
            <Group>
              {senders.map((s) => (
                <Row
                  key={s.id}
                  label={s.name}
                  detail={`${s.count} ${s.count === 1 ? "document" : "documents"}`}
                  onPress={() => setOpen({ kind: "menu", s })}
                  trailing={<DotsThreeVertical size={22} weight="bold" color={c.mutedForeground} />}
                />
              ))}
            </Group>
          ) : (
            <Text color={c.mutedForeground}>No senders yet. They show up as Nimbus reads your documents.</Text>
          )
        }
      </Loaded>
      {open?.kind === "menu" && (
        <Sheet onClose={close}>
          <SheetRow label="Rename" needsNet icon={<PencilSimple size={24} color={c.mutedForeground} />} onPress={() => setOpen({ kind: "rename", s: open.s })} />
          <SheetRow label="Merge into another" needsNet icon={<ArrowsMerge size={24} color={c.mutedForeground} />} onPress={() => setOpen({ kind: "pick", s: open.s })} />
          <SheetRow label="Delete" danger needsNet icon={<Trash size={24} color={c.destructive} />} onPress={() => setOpen({ kind: "delete", s: open.s })} />
        </Sheet>
      )}
      {open?.kind === "rename" && <PromptDialog title="Rename sender" label="Name" initial={open.s.name} confirm="Rename" onClose={close} onSubmit={(name) => actions.renameSender(open.s.id, name)} />}
      {open?.kind === "pick" && (
        <Sheet onClose={close}>
          {(q.data ?? []).filter((x) => x.id !== open.s.id).map((x) => <SheetRow key={x.id} label={x.name} detail={`${x.count} documents`} onPress={() => setOpen({ kind: "merge", s: open.s, into: x })} />)}
        </Sheet>
      )}
      {open?.kind === "merge" && (
        <ConfirmDialog
          title={`Merge into “${open.into.name}”?`}
          body={`Documents from “${open.s.name}” go to “${open.into.name}”, and “${open.s.name}” is removed.`}
          confirm="Merge"
          danger={false}
          onClose={close}
          onConfirm={async () => told(await actions.mergeSender(open.s.id, open.into.id), "Senders merged.")}
        />
      )}
      {open?.kind === "delete" && (
        <ConfirmDialog
          title={`Delete “${open.s.name}”?`}
          body="Its documents keep their other details and have no sender."
          confirm="Delete sender"
          onClose={close}
          onConfirm={async () => told(await actions.deleteSender(open.s.id), "Sender deleted.")}
        />
      )}
    </Page>
  )
}
