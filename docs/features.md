# Nimbus Features

Nimbus is an ultra-minimalist, high-performance file manager designed for absolute sovereignty over your data. It combines state-of-the-art encryption with a premium user experience.

---

## 🔒 Advanced Security & Encryption

Nimbus places security at its core, offering multiple layers of protection for your sensitive data.

### 1. Zero-Knowledge Vault
The primary vault uses **client-side AES-256 encryption**.
- **Server Blindness**: Files are encrypted before leaving your browser; neither the server nor cloud admins can access your data.
- **In-Browser Decryption**: Securely view and manage your files instantly without compromising your keys.
- **Password Protection**: Access is restricted by a secure passphrase known only to you.

### 2. Offline-First "Local Safe"
A next-generation privacy layer that bypasses the cloud entirely.
- **Sandboxed Storage**: Files are stored locally in your browser's sandboxed filesystem (OPFS).
- **Multi-Vault Isolation**: Create separate secure containers for different purposes, each with its own unique passphrase.
- **AES-256-GCM Performance**: Utilizes high-performance encryption with PBKDF2 (310k iterations) for local data derivation.

### 3. Plausible Deniability (Stealth Mode)
The ultimate privacy feature for extreme situations.
- **Dual Realities**: Use different passwords to unlock different vaults. One password reveals your standard files, while another unlocks a completely hidden "stealth" vault.
- **Ghost Files**: Stealth vaults are hidden even from database lists and server-side logs.
- **Zero Evidence**: It is technically impossible for a third party to prove that a hidden vault exists.

---

## 🗂️ Intelligent File & Folder Management

A modern workstation designed for efficiency and speed.

### Organization & Discovery
- **Smart Tags**: Categorize items with custom, multi-colored tags for quick visual identification.
- **Bulk Actions**: Perform operations on multiple files and folders simultaneously.
- **Dynamic Search (`⌘K`)**: Locate any file instantly with a global command palette and real-time filtering.
- **Starred Items**: Favorite your most important documents for quick access.

### Viewing Modes
- **Grid & List Views**: Switch between a visual grid for photos/media and a dense list for rapid document management.
- **Responsive Layout**: A fully optimized experience that works seamlessly across desktops, tablets, and smartphones.

---

## 🔄 Data Persistence & Recovery

Nimbus ensures that no data is ever truly lost unless you intend it to be.

### Version Control
- **"Time Travel"**: View the complete history of any file and jump back to any previous state instantly.
- **Partial Recovery**: Download an older version of a file without affecting the current production version.
- **Conflict Handling**: Intelligent collision detection when uploading files with identical names.

### Intelligent Trash
- **Soft Deletes**: Files are moved to a temporary trash bin, preventing accidental data loss.
- **Permanent Purge**: Securely delete items from the trash once you are certain they are no longer needed.

---

## 🔗 Enterprise-Grade Sharing

Secure, configurable sharing that gives you total control over how others access your data.

- **"Reveal & Burn"**: Create self-destructing links that permanently vanish after being viewed once.
- **Password-Protected Links**: Add an extra layer of security to public sharing URLs.
- **Configurable Expiry**: Set links to expire after a specific duration (e.g., 1 hour, 1 day).
- **Read-Only Mode**: Disable download permissions to prevent recipients from saving local copies of sensitive files.

---

## 🚀 Performance & Platform Highlights

Built with the latest technologies to ensure an ultra-fast, "sovereign" experience.

- **Real-Time Zipping**: Download entire folder structures as a single `.zip` file with real-time compression progress tracked on your dashboard.
- **Zero Latency**: Powered by Next.js 16 (Turbopack) and TanStack Query for near-instant data fetching and UI updates.
- **High-Performance Storage**: Optional AWS S3 integration for mission-critical reliability at scale.
- **Self-Hosted Infrastructure**: Total ownership—deploy Nimbus to your own cloud or on-premise hardware in minutes.
- **Premium Aesthetics**: A dark-first, fluid design with smooth micro-animations that make the platform feel alive.

---

© 2026 Nimbus Project • [docs/installation.md](installation.md) • [docs/architecture.md](architecture.md)
