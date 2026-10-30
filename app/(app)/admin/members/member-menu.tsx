"use client"

import { Dialog } from "@base-ui/react/dialog"
import { Menu } from "@base-ui/react/menu"
import {
  DotsThreeIcon,
  HardDrivesIcon,
  KeyIcon,
  LockKeyIcon,
  ShieldSlashIcon,
} from "@phosphor-icons/react"
import { useState, useTransition } from "react"

import { CopyButton } from "@/components/copy-button"
import {
  DIALOG_BACKDROP,
  DIALOG_POPUP,
  MENU_ITEM,
  MENU_POPUP,
} from "@/components/overlay-styles"
import { SubmitButton } from "@/components/submit-button"
import { FormError } from "@/components/two-factor"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formatBytes } from "@/lib/file-types"
import type { VaultSummary } from "@/lib/vault"
import {
  deleteMemberVault,
  resetTwoFactor,
  setMemberQuota,
  setMemberSpeed,
  setTemporaryPassword,
} from "./actions"

const GB = 2 ** 30
const MB = 2 ** 20

export function MemberMenu({
  id,
  name,
  twoFactor,
  quota,
  fallback,
  speed,
  speedFallback,
  vaults,
}: {
  id: string
  name: string
  twoFactor: boolean
  // Their own storage limit, and the instance default it falls back to.
  quota: number | null
  fallback: number | null
  // Their own web upload speed cap (bytes a second), and the default.
  speed: number | null
  speedFallback: number | null
  vaults: VaultSummary[]
}) {
  const [quotaOpen, setQuotaOpen] = useState(false)
  const [vaultOpen, setVaultOpen] = useState(false)
  // `kind` outlives `open` so the dialog's text doesn't change while it animates out.
  const [kind, setKind] = useState<"password" | "2fa">("password")
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function show(k: typeof kind) {
    setKind(k)
    setPassword(null)
    setError(null)
    setOpen(true)
  }

  const close = () => setOpen(false)

  function run() {
    setError(null)
    start(async () => {
      const res =
        kind === "password"
          ? await setTemporaryPassword(id)
          : await resetTwoFactor(id)
      if ("error" in res && res.error) return setError(res.error)
      if ("password" in res && res.password) return setPassword(res.password)
      close()
    })
  }

  return (
    <>
      <Menu.Root>
        <Menu.Trigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`More for ${name}`}
            />
          }
        >
          <DotsThreeIcon weight="bold" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner side="bottom" align="end" sideOffset={4}>
            <Menu.Popup className={`w-56 ${MENU_POPUP}`}>
              <Menu.Item className={MENU_ITEM} onClick={() => show("password")}>
                <KeyIcon />
                Set temporary password
              </Menu.Item>
              <Menu.Item
                className={MENU_ITEM}
                onClick={() => {
                  setError(null)
                  setQuotaOpen(true)
                }}
              >
                <HardDrivesIcon />
                Storage and speed…
              </Menu.Item>
              {twoFactor && (
                <Menu.Item className={MENU_ITEM} onClick={() => show("2fa")}>
                  <ShieldSlashIcon />
                  Reset two-factor
                </Menu.Item>
              )}
              {vaults.length > 0 && (
                <Menu.Item
                  className={MENU_ITEM}
                  onClick={() => setVaultOpen(true)}
                >
                  <LockKeyIcon />
                  Delete vault…
                </Menu.Item>
              )}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>

      <Dialog.Root open={open} onOpenChange={(o) => !o && !pending && close()}>
        <Dialog.Portal>
          <Dialog.Backdrop className={DIALOG_BACKDROP} />
          <Dialog.Popup className={DIALOG_POPUP}>
            <div className="grid gap-1.5">
              <Dialog.Title className="text-base font-semibold">
                {kind === "2fa"
                  ? `Reset two-factor for ${name}?`
                  : password
                    ? `Temporary password for ${name}`
                    : `Set a temporary password for ${name}?`}
              </Dialog.Title>
              <Dialog.Description className="text-sm text-muted-foreground">
                {kind === "2fa"
                  ? "Their authenticator app and backup codes stop working. They sign in with just their password, and set two-factor up again if your instance requires it."
                  : password
                    ? "Give it to them somewhere private. It's shown only once. They'll choose their own password right after signing in."
                    : "Their current password stops working and they're signed out on every device. You'll get a one-time password to pass on."}
              </Dialog.Description>
            </div>

            {password && (
              <div className="flex items-center gap-2">
                <code className="flex h-9 flex-1 items-center rounded-md border bg-input/20 px-3 font-mono text-sm tracking-wide select-all">
                  {password}
                </code>
                <CopyButton value={password} />
              </div>
            )}

            <FormError>{error}</FormError>

            <div className="flex justify-end gap-2">
              {password ? (
                <Button onClick={close}>Done</Button>
              ) : (
                <>
                  <Dialog.Close
                    disabled={pending}
                    render={<Button variant="outline" />}
                  >
                    Cancel
                  </Dialog.Close>
                  <SubmitButton
                    type="button"
                    variant={kind === "2fa" ? "destructive" : "default"}
                    onClick={run}
                    pending={pending}
                  >
                    {kind === "2fa" ? "Reset two-factor" : "Set password"}
                  </SubmitButton>
                </>
              )}
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root
        open={quotaOpen}
        onOpenChange={(o) => !o && !pending && setQuotaOpen(false)}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className={DIALOG_BACKDROP} />
          <Dialog.Popup className={DIALOG_POPUP}>
            <div className="grid gap-1.5">
              <Dialog.Title className="text-base font-semibold">
                Storage for {name}
              </Dialog.Title>
              <Dialog.Description className="text-sm text-muted-foreground">
                Counts their files, older versions and trash. Leave it blank to
                use the default
                {fallback === null
                  ? " (unlimited)."
                  : ` (${formatBytes(fallback)}).`}
              </Dialog.Description>
            </div>
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault()
                const form = new FormData(e.currentTarget)
                const raw = String(form.get("gb") ?? "").trim()
                const mbs = String(form.get("mbs") ?? "").trim()
                setError(null)
                start(async () => {
                  const res = await setMemberQuota(
                    id,
                    raw ? Number(raw) * GB : null
                  )
                  if ("error" in res && res.error) return setError(res.error)
                  const sped = await setMemberSpeed(
                    id,
                    mbs ? Number(mbs) * MB : null
                  )
                  if ("error" in sped && sped.error) return setError(sped.error)
                  setQuotaOpen(false)
                })
              }}
            >
              <div className="grid gap-2">
                <Label htmlFor={`quota-${id}`}>Storage in GB</Label>
                <Input
                  id={`quota-${id}`}
                  name="gb"
                  type="number"
                  min={0.01}
                  step="any"
                  defaultValue={quota === null ? "" : +(quota / GB).toFixed(2)}
                  placeholder="Use the default"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor={`speed-${id}`}>Upload speed in MB/s</Label>
                <Input
                  id={`speed-${id}`}
                  name="mbs"
                  type="number"
                  min={0.01}
                  step="any"
                  defaultValue={speed === null ? "" : +(speed / MB).toFixed(2)}
                  placeholder="Use the default"
                  aria-describedby={`speed-hint-${id}`}
                />
                <p
                  id={`speed-hint-${id}`}
                  className="text-xs text-muted-foreground"
                >
                  Caps the web uploader only; WebDAV and file-drop links
                  aren&apos;t capped. Blank uses the default
                  {speedFallback === null
                    ? " (no cap)."
                    : ` (${formatBytes(speedFallback)}/s).`}
                </p>
              </div>
              <FormError>{error}</FormError>
              <div className="flex justify-end gap-2">
                <Dialog.Close
                  disabled={pending}
                  render={<Button variant="outline" />}
                >
                  Cancel
                </Dialog.Close>
                <SubmitButton pending={pending}>Save</SubmitButton>
              </div>
            </form>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
      {vaultOpen && (
        <DeleteVault
          id={id}
          name={name}
          vaults={vaults}
          onClose={() => setVaultOpen(false)}
        />
      )}
    </>
  )
}

