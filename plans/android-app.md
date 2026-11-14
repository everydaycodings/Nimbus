# Nimbus for Android (Expo)

Native Android app with every member feature and no admin panel, for any self-hoster to point at
their own server. Apple is dropped for now. Last updated 2026-11-12 (Phase 16, playback).

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
| 7 | Vault | Built and checked on the emulator (APK), see below. Waiting on the user's phone check |
| 8 | Push, release APK, web download, docs, finish review | Built and checked on the emulator (release APK), see below. Waiting on the user's phone check |
| A | Full test of 0–8, security audit, licences, crash capture, rate limits, Maestro flows → 0.1.1 | Done 2026-11-07, see below. Phone checklist pending |
| 9 | App shortcuts, widgets, Quick Settings tile, direct share targets | Done, committed ("added till phase 9") |
| 10 | Photos tab (replaces Recent), background audio, PiP, slideshow | Built 2026-11-07, checked on the emulator (release APK), see below. Committed; released as 0.2.0 (GitHub Actions) |
| 11 | Back up other folders, two-way folder sync, export to SD/USB | Built 2026-11-07, checked on the emulator (release APK), see below. Committed; released as 0.2.0 (GitHub Actions) |
| 12 | Text editor, multi-page scan, activity feed (web + app) | Built 2026-11-07, checked on the emulator (release APK), see below. Committed; released as 0.2.0 (GitHub Actions) |
| 13 | File requests, Transfer, Vault share links | Built 2026-11-07 on web + app. Web: e2e-tested and Impeccable-polished. App: checked on the emulator (Expo Go and the release APK), Maestro 14/14, Kotlin 43/43. Not committed yet. See "Phase 13 status" |
| 14 | Comments on files (web + app) | Built 2026-11-12 on web + app. Web e2e (comments.spec.ts) passes. App: checked on the emulator in Expo Go (row badge, preview bar button, comments screen, @mention suggestions, a comment with a mention from the phone, reactions shown); release APK (x86_64, Cursor open, 7m 54s) with Maestro 16/16 including the new `comments` flow. Web e2e 9/9, including time and PDF-page chips. Not committed. See "Phase 14 status" |
| 15 | Photos: On this day, places map, smart groups, shared albums, partner sharing, quick edits | Built 2026-11-12 on web + app. API check 231/231, web e2e 15/15 (new photos-phase15.spec.ts). App checked in Expo Go and the release APK (x86_64, 9m 10s): map, daily notice, Maestro 19/19, Kotlin 48/48. Not committed. See "Phase 15 status" |
| 16 | Playback: cast to TV, sleep timer and speed, data-saver video quality | Built 2026-11-12 on web + app. API check 248/248 (17 new playback checks), web e2e 15/15, browser-checked and Impeccable-polished on the web. App 0.2.7: tsc and 92 unit tests pass; release APK (x86_64, Cursor open, 9m 24s), Maestro 19/19, emulator-checked. Cast on a real TV untested. Not committed. See "Phase 16 status" |
| 17 | Passkeys, 2FA after provider sign-in, restore a folder to a point in time | Built 2026-11-12 on web + app (0.2.8). Web: tsc, lint, 66 unit tests, e2e passkeys 3/3 + restore-point 2/2, full suite green (vault-link flaky once). App: release APK (x86_64, Cursor open, low-memory recipe, 13m 49s), Maestro 20/20 with the new `restore-point` flow. Impeccable-polished. Android passkeys and real Google/GitHub untested. Not committed. See "Phase 17 status" |
| 18 | PDF tools (markup, fill, sign), contacts and calendar backup, system folders | Built on web + app; 0.2.9/0.2.10 released. System folders built 2026-11-13 (uncommitted): web prod build + e2e, release APK (Cursor open, low-memory recipe, 11m 34s), Maestro 23/23 incl. new `pdf-edit`, `phone-backup`, `system-folders` |
| 19 | Smart search: server OCR of images, scans and video frames, with where-it-matched results | Planned |
| 20 | Optional AI service (admin): face grouping, speech search, search by what's in a photo | Planned |

