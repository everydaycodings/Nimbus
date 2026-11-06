# Nimbus for Android (Expo)

Native Android app with every member feature and no admin panel, for any self-hoster to point at
their own server. Apple is dropped for now. Last updated 2026-11-05.

## Starting a new session

1. Read this file, `apps/mobile/PRODUCT.md`, `DESIGN.md`, `apps/mobile/AGENTS.md` (Expo APIs change between
   SDKs, so check the SDK 58 docs instead of relying on memory) and `apps/web/app/api/v1/README.md`.
2. Run `git status`: this work may still be uncommitted, so don't discard anything.
3. Run the Impeccable skill for mobile UI work, from `apps/mobile`.
4. Continue at the first unfinished phase in Status. Update Status here as each phase lands.

Test accounts and other dev details are in Claude's project memory. To check the app on the emulator, drive
it with `adb` and `uiautomator`; the AVD is named `nimbus`, and `adb reverse` maps ports 8081, 3000, 1080 and 9100.
API checks: `cd apps/web && node --env-file=.env.local scripts/api-check.ts` (run it alone).

## Status

| Phase | What | State |
|---|---|---|
| 0 | SDK, Expo app, `packages/shared` | Done, except the Docker image build, which hasn't been run |
| 1 | `/api/v1`, sign-in, gates, accounts, app lock | Mostly done, see below |
| 2 | Files home and file actions | Built and checked on the emulator, see below. Waiting on the user's phone check |
| 3 | Previews | Built and checked on the emulator, see below. Waiting on the user's phone check |
| 4 | Sharing, search, notifications, versions, account settings | Built and checked on the emulator, see below. Waiting on the user's phone check |
| 5 | Uploader, share into Nimbus, camera backup | Built and checked on the emulator, see below. Waiting on the user's phone check |
| 6 | Offline, Android Files integration | Built and checked on the emulator (Expo Go and the APK), see below. Waiting on the user's phone check |
| 7 | Vault | Not started |
| 8 | Push, release APK, docs, finish review | Not started |

**Phase 1 detail**

- Verified: 179 of 179 API checks; native password and TOTP sign-in over HTTP; QR sign-in flow with a
  simulated device (8 of 8); QR sign-in on a real phone in Expo Go, reported by the user.
- Web checks rerun with Phase 4 (see there).
- Written but not tested on a device: gate screens, sign-up, app lock, brand icons. The gate's password and two-factor
  steps had a real bug, found in Phase 4: they didn't save the replaced session token. Fixed, but not run on a device.
- Not tested: Google, GitHub and OIDC sign-in (needs real provider keys or a mock).
- The APK was rebuilt in Phase 5 with everything pending (camera, date picker, image picker, Kotlin module); it runs the current JS.

**Phase 2 detail (2026-11-05)**

- Checked on the emulator in Expo Go against a real server, confirming results through the API: new folder,
  rename, move, star, new tag and apply, trash and Undo, restore, delete forever; filters, sort, grid and list,
  breadcrumbs, per-tab history, paging over 352 items, search, storage report.
- Also checked: admin row for an owner and not a member; a viewer gets no edit actions or New; two servers switch
  with nothing crossing over; sign-out; connection loss with recovery; expired session; font scale 1.3;
  remove-animations; tablet width with the rail.
- Also run: tag rename, merge and delete with Undo; sheet drag-to-dismiss; "Sign in again" going to sign-in.
- Built but not run: Empty trash's final delete, the storage report's trash and "Delete older" buttons, and the
  QR, Google, GitHub and OIDC paths with two accounts. Feel and smoothness need a real phone, which `adb` can't judge.
- Seen once: the first launch in Expo Go after an emulator boot showed "Cannot find native module 'ExpoSQLite'".
  It didn't return on later cold launches and the cause isn't known. Watch for it on the phone.
- Avatar ring waits for Phase 5, because there's no backup to report. Tapping a file opens Details until Phase 3.
- Mobile has no ESLint config, so `expo lint` wasn't run. Adding one means a new dev dependency.
- `tsconfig.json` and `.expo/` at the repo root are strays from running Expo in the wrong folder (see Running it).

**Phase 3 detail (2026-11-05)**

- Checked on the emulator in Expo Go against a real server: image (double-tap zoom, pan, swipe out), video, audio,
  PDF, Word, xlsx and CSV, slides, Markdown, code, zip listing. Corrupt, too-big and unknown files each show a real error.