// Picks one of their vaults and confirms by its name.
function DeleteVault({
  id,
  name,
  vaults,
  onClose,
}: {
  id: string
  name: string
  vaults: VaultSummary[]
  onClose: () => void
}) {
  const [pick, setPick] = useState(vaults[0].id)
  const [typed, setTyped] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const vault = vaults.find((v) => v.id === pick) ?? vaults[0]

  return (
    <Dialog.Root open onOpenChange={(o) => !o && !pending && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className={DIALOG_BACKDROP} />
        <Dialog.Popup className={DIALOG_POPUP}>
          <div className="grid gap-1.5">
            <Dialog.Title className="text-base font-semibold">
              Delete a vault of {name}?
            </Dialog.Title>
            <Dialog.Description className="text-sm text-muted-foreground">
              Everything in it is deleted for good, trash included. Nobody can
              open a vault without its passphrase, so this is the only thing
              that can be done with one.
            </Dialog.Description>
          </div>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              setError(null)
              start(async () => {
                const res = await deleteMemberVault(id, vault.id)
                if ("error" in res && res.error) return setError(res.error)
                onClose()
              })
            }}
          >
            <fieldset className="flex flex-col gap-2">
              <legend className="sr-only">Vault</legend>
              {vaults.map((v) => (
                <label
                  key={v.id}
                  className="flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm has-checked:border-ring/60 has-checked:bg-input/30"
                >
                  <input
                    type="radio"
                    name="vault"
                    checked={v.id === pick}
                    onChange={() => {
                      setPick(v.id)
                      setTyped("")
                    }}
                    className="size-4 accent-primary"
                  />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {v.name}
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    {v.items} file{v.items === 1 ? "" : "s"} ·{" "}
                    {formatBytes(v.bytes)}
                  </span>
                </label>
              ))}
            </fieldset>
            <div className="grid gap-2">
              <Label htmlFor={`vault-name-${id}`}>
                Type <span className="font-semibold">{vault.name}</span> to
                confirm
              </Label>
              <Input
                id={`vault-name-${id}`}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <FormError>{error}</FormError>
            <div className="flex justify-end gap-2">
              <Dialog.Close
                disabled={pending}
                render={<Button variant="outline" />}
              >
                Cancel
              </Dialog.Close>
              <SubmitButton
                variant="destructive"
                pending={pending}
                disabled={typed !== vault.name}
              >
                Delete vault
              </SubmitButton>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
