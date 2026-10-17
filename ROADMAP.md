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

## Phase 5: Uploads
- tusd resumable uploads into S3 (pre-create auth hook, post-finish writes the node)
- Single files, many files, whole folders (drag and drop or picker)
- Uploading a file with the same name as an existing one in that folder adds a new version
  instead of failing; versions are listed in Details and can be restored
- Deleting forever, emptying the trash and the retention purge also delete the S3 objects
  (they only remove rows today)

## Phase 6: Sharing, previews, search
- Share with users (viewer/editor) and public links with expiry. Opening shared folders and
  starring shared items arrive here (Shared with me lists items read-only until then).
- Previews for image, video, PDF, audio, code and text: double-clicking a file opens its preview
  (it opens Details until then)
- Thumbnail previews generated after upload for images, video (a poster frame) and PDFs (first
  page), shown on grid tiles and in the Details panel in place of the file-type icon
- Recent ranks by when a file was last opened, not just modified
- Search by name, then content

## Phase 7: Vault
- Client-side encrypted folders behind a separate passphrase (WebCrypto)
- Server stores only ciphertext and the wrapped key; no previews, thumbnails or content search for vault files

## Phase 8: Ship
- Production Dockerfile and compose, Vercel guide, backups, storage quotas