- Also checked: swipe across mixed types and from a sheet's edge; download with matching SHA-256, name clash, cancel with
  no partial file, ZIP; Open with; older version opens labelled with a reduced menu; Use this frame and Reset thumbnail,
  confirmed on the server; trash from the previewer with Undo; a viewer's menu; 30 MB PDF behind the mobile data warning;
  separate caches, wiped on sign-out; font scale 1.3; remove-animations; rotation. A `<script>` planted in Markdown doesn't run.
- Unit tests cover viewer choice, limits, the data warning, cache eviction and base64.
- Built but not run: the Collabora WebView, because memory was short (the "no Collabora on this server" path was seen);
  eviction past 500 MB on a device (unit test only); pinch, which `adb` can't do. Feel needs a real phone.
- Tile morph deferred: Reanimated's shared transitions need a static flag and a native rebuild, so not in Expo Go. The
  app uses the Stack's quiet transition. Retry at the next native build.
- The next native build also adds background audio with lock-screen controls and picture-in-picture (`app.json` plugins).
- `File.createFile` adds " (1)" after the extension when a file has no mime type (`huge.docx (1)`). Harmless; files uploaded
  with a type are fine (`clip (1).mp4`).
- The first launch in Expo Go after an emulator boot failed again (`globalThis.expo` undefined, also seen as the ExpoSQLite
  error above). A force-stop and relaunch fixes it. It looks specific to Expo Go; watch for it on the phone.
- Dev data: `browser-test` has a "Preview test" folder with one file per type, shared with `newbie` as viewer.

**Phase 4 detail (2026-11-05)**

- Checks: 182 of 182 API checks, 22 mobile unit tests, 59 web unit tests, web and mobile typecheck, `next build`, 4 of 4 e2e.
  Start the worker for e2e, and don't run `next dev` straight after `next build` without clearing `.next`: `/sign-in` reloaded in a loop.
- Checked on the emulator in Expo Go, confirming results through the API:
  - Sharing: add a member, change role, viewer sees no Share, reshare off shows "You can't share this", ownership offered and
    accepted in the bell (old owner becomes editor).
  - Links: New link opens Android's share menu; download switch, expiry presets and date picker, password (the link page then asks
    for it), access log with "Chrome on Android", delete; Copy link creates then reuses, from ⋯ and the selection bar.
  - Details avatars and link count. Previewer Share button.
  - Versions from ⋯ and Storage: make current with Undo, keep forever, note, save as separate file.
  - Search: recents per account, chip with no text, snippet, results as a list.
  - Bell and Shared badge; opening clears them; a notification opens its folder and the app-password screen.
  - Account: 2FA on, backup codes, new codes, off; password change. **The app stays signed in through each token change.** App
    password create, shown once, revoke. Notification switches, vault lock, preset and gallery avatars with crop.
  - Font scale 1.3, tablet width with the rail, connection loss with Try again.
- Second emulator pass, on a throwaway account: temporary-password gate stays signed in; backup-code sign-in; Delete version and
  Delete older; file-drop switches and upload limit; required link password and `maxLinkDays`; public links off; admin alert opens
  the browser, admin row and admin-only settings show; app password over WebDAV (list, download, wrong password refused);
  remove-animations; "can't send email" message on an email share.
- That pass fixed two bugs: the link name and upload limit were lost on Back (now Save buttons and the keyboard's ✓), and Copy link
  copied an existing link while public links were off.
- The user tried it on a real phone and said the UI feels great. The full checklist hasn't been reported step by step.
- Not run: an email invite actually being delivered, and the gate's two-factor step. Both need a server-wide setting (email, or
  `require_2fa`) that would have disturbed the phone in use. With the keyboard up, the Save limit button sits under it; ✓ saves.
- Provider connect and disconnect: built, unverified. Needs the next native build and a mock OIDC server, or real keys.
- Departures from the plan, all smaller: the QR uses `uqr`, already used by the web, not `react-native-qrcode-svg`. A single shareable
  selection swaps Star for Copy link in the bar, because five icons squeezed out the count; Star stays under ⋮. The access log loads the
  server's maximum of 500 at once instead of paging. "How to connect" opens the web's per-OS guide rather than copying it. No password
  strength meter: the policy shows as a hint and the server enforces it.
