import type { PasskeyItem } from "@nimbus/shared/api"
import { Fingerprint, PencilSimple, Plus, Trash } from "phosphor-react-native"
import { useState } from "react"
import { View } from "react-native"

import { ConfirmDialog, PromptDialog } from "@/components/dialog"
import { Group, Loaded, Page, Row } from "@/components/page"
import { useSnack } from "@/components/snackbar"
import { Button, IconButton, Text } from "@/components/ui"
import { errorText } from "@/lib/api"
import { useAccountData, useApi, useAuthCall, useFileActions } from "@/lib/files"
import { addPasskey, passkeysSupported } from "@/lib/passkeys"
import { c } from "@/lib/theme"

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" })

// Better Auth asks for a sign-in from the last day before it adds a passkey.
const addError = (e: unknown) => (/not fresh/i.test(errorText(e)) ? "Sign out and back in, then add the passkey." : errorText(e))

export default function Passkeys() {
  const api = useApi()
  const account = useAccountData()
  const auth = useAuthCall()
  const actions = useFileActions()
  const snack = useSnack()
  const [adding, setAdding] = useState(false)
  const [renaming, setRenaming] = useState<PasskeyItem | null>(null)
  const [removing, setRemoving] = useState<PasskeyItem | null>(null)

  return (
    <Page title="Passkeys">
      <Loaded query={account}>
        {({ passkeys }) => {
          if (!passkeys.available) return <Text color={c.mutedForeground}>{passkeys.reason}</Text>
          if (!passkeysSupported) return <Text color={c.mutedForeground}>This version of the app can&apos;t use passkeys. Update the app.</Text>
          return (
            <>
              <Text variant="bodySmall" color={c.mutedForeground}>
                Sign in with your fingerprint, face or screen lock instead of a password. A passkey also stands in for the two-factor code.
              </Text>
              <Group>
                {passkeys.items.map((p) => (
                  <Row
                    key={p.id}
                    label={p.name}
                    detail={`Added ${day(p.createdAt)}`}
                    icon={<Fingerprint size={24} color={c.mutedForeground} />}
                    trailing={
                      <View style={{ flexDirection: "row" }}>
                        <IconButton icon={PencilSimple} label={`Rename ${p.name}`} onPress={() => setRenaming(p)} />
                        <IconButton icon={Trash} label={`Remove ${p.name}`} color={c.destructive} onPress={() => setRemoving(p)} />
                      </View>
                    }
                  />
                ))}
              </Group>
              <View style={{ alignSelf: "flex-start" }}>
                <Button label="Add a passkey" icon={<Plus size={18} color={c.primaryForeground} />} onPress={() => setAdding(true)} />
              </View>
            </>
          )
        }}
      </Loaded>

      {adding && (
        <PromptDialog
          title="Add a passkey"
          label="Name"
          initial="This phone"
          confirm="Continue"
          onClose={() => setAdding(false)}
          onSubmit={async (name) => {
            try {
              if (await addPasskey(api.account.server, api.account.token, name)) {
                actions.refresh()
                snack({ text: "Passkey added." })
              }
            } catch (e) {
              return addError(e)
            }
          }}
        />
      )}
      {renaming && (
        <PromptDialog
          title="Rename passkey"
          label="Name"
          initial={renaming.name}
          confirm="Save"
          onClose={() => setRenaming(null)}
          onSubmit={async (name) => {
            try {
              await auth("/api/auth/passkey/update-passkey", { id: renaming.id, name })
              actions.refresh()
            } catch (e) {
              return errorText(e)
            }
          }}
        />
      )}
      {removing && (
        <ConfirmDialog
          title={`Remove “${removing.name}”?`}
          body="You won't be able to sign in with it any more."
          confirm="Remove"
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            try {
              await auth("/api/auth/passkey/delete-passkey", { id: removing.id })
              actions.refresh()
              snack({ text: `Removed “${removing.name}”.` })
            } catch (e) {
              snack({ text: errorText(e), error: true })
            }
          }}
        />
      )}
    </Page>
  )
}
