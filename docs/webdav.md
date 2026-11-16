# Mount Nimbus as a drive (WebDAV)

Nimbus speaks WebDAV, so you can open your files in Finder, File Explorer, GNOME Files, Dolphin, rclone and phone apps as if they were a folder on your computer. Changes go through the same rules as the web app: access, quotas, versions, trash and notifications all work the same way.

In the examples, `https://nimbus.example.com` is your Nimbus address.

## Overview

| Item | Value |
|---|---|
| Address | `https://nimbus.example.com/dav` |
| Username | Your account email |
| Password | An app password from **Account → Connect a device** |
| GNOME Files | `davs://nimbus.example.com/dav` |
| Dolphin (KDE) | `webdavs://nimbus.example.com/dav` |

The **Connect a device** page shows the address for your server and has step-by-step guides for each system. This page has the same steps.

## For admins

There is nothing to set up. The `webdav` service ships in `docker-compose.yml` (port 3404) and nginx forwards `/dav` to it. The service hands each request to the app at `/api/dav`, because Next can't route WebDAV methods like `PROPFIND` and `MKCOL` on its own. See [install.md](install.md) for the services and [configuration.md](configuration.md) for settings.

- Turn WebDAV off for everyone in **Admin → System → WebDAV**.
- Turn it off for one member on their page under **Admin → Members**.

## App passwords

WebDAV clients don't sign in with your normal password, 2FA or single sign-on ([sso.md](sso.md)). They use an app password.

1. Open **Account → Connect a device**.
2. Make a new app password. Give it a name, like `Laptop – Dolphin`.
3. Pick the access:

| Access | What the device can do |
|---|---|
| Read & write | Open, add, change and delete files |
| Read only | Open and download, nothing else |

4. Copy the password into the app right away. It is shown only once. If you lose it, revoke it and make another.

Rules:

- Make one per device, so you can revoke a lost laptop without touching the others.
- An app password is 30 letters and digits in groups of five. Dashes, spaces and case don't matter when you type it.
- It stops working after 90 days without use.
- After 10 wrong passwords from one IP address, that address is blocked for 15 minutes (`429`).
- It doesn't work while your account has a temporary password, is not active, or has WebDAV turned off.

## What you see

The root of the drive is your own files. Next to them is a folder called **Shared with me**, with one folder per person who shared something with you, and inside it the things they shared:

```text
/Report.pdf
/Shared with me/Alice Ng/Photos/beach.jpg
```

If you already have a real folder called "Shared with me", the extra folder is called **Shared with me (Nimbus)** instead. Your role on shared items comes from the share, as on the web. Vault files are not shown.

## Locking

Nimbus supports WebDAV write locks, so two programs don't overwrite each other's changes.

- Locks are exclusive write locks only. A request for a shared lock is refused (`412`).
- A lock lasts what the client asks for, up to one hour. Clients refresh their locks while a file is open, so a crashed client's lock goes away by itself.
- A lock covers one file, or a folder and everything inside it.
- While a file or a folder above it is locked, other clients can't change, move or delete it (`423`).
- Locking a name that doesn't exist yet makes an empty file to hold it.

Temporary save files that a client left behind (it crashed, or the mount dropped mid-save) are removed after a day, unless they are still locked. A Mac's `._name` file is removed once `name` itself is gone. Only files written over WebDAV are touched, never files uploaded on the web.

## rclone

rclone works on every system and is the best choice for scripts, syncing and backups.

```sh
rclone config create nimbus webdav url=https://nimbus.example.com/dav vendor=other \
  user=you@example.com pass=$(rclone obscure 'APP-PASSWORD')
rclone mount nimbus: ~/Nimbus --vfs-cache-mode writes
rclone sync ~/Photos nimbus:Photos
```

Run the mount as a service with `Restart=always` so it comes back after sleep.

## Windows

### RaiDrive (recommended)

1. Install RaiDrive (free) from raidrive.com.
2. Click **Add**, choose **NAS → WebDAV**, untick **Address** autodetect and paste `https://nimbus.example.com/dav`. Keep **Secure connection** ticked.
3. Username: your email. Password: a new app password. Tick **Remember** if asked.
4. Click **Connect**. Nimbus shows up as a drive in File Explorer and reconnects after sleep or restart.

### Built into Windows (Map network drive)

1. Open File Explorer, right-click **This PC** → **Map network drive**.
2. Folder: `https://nimbus.example.com/dav`. Tick **Reconnect at sign-in** and **Connect using different credentials**.
3. Username: your email. Password: a new app password.

Notes:

- Windows only signs in over HTTPS. If your server uses plain HTTP, use RaiDrive.
- It may disconnect after sleep. Open the drive again to reconnect.
- It refuses files over 50 MB until you raise `FileSizeLimitInBytes` under `HKLM\SYSTEM\CurrentControlSet\Services\WebClient\Parameters`.

## macOS

### Mountain Duck (recommended)

1. Install Mountain Duck from mountainduck.io (paid, free trial).
2. Open it from the menu bar → **Open Connection**, choose **WebDAV (HTTPS)** and paste `https://nimbus.example.com/dav`.
3. Username: your email. Password: a new app password.
4. Click **Connect**. It stays in Finder and reconnects after sleep.

### Built into macOS (Finder)

1. In Finder press **⌘K** (Go → Connect to Server) and enter `https://nimbus.example.com/dav`.
2. Choose **Registered User**. Username: your email. Password: a new app password.
3. To connect at login, open System Settings → General → **Login Items** and drag the Nimbus drive in.

After sleep, click Nimbus under Locations in Finder to reconnect.

## Linux

### GNOME (Ubuntu, Fedora)

1. Open Settings → **Online Accounts** → **WebDAV** (GNOME 46 or newer).
2. Server: `https://nimbus.example.com/dav`.
3. Username: your email. Password: a new app password.
4. Nimbus appears in the Files sidebar and reconnects by itself.

Older GNOME: open Files → Other Locations → Connect to Server and enter `davs://nimbus.example.com/dav`. After sleep, click it in the sidebar to reconnect.

### KDE (Dolphin)

1. Type `webdavs://nimbus.example.com/dav` in the location bar and press Enter.
2. Username: your email. Password: a new app password.
3. Right-click the folder in Places → **Add to Places**.

### davfs2

davfs2 can't list folders on Linux 7 kernels. Use rclone there to mount Nimbus as a folder.

## Android

### Material Files (recommended)

1. Install **Material Files** (free) from Google Play or F-Droid. Solid Explorer works too.
2. Open the menu → **Add storage** → **WebDAV server**.
3. Host: `nimbus.example.com`, path: `/dav`, protocol HTTPS.
4. Username: your email. Password: a new app password.

## iPhone and iPad

1. Install **Documents by Readdle** (free) from the App Store. FE File Explorer works too.
2. Tap **+** → **Connection** → **WebDAV server**.
3. URL: `https://nimbus.example.com/dav`.
4. Username: your email. Password: a new app password.

Apple's Files app can't connect to WebDAV on its own.

## Limits

- Deleting a file or folder moves it to the trash, as on the web.
- Saving over a file adds a new version.
- Copies share the original's stored bytes, so nothing is uploaded again. A copy into someone else's folder still counts against their storage. When the space runs out the server answers `507`.
- A read-only app password can't make, change, move, delete or lock anything (`403`).
- Built-in clients on Windows, macOS and older GNOME may drop the connection when the device sleeps. The recommended apps keep the password and reconnect on their own.
- Vault folders are not available over WebDAV.