- The server's Set-Cookie is how a password change returns its new token (`newToken` in `lib/api.ts`), and Expo's `fetch` takes
  form parts with `bytes()`, not React Native's `{ uri }`. Phase 5 uploads should remember the second one.
- The next native build also adds the date picker's config plugin and `expo-image-picker`.
- Seen again: Expo Go's "Cannot find native module 'ExpoSQLite'", this time right after a forced screen size change.

**Phase 5 detail (2026-11-06)**

Decisions are in Claude's project memory (Phase 5 decisions). The plan was `~/.claude/plans/start-buiding-phase-5-partitioned-sifakis.md`.

- Checks: 182 of 182 API checks (with `uploadSpeedBytes` on `/me`), 33 mobile unit tests (`upload-plan`, `backup-rules`), 6 Kotlin
  JUnit tests (`modules/nimbus-android/android/src/test`, run with `./gradlew :nimbus-android:testDebugUnitTest`), web and mobile typecheck.
- **Expo Go (tus-js-client):** New menu; files, folder (tree, empty folder) and photo pickers; each conflict choice against the
  server (Keep both gives `clip (1).mp4`, New version adds v2 with the right SHA-256); blocked extension shows the server's reason;
  1 MB/s cap held; pause and resume; over 100 MB on mobile data asks, Wait for Wi-Fi holds then starts; Change thumbnail.
- **Installed APK (Kotlin, WorkManager):** a 300 MB upload survived airplane mode and a `kill -9` of the app mid-upload, resuming
  from its offset; three copies byte-identical with the hash stored. Share from the Files app: right name and size, Save returns to
  the sender, hash matches.
- **Camera backup:** a geotagged JPEG backed up byte-identical (so GPS kept); a photo already elsewhere in My files skipped by hash;
  a same-named file with other bytes in `Camera/2026/11` got `(1)` and no version; Wi-Fi off shows "Waiting for Wi-Fi", charging-only
  shows "Waiting to charge"; the ring is whole teal; albums list; Free up space left out a photo trashed on the server, and Android's
  own dialog removed exactly the others.
- Found and fixed: tus-js-client reads a part's Blob-style `size` (bytes need it attached); the strip's auto-clear removed
  "Same as…" rows before anyone could decide (now the strip says "1 file already in Nimbus" until opened); a wait-for-Wi-Fi job that
  ran just before Wi-Fi became the active network re-queued itself with KEEP and was dropped, so backup sat waiting (now APPEND,
  and opening the app also runs backup once; rechecked: a waiting photo went up 8 s after Wi-Fi returned, nothing forced).
- Final APK pass: a 300 MB upload resumed and finished about 150 s after a reboot without opening the app; the first-sign-in offer
  shows, its second step counts older items; signing out of the backup account turns backup off and says so; TalkBack hears the
  backup state as part of the account button.
- Expo Go only: picked videos get no thumbnail, because expo-video can't open files under Expo Go's cache folder (its name holds a `%`).
- Photo picker names: Android's picker reports `1000000048.jpg`, which is the library's ID; the installed app asks the media library
  for the real name when it has photo access (checked: `IMG_20261106_013500.jpg`). Without that access, and in Expo Go, the numbered name stays.
- Needs the phone: Scan document (the AVD has no Play Store, so Play services shows "Something went wrong"; Cancel returns cleanly),
  manufacturer background limits, reliable backup's foreground service on a real battery, and the feel of the strip and ring.