**0.2.2** (2026-11-07, versionCode 5): in-app updates. More → About → Check for updates asks the server's /api/android/latest (GitHub's latest release, or the bundled APKs), shows the notes (the tagged commit's message, now written into each GitHub release by the workflow), downloads the APK for the phone's ABI with progress, asks once for "Install unknown apps", then opens Android's installer. Tested end to end on the emulator. Server: the bundled fallback now offers only the newest version's APKs (it mixed 0.1.0 and 0.1.1).

**0.2.1** (2026-11-07, versionCode 4): New folder in Save to Nimbus; camera backup queue (tap the status card) with pause/resume for the whole backup or one file, skip one or all, and a Skipped list to back up again. Fixes found on the emulator: queued rows now send when a run finds no new photos (resumed and Wi-Fi-held videos were stuck, and the run looped into the rate limit), backup runs take turns (overlapping runs marked finished uploads failed), and the queue keeps a fixed order.

**Phases 9–12 built and committed** (2026-11-07). API 2, app 0.2.0 (versionCode 3), released through GitHub Actions (tag v0.2.0); signing secrets set in the repo. Each means several hours of building, a native build, emulator testing and a commit.
Answers are in Claude's project memory (Part A + 9–12 decisions); plan `~/.claude/plans/so-all-phases-8-gentle-popcorn.md`.

- **Phase 9, phone extras** (Kotlin in `modules/nimbus-android`, wired by its config plugin):
  - **App shortcuts:** Upload, Scan document, Search, Take photo to Nimbus (static shortcuts to `nimbus://` routes).
  - **Widgets:** Recent / Starred list per account (account picked when placing), and a quick Upload / Scan widget. Data from a
    small cache the app and the push/poll worker write; hidden while app lock is on.
  - **Quick Settings tile:** pause/resume camera backup with its state; long-press opens backup settings.
  - **Direct share targets:** recent upload folders published as sharing shortcuts, so they show in Android's share sheet.
- **Phase 10, media:**
  - **Photos tab replaces Recent** (tabs: Files, Photos, Shared, Starred, More). Recent moves to a chip on Files home and a More row.
  - Timeline of all images and videos the user owns, by EXIF date taken, falling back to upload date; month headers, fast scroller,
    grid zoom levels. Server: `takenAt` on file versions (read from EXIF by the worker, backfilled) and a paged `GET /api/v1/photos`.
    The web gets the same Photos page (parity rule).
  - **Background audio** with lock-screen controls, folder queue and resume position.
  - **Video picture-in-picture.**
  - **Slideshow** of a folder or the timeline, with an interval setting; respects remove-animations.
- **Phase 11, sync** (all through Android's folder picker, no all-files permission; camera backup's rules; WorkManager every
  15 min and on app open; the reliable-backup switch; live/push signal for server changes):
  - **Back up other folders:** one-way, a target folder in My files for each, same skip-by-hash rules.
  - **Two-way folder sync:** a state DB of the last-synced hash per path; when both sides changed, keep the server's and upload the
    phone's as `name (conflict, <device>).ext`; deletes go to Trash, never forever; failures in the Couldn't sync list.
  - **Export to SD / USB:** "Save to device…" for files and folders through the folder picker.
- **Phase 12, productivity:**
  - **Text editor:** .txt, .md and code files up to 1 MB; monospace, undo, find, Markdown preview toggle. Save makes a new version,
    refuses if the server's version changed (offers Keep both); offline saves go through the change queue.
  - **Scanning:** Play scanner in multi-page PDF mode, auto-named `Scan 2026-11-06 14.32.pdf`, folder choice; hidden without Play services.
  - **Activity feed, web and app:** uploads, edits/versions, renames, moves, shares, trash/restore (no views or downloads). Owners see
    everything on their files, others only what they can access. Shown in Details on both. Retention admin setting 30/90/365/forever
    (default 90), purged by the worker, saved through `saveSettings` for the audit log.

Each phase: a short decision check only if something new comes up, build, Impeccable pass on new screens, a Maestro flow, a check on
the release APK, an update here, a commit.

**Phases 10–12 detail (2026-11-07)**

Built by three parallel builder agents, then integrated and tested here. Migration `0028_phases10_12.sql` (activity table,
`file_versions.taken_at`, `settings.activity_retention_days`), applied to the dev DB.

- **Checks:** 203/203 API checks (new: photos timeline, `/tree`, activity), 72 mobile + 56 web + 9 shared unit tests, Kotlin
  `SyncRulesTest` (12) and the old suites, web and mobile typecheck. Maestro: all 11 flows pass on the x86_64 release APK
  (new `photos`, `editor`, `folder-sync`). Web Photos page and Details → Activity checked in the browser.
- **Two-way sync run by hand on the emulator** (Documents/nsync ↔ a My files folder): first upload, phone edit → new version,
  phone add, phone delete → server Trash, server rename and trash → phone, both-sides edit → server copy kept on the phone and
  the phone's uploaded as `alpha (conflict, sdk_gphone64_x86_64).txt`, which then came down; later runs settle on "Nothing changed".
- **Found and fixed:** adding a pair always failed (Expo's picker returns a document URI inside the tree; Kotlin now stores the
  tree URI); versions with no SHA-256 (uploaders that don't send one) made sync re-download them every run — the worker now
  hashes them (`hashMisses` in `scripts/derive.ts`, 20 per sweep); Activity lines ended in "…new version of" (now "…of it",
  web and app); Maestro flows: sheet scroll for "Move to trash", the Photos tab vs a folder named Photos, picker timing, slideshow
  controls auto-hide, keyboard before Back.
- **Not run, for the phone:** background audio and lock-screen controls (AudioPlaylist next/previous), PiP, Save to device,
  SD card/USB pulled mid-sync, Android 15 `dataSync` cap on Reliable sync, Play scanner multi-page, the takenAt backfill on a
  big library (worker), the editor's offline save replay.
- **For review:** the status line shows only the last run (right after adding a pair it can say "Nothing changed" though it just
  uploaded); web Activity names you ("Browser Test"), the app says "You"; non-owners never see share events; folder sync has its
  own Wi-Fi/charging/reliable switches; mass-delete guard holds a run past max(10, half the files); videos sort by upload time.
- **Machine:** Cursor's Java/Gradle extensions imported `apps/mobile/android` and crashed Cursor during the APK build;
  `.vscode/settings.json` now turns their Gradle import off.

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

**Phase 7 detail (2026-11-06)**

Decisions are in Claude's project memory (Phase 7 decisions). The plan, with the JS–Kotlin contract, was
`~/.claude/plans/start-building-phase-7-tidy-shell.md`. Built by two builder agents (Kotlin, JS) against that contract.

- **Crypto in Kotlin** (`Vault.kt`, BouncyCastle Argon2id, javax.crypto). Keys never reach JS: they stay in `VaultKeys` until the vault locks.
  `packages/shared/scripts/vault-vectors.ts` writes fixed vectors from the web's own code, and `VaultTest` (11 tests) checks them byte for byte.
- **Checks:**
  - 182 of 182 API checks.
  - 47 mobile unit tests (8 new `vault-rules`).
  - 21 Kotlin JUnit tests.
  - 6 shared crypto tests.
  - Mobile and web typecheck, and an APK build.
- **Emulator (APK), each result confirmed by a Node script using `packages/shared/vault-crypto.ts`, playing the web's part:**
  - **Web-made vault on the phone:** it unlocks with the passphrase (real `{t:3, m:64 MB}` Argon2id). Names decrypt, including `notes – é.txt`. Preview temp files match the SHA-256 of the originals.
  - **Phone-made vault on the web:** its passphrase and its recovery code open it with the web's code. Uploads decrypt there byte-identical.
  - **Recovery unlock** opens Change passphrase, and the web then opens the vault with the new one.
  - **Fingerprint:** on, unlock, wrong finger refused. Enrolling a new finger gives "Fingerprints changed, use your passphrase."
  - **Locking:**
    - 30 s in the background locks ("Vaults locked."). So does the 5-minute idle setting (still open at 4 min, locked by 5.5).
    - Lock and closing the previewer delete the decrypted temp files.
    - Screenshots of vault screens come out black (FLAG_SECURE).
  - **Uploads:**
    - A 300 MB vault upload survived Lock, airplane mode and `kill -9`. It resumed from a 16-chunk boundary with the app never reopened, and its hash matches.
    - Its file key row was gone afterwards.
    - Replace from the conflict sheet left one file.
  - **Ways out:** decrypted Download (with the warning), a ZIP of two items, and Open with (the other app sees the real name). Move out lands in My files byte-identical and leaves the vault.
  - **Ways in:** Move to vault. Share from the Files app into a locked vault unlocks it, uploads, and returns to the sender.
  - **Housekeeping:** trash with Undo, restore and delete forever in the vault's trash. Delete vault refuses a wrong passphrase, then deletes.
- **Found and fixed:**
  - **Data loss in Move to vault:** `fetchTo` didn't await `File.move`, which is async in SDK 58. The copy read 0 bytes, an empty file was encrypted, and the original was deleted. Now awaited. Move to vault also refuses to continue when a download's size is off.
  - **Phase 6 regression:** lists restored from disk sent `cursor=null` and got a 400, so My files showed stale data. `qs` now skips null.
  - Vault previews crashed on a plain path where expo-file-system wants a `file://` URI. Kotlin wants the reverse; both are converted in `vault.ts`.
  - Undo of a vault trash matched the item against itself as a name clash and restored nothing.
  - The vault browser didn't refresh after changes on the trash screen. It now reloads on focus.
  - A share arriving as the vault locked was replaced off the stack. Vault screens now replace only their own route, and the previewer closes itself when its vault locks.
  - Move out didn't refresh My files.
  - Pickers and the camera don't count toward the 30 s background lock.
  - A JS reload left keys open in Kotlin. The provider now locks all on mount.
- **Not run:** Expo Go's "needs the installed app" screen (code path only); Scan document and Take photo into a vault (no Play services or camera on
  the AVD); BouncyCastle Argon2 speed on a real phone (the emulator took a few seconds); tablet width and font scale 1.3 on the new screens;
  the Store v3→v4 upgrade on a phone that still has Phase 6 rows (the emulator upgraded silently).
- **Settled with the user:** Move to vault deletes the originals for good once uploaded, as the web does. Plaintext copies from Move to
  vault and Move out are deleted at app start unless an upload is still pending. `eslint-config-expo`, installed by a builder, was pruned.
- **New dependencies:** `bcprov-jdk18on`, `androidx.biometric` (Gradle). No new JS dependencies.
- **Dev data:** `newbie` has the "Web made" vault (passphrase `phone changed this pass`, plus `p7-mid.bin` from share-in). The emulator has fingerprints 1 and 2 and PIN 1111.

**Phase 8 detail (2026-11-06)**

Decisions are in Claude's project memory (Phase 8 decisions). The plan was `~/.claude/plans/start-building-phase-8-jaunty-taco.md`.
Built by builder agents (web/docs, mobile, live connection, review fixes), checked by the lead.

- **Push, three routes:**
  - The user's added choice, built-in **Instant notifications**: a `specialUse` foreground service (`Live.kt`) holds `GET /api/v1/events` (SSE; Redis pub/sub fan-out, `lib/events.ts`) to each account's server, with a quiet "Connected to Nimbus" notification.
  - **UnifiedPush** (ntfy or any distributor; connector 3.3.5).
  - A **15-minute WorkManager poll** when neither is set up.
  - Pushes and events carry no content: the phone fetches `/api/v1/notifications` and shows the server's text, on three channels.
- **Checks:**
  - 185 of 185 API checks (adds instance `version` and the events stream).
  - 53 mobile unit tests, 26 Kotlin JUnit tests (5 new `PushRulesTest`), web unit tests, web and mobile typecheck.
- **Emulator, release APK** (`nimbus-0.1.0-x86_64.apk`, clean install):
  - Push through local ntfy with the app killed: the notification arrives at once with the real text, the Sharing channel and the account name.
  - Built-in instant: a share showed within 4 s with the app in the background.
  - Tapping a notification opens the file (previewer).
  - Backup, vault unlock (BouncyCastle under R8), the version gate with Switch account, About, and Copy diagnostics (addresses and emails shortened) all work.
  - The ntfy card shows when nothing instant is set up.
  - The 15-minute poll with nothing instant set up: a share reached the killed app 14½ min later, showing the Nimbus cloud icon.
  - The final APKs (with the review fixes) install over the earlier release keeping data. Fixes seen on screen: More's status-bar backing and App lock icon, "2 selected" fits, PPT glyph, "This file's contents are missing on the server."
- **Server:**
  - 600 requests a minute per user gives a 429 with a readable message. `/me` is exempt (it works while gated).
  - Push connects to the IP it checked (`pinnedLookup`).
  - `/instance` has `version`.
  - APKs come from GitHub Releases (cached 1 h) with the bundled `apps/web/android/` as fallback; `/android/<file>` refuses path tricks.
- **Web download:**
  - `/app` (public; QR on desktop), the sign-in footer link, and Account under "Sign in on your phone".
  - Chrome on Android doesn't report the architecture through client hints (the emulator got arm64). The page then recommends arm64, and lists every APK under Other versions. On a computer it always recommends arm64.
- **Release:**
  - `npm run release:android` makes the keystore once (`~/.nimbus/`, **back it up**) and builds per-ABI APKs (versionCode ×10 + ABI index) plus universal. All four are signed with one certificate (`apksigner`).
  - `.github/workflows/android-release.yml` builds on `v*` tags when the four keystore secrets are set.
- **Found and fixed:**
  - Android 15's background network block made the first fetch after a push fail. It now retries inside the distributor's foreground window, with the worker as fallback.
  - R8 stripped WorkManager's database constructor, so the release crashed at start (`consumer-rules.pro`).
  - The release script's `umask 077` leaked into the APK copies (mode 600).
  - The bundled APK list was cached for an hour.
  - Desktop visitors were offered the x86_64 build.
  - A Kotlin compile error in `Live.kt`.
- **Finish review:** the verdict was "ship after fixes". Its eight fixes were applied:
  - human previewer errors
  - selection count size
  - one instant option at a time
  - gate "Check again" / "Get the update"
  - a notification for a removed account
  - More's status-bar backing and App lock icon
  - xls/ppt/txt glyphs
  - a Nimbus notification icon tinted teal
  - Screens are in `apps/mobile/.impeccable/review/`. DESIGN.md's Mobile section was updated.
- **Dropped:** the tile-to-previewer morph. Reanimated 4.7's shared transitions (static flag on) don't cross from the tab navigator into the root stack; the quiet transition stays.
- **Not run / for the phone:**
  - Push and live on a real battery with manufacturer limits.
  - Live after a reboot (`LiveBoot`).
  - The distributor picker (needs two distributors).
  - The old-app gate on screen (same component as the old-server one).
  - Downloading and installing an APK from `/app` on a phone.
  - The GitHub workflow (no secrets or tag yet).
- **Open points for the user:**
  - Licence texts aren't shipped with the app (About lists the packages only); Apache 2.0 asks for them.
  - Reinstalling leaves the old install's push endpoints on the server until ntfy reports them gone (harmless, untidy).
  - Rate-limit numbers (600/min per user, 120/min per IP on `/instance`) are guesses.
- **New dependencies:** `org.unifiedpush.android:connector` (Gradle). Optional `ntfy` compose service (profile `push`, port 3405).
- **Dev data:** `browser-test` shared several files with `newbie` and has a public link on `app.ts`. The emulator has the release build signed in as `newbie` and `browser-test`, and ntfy is uninstalled.

**Part A detail (2026-11-06 → 07): full test and hardening, released as 0.1.1**

Plan: `~/.claude/plans/so-all-phases-8-gentle-popcorn.md`. Answers in Claude's project memory (Part A + 9–12 decisions).
Ran on the release APK (x86_64, R8 on), plus Expo Go for JS-only checks. Server-wide settings were tested on a throwaway
copy on :3001 (`nimbus_apptest`, own bucket, Redis `/4` `/5`) with Mailpit and a throwaway Keycloak (`localhost:8180`).

- **Checks:** 187 of 187 API checks, 59 mobile unit tests, 30 Kotlin JUnit tests (new `CrashLogTest`, `ShareTest`),
  web and mobile typecheck, SSRF unit tests (`node --test lib/push-rules.test.ts`).
- **Maestro** (`npm run e2e:android -w mobile`, CLI in `~/.maestro`, analytics off): `sign-in` (clears app data),
  `browse`, `file-actions`, `search`, `preview`, `share`, `account-switch` (adds `newbie` itself). All 7 pass on the 0.1.1 release APK.
  Turn app lock off first: Maestro can't touch the fingerprint. After an emulator reboot, unlock it (PIN 1111) first, or Maestro's driver
  can't start ("not encryption aware") and the run hangs.
  "Sign in" also matches the heading, so the sign-in flow submits with Enter.
- **Android versions:** clean installs on API 29, 33 and 36 pass sign-in, browse and search with no crash. 24–28 weren't run.

**Found and fixed**

- **Back exited the app from every screen** in the installed app (not Expo Go): predictive back with RN 0.88. `predictiveBackGestureEnabled` is now false.
- **Security audit** (read-only agent, then fixes): no silent http fallback (a bare host is https only; typing `http://` shows the warning
  everywhere); `nimbus://` sign-in links ask "Sign in to <origin>?" first; push SSRF guard covers IPv4-mapped/embedded IPv6
  (`net.BlockList`); the OAuth return carries a 60 s one-time code exchanged at `/api/auth/app-return/exchange`, never the session;
  share-in takes only other apps' `content://`; the vault recovery code is FLAG_SECURE and copied codes are marked sensitive;
  a push endpoint can't be taken over by another user.
- **OIDC on a plain-http issuer** failed in the app (the Expo proxy is https-only). `/api/auth/app-authorize` allows http only for the
  configured OIDC issuer. Verified end to end with Keycloak, including the exchange.
- **Session loss and gates hidden by cached data:** a 401 or a gated 403 with a list on screen kept showing it. A QueryCache handler
  (`AuthWatcher` in `_layout.tsx`) sends any auth loss on the active account to `/`.
- **The API ignored the confirm-email and required-2FA gates**, so the app kept working after an admin required 2FA. `withMember` now uses `gateOf`.
- **TalkBack read the app behind the lock screen and the version gate** (absolute overlays above native screens aren't in the
  accessibility tree): both are now `Modal`s.
- **App lock re-locked after a sign-in tab or a picker** that took over a minute: `lib/picking.ts` (also used by the vault lock), with a
  5 s grace because results arrive before the app reports active.
- **Camera backup:** photos added while a run was going were skipped until the next trigger while it said "All backed up" (the worker now
  looks again before finishing); a 429 or 5xx marked photos failed for good (now requeued); 429 shows as "The server is busy, trying
  again shortly"; no-access showed no way out ("Allow access" now) and stayed failed after access came back (cleared at once now).
- **Collabora:** its own "<" left a blank page (hidden by script; its CSP blocks an injected `<style>`). README: `--o:welcome.enable=false`.
- **Accessibility and large text:** 27 dp notification switches and a 41 dp breadcrumb row are now 48 dp; at 2.0× the tab labels ran
  together (capped at 1.3×) and folder tiles split names mid-word (one column past 1.3×; one-word names ellipsize).
- Smaller: sign-up's password submits on Enter; licence detail Back returns to the list; crash prompt copy; `/app` explains Chrome's
  "File might be harmful" warning.

**Added (A5):** open-source licences screen (`scripts/licences.mjs`, generated and gitignored, run by go/start/release); local-only crash
capture (`CrashLog.kt` + root error boundary, "Nimbus closed unexpectedly · Copy report"); `API_RATE_LIMIT_USER` (default now **1,200**/min,
measured peak was about 280/min backing up 400 small photos) and `API_RATE_LIMIT_INSTANCE_IP` (120).

**Verified, beyond the earlier phases' lists:** every gate on a real server (confirm email by Mailpit link, pending, rejected, temporary
password, required 2FA end to end); email invite delivered; Empty trash; offline cap prompt; old-app gate; instant notifications after a
reboot and in forced Doze (5 s); 200 MB upload through a tusd restart and ~70 s of web server down (hash matched); process death with
"Don't keep activities"; permissions revoked while running; `/app` download byte-identical; Collabora view-only.
The picking grace and Collabora's hidden "<" were checked in Expo Go (JS only, same bundle in the APK). The uploader's 429/5xx requeue
(`Sender.kt`) was checked by review and shares its path with camera backup's 429 handling, which was run.

