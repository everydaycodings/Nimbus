# Nimbus roadmap

Product truth lives in [PRODUCT.md](PRODUCT.md), the visual system in [DESIGN.md](DESIGN.md),
and dev infra in [local_server/](local_server/README.md).

## Access model

Nimbus is self-hosted, so the person who installs it controls who gets in.

- **Owner:** the first account created on an instance. There's exactly one, enforced by a
  unique index in the database, so two simultaneous first sign-ups can't both win. The owner can
  do everything an admin can, and can't be demoted, rejected or removed.
- **Admin:** promoted by the owner. Approves and rejects members and changes instance settings.
- **Member:** manages their own files and whatever is shared with them.

Every account has a **status**:

| Status | Can sign in | Sees |
|---|---|---|
| `pending` | yes | a "waiting for approval" screen, no files |
| `active` | yes | the app |
| `rejected` | yes | a "your request was declined" screen, no files |

Rejected accounts are kept, not deleted, so an admin can approve them later.

**Sign-in methods:** email + password, Google and GitHub, through Better Auth. A provider's button
only appears when its keys are set in env. Accounts with the same email link across methods only
when the existing account's email is verified (Better Auth's default), so pre-registering
someone else's email with a password can't hijack their Google or GitHub sign-in. Password accounts
become linkable once their email is confirmed.

**Gates** (full-screen, in this order, in `app/(app)/layout.tsx`): a temporary password must be
replaced; an unconfirmed email must be confirmed, but only while email works, only for members, and
not for accounts with two-factor on; pending and rejected screens; and when admins require two-factor,
password accounts must set it up. Google and GitHub sign-ins rely on the provider's own two-factor.

## Phase 1: Auth, admin basics, home shell ✓ done
- Better Auth with Drizzle on Postgres: email/password, Google, GitHub
- `role` (owner/admin/member) and `status` (pending/active/rejected) on users
- First sign-up becomes owner and active; everyone after is `pending`
- Sign-in and sign-up pages; "waiting for approval" and "declined" screens
- Admin panel at `/admin`: pending, active and rejected lists; approve, reject; owner can
  promote and demote admins
- A placeholder home page with the app shell (sidebar, header, sign out). No uploads yet.

## Phase 2: Instance settings ✓ done
- Sign-up mode chosen by admins: **approval** (default), **invite links**, **open**, **closed**
- Invite links: admin-generated, optional expiry and use limit; using one skips approval
- Auto-approve list of trusted email domains (only for verified emails)
- Settings are stored in the database and editable from `/admin/settings`

## Phase 3: Email and two-factor ✓ done
- Email transport **none**, **SMTP** or **Resend**, set in env (`EMAIL_TRANSPORT` and friends; the
  admin page turns read-only) or in `/admin/email`, where the SMTP password and Resend key are sealed
  with AES-256-GCM under a key derived from `BETTER_AUTH_SECRET`. Rotating that secret means
  re-entering them; the page says so.
- With email: password reset, email confirmation, "you were approved" and "new request" notices,
  and a test send. A confirmed email on a trusted domain skips approval.
- Two-factor (TOTP plus 10 backup codes) at `/account`, which works without email. Admins can
  reset a member's two-factor and require it for every password account.
- Without email: an admin sets a temporary password, which the member must replace on next sign-in.

## Phase 4: File browser ✓ done
- My files (`/`, `/folders/[id]` with breadcrumbs), Recent, Starred, Shared with me, Trash
- Grid (default) and list views, comfortable/compact density, both remembered in cookies
- A click highlights one item and a double-click opens it. **Select** (or the hover checkbox,
  Ctrl/Shift-click, Ctrl+A) turns on selection mode with a bar of bulk actions.
- New folder and rename in a dialog; move through a folder-picker dialog or by dragging onto a
  folder or breadcrumb; star; details side panel (type, size or folder contents, location,
  owner, dates, sharing, tags)
- Actions live in the ⋯ menu, the right-click menu and keyboard shortcuts (Enter, F2, Del, S, I,
  Shift+N, arrows, Space, Ctrl+A, Esc)
- Names are unique per folder, ignoring case (a partial unique index on untrashed nodes)
- Trash: a folder's contents go and come back with it; an item whose folder is still trashed
  restores to My files; Undo right after trashing; Delete forever and Empty trash. Admins can
  auto-delete trash after 7, 30 or 90 days (`/admin/settings`), purged when a file page loads.
- Folder sizes are the total of everything inside them
- Filters (type, modified, size, tags) and sort (name, date, size); folders always first
- Personal colored tags (only their owner sees them): add from the Tags submenu, the selection
  bar or Details
