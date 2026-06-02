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
| 30040 | Comic metadata                 | `comic-slug`            |
| 30041 | Chapter (pages as `page` tags) | `comic-slug/chapter-N`  |
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

`NostrService` is a singleton (or React context value) that owns `EventStore`, `RelayPool`, `AccountManager`, and `EventFactory`. Screens subscribe to reactive queries on `EventStore` (e.g., `eventStore.replaceable({ kind: 30040, pubkey })`) rather than imperatively fetching.

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

## TypeScript Navigation (typegraph-mcp)

Where suitable, use the `ts_*` MCP tools instead of grep/glob for navigating TypeScript code. They resolve through barrel files, re-exports, and project references and return semantic results instead of string matches.

- Point queries: `ts_find_symbol`, `ts_definition`, `ts_references`, `ts_type_info`, `ts_navigate_to`, `ts_trace_chain`, `ts_blast_radius`, `ts_module_exports`
- Graph queries: `ts_dependency_tree`, `ts_dependents`, `ts_import_cycles`, `ts_shortest_path`, `ts_subgraph`, `ts_module_boundary`

Start with the navigation tools before reading entire files. Use direct file reads only after the MCP tools identify the exact symbols or lines that matter.

For quick architectural insight, prefer composition modules and entrypoints over top-level barrel files. If `ts_module_exports` on an `index.ts` or other barrel looks empty or uninformative, pivot to the app entrypoint, router, handler, service composition root, or API module that wires real behavior together.

Use `rg` or `grep` when semantic symbol navigation is not the right tool, especially for:

- docs, config, SQL, migrations, JSON, env vars, route strings, and other non-TypeScript assets
- broad text discovery when you do not yet know the symbol name
- exact string matching across the repo
- validating wording or finding repeated plan/document references

Practical rule:

- use `ts_*` first for TypeScript symbol definition, references, types, and dependency analysis
- use `rg`/`grep` for text search and non-TypeScript exploration
- combine both when a task spans TypeScript code and surrounding docs/config