**Not run, for the phone (checklist below):** low storage (the emulator's space accounting let full files land), API 24–28, real battery and
OEM limits, pinch, the Play scanner and camera, an editor saving back through the Files app, the Store v3→v4 upgrade with Phase 6 rows,
Google and GitHub sign-in (same code path as OIDC).

**Real-phone checklist (0.1.1)**

1. Install `nimbus-0.1.1-arm64-v8a.apk` over 0.1.0: it updates in place and keeps accounts.
2. Back from a folder goes up; Back on Files leaves the app.
3. Pinch a photo; swipe between files; open a PDF and a docx.
4. Take 20 photos in a row with camera backup on: all reach `Camera/YYYY/MM`, and "All backed up" only shows at the end.
5. App lock on, leave for 2 min, come back: locked. Open a picker for 2 min and come back: not locked.
6. With TalkBack on, the lock screen reads only "Nimbus is locked, Unlock".
7. Fill the phone until under 100 MB is free and download a bigger file: you get an error and no partial file.
8. Save a text file from an editor through the Files app (Nimbus root): a new version appears on the web.
9. Leave instant notifications on overnight on battery: a share in the morning still arrives within seconds.
10. Scan a document (Play services).

## Phases 13–20 (planned 2026-11-07)

Chosen by the user from suggestions inspired by Google Drive, Google Photos, Dropbox, MEGA and OneDrive: every Tier 1 and
Tier 2 idea, plus contacts and calendar backup, smart search and optional face grouping. **Every feature ships on the web too**
(user, 2026-11-07), with no exceptions. Where the phone does something a browser can't, the web gets its own version (noted in each
phase). Each phase follows
the usual loop: a short decision check, build, Impeccable pass, a Maestro flow, a release-APK check, update here, commit.

Decided already (2026-11-07):
- **Smart search:** OCR on the server for everyone. Speech search and search by what's in a photo only when the AI service is on.
- **AI runs in an optional `nimbus-ml` container** (Compose profile), off by default and using no RAM until the admin turns it
  on. The admin can point it at another machine's URL. Without it, those features are hidden, not broken.
- **Transfer keeps its own copy** of the files, deleted at expiry, counted against the sender's quota until then.
- **Comments: anyone with access** can comment, viewers included. The owner and editors can delete any comment and resolve threads.

**Phase 13, sharing extras**
- **File requests:** an upload-only link on a folder. Visitors see a drop page with no listing, give a name (and an email if the
  owner asks for one) and upload. Options: deadline, size limit, password. Uploads land in the folder, or in a subfolder per
  visitor, and the owner gets a bell, push and email notification. Uses the existing tus upload path and the link rate limits.