- Not done: the tile morph retry (left for Phase 8's build); provider sign-in still unverified.
- Dev data: `browser-test2` has `Camera/2026/11` and `v300*.bin` from these tests.

**Phase 6 detail (2026-11-06)**

Decisions are in Claude's project memory (Phase 6 decisions). The plan was `~/.claude/plans/start-buiding-phase-6-compiled-church.md`.

- **Checks:** 182 of 182 API checks, 39 mobile unit tests (6 new `offline-rules`), 10 Kotlin JUnit (4 new `DocsTest`), web and mobile typecheck, APK build.
- **Expo Go, with each result confirmed through the API:**
  - **Marking:** marking a folder kept 21 files (85 MB), with the badge, the Offline screen, the More row and the chip.
  - **In airplane mode:**
    - Opened folders browse, and an offline-marked folder that was never opened lists its kept files.
    - The PDF and Markdown open from the phone.
    - Other files are greyed, and tapping one says "Not available offline".
    - Recent comes from saved data; Starred, never opened, says so.
  - **Cold start offline** opens into the saved data.
  - **Queue replay:** the queue replayed a rename, a star, a new folder, a move into that new folder (picked offline), and a clashing rename (became `app (1).ts`). A move into a folder trashed on the server meanwhile went to "Couldn't sync"; Retry worked after restoring it.
  - **Refresh:**
    - A file trashed on the server dropped its copy.
    - A version switched on the server was refreshed; the phone showed the new content offline.
    - Lost access to a shared file deleted its copy, and you're told.
  - **Accounts:** each account's offline data is separate. Sign-out deleted that account's offline files, rows and saved lists (checked on disk as root).
- **APK:**
  - **Files app basics:**
    - The root shows per account with its email.
    - My files, Shared with me, Starred and Recent list with thumbnails.
    - New folder works.
  - **Writes:**
    - Copying a file in stores one version with the right SHA-256.
    - Rename shows at once; delete goes to Trash.
  - **App lock:** the root is hidden while locked and returns after unlock.
  - **Open with** hands Google Photos a `content://org.nimbus.drive.documents` link with read and write grants, and the photo loads.
  - **Refresh:** opening the app pulls a new file in a marked folder. With the process killed, the forced background task ran headless, downloaded a new file, and rescheduled itself for 6 h.
  - **Uploader:** works through the provider path after the `Store.kt` v3 and `Sender.kt` changes.
- **Found and fixed:**
  - A marked folder spun forever offline. `send()` now gives up after 15 s with no response, and the folder uses kept files whenever offline.
  - Queued edits didn't show in folders drawn from the offline store. `applyOp` is now shared.
  - No New button in offline-store folders.
  - The Move picker failed offline. It now builds from saved lists, kept items and folders made offline.
  - "Refresh now" hid the lost-file notice.
  - Provider document ids split on the first `:`, but account ids contain `http://host:port`. They now split on the last `:`, with a test.
  - Files made in the Files app kept an empty version 1. It is now dropped after the real upload.
  - Rename and delete in the Files app didn't refresh its list.
- **Not run:**
  - Saving over a file from an editor (new version), the `(conflict)` copy, and saving while offline through the provider. The AVD has no editor, and installing one from F-Droid was refused. **Check on the phone with any editor.**
  - The cap prompt past the limit (unit-tested only; no file over 1 GB in dev).
  - Real 6-hour background timing and manufacturer limits.
- **Open points for the user:**
  - The app lock offer says "You can change this later in More", but there's no such switch. This is from Phase 1.
  - The Files app root hides 60 s after leaving Nimbus while the lock is on (the lock's own timeout), which is short for Files app sessions.
- **Departures:** Copy isn't offered in the Files app (no copy route; it falls back to create plus write). Download stays greyed offline.
- **Server change:** `parentId` was added to item details.
- **New dependencies:** `expo-background-task` and `expo-task-manager`, with the new `apps/mobile/index.js` entry.
- **Dev data:** `browser-test2` has `FilesAppTest` (p6-*.txt) and offline marks on the emulator. Preview test was restored.

## Working rules for this machine

- 15 GB of RAM, and the load has already crashed Cursor. **One heavy job at a time**: emulator, Gradle,
  `next build`, e2e or a builder agent. Check `free -g` first.
- **Don't rebuild for ordinary changes.** JS and TS reach the app through Metro. Batch native changes
  and build once, when the user is ready to install.
- Close Metro, `next dev`, the emulator and Gradle daemons when they aren't needed. The user may run
  the dev servers themselves, so check before stopping one.
- Commit only when asked.

## Running it

```bash
npm run dev                                                   # web, from the repo root
cd apps/mobile && unset NODE_ENV && npm run go      # Expo Go
cd apps/mobile && unset NODE_ENV && npm start       # Nimbus APK
```

Both first run `npm run viewers`, which builds `viewer/*.ts` into `src/lib/viewers/` (generated, not committed). The app,
`npm run typecheck` and any native or release build need that folder, so run it first on a fresh clone, or after editing `viewer/`.

Run Expo from `apps/mobile`, never the repo root: at the root it generates a stray `tsconfig.json` and `.expo/`.
Use `--go` for Expo Go and `--dev-client` for the APK: Expo Go on a `--dev-client` Metro kept running a stale bundle.

Native build, about 5 minutes, needs a JDK with a compiler (`~/Android/jdk`):

```bash
cd apps/mobile && CI=1 npx expo prebuild --platform android --no-install
cd android && unset NODE_ENV && JAVA_HOME=~/Android/jdk ANDROID_HOME=~/Android/Sdk \
  ./gradlew :app:assembleDebug -PreactNativeArchitectures=arm64-v8a,x86_64 --max-workers=3; ./gradlew --stop
```

Dev addresses, with `192.168.0.108` as this computer's address at the time of writing:

- Computer's browser: `http://localhost:3000`. Other origins get a 403 from sign-in.
- Phone, and the "Address your phone can reach" field: `http://192.168.0.108:3000`.
- Metro for the APK: `http://192.168.0.108:8081`.
- Files on a phone: `TUS_URL` and `S3_ENDPOINT` in `apps/web/.env.local` say `localhost`, so previews and uploads
  fail from a phone. For a phone check set `S3_ENDPOINT=http://192.168.0.108:9100` (and `TUS_URL` from Phase 5), then
  restart the web server. The emulator doesn't need this: `adb reverse` covers it.
- If a phone can't connect, `ufw` may be blocking it:
  `sudo ufw allow from 192.168.0.0/24 to any port 3000,8081,9100,1080 proto tcp`

## Decisions

| Area | Decision |
|---|---|
| Server | User enters the URL on first launch, or scans it |
| Distribution | Android only, signed APK first (GitHub releases); Play later without rework |
| Audience | Any self-hoster, so handle varied servers and versions |
| Scope | Full member parity, no admin. Main job: find, back up, replace Drive and share equally |
| Android features | Camera backup, share into Nimbus, offline files, Files app integration |
| Vault | Full. Passphrase, plus optional per-Vault fingerprint unlock (Android Keystore) |
| Look | Same Nimbus (tokens, Geist, file hues, teal cloud), native gestures and sheets. Dark only |
| UI quality | Must feel professional, smooth and easy to navigate. Impeccable on every screen |
| Navigation | Bottom tabs: Files, Recent, Shared, Starred, More. Navigation rail on tablets |
| Files home | **Google Drive standard**, chosen on the decision page (contract below) |
| File view | Grid default, list toggle. Tap opens, long-press selects, ⋯ for actions |
| Sign-in | All methods the server has on: password, Google, GitHub, OIDC, TOTP |
| QR sign-in | QR or short code from web Account; see below |
| Accounts | Multi-account across multiple servers |
| App lock | Biometric or PIN, offered at first sign-in, can be declined |
| Backup | Camera, new items by default; other albums and older items optional |
| Backup rules | Wi-Fi default, configurable (mobile data, charging, videos on Wi-Fi only) |
| Backup engine | Periodic by default, "reliable backup" toggle uses a foreground service |
| Backup target | `Camera/YYYY/MM` in My files; originals stay until "Free up space" |
| Offline | Marked items auto-refresh on Wi-Fi, size cap. Browse cached lists, queue changes |
| Previews | All in-app, swipe between files, "Open with" as the escape. Answers in Claude's project memory (Phase 3 decisions) |
| Files integration | Read and write; Vaults hidden |
| Notifications | Self-hosted push through UnifiedPush/ntfy, polling fallback |
| Sharing | Native full-screen Share page with drill-downs, then Android's share menu for links. Answers in Claude's project memory (Phase 4 decisions) |
| Search | Full screen: recents, filter chips that work with no text, server content search, results always a list |
| Account | All settings native, as a hub with sub-pages: avatars, password, 2FA, app passwords, prefs, Vault lock |
| API | Private `/api/v1` in `apps/web`, logic shared with web, with a version check |
| Code sharing | `packages/shared`, with tests that lock Vault format compatibility |
| Build | Local Android SDK and emulator; no EAS |
| Expo Go | Must keep working for everything that doesn't need native code |
| Admins | One "Open admin on web" row under More, owners and admins only |
| Devices | Phone-first; tablets get a wider grid and nothing broken |
| Telemetry | None. "Copy diagnostics" button only |

Defaults the user wasn't asked about: package ID `org.nimbus.drive` (permanent once public); APK signing
key generated locally, never committed, and the user must back it up; plain http and private CAs allowed,
with a warning; public share links and invites open in the browser; Vaults excluded from offline, Files
integration and background upload.

### QR sign-in

Built. The QR holds the server address and a one-time token, never a password. Web Account → "Sign in on
your phone" shows it with a short code. The device claims it, the web page approves it by name, and the
device collects its own session once. Codes last 2 minutes and refresh while the page is open. On by
default, with an admin switch recorded in the audit log. Desktop apps should reuse the same flow.

### Expo Go limits

Works: all screens, password and QR sign-in, the in-app scanner. Doesn't work: Google, GitHub and OIDC
(the `nimbus://` return can't reach Expo Go), a QR opened from the phone's camera app, and anything in the
Kotlin module. Check for native features at runtime and hide them; never import the module unguarded.

## Architecture

```
apps/web/app/api/v1/*        JSON routes (thin: auth, validate, call service). See README.md there
apps/web/lib/services/*      logic moved out of the action files; takes `me`
apps/web/lib/device-link*    QR sign-in
packages/shared/             file-rules, vault-crypto, api.ts (types for every route)
apps/mobile/src/             Expo Router app
apps/mobile/modules/nimbus-android/   Kotlin, from Phase 5: uploader, DocumentsProvider, push, credentials
```

- **Auth:** `expo()` and `bearer({ requireSignature: true })` in `lib/auth.ts`. Requests send
  `credentials: "omit"` so two accounts on one server don't share Android's cookie jar.
- **Mobile stack:** Expo SDK 58, Expo Router (`src/app`), TanStack Query, `expo-sqlite`, reanimated, gesture
  handler, Geist, `phosphor-react-native`. Tokens in `src/lib/theme.ts`, components in `src/components/ui.tsx`.
- **Native module:** one Expo module with a config plugin, holding:
  - **Uploader:** tus in Kotlin on WorkManager, periodic by default, expedited with a `dataSync` foreground
    service for reliable backup. All non-Vault uploads use it.
  - **DocumentsProvider:** each account is a root. Open downloads to cache; close-after-write uploads.
  - **UnifiedPush receiver:** registers the endpoint, shows notifications.
- **Previews:** native for images, video (`expo-video`) and audio (`expo-audio`). PDF, Word, sheets, slides, Markdown,
  code and zip use one small page per viewer (`apps/mobile/viewer/`), built from the web's parsers. The pages have no
  network or file access and a hash-based CSP; the app fetches the bytes and sends them over a bridge. A page tells the
  app when it scrolls sideways, so the pager steps aside and a swipe from its edge changes file.
- **Vault:** Hermes has no WebAssembly or WebCrypto, so inject `crypto.subtle` from
  `react-native-quick-crypto` and a native Argon2id in place of `hash-wasm`. Vault uploads reuse the web's
  `vaultReader` with `tus-js-client` while the app is open.

### Traps to handle deliberately

- **Same-name uploads become versions only when asked** (`onConflict: "version"`). Backup always sends `"rename"`
  and checks `POST /api/v1/uploads/exists` first: same bytes anywhere, or same name and size in the month folder, is skipped.
- **Photo GPS:** request `ACCESS_MEDIA_LOCATION`, or Android strips location. Backup must be byte-identical.
- **Android 15 caps `dataSync` services at 6 hours a day.** Save offsets and resume in the next window.
- **Free up space** deletes only after the server confirms, through Android's `createDeleteRequest` dialog.
- **Video thumbnails:** the worker doesn't draw them, so the app generates one and posts it to
  `/api/files/{id}/thumb`.
- **Offline queue:** a change that fails on replay shows in a visible failed list, never dropped silently.
- **Two-factor changes issue a new token** and invalidate the old one, so save the new `set-auth-token`.

## Design contract

Full brief: `apps/mobile/.impeccable/surfaces/apps-mobile.md`. Mode: Operate, code-led. Material 3 structure
themed with DESIGN.md's tokens.

- **First screen:** status bar, 56dp search pill with the avatar inside its right end, scrolling filter chips
  (Type, Modified, Size, Tags), then a sort label with a grid/list toggle. "Folders" as two-column one-row
  tiles, "Files" as two-column cards with 4:3 thumbnails. Extended "New" FAB bottom-right, above the five tabs.
- **Signature move:** the avatar in the search pill wears a thin ring showing backup state: teal progress while
  uploading, complete teal when backed up, destructive when failing. Tapping it opens the account sheet
  naming the server.
- **Motion:** container transform from tile to previewer, shared-axis for folder depth, FAB shrinks on scroll,
  all honouring the system's remove-animations setting.
- **Finish:** the build ends with the finish review, the verdict, a Mobile section in DESIGN.md, and provenance
  on every shipping raster.

## Web parity

The app has **everything the web has except the admin section** (user, 2026-11-05). A feature hidden until its
phase is scheduled, never dropped. Checked against the web's pages, `components/` and `/api/v1`.

| Web feature | Phase |
|---|---|
| My files, folders, breadcrumbs, Recent, Starred, Shared (with me, by me), Trash | 2 |
| Grid and list, tile size, density, sort, filters (Type, Modified, Size, Tags), Select all | 2 |
| New folder, rename, move, star, trash with Undo, restore, delete forever, empty trash | 2 |
| Shortcuts: add and remove (the row in the ⋯ menu; the shared-folder flow comes with sharing) | 2 |
| Tags: apply, create, tag page, rename, recolour, merge, delete with Undo | 2 |
| Details, storage meter, storage report and its folder drill-down | 2 |
| Search by name and contents | 2 (simple), 4 (recents, chips). The palette's commands don't carry over: every destination is a tab or a row |
| Multi-account: saved logins and the browser's switcher become native accounts | 2 |
| Previewer: all types, zoom, swipe, older versions, Open with, Collabora view-only. Trash deliberately keeps Details, unlike the web (user, 2026-11-05) | 3 |
| Download, zip download of several items, Reset thumbnail, video "Use this frame" | 3 |
| Share dialog, links, access log, ownership transfer | 4 |
| Versions dialog, including from the storage report and Details | 4 |
| Account: avatar, sign-in methods, password, two-factor, notification prefs, app passwords ("Connect a device"), Vault lock | 4 |
| Notification bell | 4 |
| File and folder upload, conflict dialog, upload panel, Change thumbnail | 5 |
| Vault: everything, including Move to vault | 7 |

Doesn't carry over: keyboard shortcuts, right-click and drag and drop, which the phone's touch gestures replace;
"Sign in on your phone", which this app is the other end of; public link pages, which open in the browser (see
Decisions).

## Phases and how each is checked

| # | Delivers | Verify |
|---|---|---|
| 2 | Tabs, Files home to the contract, grid and list, breadcrumbs, thumbnails, selection, rename, move, star, trash with Undo, restore, delete, tags, filters, sort, details, storage meter, More tab with admin row, account switcher | Each action matches the web's view; a member never sees the admin row and an owner does; two servers switch cleanly |
| 3 | Previewer for images, video, audio, PDF, Word, sheets, slides, Markdown, code. Swipe, download, Open with | Open one seeded file of each type; overlong and corrupt files show a real error |
| 4 | Sharing sheet, links, access log, ownership, shortcuts, search, bell, versions, all account settings | Share between two accounts both ways; each setting round-trips with the web |
| 5 | Kotlin Uploader, New menu, conflict sheet, share into Nimbus, camera backup with every rule, Free up space | 1 GB upload survives airplane mode and app kill; EXIF GPS byte-identical; no accidental versions; rules enforced |
| 6 | Offline marks, auto-refresh, size cap, cached browsing, change queue, DocumentsProvider | Airplane mode browse and open; queue replays; failures visible; another app opens and saves through the picker; Vaults absent |
| 7 | Vault: create, unlock, browse, preview, upload, download, trash, recovery code, per-Vault fingerprint, auto-lock | Files made on web open on Android and the reverse, with shared test vectors; keys cleared on lock |
| 8 | Push, polling fallback, diagnostics, release-signed APK, README and `setup.sh` notes, finish review, DESIGN.md | Push arrives through local ntfy with the app killed; fallback works; release APK installs clean; old server shows the update message |

## Risks

- **Real device behaviour:** background limits vary by manufacturer and an emulator can't prove them, so test
  on a real phone before any public release.
- **Size:** phases 5 to 7 are the largest and most native-heavy.
- **Before public release:** `/api/v1` has no rate limiting of its own, and push's SSRF check doesn't pin the
  resolved IP between lookup and connect.
