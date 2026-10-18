import {
  ClockCounterClockwiseIcon,
  EnvelopeSimpleIcon,
  FileDocIcon,
  FingerprintIcon,
  GaugeIcon,
  HeartbeatIcon,
  HardDrivesIcon,
  LinkSimpleIcon,
  LockIcon,
  PaletteIcon,
  ScanIcon,
  TrashIcon,
  UploadSimpleIcon,
  UserCheckIcon,
  UserPlusIcon,
  UsersIcon,
  type Icon,
} from "@phosphor-icons/react"

export type AdminPage = { href: string; label: string; icon: Icon }

// The admin sidebar, in order. Search reads the same list.
export const ADMIN_GROUPS: { title: string; pages: AdminPage[] }[] = [
  {
    title: "",
    pages: [{ href: "/admin", label: "Overview", icon: GaugeIcon }],
  },
  {
    title: "People",
    pages: [
      { href: "/admin/approvals", label: "Approvals", icon: UserCheckIcon },
      { href: "/admin/members", label: "Members", icon: UsersIcon },
      {
        href: "/admin/signups",
        label: "Sign-ups & invites",
        icon: UserPlusIcon,
      },
    ],
  },
  {
    title: "Security",
    pages: [
      {
        href: "/admin/authentication",
        label: "Authentication",
        icon: FingerprintIcon,
      },
    ],
  },
  {
    title: "Storage",
    pages: [
      { href: "/admin/storage/quotas", label: "Quotas", icon: HardDrivesIcon },
      {
        href: "/admin/storage/uploads",
        label: "Uploads",
        icon: UploadSimpleIcon,
      },
      {
        href: "/admin/storage/versions",
        label: "Versions",
        icon: ClockCounterClockwiseIcon,
      },
      { href: "/admin/storage/trash", label: "Trash", icon: TrashIcon },
    ],
  },
  {
    title: "Sharing",
    pages: [
      {
        href: "/admin/sharing/links",
        label: "Public links",
        icon: LinkSimpleIcon,
      },
      { href: "/admin/sharing/vaults", label: "Vaults", icon: LockIcon },
    ],
  },
  {
    title: "System",
    pages: [
      { href: "/admin/system/health", label: "Health", icon: HeartbeatIcon },
      {
        href: "/admin/system/email",
        label: "Email",
        icon: EnvelopeSimpleIcon,
      },
      {
        href: "/admin/system/office",
        label: "Office documents",
        icon: FileDocIcon,
      },
      { href: "/admin/system/ocr", label: "Text in images", icon: ScanIcon },
      {
        href: "/admin/system/appearance",
        label: "Appearance",
        icon: PaletteIcon,
      },
    ],
  },
]

// Every setting search can jump to. `id` is the row's anchor on its page.
export const ADMIN_SETTINGS: {
  id: string
  label: string
  href: string
  keywords: string
}[] = [
  {
    id: "health-interval",
    label: "Health check interval",
    href: "/admin/system/health",
    keywords: "status uptime monitoring schedule worker every minutes",
  },
  {
    id: "health-failures",
    label: "Health alert after",
    href: "/admin/system/health",
    keywords: "down failures alerts notify threshold",
  },
  {
    id: "health-retention",
    label: "Health history",
    href: "/admin/system/health",
    keywords: "uptime keep days retention",
  },
  {
    id: "health-services",
    label: "Services to check",
    href: "/admin/system/health",
    keywords:
      "health postgres database storage s3 redis email tusd collabora oauth",
  },
  {
    id: "health-slow",
    label: "Slow service threshold",
    href: "/admin/system/health",
    keywords: "health latency milliseconds ms degraded",
  },
  {
    id: "signup-mode",
    label: "Sign-up mode",
    href: "/admin/signups",
    keywords: "registration register join open closed approval invite only",
  },
  {
    id: "invite-links",
    label: "Invite links",
    href: "/admin/signups",
    keywords: "invitation join url",
  },
  {
    id: "trusted-domains",
    label: "Trusted domains",
    href: "/admin/signups",
    keywords: "domain google github skip approval",
  },
  {
    id: "require-2fa",
    label: "Require two-factor",
    href: "/admin/authentication",
    keywords: "2fa mfa totp authenticator otp",
  },
  {
    id: "password-rules",
    label: "Password rules",
    href: "/admin/authentication",
    keywords: "password policy length passphrase nist characters",
  },
  {
    id: "storage-per-member",
    label: "Storage per member",
    href: "/admin/storage/quotas",
    keywords: "quota limit space gb tb",
  },
  {
    id: "largest-file",
    label: "Largest file",
    href: "/admin/storage/uploads",
    keywords: "max upload size limit",
  },
  {
    id: "blocked-types",
    label: "Blocked file types",
    href: "/admin/storage/uploads",
    keywords: "extension exe block deny",
  },
  {
    id: "keep-newest",
    label: "Versions to keep",
    href: "/admin/storage/versions",
    keywords: "version history retention keep newest",
  },
  {
    id: "version-age",
    label: "Delete old versions",
    href: "/admin/storage/versions",
    keywords: "version age days retention",
  },
  {
    id: "trash-retention",
    label: "Empty trash automatically",
    href: "/admin/storage/trash",
    keywords: "trash retention delete days",
  },
  {
    id: "allow-links",
    label: "Allow public links",
    href: "/admin/sharing/links",
    keywords: "share link public anyone",
  },
  {
    id: "link-password",
    label: "Require a password on links",
    href: "/admin/sharing/links",
    keywords: "share link password protect",
  },
  {
    id: "link-expiry",
    label: "Longest link lifetime",
    href: "/admin/sharing/links",
    keywords: "share link expire expiry days",
  },
  {
    id: "active-links",
    label: "Active public links",
    href: "/admin/sharing/links",
    keywords: "revoke links list",
  },
  {
    id: "allow-vaults",
    label: "Allow new vaults",
    href: "/admin/sharing/vaults",
    keywords: "vault encrypted e2e",
  },
  {
    id: "vaults-per-member",
    label: "Vaults per member",
    href: "/admin/sharing/vaults",
    keywords: "vault limit",
  },
  {
    id: "email-delivery",
    label: "Email delivery",
    href: "/admin/system/email",
    keywords: "smtp resend mail sender from",
  },
  {
    id: "email-test",
    label: "Send a test email",
    href: "/admin/system/email",
    keywords: "test mail smtp",
  },
  {
    id: "collabora-url",
    label: "Collabora server",
    href: "/admin/system/office",
    keywords: "office word excel powerpoint collabora wopi",
  },
  {
    id: "ocr-languages",
    label: "Text recognition languages",
    href: "/admin/system/ocr",
    keywords: "ocr tesseract images screenshots language",
  },
  {
    id: "toast-position",
    label: "Action message position",
    href: "/admin/system/appearance",
    keywords: "toast notification message corner",
  },
]
