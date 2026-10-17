# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
- **Self-hosters** running their own server who want a Google Drive replacement they fully control.
- **Small teams** that need shared folders and permissions without handing files to a big provider.
- **Everyday users**, often non-technical, who expect it to feel as familiar as Google Drive.

## Product Purpose
Nimbus is an open-source, self-hostable file storage and sharing app: a Google Drive clone you own. Success is someone moving off Drive without losing the habits they rely on, and knowing their files never leave infrastructure they trust.

## Positioning
Privacy and ownership. Files live in the user's own S3-compatible bucket, the code is open, and a Vault keeps the most sensitive files end-to-end encrypted so even the server operator cannot read them.

## Operating Context
- Daily file management in a browser: upload, organise, find, preview and share.
- Self-hosted via Docker Compose, or deployed to Vercel with external Postgres and S3.
- Sign-in with Google or GitHub OAuth.

## Capabilities and Constraints
- v1: upload single files, multiple files and whole folders; create folders; grid and list views; rename, move, trash; sharing with users and public links with permissions; in-browser previews (image, video, PDF, audio, code); search, recents, starred.
- Storage: any S3-compatible backend (S3, R2, MinIO, Backblaze). Resumable uploads via tusd.
- Encryption: server-side at rest for everything; Vault folders are encrypted client-side with a separate passphrase. Vault files get no server previews or content search, and a lost passphrase means lost files.
- Stack: Next.js full-stack, Postgres + Drizzle, Better Auth (email + password, Google, GitHub).
- Undecided: OIDC/SSO for self-hosters, storage quotas, hosted offering.

## Brand Commitments
- Name: **Nimbus**. Open source.
- Personality: trustworthy, friendly, independent, fast.
- Dark theme only.
- Layout keeps the Google Drive mental model (sidebar, toolbar, grid/list) so switchers feel at home.

## Evidence on Hand
None yet. No users, testimonials, benchmarks or press exist; do not invent them.

## Product Principles
1. Ownership is visible: users should always know where their files live and who can see them.
2. Familiar first: keep Drive's mental model, earn trust through details instead of novelty.
3. Fast by default: everyday actions are instant and keyboard-reachable.
4. Honest about security: explain what the Vault protects and what it costs (no previews, unrecoverable passphrase) in plain words.
5. Approachable for non-technical users, transparent for self-hosters.