- **Transfer:** pick files from the phone or from Nimbus, add recipient emails (sent through the jobs queue) and/or copy the link,
  plus a message, an expiry (1/7/30 days), an optional password and a download limit. A "Downloaded by…" notice for each download.
  Sent transfers get a list in More (web: a Transfers page) with Revoke. The worker purges them at expiry.
- **Vault share links:** a link to one Vault file or folder carries the key in the `#` part of the URL, which never reaches the
  server. The page decrypts in the browser with the same crypto as Phase 7. Optional expiry; Revoke deletes the copy that was
  re-encrypted for the link, so the Vault key itself is never shared.

**Phase 13 status (2026-11-07)**

Decisions (16 answers, user): file requests upgrade the existing file-drop link (no new link type) and get a "Request files…"
entry in the folder menu; a folder per person is an owner toggle (off by default); name always, email optional or required;
limits per file size, file types and file count; the drop page shows title, instructions, a "Closes in…" countdown, the
visitor's own uploads and a receipt email. Transfer: one link per emailed recipient (the copy link is anonymous); the limit
counts full downloads (a zip, or the first file in a 30-minute visit); sender quota plus an admin max; the recipient page has
preview, Download all and Save to my Nimbus; download notices through bell, push and email ("Transfers" preference, folded
hourly). Vault links re-wrap each file's own key under a link key, so no data is copied (this replaces the "re-encrypted copy"
above); a folder link is a snapshot; key in `#` or an optional passphrase; preview and download. Admin: Transfer on/off, Vault
links on/off, longest transfer lifetime, biggest transfer, a Transfers page with Revoke, a Transfers row in the storage report.

Built:
- Schema: `shares` gets request columns (`drizzle/0029`); `transfers`, `transfer_files`, `transfer_recipients`,
  `transfer_events`, `vault_links`, `vault_link_versions` and the four settings (`drizzle/0030`).
- File requests: `app/s/actions.ts` (checks, folder per person, `finishDrop` receipt), the limits checked again when tus
  finishes (`lib/uploads.ts`), `components/share-dialog.tsx` RequestSettings, `components/public-link.tsx` DropZone; app:
  `share/link/[id].tsx` RequestFields, "Request files" in the folder sheet and the Share screen. Type rules are shared
  (`packages/shared/file-rules.ts` REQUEST_TYPES, `typeAllowed`, `acceptOf`).
- Transfer: `lib/services/transfers.ts`, `lib/transfer-links.ts`, `/t/[token]` (page, download, zip, thumb), `/transfers`,
  `/api/v1/transfers/*`, hourly purge, orphan-sweep exclusion, quota counting; app: More → Transfers, New transfer (Nimbus
  picker + device files through the upload engine), "Send with Transfer" in the file sheet and in Save to (share-in).
- Vault links: `packages/shared/vault-crypto.ts` (link key, wrapForLink, sealManifest, passphrase wrap; tests and vectors),
  `lib/vault-links.ts`, `/v/[token]` (page + ranged ciphertext route), `components/vault-links.tsx` and
  `vault-link-view.tsx`; app: Kotlin `Vault.makeLink` + `vaultLinkSeal` (optional native method, hidden on older APKs), Share
  link in the vault sheet, Shared links in vault settings.

Checked (web): Playwright `e2e/request.spec.ts`, `transfer.spec.ts`, `vault-link.spec.ts` plus the old link, share, upload and
vault specs, 7/7 passing; shared, app and web unit tests pass; tsc and eslint clean. Receipt emails aren't sent on the dev
instance (email is off there): the spec checks Mailpit only with `E2E_MAILPIT` set.

Impeccable polish (web, 2026-11-07; the user asked for production grade with no compromises): drop page without the
duplicate "Shared by", limits as words ("Only PDFs or images"), no orphan separators on phones, a "Sent N files to X; a
receipt is on its way" status line and file sizes in the visitor's list; Request files scrolls the dialog (not the page) to
the new request and hides the meaningless Download toggle on upload-only links; Vault link page title on the page scale,
names open the preview, no amber outside Health; Transfer dialog with visible labels and type icons and sizes on every row,
the recipient page with type icons instead of unreadable text thumbnails and Download all first on phones, the Transfers list
with Revoke on closed transfers too (they still hold storage), an inline Revoke/Keep instead of `confirm()`, and honest
status lines.

Checked (app, Expo Go on the emulator, 2026-11-08): More → Transfers (empty state, list, details, Revoke confirm; the link
stops), New transfer from Nimbus (a folder expands to its files, title kept, link works), Request files from the folder sheet
opens the new request's settings, type switches and limits save (bad input shows an error). Polish there: file-type icons
and a labelled remove button on picked rows (tapping a row no longer removes it), a taller Message field, Files and
Downloads as separate detail rows, the plural following the limit ("0 of 1 download", web too), and the Download switch
hidden on upload-only links.

About (user request, 2026-11-08): a web `/about` page from the account menu and a "Made by" section on the app's About
screen: the creator's photo (bundled `creator.webp`, cropped passport-style from the user's own picture, so nothing is
fetched from GitHub), "everydaycodings", GitHub profile and everydaycodings.com, plus the source code link.

Release APK (x86_64, 2026-11-08, Cursor kept open: emulator, Metro and next dev stopped during Gradle, --max-workers=2,
-Xmx2g; 8 min, no crash): Kotlin tests 43/43 including `VaultTest.sharesLinksLikeTheWeb`. On the phone: Vault Share link,
link only and with a passphrase (Argon2id about 3 s), both opened and decrypted in a signed-out browser; Shared links shows
the decrypted name and views; Revoke stops the link. Maestro: new `request`, `transfer`, `about` flows; `editor` now scrolls
to Versions (Send with Transfer pushed it down), `share` centres app.ts (its ⋯ sat under the New button), `quick-actions`
and `folder-sync` back out of a deep system picker, `photos` waits for the grid (a playing video hides Close preview). All 14
pass. Found on the phone: a tall dialog (vault link with passphrase) put its buttons under the keyboard; dialogs now scroll
(`components/dialog.tsx`), to be seen on the next APK. Then commit.

**Phase 14, comments**
- Threads on files (not folders) in Details and the previewer, with replies, @mentions of people who have access, edit and
  delete your own, and Resolve/Reopen. Mentions and replies notify through the bell, push and email, using the existing notification
  preferences plus a new "Comments" toggle. Comments show in the Activity feed. They're kept across versions and go with the file
  on ownership transfer. Vault files can't have comments, since the server can't see them.

**Phase 14 status (2026-11-12)**

Decisions (7 answers, user): the owner (new threads), thread participants (replies) and @mentioned people are notified,
with a new "Comments" preference; signed-in members only, no comments on public links; anchors are the whole file plus a
video/audio timestamp or a PDF page, shown as chips that jump the previewer there; only people with access can be
@mentioned; an open-thread count badge on file rows (web + app); extras: reactions 👍 ❤️ 😂 🎉 👀, live updates (web SSE,
the app polls every 8 s), autolinked URLs, search over comment text plus `has:comments`. Deleting a first comment that has
replies leaves a "Comment deleted" stub. Rules: owner and editors delete any comment and resolve any thread, the thread
starter can resolve their own; mentions never fold, other comment notifications fold per file per hour; Vault files excluded.

Built:
- Schema: `comments` and reactions, `drizzle/0031_phase14_comments.sql`. Mention tokens (`<@userId>`), `REACTIONS` and
  helpers in `packages/shared/comments.ts` (tested); types in `packages/shared/api.ts` (Comments section, `Item.comments`,
  `Hit.inComment`, notification kind and activity type `comment`).
- Service `lib/services/comments.ts`; routes `/api/v1/files/{id}/comments` (+ `/events` SSE), `/api/v1/comments/{id}`
  (PATCH, DELETE), `/api/v1/comments/{id}/reactions`; web actions `app/(app)/comment-actions.ts`; search in `lib/files.ts`.
- Web: `components/comments.tsx` in Details and as a previewer side panel; notifications deep-link with
  `?open=<id>&comments=1`; count badge in the file browser; comment hits in the search palette.
- App: `src/app/comments/[id].tsx`, `src/lib/comment-anchor.ts`, a Comments row in Details, a button in the preview bar,
  notification routing to the thread, the "Comments" notification toggle, count badge on tiles.

Also (user request): Details "Activity" is paged 10 at a time ("1–10 of N" with newer/older buttons; web + app; `?offset=`/`limit`, `total`), and
the web Details thumbnail no longer shrinks to a line when the activity list is long (`shrink-0`).

Checked: web Playwright `e2e/comments.spec.ts` passes; app typecheck clean. Still to do: an emulator check of the app
screens, then commit.

**Phase 15, Photos**
- **On this day:** a card at the top of Photos, "N years ago", grouped by year from `takenAt`, opening a slideshow. An optional
  daily notification (off by default). Hide a day or a photo from memories.
- **Places map:** a map view of photos that have GPS, clustered, tap to see the photos from that spot. Map tiles from
  OpenStreetMap (the server URL can be changed in admin settings, or the map turned off). The location is read from EXIF by the
  worker next to `takenAt`.