- `npm run db:seed [email]` fills an account with sample folders and byte-less files for development
- Left for later: renaming, recoloring and deleting tags; remembering sort per view

## Phase 5: Uploads, versions, downloads, storage ✓ done
- tusd resumable uploads into S3, 3 at a time. The app signs an upload token (user + target
  folder, 24h); tusd's pre-create hook checks it, the size limit, blocked types and the quota.
  Finishing is idempotent and runs from both the post-finish hook and the browser.
- Upload from the sidebar **New** menu (files or a folder), by dropping onto the page, a folder
  tile or a breadcrumb, or by pasting with Ctrl+V. A corner panel shows progress and ETA, with
  pause/resume per file and for all, cancel and retry. It hides itself ~5 s after everything
  succeeds. Uploads cut off by a closed tab resume when the same files are picked again.
- Same names ask each time: files get New version / Keep both / Skip, folders Merge / Keep
  both / Skip, with Apply to all.
- **Versions:** each file points at its current version, so any version (older or newer) can be
  made current and switched back. Versions are numbered, can carry a note, be kept forever
  (pruning skips them), be saved as a separate file, downloaded or deleted. A Versions dialog
  lists them all; Details shows the latest three. Admins can cap versions by count or age.
- **Downloads:** single files redirect to a presigned URL; folders and selections stream as a
  store-only ZIP64 from the server (flat memory, fine for 70 GB+). On Vercel the browser builds
  the zip and streams it to disk instead.
- Deleting forever, emptying the trash and the retention purge delete the S3 objects too,
  except ones another version still uses.
- **Storage:** a sidebar meter (used of quota, split into images, videos, docs, other and
  versions & trash). Admins set a default quota and per-member limits; the owner is unlimited.
  Usage counts every stored byte, including older versions and the trash.
- Admin settings: largest file, blocked file types, version limits, storage per member.
- Left for later: an orphan sweep for S3 deletes that fail (they're only logged), reserving quota
  for uploads in flight.

## Phase 6a: Thumbnails and previews ✓ done
- Thumbnails are drawn in the browser as 480px WebP: images, a video frame ~1 s in, PDF page 1,
  the first lines of code/text in shiki colors, and MP3/M4A cover art. They're made at upload,
  or lazily when an owner's tile scrolls into view (2 at a time). Stored at
  `thumbs/<s3Key>.webp`; `file_versions.thumb` is null (not tried), "" (none possible) or a
  revision that busts the cache.
- Owners can change a thumbnail (⋯ → Change thumbnail…, or "Use this frame" in the video
  player) and reset it to automatic.
- Opening a file (double-click or Enter) shows a full-screen previewer: ← / → step through the
  folder, plus download, details and the ⋯ menu. Viewers: image zoom/pan, Nimbus's own video
  player, audio with cover art, PDF in the browser's viewer, code with shiki (line numbers, wrap,
  copy), Markdown rendered and sanitized with a source toggle, CSV and xlsx tables, docx, and zip
  listings via range requests. Older versions open in it from the Versions list.
- Grid tile size is the user's choice (small / medium / large), remembered in a cookie.
- Optional Collabora Online, view only: when an admin sets its URL in `/admin/settings`, office
  files (Word, Excel, PowerPoint, OpenDocument) open in it through two WOPI endpoints
  (`CheckFileInfo`, `GetFile`) with a signed 10-hour token; access is rechecked on every call.
  Blank URL or an unreachable server falls back to the built-in docx and sheet viewers.
  `docker compose --profile office` runs CODE locally.
