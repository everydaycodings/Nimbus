# Vaults

A vault is a place for your most sensitive files. Everything in it is encrypted in your browser (or in the Android app) before it is uploaded, file and folder names included, with a passphrase the server never sees. This guide covers how vaults work, what they protect and what they don't, and what happens if you forget the passphrase.

## What a vault is

- Each member can have several vaults, each with its own name and its own passphrase. Open them from **Vault** in the sidebar (`/vault`).
- Inside, a vault works like My files: folders, grid or list, breadcrumbs, a name filter across the whole vault, rename, move, keyboard shortcuts and right-click menus.
- The server stores only ciphertext and wrapped keys. It can't read your files, their names or their types.
- Vault files count toward your storage, shown as a "Vault" part of the storage meter.

The cost of this: the server can't help with anything that needs to read a file. See [What vaults don't do](#what-vaults-dont-do).

## Create a vault

1. Open **Vault** and create a new one.
2. Read the explainer and tick **I understand**.
3. Choose a passphrase. By default it must be at least 12 characters, and a meter flags guessable ones. An admin can set other rules under **Admin → Authentication → Password rules**.
4. Save the **recovery key**. It is shown once, and you can't skip this step: **Copy** or **Download** it first. Keep it somewhere other than the passphrase.

An admin can turn new vaults off, or cap how many each member has, under **Admin → Sharing → Vaults**. Vaults that already exist keep working.

## Unlock and lock

Unlock a vault with its passphrase, or with its recovery key. Unlocking with the recovery key offers to set a new passphrase.

Keys live in memory only. Every vault locks when you:

- reload the page,
- press **Lock**,
- leave the browser idle for the time set in **Account → Vault → Lock after**: 5, 15 (default), 30 or 60 minutes.

### Change the passphrase

Use the vault's ⋯ menu. Your files and the recovery key stay as they are: only the copy of the vault key that the passphrase opens is replaced.

## Put files in and take them out

- **Uploads:** every upload path works in an unlocked vault: the New menu, the Upload button, drag and drop, paste, and whole folders. Files are encrypted piece by piece as they upload, resume after a reload, and show in the normal progress panel.
- **Same names:** a vault has no versions. When a name is taken you choose **Replace**, **Keep both** or **Skip**.
- **Move to vault…** in My files encrypts items into a vault. **Move to My files…** decrypts them back out. The originals are deleted for good only once every file has landed. A skip, a failure or a cancel keeps them.
- **Opening files:** previews decrypt in the browser with the usual viewers, up to 1 GB, and ← and → step through the folder. Downloads decrypt as they stream. Zips are built in the browser.
- **Trash:** each vault has its own trash, with Restore, Delete forever and Empty trash. The admin's trash retention applies to it too.

## Delete a vault

Deleting a vault needs its passphrase and its name, typed. Everything in it, and its stored data, goes with it.

## What is protected

Someone with the database and the storage bucket learns only:

- the vault's name (vault names are not encrypted),
- how many files and folders it holds and how they are nested,
- their rough sizes (sizes are padded only by the encryption overhead),
- when they changed, and which are in the vault's trash,
- that two items in one folder share a name, if they do. Nimbus stores a keyed fingerprint of each name so it can refuse duplicates without reading them. It means nothing without the vault key.

They don't learn file contents, file names, folder names or file types.

## What isn't protected

- **A compromised server.** A vault doesn't protect against a server that sends tampered JavaScript to your browser. The code that encrypts runs in the page the server sends.
- **A stolen session.** Someone signed in as you can't open a vault without the passphrase, but they can trash its contents, as in My files. Two-factor is the defence. See [sso.md](sso.md).
- **Files you take out.** A decrypted download, a ZIP or a file moved back to My files is no longer protected.

## What vaults don't do

Because the server can't read vault files, they get:

- no thumbnails and no server-side previews,
- no search (names or contents), no OCR and no AI features,
- no Recent, Starred, notifications or comments,
- no sharing with members (but see [Share vault files](#share-vault-files)),
- no WebDAV, S3 API, casting or Restore to a point in time,
- no versions.

Blocked file types don't apply inside vaults. The server can't see the names.

## If you forget the passphrase

Use the recovery key. Unlocking with it offers to set a new passphrase, and the vault works as before.

**If you lose both the passphrase and the recovery key, the files are gone.** Nobody can recover them: not you, not an admin, not the person who runs the server. An admin can only delete the vault (**Admin → Members**, a member's menu, **Delete vault…**) to free the space. That is logged in the admin audit log.

A server backup doesn't help either. It holds the same ciphertext. See [backups.md](backups.md).

## Share vault files

You can share one vault file or folder with anyone by link, without giving away the vault key. Use **Share link…** on the item. The vault's **Shared links** list shows the links you made.

| Option | Choices |
|---|---|
| How the link is opened | The key is in the link itself, or the person also needs a passphrase you choose |
| Expires | After 1, 7 or 30 days, or never |

How it works:

- Your browser makes a new random key for the link and re-wraps each shared file's own key under it. No data is copied.
- **Key in the link:** the key is in the part after `#`, which the browser never sends to the server. Anyone with the full link can open it.
- **Passphrase:** the link carries no key. The link key is wrapped with the passphrase (Argon2id), so the person types it to open the link.
- The page at `/v/<token>` decrypts in the visitor's browser. They can preview and download.
- A folder link is a snapshot: files added later aren't in it. A file deleted later drops out of it.
- Your list of links shows each one's name (sealed with the vault key, so only you can read it), its expiry and its view count.
- **Revoke** deletes the link and the wrapped keys with it.

An admin can turn vault links off under **Admin → Sharing → Vaults**. New links can't be made then, and existing ones stop opening.

## Android vault

The Android app opens the same vaults. See [android.md](android.md) for installing it.

- Encryption runs in native code (Kotlin), with the same format as the web. A vault made on the web opens on the phone, and the other way round. Keys never reach the app's JavaScript and stay in memory until the vault locks.
- **Fingerprint unlock** can be turned on per vault (Android Keystore, strong biometrics only). If the phone's fingerprints change, the app asks for your passphrase again.
- **Locking:** a vault locks after 30 seconds in the background, and after your idle setting.
- **Screenshots:** vault screens are blocked from screenshots and the recent-apps preview. So is the recovery key.
- **Previews** are decrypted to temporary files, deleted when you close the previewer or lock.
- **Uploads** keep going in the background, and resume after the app is killed or the network drops.
- **Ways in:** Move to vault, and sharing a file from another app into a vault.
- **Ways out:** a decrypted download (with a warning), a ZIP, Open with another app, and Move out.
- Vaults stay out of offline files and Android's Files app.
- **Share link** works from the vault sheet, and vault settings list your shared links.

## Technical details

All of this is in `packages/shared/vault-crypto.ts`, shared by the browser and Node tests. The Android app has its own implementation, checked byte for byte against vectors made from this code.

**Keys**

- Each vault has a random AES-256-GCM vault key.
- It is stored wrapped twice:
  - by a key from **Argon2id** of the passphrase (64 MiB memory, 3 iterations, parallelism 1, a random 16-byte salt). The passphrase is normalized to NFC first.
  - by a key from **HKDF-SHA-256** of the recovery key. The recovery key is 32 random bytes, written in base32 in groups of four.
- Changing the passphrase makes a new salt and a new passphrase-wrapped copy. Nothing else changes.

**Names**

- Each name is sealed with AES-GCM under the vault key, with a random 12-byte IV. The sealed value holds the name and the file type.
- The duplicate check uses a name tag: HMAC-SHA-256 of the lowercased name, under a key derived from the vault key with HKDF, cut to 16 bytes. A unique index refuses two items with the same tag in one folder.

**Files**

- Each file has its own AES-256-GCM key, wrapped by the vault key and stored with its version.
- Files are encrypted in 4 MiB chunks. Each chunk's nonce is its index, and its additional data holds the index and an "is last" flag. Reordered, swapped or truncated ciphertext fails to open, even when cut on a chunk boundary.
- Each chunk adds a 16-byte tag, so the server knows the ciphertext size and nothing finer.
- Uploads go through tus, encrypted chunk by chunk as they are sent, so they resume. Moving files in and out reads and writes by byte range, so memory stays flat at any size.

**Share links**

- A link key is a fresh random AES-256 key per link. The vault key never leaves the owner.
- Each shared file's key is re-wrapped under the link key. A manifest (path, size, type, version, wrapped file key for each file) is sealed with the link key.
- Key mode: the link key travels in the URL's `#` as base64url. Passphrase mode: the link key is wrapped by Argon2id of the passphrase, with the same settings as above.
- The server holds the sealed manifest, the wrapped link key (passphrase mode) and which ciphertexts the link may fetch.

## See also

- [sharing.md](sharing.md): sharing files outside a vault
- [backups.md](backups.md): server backups
- [android.md](android.md): the Android app
- [configuration.md](configuration.md): instance settings