- **Smart groups:** Screenshots, Documents, Receipts and Videos, worked out from file paths, names and OCR text (Phase 19
  improves them), shown as chips in Photos.
- **Shared albums:** albums that other people can view or add photos to, using the existing share roles. **Partner sharing:**
  automatically share new photos (all of them, or from a date onwards) with one person, who can choose to save them to their own
  library.
- **Quick edits:** crop, rotate, straighten and markup (pen, highlighter, text, arrows), from the previewer and before an upload
  (scan, camera, share-in). Saving makes a new version, or a copy if you choose. The original is always kept in versions.
  Web: the same editor (canvas) in the previewer, and an Edit button on images in the upload panel before they're sent.

**Phase 15 status (2026-11-12)**

Decisions (20 answers, user; also in Claude's project memory):
- **Memories:** On this day is today's date in past years, one card per year. A daily notice runs on the phone (Kotlin
  WorkManager) with a time picker, off by default. Hide a photo, a day or a folder, with a Hidden page to undo. The
  slideshow is reused, and the web got its own.
- **Map:** MapLibre (native in the app, maplibre-gl on the web), with the Places chip hidden in Expo Go. Tiles come from
  OpenFreeMap by default; the admin can change the style URL or turn the map off. Tapping a cluster opens a sheet grid.
  GPS is shown to the owner only.
- **Smart groups:** rules on path, name, size and type, plus tesseract in the worker for undecided images.
- **Albums:** an album points at photos. It has its own shares (viewer or contributor) and public links.
- **Partner:** the partner's photos are merged into the timeline with a badge and a toggle. "Save to my library"
  makes a copy. The share can be all photos or from a date, and accepting offers to share back.
- **Quick edits:** crop, rotate, flip, straighten and markup. Save makes a new version (or a copy) and keeps the EXIF date and GPS.
  Edit before upload covers the camera, share-in and the web upload panel.

Built (four builder agents: server, editor, web UI, app UI):
- Schema: `drizzle/0032_phase15_photos.sql`. It adds `file_versions` lat/lng/width/height/gps_checked/smart, `albums`,
  `album_items`, `album_shares`, `partners`, `memory_hides`, and the settings `map_enabled` and `map_style_url`.
- Server:
  - `lib/exif.ts` `exifGps`; worker `exifMisses` reads GPS, size and smart groups, with a backfill on `gps_checked`.
  - `packages/shared/smart-groups.ts`.
  - `lib/access.ts` gives viewer access to album photos and active partner photos.
  - Services `lib/services/photos.ts`, `albums.ts` and `partners.ts`, with routes under `/api/v1/photos/*`, `/albums/*` and
    `/partner`.
  - Public album page `/a/[token]`, notification kinds `album` and `partner`, and the admin page System → Photos map.
- Editor: `packages/shared/exif-write.ts` (`withExif`, `readExif`) and `image-edit.ts`; web `components/image-editor.tsx`
  (previewer and upload panel); app `src/app/photo-edit.tsx` (preview bar, camera and share-in), with `editor-save.ts`
  `uploadFile`.
- Web: chips, the memories strip, `components/slideshow.tsx`, the hidden page, smart group pages, `components/places-map.tsx`,
  the album pages and dialogs, `components/album-share-dialog.tsx`, partner settings in Account, and "Add to album" in the
  file browser.
- App:
  - Chips, the memories strip, the photo settings sheet, albums (list, detail, add, share), smart group screens,
    `places.tsx` (`@maplibre/maplibre-react-native`), `account/partner.tsx`, and "Add to album" and "Save to my library" in the
    file sheet.
  - Kotlin `Memories.kt` (a chain of one-time WorkManager jobs) behind `memoriesSet?` and `memoriesState?`.
  - Maestro flows `memories`, `albums`, `places`, `photo-edit`.