- Upload errors say why (storage full, a storage error's reason, tusd unreachable) instead of a
  generic "check your connection".
- `local_server/README.md` documents the bucket CORS rule (GET, `Range`, exposing
  `Content-Range`); a preview fetch blocked by CORS says to check it.
- Left for later: Collabora editing (PutFile, locks), Collabora's dark theme and its CODE
  welcome popup (CODE builds always show it once per browser), Space opens the previewer (it still toggles selection), storage-meter
  categories using `mimeOf` (a `.ts` file counts as video there).

## Phase 6b: Sharing ✓ done
- **Access** (`lib/access.ts`): a recursive walk up from each item gives owner, editor or viewer.
  Shares are inherited and the highest role wins. Every file action, upload (planning, the tus
  hook and finishing), download, zip, preview, thumbnail and WOPI call goes through it.
  - Editors can upload, make folders, rename, trash (into the owner's trash, with Undo) and
    manage versions and thumbnails.
  - Editors can only move things between folders from the same owner, so nothing leaves a
    shared folder by moving.
  - What editors add belongs to the folder's owner and counts against the owner's storage.
  - Member viewers can always preview and download.
- **Share dialog** (⋯ → Share…, Shift+S): add members by name or email autocomplete, or invite
  an email that has no account yet (needs email and a sign-up mode other than Closed).
  - Viewer or Editor per person. People who get access through a parent folder are listed
    with where it comes from.
  - "Editors can share it too" applies to the item and everything inside it. Editors manage
    only the shares and links they made.
  - **Ownership transfer**: Offer ownership; the new owner accepts or declines from the bell.
    Accepting checks their storage and moves the item, with everything in it, to their My
    files. The old owner keeps edit access.
- **Public links**: any number per item, each with a name, expiry (capped by the admin), password
  (scrypt; changing it signs out everyone who unlocked it), download on/off, and for folders a
  file drop with an optional size cap.
  - Each link shows view and download counts plus an access log (time, event, IP, user agent;
    90 days).
  - `/s/<token>` has no sidebar: a password prompt first when needed, then the file inline or
    a folder grid/list with breadcrumbs, a name filter, the previewer and zip downloads.
  - File-drop links take uploads with an optional "your name"; contents stay hidden unless
    the link also shows them.
  - Wrong passwords are throttled (10 per IP per 15 minutes) and anonymous uploads limited
    (200 per IP per hour), both counted from the access log.
- **Notifications**: a header bell (polls on focus and every 60 s) and a Shared with me badge.
  - Events: shared with you, access changed or removed, file drops, editors' changes in your
    folders (one entry per folder per hour), ownership offers, sign-up requests for admins.
  - Email per kind, chosen in `/account`.
- **Email invites**: the emailed link (signed, 30 days) skips approval when that address signs
  up, and the share is waiting in Shared with me. If they made an account meanwhile, clicking
  the link binds the share to it.
- Stars are per person (`stars`), so shared items can be starred. "Add shortcut to My files"
  puts a shared item in your root. Tiles show a people glyph for member shares and a link glyph
  for public links.
- **Admin**: `/admin/settings` turns public links on or off, caps link expiry and can require
  passwords. `/admin/links` lists every link (item, owner, counts, expiry) with Revoke; admins
  can't open them.
- Left for later: Collabora on public links, an in-browser zip for links on Vercel, removing
  yourself from something shared with you, moving shortcuts out of the root, restricting a
  subfolder below an inherited share.

## Phase 6c: Search and recent ✓ done
- **Search** covers your files and everything shared with you, never trash or vaults.
  - Names: substring or close spelling (`pg_trgm` word similarity ≥ 0.4, so "reprot" finds
    report.pdf).
  - Text inside files: `node_content` keeps the current version's text (up to 200k characters)
    with a generated `tsvector` and a GIN index. Queries use `websearch_to_tsquery('simple')`,
    so plain words and "quoted phrases" work. A new version makes the old text stale.
- **Reading text** (`lib/extract.ts`, shared by the browser and Node): text, code and Markdown;
  PDF via pdf.js; docx body, headers and footers; xlsx/ods/csv (5,000 rows per sheet); images up
  to 20 MB via tesseract.js OCR, dropping low-confidence results.
  - The browser reads a file right after uploading it, from the local copy, and catches up older
    files when an owner or editor opens their folder. One file at a time, when the page is
    idle, and no OCR on devices reporting under 4 GB of memory.
  - OCR languages are an admin setting (`/admin/settings`, default `eng`).
  - `npm run worker` sweeps every minute for whatever no browser has read yet;
    `npm run indexer` does one sweep.
- **UI**: the header search box (Ctrl+K anywhere) opens a palette.
  - Recent searches (stored in this browser) and app commands: new folder, uploads, go to a
    view or Admin, switch list/grid, collapse the sidebar.
  - As you type: up to 6 name matches with their folder, then text matches with the matching
    words highlighted. Files open in the previewer right there; folders open.
  - Enter on "See all results" opens `/search?q=` with the usual filters, sorted by relevance.
- **Recent**: `node_opens` is updated on preview, download, upload and rename, for shared items
  too; Recent lists the last 50 by when you opened them. Existing files start at their last
  modified time.
- Left for later: pptx and audio tags, search operators (type:, owner:), indexing older
  versions, matching partly typed words inside files, serving Tesseract's language data
  locally (it downloads from the jsDelivr CDN the first time), a compose service for the
  indexer.

## Phase 7: Vault ✓ done
- **Vaults** (`/vault`): each member can have several named vaults, each with its own
  passphrase. Vault names are plaintext; everything inside is encrypted in the browser,
  file and folder names included. The server stores only ciphertext and wrapped keys.
- **Keys** (`lib/vault-crypto.ts`, tested by `lib/vault-crypto.test.ts`):
  - A random AES-GCM vault key is wrapped twice. One copy uses Argon2id of the passphrase
    (hash-wasm, 64 MiB, t=3). The other uses HKDF of a 32-byte recovery key, which is shown
    once at creation and can't be skipped.
  - Each file has its own key, wrapped by the vault key and stored on its version.
  - Files are encrypted in 4 MiB chunks. Each chunk's nonce is its index, and its AAD holds the
    index and an is-last flag, so reordered or truncated files fail to decrypt.
- **Creating a vault**: an explainer with an "I understand" checkbox, a passphrase of at least
  12 characters with a zxcvbn meter, then the recovery key (Copy or Download first).
- **Locking**: keys live in memory only. A reload, the Lock button or idle time locks every
  vault. Members pick 5/15/30/60 minutes of idle time in `/account`.
- **Inside a vault**: a browser like My files over the decrypted tree. Grid or list,
  breadcrumbs, a name filter across the whole vault, rename, move, keyboard shortcuts and
  context menus. Names are checked for duplicates in the browser, since the server can't.
- **Uploads**: every upload path works in an unlocked vault (New menu, Upload button,
  drag-drop, paste, folders). Files are encrypted chunk by chunk as tus sends them, resume after
  a reload, and use the normal progress panel. There are no versions: Replace, Keep both or
  Skip.
- **Opening files**: previews decrypt in the browser with the usual viewers (up to 1 GB),
  stepping with ← and →. Downloads decrypt as they stream. Zips are built in the browser. No
  thumbnails, and vaults stay out of search, Recent, starred, sharing and notifications.
- **Trash**: each vault has its own trash, with Restore, Delete forever and Empty trash. The
  admin's retention setting applies to it too.
- **Moving files**:
  - "Move to vault…" in My files encrypts items into a vault, and "Move to My files…" decrypts
    them back out.
  - The originals are deleted for good only once every file has landed; a skip, failure or
    cancel keeps them.
- **Passphrases**: change one from the vault's ⋯ menu; the files and the recovery key stay as
  they are. Unlocking with the recovery key offers to set a new one.
- **Deleting a vault**: the owner needs the passphrase and the vault's name, typed. Its rows
  and S3 objects go together.
- **Storage**: vault bytes count toward the quota, as a "Vault" part of the storage meter.
- **Admin**:
  - `/admin/settings` can turn new vaults off and cap how many each member has.
  - `/admin/members` shows each member's vault count and size, and "Delete vault…" for a member
    who lost both keys.
- **Unique names**: each item stores a name tag, an HMAC of its lowercased name under a key
  derived from the vault key. A unique index refuses two same-named items in one folder, even
  from racing tabs. The tag reveals only that two items in a vault share a name. Items from
  before the tags get theirs the next time the vault opens.
- **Moving files streams**: files are read by byte range and encrypted or decrypted a piece at
  a time, so memory stays flat at any size.
- By design:
  - Blocked file types don't apply inside vaults. The server can't see names, and vault files
    can't be shared, which is what the block list guards against.
  - Deleting a vault asks for the passphrase in the browser, not on the server. A stolen
    session can already trash everything inside, as in My files; two-factor is the defence.
- Left for later: encrypted thumbnails, vault versions, sharing a vault, paging very large
  vault trees, and resuming a vault move after a reload.

## Health (Admin → System → Health)
- Checks Postgres, file storage, Redis, tusd, email, Collabora, the indexer and OAuth config
  with real probes (a write/read/delete in the bucket, an SMTP sign-in) and records latency.
- `npm run worker` (BullMQ on Redis) runs them every 5 minutes by default; admins set the
  interval, failures before alert, history, per-service on/off and slow thresholds.
- A service is down after N failures in a row: admins get a bell notification and email (each
  picks channels per kind in Account) and a warning on Health in the admin sidebar. The page
  warns when scheduled checks stop. **Redis is now required** (`REDIS_URL`).
- The worker also runs background jobs with retries (`/api/jobs`): notification and auth
  emails, S3 deletes, tus uploads whose post-finish hook crashed, the hourly trash/link-event
  purge and the indexer sweep. **The worker is now required**: without it emails wait in Redis,
  deleted files stay in the bucket and trash isn't purged.

## Phase 8: Ship
- Production Dockerfile and compose, Vercel guide, backups
