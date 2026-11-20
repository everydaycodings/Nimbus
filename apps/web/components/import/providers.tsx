import { CloudIcon, DatabaseIcon, DropboxLogoIcon, GlobeSimpleIcon, GoogleDriveLogoIcon, GooglePhotosLogoIcon, TerminalWindowIcon, type Icon } from "@phosphor-icons/react"

import { PROVIDERS, type Provider } from "@/lib/import/rules"

const ICONS: Record<Provider, Icon> = {
  gdrive: GoogleDriveLogoIcon,
  gphotos: GooglePhotosLogoIcon,
  dropbox: DropboxLogoIcon,
  onedrive: CloudIcon,
  s3: DatabaseIcon,
  webdav: GlobeSimpleIcon,
  sftp: TerminalWindowIcon,
}

export const ORDER = Object.keys(PROVIDERS) as Provider[]
export const label = (p: Provider) => PROVIDERS[p].label

// The `rclone authorize` argument for each cloud service.
export const AUTHORIZE: Record<string, string> = { gdrive: "drive", gphotos: "google photos", dropbox: "dropbox", onedrive: "onedrive" }

export function ProviderIcon({ provider }: { provider: Provider }) {
  const I = ICONS[provider]
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
      <I aria-hidden className="size-5 text-muted-foreground" />
    </span>
  )
}