Fixed while checking:
- **Web map, worker:** maplibre-gl couldn't find its worker once bundled. It now uses `setWorkerUrl(new URL(...,
  import.meta.url))`.
- **Web map, container:** its own CSS (`.maplibregl-map { position: relative }`) collapsed the absolutely placed container.
  It is now wrapped in a sized box.
- **Web map, cluster box:** the bounding box for a cluster's photos is padded, because the worker rounds coordinates.
- **App editor:** the crop handles were offset on the right and bottom and clipped by the frame. They are now placed by
  fraction, outside the clip.
- **API check:** the partner timeline check pages through, because newbie has more than 1000 photos.

Checked:
- `scripts/api-check.ts` 231/231.
- Playwright: all 15 pass, including `photos-phase15.spec.ts` (memories, hide/undo, slideshow, smart chip, album to a second
  account plus a public link, partner merge and switch, map cluster to the previewer, and a quick edit that keeps EXIF).
- Mobile typecheck is clean; unit tests pass (mobile 86, shared 29).
- Expo Go on the emulator: memories card and slideshow, album create/add/share (person plus link), the editor (1:1, rotate,
  straighten, Save as copy gives an 863×863 JPEG), the Screenshots chip, photo settings (no daily row in Expo Go) and the
  partner screen.

Notes:
- **Memories day:** matched on UTC days, so near midnight in far-off time zones the day can be off by one.
- **Re-edits clear markup:** changing the crop, rotation, flip or straighten after drawing clears the markup.
- **EXIF:** an edited JPEG keeps only the date, GPS and Orientation from the original EXIF.
- **Offline:** photo edits aren't queued while offline.

Release APK (x86_64, 2026-11-12; emulator, Metro and next dev stopped during Gradle; --max-workers=2, -Xmx2g):
- Kotlin tests 48/48, including `MemoriesRulesTest`.
- **Places:** the chip shows only in the APK. The map loads OpenFreeMap tiles over Paris, and a cluster tap opens
  "2 photos here".
- **Daily notice:** switched on with a 9:00 time; a forced WorkManager job posted "On this day · <account>" / "2 photos
  from 7 years ago", and tapping it opens the memories slideshow.
- **Maestro:** 19/19. `places` now matches MapLibre's own view description and goes back with the system Back key.
- **Phone check, map text:** no map text drew on the emulator (no place names and no cluster counts), because SwiftShader
  is software GL. Check on a real phone.
- **Notice tap with a sheet open:** tapping the notice while a sheet (Photo settings) is open leaves you on that sheet.
- **Notice title:** it names the account by email even when only one account is on the phone.

**Phase 16, playback**
- **Cast to TV** (Chromecast) for video, photos and slideshows: the server gives the TV a short-lived signed URL. Hidden without
  Play services. Web: a Cast button in the video player through the browser's Remote Playback API (Chrome and Edge), hidden where
  that isn't available.
- **Sleep timer** (15/30/60 min, end of track) and **playback speed** for audio and video.
- **Data-saver quality:** the worker makes a 720p (and 480p) H.264 copy of each video, and the player uses it on mobile data,
  with a quality picker. Admin switch, off by default (heavy on CPU and space); each copy counts as a derived file, not as quota.

**Phase 16 status (2026-11-12)**

Decisions (19 answers, user; also in Claude's project memory):
- **Cast:** video, photos, slideshows and audio, from My files and Shared (not vault, not public links). Google's Default
  Media Receiver. The TV gets a signed URL valid for the media's length + 1 h, reloaded at the same spot before it expires.
  Formats a Chromecast can't play cast the 720p copy, or say "This video can't be cast yet" with Make copy. Subtitles go
  as WebVTT (sidecar and embedded). Photos go as a 1920 px JPEG preview (HEIC through heic-decode, RAW through its
  embedded JPEG) and follow swipes. Web: Cast Web SDK in Chrome, Remote Playback elsewhere. Full remote; notification
  controls on Android. Audio and video art go to the TV through a token-signed `art` URL.
- **Audio, sleep, speed, resume:** a real web audio player (queue, shuffle/repeat, mini-player across pages, Media
  Session). Sleep timer everywhere: 15/30/45/60, end of track, custom, 10 s fade. Speed per device, separate for audio
  and video. Resume over 10 min, synced to the account (`playback_positions`), replacing the app's local positions.
- **Data-saver copies:** 720p and 480p H.264/AAC MP4, never upscaled, skipped when the original is H.264 at or under
  that size. Admin switch (off by default) and size cap on Admin → Text in images; Delete all also turns it off. The
  worker's minute sweep queues the newest video with no copies, one at a time, nice'd ffmpeg veryfast. Owners can ask
  for a copy. Shown as "Video copies" in health and the storage report, not counted against quota. App: 480p on mobile
  data by default (setting), Original on Wi-Fi; offline can save the copy. Web: picker, 480p with Save-Data. Share and
  album links get the picker without a download event.

Release APK 0.2.7 (x86_64, 2026-11-12; Cursor open, --max-workers=2; Cast framework 21.5.0 resolved):
- Maestro 19/19 (`photos` flaked once on "Grid size", passed alone).
- Emulator: video settings show Sleep timer (15/30/45/60, Custom… with the fade note, End of video; "Pauses in 1 min"
  after a custom 1) and Quality (Original / 480p; switching kept the time and played the softer copy). No Cast button
  with no TV on the network. Long MP3: "Resume from 1:01 / Start over" from the server, Resume plays from 1:01, the moon
  sheet has the same rows with End of track, the media pause key works, and the server then held 145 s. More shows
  "Video on mobile data: 480p".
- Traps: a short video auto-advances into the next one in the list (search put a seed `teaser.mp4` with a missing
  object next to it); uiautomator dumps hang while audio plays (pause first).

Not done or to check:
- Casting to a real TV (web and app), the HEIC cast path, and whether the Default Media Receiver shows `artUrl`.
- The bucket needs CORS GET for any origin so a TV can fetch signed URLs (deployment note).
- Copies are made only for the current version; a failed copy is retried only by Make copy.
- Fixed on the way: the album photo picker appended its first page twice under React's dev double effect.

**Phase 17, sign-in and safety**
- **Passkeys:** add, name and remove passkeys in account settings (web and app), and sign in with one on either. The app uses
  Android's Credential Manager. The server serves `/.well-known/assetlinks.json` with the APK's signing fingerprint. Needs HTTPS
  and a real domain, so the option is hidden on HTTP or IP servers, with a note saying why. Passkeys count as two-factor.
- **Two-factor after Google, GitHub and OIDC sign-in** (user, 2026-11-08): today Better Auth's 2FA only runs on password sign-in
  (its hook matches `/sign-in/email|username|phone-number`), so a provider sign-in skips the code. Make it ask too, on web and app.
  Server: extend the twoFactor plugin's after-hook matcher to `/callback/*` (and the OIDC callback); when the user has 2FA on,
  drop the new session, set the two-factor cookie, and redirect to the web's code page instead of returning JSON. App: the
  `nimbus://` return (`app-return`, `stashSession` in `lib/auth.ts`) carries a "2FA pending" code instead of a session; the app
  trades it for the two-factor cookie and opens its existing `two-factor` screen. Trusted-device cookie works as on password
  sign-in. Check order with the existing callback hooks (known-accounts, app return, Expo plugin). Decide: whether the admin's
  OIDC provider is exempt (it may enforce its own MFA).
- **Restore to a point in time:** on a folder (or all of My files), choose a date and time, see a preview of what changes
  (restored from Trash, older versions, undone renames and moves), then restore. Built from versions, Trash and the Activity
  log, so how far back it reaches follows the activity retention setting. The restore itself can be undone.

**Phase 17 status (2026-11-12)**
- **Passkeys:** `@better-auth/passkey` 1.7.10 (peers pinned as direct deps; never `--legacy-peer-deps`, it strips React Native
  packages from the lockfile). Plugin added only when `BETTER_AUTH_URL` is https + domain (or localhost) and Admin → Authentication
  "Allow passkeys" is on. Passkey sign-in skips the code; `/two-factor/passkey-options` + `/two-factor/verify-passkey` let a
  passkey answer the 2FA step (trust-device honoured). "Require a passkey" is a gate (`gate: "passkey"`), not a page, and can't be
  turned on until the admin has one. `/.well-known/assetlinks.json` lists the release key (env `ANDROID_RELEASE_SHA256`) and the
  debug key. App: Kotlin `Passkeys.kt` (Credential Manager 1.5.0), sign-in button, Account → Security → Passkeys, two-factor
  "Use a passkey", forced setup in the gate.
- **2FA after Google/GitHub/OIDC:** plugin `providerTwoFactor` right after `twoFactor()` (before multiSession's cookie). Web goes
  to `/two-factor?next=…`; the app gets `nimbus://…?code=…&twofa=1` and opens its two-factor screen. Admin "Trust the OIDC
  provider's own MFA" (off by default). Tested with a throwaway local OIDC provider, not real Google/GitHub.
- **Restore to a point in time:** activity now stores `from_name`, `from_parent_id` (renames, moves) and `restore_id`
  (migrations 0034–0036). Brings back trash, older versions, renames and moves; keeps newer files; owner only; no vault;
  "(restored)" on clashes; undo from the toast or the Activity entry for 7 days (`point_restores`). My files root restores get the
  toast Undo only; the app restores folders only (API supports `root`).

Release APK 0.2.8 (x86_64, 2026-11-12; Cursor open with the low-memory recipe: `--no-daemon --max-workers=1`, parallel off,
`-Xmx1536m`, Kotlin in-process, a MemAvailable watchdog; lowest free RAM 2.9 GB. A plain `--max-workers=2` build crashed Cursor):
- Maestro 20/20, including the new `restore-point` flow. `browse` now scrolls to Projects and back up (leftover e2e folders push it
  off-screen), and `photos` retries the slideshow pause (the controls auto-hide between check and tap on a busy emulator).
- Emulator: Account → Security shows Passkeys; the Passkeys screen and the restore screen render and load from the server.
- Polish: web sign-in, Account → Passkeys and the restore dialog checked at 1280 and 390 wide; the "not tracked yet" note
  reworded on web and app (the app copy ships with the next APK).
- Traps: the Playwright MCP browser writes its console log into the repo's `.playwright-mcp/`, which the dev server
  watches, so a page open in it can reload in a loop and leave `next dev` reloading every page; close it and restart
  `next dev`. A new route's first request in `next dev` can take longer than the app's 15 s timeout.

Not done or to check:
- Android passkeys need a real HTTPS domain with assetlinks (`ANDROID_RELEASE_SHA256` set); untested. Real Google/GitHub 2FA
  untested. The admin Authentication page's new settings were not checked by eye (the test accounts aren't owners).
- Dev DB test user `passkey-test@example.invalid` left by the e2e; 24 leftover e2e folders of `browser-test` were moved to Trash.

**Phase 18, documents and phone**
- **PDF tools:** highlight, underline, notes, free text, drawing, fill in form fields, and a saved signature you can place.
  Saving makes a new version. The same on the web.
- **Contacts and calendar backup** (backups made by the app; the web can read them): exports contacts as `.vcf` and calendars as `.ics` into My files →
  Phone backup → <device>, on the backup schedule (daily by default) with Wi-Fi and charging rules. Keeps the last N copies.
  Restore opens the file in Android's Contacts or Calendar import. Needs the contacts and calendar permissions, asked for only
  when you turn it on. Web: a Phone backup page for each device with the latest backup time, a searchable list of contacts and
  events read from the `.vcf`/`.ics`, and a download of any copy (to import into Google, Outlook or another phone).

**Phase 18 status (2026-11-13, uncommitted)**
- **PDF tools:** one model of our own for every mark. `packages/shared/pdf-annot.ts` (pdf-lib) reads and writes real
  annotations with appearance streams; `packages/shared/pdf-editor.ts` is a framework-free editor on pdf.js (canvas, text
  layer, form fields) with an SVG overlay, used by the web (`components/pdf-editor.tsx`) and the app's WebView
  (`viewer/pdf-edit.ts`, screen `/pdf-edit`). pdf.js's own editor isn't used: it has no underline, strike, shapes or eraser.
  Signatures in `signatures` (migration 0037), `/api/v1/signatures`; admin "Largest PDF to edit" (`settings.max_pdf_edit_bytes`,
  0038, Office documents page, `/instance.maxPdfEditBytes`). App saves queue offline (`savePdf` op).
- **Phone backup:** `packages/shared/vcard.ts` / `ical.ts`; `phone_backups` table, `/api/v1/phone-backup` (+ `/{id}/done`, which
  trims to Keep); web page `/account/phone-backup/[id]` (contacts, events, compare, single export) linked from Account; daily
  `phone-backup-stale` job → bell. App: section in Backup settings (expo-contacts, expo-calendar, expo-battery), runs from the
  background task and on open, restore through Android's import.
- Checked: web by Playwright scripts (every tool, forms, signature, conflict → Save as copy, eraser/undo, viewer has no Edit,
  saved file read back with pdf-lib); app in Expo Go on the emulator (draw, forms, typed initials, Save, Save as copy, conflict
  → Overwrite, discard prompt, offline open + queued copy synced; contacts and calendar backup, unchanged skip, restore opens
  Google Contacts' vCard import).
- Fixed while testing: pdf.js page border offset, mouse selection never marked, opaque highlight overlay, checkbox looks
  (`annotationCanvasMap`), field layer collapsed on WebViews without CSS `round()` (Chrome < 125), offline open of an older
  kept copy, phone backup picking a stale camera-backup account, async kv write losing the last backup time.
- Not done: native build/APK (new modules: expo-contacts, expo-calendar, expo-battery; READ_CONTACTS/READ_CALENDAR), so the
  background run, Wi-Fi/charging gates and real permission flow in the APK are untested. Free text is Helvetica only (no
  non-Latin) and doesn't wrap. Repeating events lose weekdays (Android gives only frequency/interval). `pdf-saves` files
  aren't swept. The admin cap row and the web signature Type/Upload tabs were not checked by eye.

**System folders (built 2026-11-13, uncommitted; was planned the same day)**
Status: built by two agents (web+server, Android) to the spec below. Migration `0039_system_folders` (applied to dev; tagged
1 Phone backup + 2 Camera). Camera tag rides the upload token (`k: "camera"`) from plan `purpose: "camera"` to `mkdirp` at tus
finish. `system` is also on `PathStep`, `FolderResponse.folder` and `PickerResponse.folders`. Delete forever in Trash doesn't
warn again (Move to trash already did). Checked: web prod build, e2e all green across runs (new `system-folders.spec.ts`;
sign-in rate limit trips full serial runs, so failures there were re-run alone; comments/passkeys specs made prod-safe);
release APK x86_64: Maestro 20/20 plus new `pdf-edit`, `phone-backup`, `system-folders` flows; on the APK a real photo backup
created `Camera` tagged `camera`, contacts .vcf uploaded, the pen stroke saved as a real `/Ink` annotation. Not checked: partner
folder tagging live, warnings on Move to vault (none by design). App warning copy says "keeps" where web says "saves".

Folders the app makes by itself should look different from the user's own, on the web and in the app (parity).
- **Which:** `Camera` (photo backup), `Phone backup` (contacts and calendar), and `Photos/From <partner>` (saved partner
  photos). Folder-sync targets are picked by the user, so they stay normal.
- **Look:** each kind gets its own icon in place of the folder (camera, phone, people) in the brand tint, plus a small label
  under the name: "Auto · Photo backup", "Auto · Contacts and calendar", "Auto · Partner photos". This applies to list and
  grid, the folder header, breadcrumbs and pickers.
- **Order:** system folders come first in My files, then the user's folders in the chosen sort.
- **Protection:** rename, move and delete still work but warn first, for example "Photo backup puts new photos in Camera. If
  you rename it, the next backup makes a new Camera folder." A system folder stays special after a rename or move.
- **Detection:** the server tags a folder when it creates one (new column `nodes.system_kind` set to
  `camera | phone_backup | partner`, null for everything else), so a user's own folder called "Camera" isn't affected.
  - **Phone backup:** tag the `Phone backup` root in `registerPhone` (`lib/services/phone-backup.ts`).
  - **Partner photos:** tag the `From <name>` leaf that `mkdirp(..., ["Photos", from])` makes in
    `lib/services/partners.ts`. The root `Photos` folder may be the user's own, so leave it untagged.
  - **Camera:** Kotlin's `/api/v1/uploads/plan` call (`Backup.kt`) sends `purpose: "camera"`, and the plan tags the root
    folder `mkdirp` makes for `Camera/...`. This is a native change, so it ships in the next APK.
  - **Migration (once):** tag the `Phone backup` roots that hold a `phone_backups.folder_id`, the `Photos/From …` folders
    holding partner copies, and root `Camera` folders whose children are year folders (`2019`…), which is the layout
    camera backup makes.
- **API:** `Item` gains `system?: "camera" | "phone_backup" | "partner"` (`packages/shared/api.ts`), set in the list,
  details and search responses, and over WebDAV it's ignored. The web and the app pick the icon and label from it.
- **Check:** a production build plus the e2e suite on the web (look, order, the three warnings); Android in the APK (the
  Camera tag needs the new native plan flag), the More screen and the pickers.

**Phase 19, smart search (OCR)**
- OCR moves from the browser to the worker (tesseract, already a dependency), so it runs for every upload, including from the
  app and WebDAV: images, scanned PDFs (pages with no text layer) and video frames (one every few seconds, plus scene changes,
  using ffmpeg), with the OCR languages set by the admin. Backfilled for old files a little at a time.
- Results say **where** the match is: the text around it with the words highlighted, the PDF page (opens at that page), the time
  in the video (opens there), or the area of the image (shown with a box). Filters: Images, Videos, PDFs, Documents.
- Uses the existing memory gate: the admin can turn OCR off or limit it to images.

**Phase 20, optional AI service (admin switch)**
- `nimbus-ml`: a small Python container (ONNX models, CPU) behind a Compose profile, health-checked on the Health page. An admin
  page turns on each of these separately: **face grouping**, **speech search**, **search by what's in a photo**.
- **Face grouping:** a People view in Photos: name a person, merge, split, hide. Each user's faces stay separate (no matching
  across accounts). A user can turn it off for themselves, which deletes their face data. Not run on Vault or shared-in files.
  **Lightest models (user, 2026-11-07):** detection with **YuNet** (OpenCV Zoo, ~230 KB, MIT) and recognition with **SFace int8**
  (OpenCV Zoo, ~10 MB, Apache-2.0, 128-d embeddings), run through `opencv-python-headless`, with no PyTorch or GPU. About 10–30 ms
  per photo on one CPU core, and the faces part of the container stays under ~300 MB of RAM. InsightFace models (SCRFD, buffalo)
  are avoided because their licence is non-commercial. Speed-ups: work on the existing server thumbnails (longest side 1024),
  never the originals; one photo at a time at low priority, paused while uploads are busy; skip faces under 40 px. Grouping: compare
  each new face with the existing people using pgvector cosine distance (join a person if close enough, otherwise unassigned),
  then group the unassigned faces in a nightly job, so the whole library is never re-clustered.
- **Speech search:** Whisper transcripts of videos and audio, searchable with time links like the OCR results in Phase 19.
- **Search by what's in it:** CLIP embeddings stored with pgvector, so a search like "dog on a beach" finds photos and video frames.
- Embeddings and face data live in the DB only and are deleted with the file. Model files download on first enable, not in the image.
- **Machine:** test it with the emulator off, since a model plus Whisper can take several GB of RAM.

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
- **Before public release:** licence texts for bundled open-source packages, and tuning the `/api/v1` rate limits.

## Phase 19 status (2026-11-13)

BUILT, uncommitted. Decisions: Claude memory `nimbus-phase19-decisions`. Three builder agents (server/worker, web, app).

- Server/worker: `drizzle/0040_phase19_ocr.sql` (`node_text_parts` with page/time/line + box, `node_content.ocr_langs`/`ocr_failed`, settings `ocr_mode`, `ocr_video_max_min`, `ocr_lang_status`). `lib/extract.ts` `extractParts` (tesseract line boxes, scanned PDF pages via pdfjs + @napi-rs/canvas), `scripts/video-ocr.ts` (ffmpeg every 5 s + scene changes, merged), `scripts/indexer.ts` sweep honours the mode, skips Vault, backs off while derive/transcode run. Browser OCR (`lib/index-content.ts`) and `smartOcr` removed. Routes `/api/v1/files/:id/text`, `/reread`, `found` filter on search. Health card shows the OCR backlog. Test: `node --test lib/ocr.test.ts`.
- Web: search chips, Found in, place links, previewer `start` (PDF `#page=N`, video paused 2 s early, image box), find-in-file, Details "Text found", palette place label.
- Checked on the web dev server: image, mixed PDF (scanned page 2) and video were read by the worker; search shows "p. 2"; PDF opens at `#page=2`; image box lines up; video opens paused at 8 s for a 10 s match; `/text`, `/reread` (204 then "waiting") and `found` work; no Vault rows.
- Checked 2026-11-13 (second pass): admin OCR page on a fresh owner instance (mode, video cap, languages eng+deu downloaded and "ready", Re-read all with confirm, audit entries, Health card "0 waiting to be read"); a fresh DB migrates through 0040; `0040_snapshot.json` added (drizzle-kit shows no diff); OCR tests pass inside `node:24-slim` (canvas PDF render + ffmpeg), and `@napi-rs/canvas` is a prod dependency, so `npm prune --omit=dev` keeps it; app on the emulator: chips, Found in, place rows, PDF opens at page 2, image box on a letterboxed photo with Clear, find bar "1 of 1" with box, Details Text found, video opens paused at 0:08 for a 0:10 match.
- Fixed in that pass: the app PDF counter now shows the page in the middle of the screen (it said "1 / 2" when opened at page 2 of a short file); admin copy and the language status before the first save.
- Dev gotcha: `next dev -H 0.0.0.0` puts the browser into an endless Fast Refresh reload loop here; use plain `next dev`.

### App part

JS only, no native rebuild. Built, not yet run on the emulator.

- Search: quick chips (All, Images, Videos, PDFs, Documents), a "Found in" filter, place rows under a result (p. 4, 12:30, In image, with snippet) and "N more" loading the rest from `/files/:id/text?q=`. A tap opens the previewer at that place (`components/search-places.tsx`, `lib/preview-session.ts` `start`).
- Previewer: PDF opens at the page (viewer meta `page`, `npm run viewers` rerun), video opens paused 2 s early without touching the resume spot, image shows a box that fades after about 3 s with a Clear pill. A find bar in the top bar (`components/find-bar.tsx`) gives "2 of 7" with next and previous.
- Details: "Text found" for images, PDFs and videos (`components/text-found.tsx`): status, collapsible text, Copy, Read text again.
- Impeccable polish: 48 dp targets, accessible labels and selected/expanded states, live region for the match count, reduced motion skips the box fade, loading and error states for "N more". Places are optional, so cached and offline lists look as before.
- Left for the emulator: box alignment on a letterboxed photo, PDF scroll settling on a long mixed-size file, video seek from the find bar (it plays).

## Phase 20 status: Android parity (2026-11-13)

BUILT, uncommitted, JS only (no native rebuild). Server contract: `plans/resilient-humming-snail.md` §5, §6, §8. Every AI screen is hidden unless `/me` `ai` says so (`lib/people.ts` `useAi`).

- Photos: People chip, up to five named person chips, a People avatar row under the memories strip (both share one lead row so the fast scroller still adds up), "With Priya" memory cards (slideshow `person` param).
- `app/people/index.tsx` (named first, Hidden behind a toggle, off and empty states) and `app/people/[id].tsx` (rename, hide, merge picker, "Is this X?" review sheet with Yes/No/Skip, Select photos then Not X / Move to… by looking up each photo's faces).
- Details: People section (face crops; tap to confirm a guess, name, choose a person, open, "Not X") and Transcript (language, lines that seek in the open previewer or open the player at that time, Download .srt/.txt via the share sheet, owner "Transcribe again").
- Video: `lib/captions.ts` VTT parser (test `lib/captions.test.ts`) and a caption overlay; sidecar and Auto (speech) tracks listed in Subtitles next to embedded ones.
- Search: Spoken and Picture in Found in (only when allowed), "Said at" / "Seen at" place labels, "Looks like" / "Person" tag on hits without places.
- Face grouping Row in Account and Photo settings with a delete-data confirm.
- Impeccable pass: 48 dp targets, accessibility labels and roles, loading, error, empty and off states, no motion added.
- Emulator (Expo Go): chips, People row, memory card, People page, person page, review (Yes saved), search "Said at 0:03", Found in options, Details Transcript, .srt share sheet, line opens paused at 0:04, caption overlay at 0:04, face-off dialog. Not run: Details People on a photo, merge, Not X / Move.
- Known gaps: transcript lines on audio opened from a list start at 0:00 (only the video player honours a start time); no hide for person memory cards.

## Phase 20 status: end-to-end run with the real nimbus-ml (2026-11-13)

Real container (`local_server` ml profile, Whisper tiny, CLIP vitb32, YuNet+SFace), worker sweeps on the dev DB, AI on for `browser-test` only (`ai_access = chosen`).
- Speech: 12 videos/audio; a Hindi video gave 54 lines (`hi`), tones and silent clips `no_speech`. Search "induction" → the video with "Said at 0:32"; transcript JSON/.srt and the "Auto (Hindi)" subtitle track work.
- Pictures: 66 vectors (photos + video frames). "a group of people taking a selfie" → the 5 group photos tagged "Looks like"; "colorful gradient" → gradients; nonsense queries now return no picture hits.
- Faces: 5 crops of a 57-face group photo → 179 faces; the nightly pass made 24 people (one face per photo each); a fifth photo joined 21 faces and suggested 13. Rename → search by name finds the photos; accept suggestion, merge, cover crop, file faces all 200.
- Fixed in this pass:
  - ml: a video with no audio track is "no speech", not failed.
  - Worker: a video whose file can't be read is marked done for pictures instead of failing every sweep (it blocked faces).
  - Clustering: one person never twice in the same photo; edges closest first (look-alike chains had merged 3 people into one).
  - Matching: a new face can't join a person who's already in that photo.
  - Picture search cut-off: similarity ≥ 0.26 and within 0.04 of the best hit (0.22 let every photo through).
- Other dev DBs (`nimbus_admintest`, `nimbus_e2e`, `nimbus_apptest`) reindexed after the pgvector image switch and migrated to 0041.
- Release APK (x86_64, 0.2.10 version fields unchanged, 2026-11-13; Cursor open with the low-memory recipe, next dev/ml/emulator stopped during Gradle; 1m 16s, lowest free RAM 4.9 GB). Maestro 24/24 on it, including the new `ai` flow (People chip → Zara Test → person page; search "induction" → "Said at 0:32"). The first run failed `file-actions` and `albums`: the root folder had grown (my 5 test photos, now in "AI test"), and a route's first compile in `next dev` timed out; both passed on rerun.
- Web e2e 22/22, including the new `e2e/ai.spec.ts` (skips when AI is off). No AI rows on Vault files, no faces across accounts.
- Also fixed (Phase 19 bug found here): OCR retried a video gone from storage every sweep, because ffmpeg reports a 404, not NoSuchKey.
- Dev DB left with AI settings back at defaults (all off, Whisper base); test people/transcripts kept on `browser-test`. To try it: `docker compose -f local_server/docker-compose.yml --profile ml up -d ml`, then Admin → AI features.

### Open items closed (2026-11-13, second pass)
- Person memory cards can be hidden: "No memories of X" in the card menu (web) or on long press (app), with Undo; the person's page has "No memories of them" / "Show in memories" and a "Not in memories" note. Stored as `people.memories` (added to the unreleased 0041; dev DBs altered by hand).
- App: audio opened from a transcript line or a search hit starts there (2 s early, like video).
- Multilingual CLIP checked live: re-indexed 68 photos/frames; English, French and Hindi queries all find the group photos. Its scores run lower, so the cut-off is per model (`CLIP_MIN_SIM`: vitb32 0.26, multilingual 0.19). The env template now says to use 4g+ for it.
- Admin AI page checked as owner on a fresh :3001 instance: saves for all features and Access are audited; Health shows "AI service: Working". Fixed: the status line read "with  loaded" (the service sends [feature, model] pairs), and the model state now describes the model the admin picked (`/health` gained `ready`, every model on disk per feature). Fixed: in "Only chosen members" mode the owner and admins couldn't be on the list, so they lost the features; they now always count as chosen ("On, as an admin").
- Release APK rebuilt with these (1m 27s, lowest free RAM 3.3 GB, Cursor open); `ai`, `memories`, `photos` flows pass on it. The `ai` flow needs face grouping on for `browser-test` (or the opt-out default).

### Secrets polish (web, 2026-11-14)
Impeccable pass over every Secrets screen (web only; Secrets has no app UI), checked at 1440 and 390 wide with a seeded project (385 secrets, a 180-character key, 15 environments, SSH, PKI, items, KMS, a change request):
- Phones: the project sidebar is one sideways strip (hairlines between groups, the current page scrolled into view) instead of three strips and a long column; the unlock bar shrinks to "Unlocked" plus four icon buttons; the project menu sits beside the title; the env toolbar is one row (Add secret plus icon buttons, names kept for screen readers).
- Overview: long keys cut off with the full name on hover, so the environments stay on screen; the table scrolls inside itself with a sticky header row and key column; denser rows.
- Env table: Infisical-dense rows (32px controls), the masked value without a box until hover (always boxed on phones), aligned Key/Value headers, Export styled like the other outline buttons.
- Same patterns everywhere: skeleton rows instead of "Loading…", one empty state (icon, title, line) for trash, requests, access requests, audit, shares, snapshots, tokens, webhooks, SSH keys and hosts, overview and the env table; section headings on Trash, SSH and Access; project tiles use the neutral icon tile (teal stays for brand and focus); intro text and its button stack on phones.
- Fixes: Health's long keys spilled into the next card and scrolled the page sideways at 390; snapshot times wrapped; the environments dialog's names didn't line up; Leaks' back link matched no other page; focus rings on the guide's back link, contents links and the root-key card's summary; a project filter appears past 8 projects.
- Not covered: the admin Secrets page and the Health root-key card were reviewed in code only (the test account isn't an admin).

## Documents D4 status: Android (2026-11-14, built, not yet run on the emulator)
Built against the D1 API (`/api/v1/documents/*`, types in `packages/shared/documents-api.ts`); no native change.
- **More** has a Documents row (hidden when the summary answers 404, i.e. the admin turned it off; shows "N to review").
- **Documents screen** (`app/documents/index.tsx`): All / Needs review / Totals tabs, "Expiring soon" strip, filter chips (type, sender, date or year, amount + currency, expiry, missing fields, sort), search, list or grid, long-press multi-select with a bottom action bar (type, sender, confirm, merge to PDF, download, Not a document), pull to refresh, paging. The Add button scans (existing ML Kit `scan()`) or uploads into `Documents/<year>` through `upload-target` and the normal uploader. "Not a document list" lives in the Add sheet.
- **Details editor** (`app/documents/[id].tsx`): all fields, custom key/value, remind days (follows the type), notes, guess chips ("Use Receipt"), duplicate warning, expiry banner, the text Nimbus read, Save / Save and confirm, Not a document. Read-only for documents shared with me.
- **File menus and Details** (`components/document-rows.tsx` in `file-sheets.tsx`): Mark as document, Not a document, Confirm, Document details; a "Document" link in Details.
- **Settings**: Types (remind days), Senders (rename, merge, delete), Watched folders (with a folder picker), reached from the gear.
- **Notifications**: `document_expiring` opens the document (bell and push tap).
- **Offline**: lists/details/summary are saved by query-persist (`docs` key); field edits and Mark/Not a document go through the offline queue (`docPatch`, `docMark` ops, shown at once, replayed in order). Bulk, merge, settings and uploads need a connection.
- **Impeccable pass** (Operate mode, Drive-style, no new components of its own): outlined rows and tiles as in Files, teal only for selection and brand, warning amber for "Needs review" and the reminder window, destructive red for expired, tabular numerals for dates and amounts, 48dp targets, no coloured side borders, no nested cards. A device-size look still has to be done on the emulator.
- Checks: `tsc`, `node --test` (126 pass, incl. `documents-rules.test.ts`: filter to query, amounts, expiry wording, form to patch, optimistic list changes, queue ids and remap; notification target).
