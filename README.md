# Nimbus

**Intelligent Cloud Storage Dashboard**

Nimbus is an evolving cloud storage platform designed for performance, security, and a seamless user experience. Built on a modern tech stack, it provides a powerful "Vault" for managing sensitive files and folders with advanced features like real-time zipping and file versioning.

## 🚀 Highlights

- **🔒 Secure Vault**: A dedicated space for your most important data.
- **📂 Advanced Folder Management**: Move, rename, and organize folders with ease.
- **⚡ Parallel Zipping**: Rapid folder downloads with real-time compression progress.
- **🔄 Version Control**: Track history and restore previous versions of your files.
- **✨ Premium UI**: A modern, dark-first dashboard that's fully responsive.

## 🛠️ Tech Stack

- **Frontend**: Next.js 16 (App Router), React 19, Zustand, Tailwind CSS 4.
- **Backend**: Supabase (Auth, PostgreSQL, Storage).
- **Core Integrations**: AWS S3 for high-performance object storage.

## 📖 Documentation

Explore the detailed documentation in the `docs/` folder:

- **[Features List](docs/features.md)**: A comprehensive breakdown of what Nimbus can do.
- **[Installation Guide](docs/installation.md)**: Step-by-step instructions for local setup.
- **[Architecture Overview](docs/architecture.md)**: Insights into the technical design and project structure.

## ⚡ Quick Start

1. **Clone & Install**:
    ```bash
    git clone https://github.com/everydaycodings/Nimbus.git
    cd Nimbus
    npm install
    ```
2. **Setup Env**: Copy `.env.example` to `.env.local` and add your keys.
3. **Start Supabase**: `npx supabase start` (Requires Docker).
4. **Dev Server**: `npm run dev`.

---

© 2026 Nimbus Project • Released under the Apache License 2.0
Developed by [everydaycodings](https://github.com/everydaycodings)
