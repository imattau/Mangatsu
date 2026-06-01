# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Mangatsu** is a decentralized comic/manga reader for the Nostr network. Comics are stored on Blossom servers (NIP-B7); metadata (titles, chapters, reading progress, server lists) lives on Nostr relays as parameterized replaceable events. The app is a **mobile-first web application** built with Vite + React — not a native iOS/Android app.

---

## Commands

```bash
# Start dev server (Vite HMR)
npm run dev

# Production build (output to dist/)
npm run build

# Preview production build locally
npm run preview

# Type-check
npx tsc --noEmit

# Lint
npm run lint

# Run all tests
npm test

# Run a single test file
npm test -- path/to/file.test.ts
```

---

## Architecture

### Layer Overview

```
Vite + React (TypeScript)

UI (gluestack-ui v2)
  └── screens: Library, ComicDetail, Reader, Upload, Settings

State (Zustand + MMKV persistence)
  └── stores: AuthStore, ComicStore, ReadStore, BlossomStore

Services
  ├── NostrService  – Applesauce reactive Nostr layer
  └── BlossomService – blossom-client-sdk file upload/resolve

Nostr relays  ←→  Blossom servers  ←→  Local cache (MMKV + expo-file-system)
```

### Nostr Data Model

Events use parameterized replaceable kinds:

| Kind  | Purpose                        | `d` tag pattern         |
|-------|--------------------------------|-------------------------|
| 30402 | Comic metadata                 | `comic-slug`            |
| 30403 | Chapter (pages as `page` tags) | `comic-slug/chapter-N`  |
| 30301 | Reading progress               | `comic-slug/chapter-N`  |
| 10063 | User's Blossom server list     | (replaceable, no `d`)   |

Page images are referenced as `blossom://<sha256-hash>` URIs inside `page` tags and resolved to HTTPS at runtime using the user's preferred Blossom server from kind 10063.

### Key Packages

- **`applesauce-core`** – `EventStore` (reactive in-memory cache), `EventFactory` (build + sign events)
- **`applesauce-relay`** – `RelayPool` (manage WebSocket connections)
- **`applesauce-accounts` / `applesauce-signers`** – key management, bunker (NIP-46) support
- **`applesauce-loaders`** – `createEventLoaderForStore` wires RelayPool → EventStore automatically
- **`applesauce-react`** – React hooks for subscribing to EventStore queries
- **`blossom-client-sdk`** – upload blobs, produce `blossom://` URIs
- **`zustand`** – state management; persisted to `localStorage` via `zustand/middleware`
- **Web Crypto API / `window.crypto`** – private key handling in-browser; keys stored in `sessionStorage` or encrypted in `localStorage` (never plaintext)

### Service Design

`NostrService` is a singleton (or React context value) that owns `EventStore`, `RelayPool`, `AccountManager`, and `EventFactory`. Screens subscribe to reactive queries on `EventStore` (e.g., `eventStore.replaceable({ kind: 30402, pubkey })`) rather than imperatively fetching.

`BlossomService` is stateless. It reads the user's server list from `NostrService.eventStore` (kind 10063) and resolves `blossom://hash` → `https://server/blob/hash` at read time. Offline mode substitutes local file paths stored in MMKV.

### Offline Flow

1. User triggers download for a chapter.
2. All `page` blob URLs are fetched and stored via the **Cache API** (`caches.open()`).
3. A service worker intercepts `blossom://` blob requests and serves from cache when offline.
4. Zustand (persisted to `localStorage`) tracks which chapters are cached.

### Authentication

Browser extensions (NIP-07, e.g. Alby, nos2x) are the primary login path — they keep keys out of the page entirely. nsec/private key input and bunker (NIP-46) URIs via `@applesauce/signers` are also supported. Only the public key is persisted in `localStorage`; the signer is reconstructed at startup.

---

## Conventions

- All Nostr event construction goes through `EventFactory` — never build raw event objects manually.
- Blossom URIs (`blossom://`) are the canonical reference format in stored data; HTTP URLs are ephemeral and resolved at display time.
- Screens do not call service methods directly — they read from Zustand stores, which are populated by service layer reactions to `EventStore` updates.
- React Navigation stack names match screen file names (e.g., `ReaderScreen` → `"Reader"`).
