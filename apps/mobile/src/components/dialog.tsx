import { useState, type ReactNode } from "react"
import { KeyboardAvoidingView, Modal, Pressable, View } from "react-native"

import { Button, Field, Text } from "@/components/ui"
import { c, radius } from "@/lib/theme"

export function Frame({ onClose, title, children }: { onClose: () => void; title: string; children: ReactNode }) {
  return (
    <Modal transparent statusBarTranslucent navigationBarTranslucent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1, justifyContent: "center", padding: 24, backgroundColor: "rgba(0,0,0,0.6)" }}>
        <Pressable style={{ position: "absolute", inset: 0 }} accessibilityLabel="Close" onPress={onClose} />
        <View
          accessibilityViewIsModal
          style={{ alignSelf: "center", width: "100%", maxWidth: 420, gap: 16, padding: 24, backgroundColor: c.card, borderColor: c.border, borderWidth: 1, borderRadius: radius.sheet }}
        >
          <Text variant="title">{title}</Text>
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

export const Actions = ({ children }: { children: ReactNode }) => (
  <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>{children}</View>
)

// Asks before something that can't be undone.
export function ConfirmDialog({
  title,
  body,
  confirm,
  danger = true,
  onConfirm,
  onClose,
}: {
  title: string
  body: string
  confirm: string
  danger?: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Frame title={title} onClose={onClose}>
      <Text color={c.mutedForeground}>{body}</Text>
      <Actions>
        <Button variant="text" label="Cancel" onPress={onClose} />
        <Button
          variant="text"
          danger={danger}
          label={confirm}
          onPress={() => {
            onClose()
            onConfirm()
          }}
        />
      </Actions>
    </Frame>
  )
}

// One text field. onSubmit returns an error to show, or nothing when it worked.
// `selectEnd` preselects the start of the text, so a rename can leave the extension alone.
export function PromptDialog({
  title,
  label,
  initial = "",
  confirm,
  selectEnd,
  secret,
  children,
  canSubmit,
  onSubmit,
  onClose,
}: {
  title: string
  label: string
  initial?: string
  confirm: string
  selectEnd?: number
  secret?: boolean
  children?: ReactNode
  canSubmit?: (value: string) => boolean
  onSubmit: (value: string) => Promise<string | void>
  onClose: () => void
}) {
  const [value, setValue] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [selection, setSelection] = useState(selectEnd === undefined ? undefined : { start: 0, end: selectEnd })
  const ok = canSubmit ? canSubmit(value) : !!value.trim()
  const submit = async () => {
    if (!ok || busy) return
    setBusy(true)
    setError(null)
    const problem = await onSubmit(value.trim())
    setBusy(false)
    if (problem) setError(problem)
    else onClose()
  }
  return (
    <Frame title={title} onClose={onClose}>
      <Field
        label={label}
        value={value}
        autoFocus
        secret={secret}
        error={error}
        selection={selection}
        returnKeyType="done"
        onChangeText={(v) => {
          setValue(v)
          setSelection(undefined)
        }}
        onSelectionChange={() => setSelection(undefined)}
        onSubmitEditing={submit}
      />
      {children}
      <Actions>
        <Button variant="text" label="Cancel" onPress={onClose} />
        <Button label={confirm} busy={busy} disabled={!ok} onPress={submit} />
      </Actions>
    </Frame>
  )
}
