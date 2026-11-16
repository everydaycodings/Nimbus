# Sharing

Nimbus has several ways to get files to other people, and to get files from them. This guide covers each one, who can do what, and the admin switches that control them.

| You want to | Use |
|---|---|
| Work on a file or folder with other members | [Share with people](#share-with-people) |
| Let anyone with a link see a file or folder | [Public links](#public-links) |
| Collect files from people, with or without an account | [File requests](#file-requests) |
| Send someone a copy that expires | [Transfer](#transfer) |
| Share photos | [Shared albums and partner sharing](#shared-albums-and-partner-sharing) |
| Discuss a file | [Comments](#comments) |
| Share a vault file | [vault.md](vault.md#share-vault-files) |
| Share one secret value | [secrets.md](secrets.md) |

## Share with people

Open an item's ⋯ menu and choose **Share…** (or press Shift+S). Add members by name or email.

### Roles

| Role | Can |
|---|---|
| Viewer | Open, preview and download |
| Editor | Everything a viewer can, plus upload, make folders, rename, trash, manage versions and thumbnails |
| Owner | Everything, including sharing, links and giving the item away |

- Shares are inherited: sharing a folder shares everything in it. When someone gets access in more than one way, the highest role wins.
- The dialog lists people who get access through a parent folder, and where it comes from.
- What editors add belongs to the folder's owner and counts against the owner's storage.
- Editors trash into the owner's trash, with Undo.
- Editors can only move things between folders of the same owner, so nothing leaves a shared folder by moving.
- **Editors can share it too** lets editors add people and links, for the item and everything inside it. Editors manage only the shares and links they made.

### Invite someone without an account

Type an email that has no account. Nimbus emails an invite (this needs email set up, and a sign-up mode other than Closed). The link is good for 30 days and skips approval when that address signs up. The share is waiting in **Shared with me**. See [sso.md](sso.md#sign-up-mode).

### What the other person sees

- Shared items appear in **Shared with me**, with a badge for new ones.
- **Add shortcut to My files** puts a shared item in their own My files.
- Stars are per person, so shared items can be starred.
- Shared items show up in their search and Recent.
- Tiles show a people icon for member shares and a link icon for public links.

### Give an item away

**Offer ownership** in the share dialog. The new owner accepts or declines from the bell. Accepting checks their storage and moves the item, with everything in it, to their My files. You keep edit access. Comments go with the file.

## Public links

A public link lets anyone who has it open a file or folder without an account. In the share dialog, under **Public links**, choose **New link**. An item can have any number of links.

| Option | Choices |
|---|---|
| Name | So you can tell links apart |
| Expires | A date, or never (an admin can cap how long links last) |
| Password | Optional. Changing it signs out everyone who unlocked the link |
| People with the link can | See the file (or the files in a folder), download, upload files (file drop) |

With **Download** off, people can only preview. Anyone can still screenshot what they see.

The link opens at `/s/<token>`: a password prompt first when needed, then the file, or a folder with breadcrumbs, a name filter, the previewer and zip downloads.

### Counts and access log

Each link shows its view and download counts, and its recent activity. **View all activity** opens the access log: time, event, IP address and browser, kept for 90 days.

### Limits

- Wrong passwords: 10 per IP per 15 minutes.
- Anonymous uploads: 200 per IP per hour.

**Delete link** stops it at once.

## File requests

A file request asks people to send you files. It is a public link on a folder with uploads turned on. Choose **Request files** in the share dialog, or **Request files…** from a folder's menu.

| Option | Meaning |
|---|---|
| Instructions for people sending files | Shown on the page, e.g. "Please send your signed contract and a photo ID." |
| Ask for an email | Their name is always asked. With an email, they also get a receipt |
| Put each person's files in a folder with their name | People who give the same name share a folder. Off by default |
| Kinds of files | Images, PDFs, documents, videos, audio, and other extensions such as `.psd` |
| Each file up to (GB) | The largest file allowed |
| Files at most | How many files in total |
| Stop after, in total (GB) | How many bytes in total |
| Expires, Password | As for any public link |

- Uploads land in the folder, belong to you and count against your storage.
- The folder's contents stay hidden, unless the link also lets people see the files.
- The page shows your title, the instructions, a "Closes in…" countdown, and the visitor's own uploads.
- You get a notification (bell, push and email) when files arrive.
- The limits are checked again when each upload finishes, not just in the browser.

## Transfer

Transfer sends a copy of files, by link or by email, that is deleted when it expires. Choose **Send with Transfer…** from an item's menu, or open **Transfers** in the sidebar.

| Option | Meaning |
|---|---|
| Recipients | Email addresses. Each one gets their own link |
| Copy link | One more link, not tied to anyone |
| Message | Shown to the recipient |
| Expires | After 1, 7 or 30 days, up to the admin's limit |
| Password | Optional |
| Download limit | How many full downloads each link allows |

- A full download is a zip, or the first file in a 30-minute visit.
- The recipient's page (`/t/<token>`) has previews, **Download all** and **Save to my Nimbus**.
- You get a "Downloaded by…" notice for each download (bell, push and email, folded hourly). Turn it off with the "Transfers" notification preference under Account.
- The copies count against your storage until the transfer expires or you revoke it.
- **Transfers** lists what you sent, with **Revoke**. Revoke works on closed transfers too, since they still hold storage.

## Shared albums and partner sharing

- **Albums** point at photos. Each album has its own shares, as a viewer or a contributor who can add photos, and its own public links (`/a/<token>`). A public album link never shows locations or who else has the album.
- **Partner sharing** (**Account → Partner sharing**) shares all your photos, or those from a date onwards, with one person. Their photos and yours show up together in Photos, with a badge and a toggle. **Save to my library** makes a copy. Accepting offers to share back. Locations stay private.

## Comments

Members comment on files they can open, from Details or the previewer.

- Threads with replies, one level deep.
- **@mentions** of people who have access to the file.
- Anchors: the whole file, a moment in a video or audio file, or a PDF page. Clicking one jumps the previewer there.
- Reactions: 👍 ❤️ 😂 🎉 👀.
- Edit and delete your own comments. The owner and editors can delete any comment and resolve any thread. The person who started a thread can resolve it.
- Deleting a first comment that has replies leaves a "Comment deleted" stub.
- New threads notify the owner, replies notify the people in the thread, and mentions notify the person mentioned. Choose where under the "Comments" notification preference.
- File rows show a badge with the number of open threads. Search finds comment text, and `has:comments` finds files with comments.

Comments are for signed-in members only. They don't appear on public links, and folders and vault files can't have them.

## Notifications

The bell in the header shows sharing events: something shared with you, access changed or removed, file drops, editors' changes in your folders (one entry per folder per hour), ownership offers, comments, transfers, albums and partner requests. Choose bell, email or both for each kind under **Account → Notifications**.

## What admins control

| Setting | Place |
|---|---|
| Allow public links, longest link lifetime, require a password on new links | Admin → Sharing → Public links |
| Every public link, with item, owner, counts and expiry, and Revoke | Admin → Sharing → Public links |
| Allow Transfer, longest transfer lifetime, biggest transfer | Admin → Sharing → Transfers |
| Every transfer, with Revoke | Admin → Sharing → Transfers |
| Allow vault share links | Admin → Sharing → Vaults |
| Revoked links and every settings change | Admin → Security → Audit log |

- Turning public links off stops existing links from opening, and members can't make new ones. Sharing with members isn't affected.
- Turning Transfer off hides it, and no transfer opens. Copies are still deleted at expiry.
- Admins can't open other people's public links from the admin list.

## See also

- [vault.md](vault.md): sharing encrypted files
- [sso.md](sso.md): sign-up modes and invites
- [android.md](android.md): sharing from the phone
- [configuration.md](configuration.md): instance settings
- [secrets.md](secrets.md): one-time share links for secret values
