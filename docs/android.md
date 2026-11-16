# Nimbus for Android

Nimbus for Android is a native app for your own Nimbus server. It has every member feature of the web app and no admin panel: owners and admins get one row under More that opens admin on the web. It works with any Nimbus server you name at first launch, and with several accounts on several servers at once. There is no iOS app.

The app sends no analytics or crash data. Vault contents are decrypted only on the phone.

## Install

Pick one:

- Open `https://<your-nimbus>/app` on the phone. The page picks the right build and downloads it. On a computer it shows a QR code that opens the same page on your phone.
- Download an APK from the [GitHub Releases](https://github.com/everydaycodings/Nimbus/releases) page.

Each release has one APK per phone architecture:

| File | For |
|---|---|
| `nimbus-<version>-arm64-v8a.apk` | Most phones from the last several years |
| `nimbus-<version>-armeabi-v7a.apk` | Older 32-bit phones |
| `nimbus-<version>-x86_64.apk` | Emulators and Chromebooks |
| `nimbus-<version>-universal.apk` | Works anywhere, larger download |

Chrome on Android doesn't always report the phone's architecture. The `/app` page then recommends arm64 and lists every APK under Other versions.

Chrome may say the file might be harmful, because it doesn't come from the Play Store. Choose Download anyway, then allow your browser to install apps when Android asks ("Install unknown apps").

The server gets its APKs from the latest GitHub release (cached for an hour). When GitHub can't be reached, it offers the APKs bundled in `apps/web/android/` instead.

The `/app` page is public. It is also linked from the sign-in page footer and from Account, under Sign in on your phone.

## Updates

- **In the app:** More → About → Check for updates. The app asks your server for the newest release, shows its notes, downloads the APK for your phone's architecture, asks once for "Install unknown apps", then opens Android's installer. An update installs over the old app and keeps your accounts.
- **Obtainium:** add `github.com/everydaycodings/Nimbus` to [Obtainium](https://obtainium.imranr.dev/).

If the app is too old for the server, or the server too old for the app, the app says which one to update.

## Sign in

On first launch, either:

- **Type the server address**, for example `files.example.net`, and sign in with any method the server has turned on: password, Google, GitHub, OIDC, two-factor codes and passkeys. See [sso.md](sso.md) for setting up providers.
- **Scan a QR code.** On your computer, open Nimbus, go to Account, then Sign in on your phone. Tap Scan QR code in the app and point it at the screen.
- **Use a short code.** On the sign-in screen tap Use a code from your computer, enter the server address and the code the Account page shows (like `ABCD-2345`).

With a QR or code, the computer then asks whether to allow the phone by name. Choose Allow on the Account page to finish. The QR holds the server address and a one-time token, never a password. Codes last 2 minutes, work once, and refresh while the page is open.

A bare address is tried over `https://` only. Typing `http://` works, with a warning. Private certificate authorities are allowed, also with a warning.

An admin can turn QR and code sign-in off in Admin → Authentication (Allow QR and code sign-in). Devices already signed in stay signed in.

After the first sign-in the app offers an app lock (biometric or PIN). You can decline it.

### Several accounts

Tap your avatar in the search bar to open the account sheet. Add accounts there, on the same server or others. Each account's data, cache and offline files are kept apart, and signing out of one deletes its offline files.

## What it does

### Files

- Tabs: Files, Photos, Shared, Starred, More. Tablets get a navigation rail and a wider grid.
- Grid or list. Tap opens, long-press selects, ⋯ for actions.
- Filter chips (Type, Modified, Size, Tags), sort, breadcrumbs.
- New folder, rename, move, star, tags, trash with Undo, restore, delete forever.
- Sharing with members, public links (password, expiry, download switch, access log), versions, comments, activity, search with filter chips and server content search.
- Text editor for `.txt`, `.md` and code files up to 1 MB. Save makes a new version.
- Scan documents to a multi-page PDF (needs Google Play services).
- App shortcuts, home screen widgets, a Quick Settings tile for camera backup, and direct share targets.

### Previews

Everything opens inside the app, and you swipe between files. Images, video and audio play natively. PDF, Word, spreadsheets, slides, Markdown, code and zip listings each have their own viewer. Office files can also open in Collabora when the server has it. "Open with" hands the file to another app.

Previews are cached on the phone, up to 500 MB. Big files on mobile data ask first.

### Video player

The player has its own controls:

- Double-tap the left or right side to skip 10 seconds; double-tap the middle to pause or play.
- Drag sideways to seek. In fullscreen, drag up or down on the left half for brightness, the right half for volume.
- Press and hold for 2× speed. Pinch to fill the screen or fit it.
- Lock touch, so the screen ignores taps until you unlock.
- Rotation and fullscreen, next and previous video, picture-in-picture.
- Video settings: playback speed, subtitles (tracks in the file, subtitle files next to it, and Auto captions from [speech search](ml.md)), audio track, picture fit, loop, sleep timer and quality.
- Long videos offer "Resume from…" or Start over. The position is saved to your account, so it carries across devices.

Audio plays in the background with lock-screen controls.

### Cast

Video, photos, slideshows and audio can be cast to a Chromecast from My files and Shared (not from vaults or public links). The TV gets a short-lived signed address. The Cast button only shows when a TV is on the network and the phone has Google Play services.

Videos a Chromecast can't play are cast from the 720p copy, if the server has made one. Your storage bucket needs CORS GET allowed for any origin so the TV can fetch the file.

### Data-saver video

When an admin turns on video copies (Admin → Text in images), the server makes 720p and 480p copies of each video. The app plays 480p on mobile data by default and the original on Wi-Fi. Change it under More, or per video under Quality.

### Photos and camera backup

- The Photos tab is a timeline of your images and videos by date taken, with memories, places, albums and slideshows.
- Camera backup uploads new photos and videos to `Camera/YYYY/MM` in My files. It is offered at first sign-in, and can include older items and other albums.
- Rules: Wi-Fi only by default; mobile data, charging only and videos on Wi-Fi only are settings.
- Backup runs periodically. The Reliable backup switch uses a foreground service instead.
- Photos already in Nimbus (same bytes anywhere, or same name and size in the month folder) are skipped. Files are uploaded byte for byte, so location data stays.
- Uploads resume after losing the connection, a reboot or the app being killed.
- The ring around your avatar shows backup state: teal progress while uploading, full teal when backed up, red when failing. Tap the status card for the queue (pause, resume, skip).
- **Free up space** deletes photos from the phone only after the server confirms them, through Android's own delete dialog.
- Other phone folders can be backed up one way, or synced both ways. When both sides change, the server's copy is kept and the phone's is uploaded as `name (conflict, <device>).ext`. Deletes go to Trash.
- Contacts and calendars can be backed up too.

### Offline files and the change queue

- Mark files or folders to keep them on the phone. Marked items refresh on Wi-Fi.
- More → Offline shows what is kept and sets the storage limit. Saving past it asks first; nothing is removed on its own.
- With no connection you can browse folders you opened before and open kept files. Other files are greyed out.
- Changes made offline (rename, star, new folder, move, edits) wait in a queue and replay when you're back online. A change that fails shows in the Couldn't sync list with Retry. Nothing is dropped silently.
- A file trashed on the server, or one you lost access to, is removed from the phone and you're told.

### Nimbus in other apps (Files app)

Nimbus shows up in Android's system file picker and Files app. Each account is a root with My files, Shared with me, Starred and Recent. Other apps can open, save over (a new version), create, rename and delete files there. Roots are hidden while the app lock is on, and vaults never appear.

For WebDAV clients, make an app password under Account. See the app's Files settings.

### Vault

Vaults work as on the web, with the same encryption: a vault made on the web opens on the phone and the other way round. See [vault.md](vault.md).

- Unlock with the passphrase or recovery code, or turn on fingerprint unlock per vault. Enrolling a new fingerprint turns it off until you use the passphrase again.
- Vaults lock after 30 seconds in the background and after the idle time you set. Locking deletes decrypted temporary files.
- Vault screens can't be screenshotted.
- Vault uploads continue in the background and survive the app being killed.
- Vaults are left out of offline files, the Files app and camera backup.

### Notifications

There are three ways to get notifications. Pushes carry no content: the phone fetches the text from your server.

| Way | Setup | Speed |
|---|---|---|
| Polling | None | Every 15 minutes |
| Instant notifications | Account → Notifications → Instant notifications | Within seconds |
| UnifiedPush | Install [ntfy](https://ntfy.sh) or another UnifiedPush distributor on the phone | Within seconds |

Instant notifications keep a connection open to your own server (`GET /api/v1/events`). Android shows a quiet "Connected to Nimbus" notification while it is on.

With UnifiedPush, the distributor's own server (ntfy.sh by default) works with no change on your side. To self-host ntfy, answer yes to "Self-host push notifications (ntfy)?" in `./setup.sh` (compose profile `push`, port 3405), add a DNS record for `ntfy.<your domain>` (`setup-nginx.sh` serves it over HTTPS), and enter `https://ntfy.<your domain>` in the ntfy app. See [install.md](install.md) and [configuration.md](configuration.md).

## Permissions

Android asks for each when a feature first needs it.

| Permission | Used for |
|---|---|
| Photos and videos (`READ_MEDIA_IMAGES`, `READ_MEDIA_VIDEO`, `READ_MEDIA_VISUAL_USER_SELECTED`, `READ_EXTERNAL_STORAGE` on older Android) | Camera backup, picking photos |
| Photo location (`ACCESS_MEDIA_LOCATION`) | Keeping GPS data in backed-up photos |
| Notifications (`POST_NOTIFICATIONS`) | Notifications and upload progress |
| Contacts, Calendar (`READ_CONTACTS`, `READ_CALENDAR`) | Contacts and calendar backup |
| Install apps (`REQUEST_INSTALL_PACKAGES`) | In-app updates |
| Foreground services, start at boot | Reliable backup, background uploads, instant notifications after a reboot |
| Camera | Scanning QR codes and documents, taking photos to Nimbus |
| Biometrics | App lock and vault fingerprint unlock |

Other phone folders are picked through Android's folder picker, so the app never needs access to all files.

## Troubleshooting

- **The app closed unexpectedly:** the next launch offers Copy report. Crash reports stay on the phone.
- **Copy diagnostics** (More → About) copies details for a bug report, with addresses and emails shortened.
- **Can't reach a server on your network:** check that the phone can open the server's address in its browser.

## Building from source

The app lives in `apps/mobile`. It is an Expo (SDK 58) app with Expo Router, plus a Kotlin module in `apps/mobile/modules/nimbus-android` for the uploader, Files app provider, push and vault crypto. Builds are local; EAS isn't used.

You need Node, a JDK with a compiler and the Android SDK. The scripts default to `JAVA_HOME=~/Android/jdk` and `ANDROID_HOME=~/Android/Sdk`.

Run every Expo command from `apps/mobile`, never the repo root. If your shell sets `NODE_ENV`, unset it first.

### Run in development

```bash
npm run dev                                   # web server, from the repo root
cd apps/mobile && unset NODE_ENV && npm run go     # Expo Go
cd apps/mobile && unset NODE_ENV && npm start      # development build (the installed app)
```

Both first run `npm run viewers`, which builds `viewer/*.ts` into `src/lib/viewers/` (generated, not committed), and `npm run licences`. A fresh clone needs `npm run viewers` before `npm run typecheck` or any native build.

Expo Go runs all screens, password and QR sign-in and the in-app scanner. It can't do Google, GitHub or OIDC sign-in, or anything in the Kotlin module (backup engine, Files app, vault, push).

To build and install a debug APK:

```bash
cd apps/mobile && CI=1 npx expo prebuild --platform android --no-install
cd android && unset NODE_ENV && JAVA_HOME=~/Android/jdk ANDROID_HOME=~/Android/Sdk \
  ./gradlew :app:assembleDebug -PreactNativeArchitectures=arm64-v8a,x86_64 --max-workers=3; ./gradlew --stop
```

`npm run android` (`expo run:android`) also works.

On a phone, the server's `TUS_URL` and `S3_ENDPOINT` in `apps/web/.env.local` must use your computer's network address, not `localhost`, or previews and uploads fail.

### Checks

| Command (in `apps/mobile`) | Does |
|---|---|
| `npm run typecheck` | TypeScript, app and viewers |
| `npm test` | Unit tests (`src/lib/*.test.ts`) |
| `npm run lint` | `expo lint` |
| `npm run e2e:android` | Maestro flows in `.maestro`, against a running emulator |

Kotlin unit tests: `./gradlew :nimbus-android:testDebugUnitTest` in `apps/mobile/android`.

### Release build

```bash
cd apps/mobile && npm run release:android
```

This runs `scripts/release-android.sh`. It builds signed APKs for arm64-v8a, armeabi-v7a and x86_64 plus a universal one, into `apps/mobile/dist/nimbus-<version>-<abi>.apk`, and copies them to `apps/web/android/`, which the server offers when GitHub isn't reachable. The version comes from `app.json`.

Signing uses `NIMBUS_KEYSTORE_FILE` (with `NIMBUS_KEYSTORE_PASSWORD`, `NIMBUS_KEY_ALIAS`, `NIMBUS_KEY_PASSWORD`) or `~/.nimbus/release.properties`. With neither, the script makes a keystore once in `~/.nimbus/`.

Back up `~/.nimbus/release.properties` and its `.jks`. They can't be recreated: every update must be signed with the same key, or it won't install over the old app.

Pushing a `v*` tag builds the APKs in GitHub Actions (`.github/workflows/android-release.yml`) and attaches them to the release, when the repository has the `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD` secrets. The tagged commit's message becomes the release notes the app shows.

The package ID is `org.nimbus.drive`.
