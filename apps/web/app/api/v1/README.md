# Nimbus /api/v1

The private JSON API for the Nimbus Android app. Member features only: there is
no admin route. Request and response types are in `@nimbus/shared/api`
(`packages/shared/api.ts`); the type name for each route is in the table.
`API_VERSION` is 1 (`GET /instance` returns it).

## Auth and errors

- **Sign in** with Better Auth, not with this API: `POST /api/auth/sign-in/email`
  `{email, password}` with header `origin: nimbus://`. The bearer token is the
  `set-auth-token` response header. Send `Authorization: Bearer <token>` on every
  call below. OAuth/OIDC go through the browser and the `nimbus://` deep link
  (`@better-auth/expo`). Sign out with `POST /api/auth/sign-out`.
- Every route except `GET /instance` needs a token. **401** `signed-out`: no or
  expired token. **403** `gated`: the account must finish a step first (temporary
  password, pending approval, ...); `GET /me` says which in `gate`. `GET /me`,
  `POST /account/password` and `POST /account/resend-verification` work while gated.
- Errors are `{ "error": code, "message": plain-language text }` (`ApiError`).
  Codes: `signed-out` 401, `gated` 403, `forbidden` 403, `not-found` 404 (gone or
  you can't see it; the two are never told apart), `bad-request` 400 (malformed
  input), `refused` 400 (understood but not possible, e.g. name taken). Show `message`.
- Ids are UUIDs, except user ids (opaque strings). Dates are ISO strings, sizes bytes.
- Rate limits: 600 requests a minute per user on every route, 120 a minute per IP
  on `GET /instance`. Over the limit: **429** `rate_limited` (wait a minute). Redis
  being down lifts the limit. Sign-in rate limits and origin checks are Better Auth's
  and apply to `/api/auth/*`.

## Two-factor, sessions (Better Auth endpoints, all work with the bearer)

Send header `origin: nimbus://`. Bodies are Better Auth's.

| Method | Path | Notes |
|---|---|---|
| POST | `/api/auth/two-factor/enable` `{password}` | returns `totpURI`, `backupCodes` |
| POST | `/api/auth/two-factor/verify-totp` `{code}` | turns it on |
| POST | `/api/auth/two-factor/disable` `{password}` | refused if the admin requires 2FA |
| POST | `/api/auth/sign-in/email` then `/api/auth/two-factor/verify-totp` | sign-in with 2FA |
| GET | `/api/auth/list-sessions` | active sessions |
| POST | `/api/auth/revoke-other-sessions` `{}` / `/revoke-sessions` `{}` | sign out everywhere (else / all) |

**Every two-factor enable/verify/disable issues a new session token** (see the
`set-auth-token` header on that response); the old one stops working. Store the new one.

## Lists, filters, paging

List routes answer `ListResponse`: `{items, total, nextCursor, tags}`. `tags` are
my tags, for filter chips. All accept `ListQuery`:
`type` (folder|image|video|doc|pdf|audio|code|archive|other), `modified`
(today|week|month|year; trash uses the trashed date), `size`
(small <1 MB, medium 1-100 MB, large 100 MB-1 GB, huge >1 GB), `tag` (tag id),
`sort` (rank|name|date|size), `order` (asc|desc), `limit` (1-1000, default 500),
`cursor`. Default sort: name asc, folders first; recent and search keep the
server's order (`rank`); trash is newest-trashed first. Date/size default to desc.

Paging is by offset: pass `nextCursor` back as `cursor` until it is `null`. The
underlying queries return whole lists, so the server filters, sorts and slices
in memory (fine for thousands of items per list). Recent is capped at 50, search with text at 50.
`/photos` pages by keyset instead: pass its `nextCursor` (an opaque string) back as `cursor`. `takenAt` is the
EXIF date, else the upload time; the worker reads it within a minute of an upload, until then it is the upload time.
An item's `role` is set when it isn't mine (`editor`|`viewer`); viewers can't change it.

## Routes

