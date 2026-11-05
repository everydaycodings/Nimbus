# Product

<!-- impeccable:product-schema 1 -->

## Platform

android

## Users
- **Self-hosters** connecting a phone to their own Nimbus server.
- **Small teams and families** on someone else's Nimbus server, often non-technical.

## Product Purpose
Nimbus for Android replaces the Google Drive app for people who run or use a Nimbus server: find and preview files, back up the camera, share, keep files offline and open Vaults, from any server the user names at first launch. It has every member feature and no admin panel. Owners and admins get one row that opens admin on the web.

## Positioning
Privacy and ownership. Files live on infrastructure the user trusts, the code is open, the app sends no analytics or crash data, and Vault contents are decrypted only on the device.

## Operating Context
One-handed, on the move, in any light, on connections that drop. Sessions are short and frequent: open a file, share a link, check that photos backed up. Backup runs unattended in the background and must be trustworthy without being watched.

## Capabilities and Constraints
- Expo development build with a small Kotlin module. Android only for now.
- Multi-account across multiple servers; servers vary in version, sign-in methods and whether they use http or a private CA.
- Offline: cached lists, kept files, and a visible queue of pending changes.
- Vaults are excluded from offline, Android Files integration and background upload.
- The app talks to a private `/api/v1`; an old app or old server gets a plain message saying what to update.

## Brand Commitments
- Name: **Nimbus**. Open source.
- Personality: trustworthy, friendly, independent, fast.
- Dark theme only.
- Same Nimbus as the web (tokens, Geist, file-type hues, teal cloud), with Android's gestures, sheets and navigation.
- The UI must feel professional and smooth, and be easy to navigate and use.

## Evidence on Hand
None yet. No users, testimonials, benchmarks or press exist; do not invent them.

## Product Principles
1. Ownership is visible: users always know which server and account they are on, and who can see a file.
2. Familiar first: keep Drive's mental model, reachable with one thumb.
3. Fast by default: cached content appears instantly and refreshes quietly.
4. Honest about security: explain what the Vault protects and what it costs in plain words.
5. Never lose work: uploads, backups and queued changes show their true state, and failures are visible.
