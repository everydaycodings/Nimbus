# Nimbus Architecture Overview

Nimbus is built on a modern, high-performance stack, prioritizing performance and a seamless user experience.

## Technical Foundation

### Frontend
- **React 19**: Utilizing the latest features, including the `use` hook and Actions.
- **Next.js 16 (Turbopack)**: Leveraging the App Router, Server Components, and the high-speed Turbopack development server.
- **Zustand**: A lightweight, centralized state management library for managing global UI and data states.
- **TanStack Query**: Powering efficient data fetching, caching, and background data synchronization.
- **Tailwind CSS 4**: Modern, utility-first styling with enhanced CSS variables and design tokens.
- **shadcn/ui & Radix UI**: High-quality, accessible UI components as building blocks.

### Backend & Cloud Services
- **Supabase**: The core backend-as-a-service (BaaS), providing:
    - **Authentication**: Secure user management and session handling.
    - **PostgreSQL**: A high-performance, relational database with robust data integrity.
    - **Database Migrations**: Managed via the Supabase CLI for reproducible environments.
- **AWS S3**: Optional, high-availability object storage for mission-critical file management.
- **Browser-Native APIs**: Leveraging **OPFS** (Origin Private File System) for encrypted binary storage and **IndexedDB** for local metadata in the Offline Vault.
- **Web Crypto API**: Powering client-side AES-256-GCM encryption for both Cloud and Offline Vaults.

## Project Structure
A high-level view of the repository organization:
- `app/`: Next.js App Router (pages and layouts).
- `components/`: Global, reusable UI components.
- `hooks/`: Custom React hooks for data fetching and global state.
- `lib/`: utility functions and shared logic.
- `store/`: Zustand state definitions.
- `supabase/`: Database migrations, configuration, and snippets.
- `types/`: Global TypeScript definitions.
- `vault/`: Domain-specific components and actions for the cloud vault.
- `offline-vault/`: An entirely client-side storage implementation for maximum privacy.

## Core Workflows
- **Zipping & Downloads**: Large-scale zipping is handled efficiently, with progress tracking broadcasted to the frontend via server-side events.
- **File Versioning**: Soft-delete patterns and version history tracking are implemented using relational database triggers and constraints.
- **Recursive Cascading**: Folder tagging and deletions use recursive server-side actions (for cloud) and browser-side logic (for offline) to ensure state consistency across deep hierarchies.
- **Client-Side Editing**: Text file editing follows a "Fetch -> Decrypt -> Edit -> Encrypt -> Upload" pipeline entirely within the user's browser, ensuring raw data never touches the network.
- **Performance Optimization**: Lazy-loading and efficient data fetching minimize initial load times.