`{id}` is an item (file or folder) unless named otherwise. A mutation that has
nothing to return answers `200 {}`.

| Method | Path | Body / query | Response |
|---|---|---|---|
| GET | `/instance` | (public) | `Instance` (`version`: the Nimbus server's version) |
| GET | `/me` | | `Me` |
| **Lists** | | | |
| GET | `/files` | `ListQuery` | `ListResponse` (My files root + shortcuts) |
| GET | `/folders/{id}` | `ListQuery` | `FolderResponse` (adds `folder`, `path` breadcrumbs) |
| GET | `/recent` | `ListQuery` | `ListResponse` |
| GET | `/photos` | `?limit=` (1-1000, 500), `?cursor=` | `PhotosResponse` (my images and videos, not Vault or trashed, newest `takenAt` first) |
| GET | `/starred` | `ListQuery` | `ListResponse` |
| GET | `/shared` | `?by=me` for shared-by-me, `ListQuery` | `ListResponse` |
| GET | `/trash` | `ListQuery` | `TrashResponse` (adds `retentionDays`) |
| GET | `/tags/{tagId}` | `ListQuery` | `TagResponse` (items with that tag) |
| GET | `/search` | `?q=`, `ListQuery`. With a filter and no `q`: everything I can see that matches, newest first | `SearchResponse` (`Hit`: adds `where`, `byName`, `snippet`) |
| GET | `/search?q=&quick=1` | | `QuickSearchResponse` (12 hits) |
| GET | `/search/langs` | | `OcrLangsResponse` |
| PUT | `/items/{id}/content` | `SaveContentRequest` (search text the app extracted) | `{}` |
| **File operations** | | | |
| POST | `/folders` | `CreateFolderRequest` | `CreateFolderResponse` |
| GET | `/items/{id}` | | `ItemResponse` (item + details panel) |
| PATCH | `/items/{id}` | `RenameRequest` | `{}` |
| POST | `/items/move` | `MoveRequest` | `{}` |
| POST | `/items/star` | `StarRequest` | `{}` |
| POST | `/items/trash` | `IdsRequest` | `{}` |
| POST | `/items/restore` | `IdsRequest` (also the Undo for trash) | `{}`; 400 names items whose name is now taken |
| POST | `/items/delete` | `IdsRequest` (trashed items I own) | `{}` |
| POST | `/trash/empty` | | `{}` |
| GET | `/picker` | `?parent=` (omit: My files) | `PickerResponse` (folder picker) |
| POST | `/shortcuts` | `ShortcutRequest` | `{}` |
| DELETE | `/shortcuts/{nodeId}` | | `{}` |
| **Tags** | | | |
| GET | `/tags` | | `TagsResponse` |
| POST | `/tags` | `CreateTagRequest` | `CreateTagResponse` |
| PATCH | `/tags/{id}` | `UpdateTagRequest` | `UpdateTagResponse` (`merge`: name taken, ask then merge) |
| POST | `/tags/{id}/merge` | `MergeTagRequest` (merge `{id}` into `into`) | `{}` |
| DELETE | `/tags/{id}` | | `TagSnapshot` (keep it for Undo) |
| POST | `/tags/restore` | `TagSnapshot` | `{}` |
| POST | `/tags/apply` | `ApplyTagRequest` | `{}` |
| **Versions** (owner/editor) | | | |
| GET | `/items/{id}/versions` | | `VersionsResponse` (empty if not allowed) |
| DELETE | `/items/{id}/versions` | delete all older, except `keep` | `DeleteOlderResponse` |
| PATCH | `/versions/{vid}` | `UpdateVersionRequest` | `{}` |
| POST | `/versions/{vid}/current` | make current (also switches back) | `{}` |
| POST | `/versions/{vid}/copy` | | `CopyVersionResponse` |
| DELETE | `/versions/{vid}` | not the current one | `{}` |
| **Activity** | | | |
| GET | `/files/{id}/activity` | a file, or a folder with everything inside it; newest first, 50 at most | `ActivityResponse` (404 if I can't open it) |
| **Uploads** | | | |
| POST | `/uploads/plan` | `PlanUploadRequest` | `Plan` |
| POST | `/uploads/folders` | `CreateFoldersRequest` (empty folders, mkdir -p) | `{}` |
| POST | `/uploads/finish` | `FinishUploadRequest` | `FinishUploadResponse` |
| POST | `/uploads/exists` | `ExistsRequest` | `ExistsResponse` |
| POST | `/zip-manifest` | `IdsRequest` | `ZipManifest` |
| GET | `/tree` | `?folder=` (omit: My files) | `TreeResponse` (every file and folder below it: relative `path`, `size`, `modified`, `sha256`, `versionId`; `truncated` past 50,000) |
| **Previews and files** | | | |
| GET | `/items/{id}/preview` | `?v=` older version, `?open=1` counts as opened | `PreviewResponse` (short-lived storage URL) |
| GET | `/items/{id}/office` | `?v=` | `OfficeResponse` |
| GET | `/api/files/{id}/download` | `?v=` | 302 to a storage URL |
| GET | `/api/files/{id}/thumb` | `?v=<version>` | `image/webp` |
| POST | `/api/files/{id}/thumb` | `?v=<version>`, raw WebP body (<= 512 KB), or an empty body for "couldn't make one" | `{thumb: revision}` (editors) |
| DELETE | `/api/files/{id}/thumb` | back to automatic | 204 |
| POST | `/api/zip` | form field `ids` (repeat) | streamed ZIP |
| GET | `/api/avatar/{key}` | | `image/jpeg` |
| GET | `/api/notifications` | | `{unread, shared}` (cheap poll) |
| **Sharing** | | | |
| GET | `/items/{id}/shares` | | `ShareState` (404 if I may not share it) |
| POST | `/items/{id}/shares` | `ShareWithRequest` | `{}` |
| PATCH | `/items/{id}/shares` | `ReshareRequest` (owner only) | `{}` |
| GET | `/members` | `?q=` (2+ chars) | `MembersResponse` |
| PATCH | `/shares/{shareId}` | `SetShareRoleRequest` | `{}` |
| DELETE | `/shares/{shareId}` | | `{}` |
| POST | `/items/{id}/links` | `CreateLinkRequest` | `CreateLinkResponse` (token/URL parts in `ShareState.links`) |
| PATCH | `/links/{shareId}` | `UpdateLinkRequest` | `{}` |
| DELETE | `/links/{shareId}` | | `{}` |
| GET | `/links/{shareId}/events` | `?limit=` (<=500, 20) | `LinkEventsResponse` |
| POST | `/items/{id}/ownership` | `OfferOwnershipRequest` | `{}` |
| DELETE | `/items/{id}/ownership` | cancel my offer | `{}` |
| POST | `/items/{id}/ownership/answer` | `AnswerOwnershipRequest` | `{}` |
| **Notifications** | | | |
| GET | `/notifications` | | `NotificationsResponse` |
| POST | `/notifications/read` | `MarkReadRequest` (no `ids`: all) | `{}` |
| POST | `/notifications/shared-seen` | | `{}` |
| **Account** | | | |
| GET | `/account` | | `AccountResponse` |
| POST | `/account/password` | `ChangePasswordRequest` (works while gated; applies the password policy; clears the temporary flag; signs out other devices) | `OkResponse` |
| POST | `/account/resend-verification` | | `{ok: true}` |
| PUT | `/account/notification-prefs` | `NotificationPrefsRequest` | `{}` |
| PUT | `/account/vault-lock` | `VaultLockRequest` | `{}` |
| GET | `/account/avatars` | | `AvatarsResponse` |
| PUT | `/account/avatar` | `PickAvatarRequest` | `{}` |
| POST | `/account/avatar` | multipart `file`: 256 px JPEG <= 300 KB | `{ok: true}` |
| POST | `/account/app-passwords` | `CreateAppPasswordRequest` | `CreateAppPasswordResponse` (shown once) |
| DELETE | `/account/app-passwords/{id}` | | `{}` |
| **Storage** | | | |
| GET | `/storage` | `?folder=` | `StorageReport` |
| **Vaults** | | | |
| GET | `/vaults` | | `VaultsResponse` |
| POST | `/vaults` | `CreateVaultRequest` | `{id}` |
| GET | `/vaults/{vid}` | | `VaultResponse` (sealed keys) |
| DELETE | `/vaults/{vid}` | | `{}` |
| PUT | `/vaults/{vid}/key` | `UpdateVaultKeyRequest` | `{}` |
| GET | `/vaults/{vid}/tree` | | `VaultTreeResponse` |
| POST | `/vaults/{vid}/tags` | `VaultTagsRequest` | `{}` |
| POST | `/vaults/{vid}/folders` | `CreateVaultFoldersRequest` | `CreateVaultFoldersResponse` |
| PATCH | `/vaults/{vid}/nodes/{id}` | `RenameVaultNodeRequest` | `{}` |
| POST | `/vaults/{vid}/nodes/move` | `MoveVaultNodesRequest` | `{}` |
| POST | `/vaults/{vid}/nodes/trash` | `VaultIdsRequest` | `{}` |
| POST | `/vaults/{vid}/nodes/restore` | `VaultIdsRequest` | `RestoreVaultNodesResponse` |
| POST | `/vaults/{vid}/nodes/delete` | `VaultIdsRequest` | `{}` |
| POST | `/vaults/{vid}/uploads/plan` | `PlanVaultUploadRequest` | `PlanVaultUploadResponse` |
| GET | `/vaults/{vid}/files/{id}` | | `VaultFileResponse` |
| **Events** | | | |
| GET | `/events` | | `text/event-stream` |
| **Push** | | | |
| POST | `/push` | `PushRequest` (UnifiedPush endpoint URL) | `{}` |
| DELETE | `/push` | `PushRequest` | `{}` |

Paths starting `/api/` above are existing routes, outside `/api/v1`; the rest are `/api/v1/...`.

## Activity

Uploads, new versions (including switching version), renames, moves, share and link changes, trash and
restore are recorded with who did them; views and downloads aren't. Owners see every event on their
files. Editors and viewers see the events on what they can currently open, except `share` events, which
are the owner's. The admin keeps them 30, 90 (default), 365 days or forever (Admin, Storage, Versions);
the worker's hourly purge deletes older ones. Vault items record nothing.

## Uploads

1. `POST /uploads/plan` with `{parentId, entries: [{path, size}]}`. `path` is
   relative to the folder (`a.jpg`, `Photos/2024/a.jpg`); add `dir: true` for an
   empty folder. The answer is `Plan` with HTTP 200 even when it can't go ahead:
   if `error` is set (no space left, folder gone, over 10,000 items), nothing is
   planned. Otherwise `token` (one day to start each tus upload) goes into every file's tus
   metadata, `rejected` entries (too big, blocked extension, bad name; see
   `Instance.maxUploadBytes`, `blockedExtensions`) must not be sent, and
   `conflicts` lists same-name items.
2. Send each file to `Instance.tusUrl` with tus 1.0.0 (parts of a few MB;
   resumable). Metadata (`TusMetadata`): `filename`, `filetype`, `token`, `path`,
   `onConflict`. The token binds the user and the target folder; no cookie or
   bearer is needed on the tus requests.
3. `POST /uploads/finish` with the upload's URL and the file's SHA-256 (hex). It
   is idempotent and the server's own tus hook finishes uploads too, so calling
   it late or twice is safe. It returns `nodeId`/`versionId`, and `duplicateOf` if
   the same bytes already exist elsewhere in My files.
4. Empty folders: `POST /uploads/folders`. Thumbnail: `POST /api/files/{id}/thumb?v=<versionId>`.
   Search text: `PUT /items/{id}/content` (the web does both from the browser;
   the server's worker also makes a thumbnail and text for files nobody drew
   one for, after about two minutes, except video thumbnails).

**Same name in the same folder** (a conflict from the plan):
- *Keep both*: upload with `onConflict: "rename"`; the server names it `a (1).txt`
  (the conflict's `freeName`). For a conflicting **folder**, replace that folder's
  name in the start of `path` with `freeName` before uploading its files.
- *Replace* (new version): `onConflict: "version"`. The existing file gets a new
  version and keeps its id, sharing and tags. Only for `kind: "file"` conflicts.
- *Skip*: don't upload it.
- With no conflict, `onConflict` is irrelevant. Never send `"version"` unless the
  person chose it. Without `onConflict` the server keeps both.

**Backup: don't stack a new phone's photos as versions.** Before sending, ask
`POST /uploads/exists` with `{items: [{sha256, name, size, parentId}]}` (up to
200). Each answer is `null` or `{id, path, by, sameSize?}`: `by: "sha256"` means
those exact bytes are already in My files (skip it); `by: "name"` means a
different file has that name there (`sameSize` tells you whether it's probably
the same photo). Hash matches only work for files finished with `sha256`, so always
send it. When a name collides with different content, upload with `onConflict:
"rename"` so both survive. Trashed files and vault files never match.

**Vault uploads** use `POST /vaults/{vid}/uploads/plan` for tokens (one per target
folder, in order) and `VaultTusMetadata`: `filename` (sealed name), `nameTag`,
`token`, `encKey` (the wrapped file key) and optionally `replaces`. Parts must be
`CIPHER_CHUNK` (4 MiB + 16) ciphertext chunks from `@nimbus/shared/vault-crypto`.
Finish with `POST /uploads/finish` (no `sha256`).

## Folder sync

The Android app's folder sync and "Save to device" walk a folder with one call, `GET /tree?folder=<id>`
(no `folder`: My files), instead of listing every subfolder. A file's `sha256` is that of its current
version (null if it was finished without one: treat it as changed). Upload changes with
`onConflict: "version"` (a new version) or `"rename"` (a new file), trash with `POST /items/trash`, and
download with `GET /api/files/{id}/download`. Check `truncated` before treating a missing path as deleted.

## Previews and Collabora

`GET /items/{id}/preview` gives a URL to fetch straight from storage (works with
range requests; PDFs come inline). It expires in minutes, so ask when needed.
`GET /items/{id}/office` returns `{office: {action, token}}` when Collabora is
configured and opens that file: load a WebView with an auto-submitted POST form to
`action` with fields `access_token=<token>` and `access_token_ttl=0`. It returns
`{office: null}` otherwise; use native/other viewers.

## Push (UnifiedPush)

`POST /push {endpoint}` registers the URL your distributor (ntfy etc.) gave you.
The server POSTs `{"app":"nimbus","id":"<notification id>","text":"You have new
activity in Nimbus."}` (`PushPayload`) to it for each new notification that would
ring the bell. Nothing about files is in the payload; fetch `GET /notifications`.
Endpoints answering 404 or 410 are dropped. Registration refuses private
addresses and non-http(s) URLs unless the server runs in development. Needs the
worker (`npm run worker`). Registering the same URL again moves it to the caller.

## Live events (SSE)

`GET /events` is a Server-Sent Events stream for the signed-in member (bearer
token). It sends `retry: 10000`, then `event: notification` with `data: {"id":"<notification id>"}`
whenever the bell gets a new row (fetch `GET /notifications` for the text), and a
`: ping` comment every 25 seconds. The Android app's "Instant notifications" keeps
one open per account. Fans out through Redis channel `events:<userId>`.

## Android APK (not under /api/v1)

Public, no token: `GET /api/android/latest` answers `{version, files: [{abi, url, size}]}`
or `null` (abi: `arm64-v8a`, `armeabi-v7a`, `x86_64`, `universal`). The files come from
the latest GitHub release, else from APKs bundled on the server (`GET /android/<file>`).
`/app` is the web page for it.

## Not in /api/v1

Admin, saved logins and the browser's multi-account switching are web-only.
Profile name/email editing doesn't exist on the web either, so there's no route.
