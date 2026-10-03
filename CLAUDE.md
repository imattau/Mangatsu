# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Mangatsu** is a decentralized comic/manga reader for the Nostr network. Page images and covers are stored on Blossom servers; metadata (comics, chapters, reading progress, lists) lives on Nostr relays. It is a **mobile-first web app** (Vite + React + TypeScript), also packaged as an **Android app with Tauri 2** (`src-tauri/`). Releases ship the Android build to GitHub Releases and Zapstore.

---

## Commands

```bash
npm run dev          # Vite dev server
npm run build        # tsc -b && vite build (output: dist/)
npm run preview      # serve dist/ (the .claude/launch.json "mangatsu-preview" config)
npx tsc -b           # type-check (project references)
npm run lint         # eslint
npm test             # vitest run (jsdom)
npm test -- src/test/ReaderScreen.test.tsx   # single file
npm run tauri android build                  # Android build (normally done by CI)
```

---

## Architecture

```
React 19 + Vite + Tailwind v4 + shadcn/ui (src/components/ui)
  screens (src/screens, lazy-loaded routes in src/router.tsx):
    Login, Library (/), Feed, ComicDetail, Reader, Upload (new/edit comic/chapter), Settings

State: Zustand stores in src/stores, persisted to localStorage via zustand/middleware
  auth, comics, read, library, blossom, relays, settings, session, publish-queue,
  nwc (encrypted with a session key, see lib/sessionCrypto)

Services (src/services)
  NostrService    – singleton owning EventStore, RelayPool, AccountManager, EventFactory
  BlossomService  – uploads via blossom-client-sdk (kind 24242 auth)
  ComicIndex      – IndexedDB + flexsearch catalog behind the Feed (search, tags, authors)
  WebTorrentService – optional P2P seeding/fetching of page blobs

NostrContext (src/context) wires the service into React: relay/account restore,
subscriptions, syncGeneration (bumped on refresh so effects resubscribe).
```

Screens call `service.*` directly (via `useNostr()`) and also read/write the Zustand stores; there is no separate store-only layer.

### Nostr data model

| Kind  | Purpose | Notes |
|-------|---------|-------|
| 30040 | Comic metadata | `d` = comic slug; Mangatsu comics carry `['L', 'com.mangatsu']` |
| 30041 | Chapter | `d` = `<comic-slug>/chapter-N`; pages as `['page', 'blossom://<sha256>', ...servers]`, plus `page_dimensions` / `page_torrent` |
| 30301 | Reading progress | `d` = chapter `d` tag |
| 30003 | Saved-comics library list | `d` = `mangatsu-library`, NIP-44 encrypted to self (`lib/nip51.ts`) |
| 10063 | User's Blossom server list | `['server', url]` tags |
| 10002 | User's relay list | read only |
| 3     | Contact list (follows) | edited by Feed's Follow/Unfollow |
| 1111  | Comments (NIP-22) | `components/ComicComments.tsx` |
| 1     | Boost note | `components/BoostButton.tsx` |
| 5     | Deletion requests | comic/chapter delete in ComicDetail |

`blossom://<sha256>` is the canonical page reference in events. `BlossomImage` resolves it to `https://<server>/<sha256>` at display time, trying the chapter's servers, then the user's 10063 list, then `DEFAULT_BLOSSOM_SERVERS`, with WebTorrent as an optional fallback.

### Profile search

`service.searchProfiles(query)` sends a NIP-50 `search` filter to `SEARCH_RELAYS` (in `NostrService.ts`) only: ordinary relays ignore `search` and return arbitrary profiles. Check a relay's NIP-11 `supported_nips` includes 50, and that it actually returns matches, before adding it. `AuthorPubkeyInput` also resolves `name@domain` queries directly via NIP-05.

### Replaceable lists: never publish from local state

Kinds 3, 10063 and 30003 are replaceable: publishing replaces the user's list in **every** Nostr client. Local state can be empty or stale (fresh device, not loaded yet), so a list built from it can wipe the user's data. Edit lists through the `NostrService` helpers, which load the newest event from relays (falling back to the local store), change one entry, keep all other tags and `content`, refuse to publish if the list can't be loaded, and serialize concurrent edits:

- `setFollow(pubkey, follow)` – kind 3
- `setBlossomServer(url, present)` – kind 10063
- `setLibraryEntry(aTag, saved)` – kind 30003 library. Decrypts the existing list (account signer's `nip44`, else `window.nostr` / nsec), keeps entries it doesn't recognise (both plain `30040:…` strings and `['a', …]` tags count as saved comics), and refuses if the list can't be decrypted or parsed.

Each returns the resulting list; write it back to the store (`setAll`, `setServers`) rather than assuming the optimistic local edit. Tests: `src/test/NostrServiceContacts.test.ts`, `src/test/NostrServiceLibrary.test.ts`.

### Offline reading

- "Make offline" (ComicDetail) caches the resolved HTTPS image URLs into the Cache API (`mangatsu-images-v1`) via `lib/offline.ts`; `areTargetsCached` reports status (no store involved).
- `public/sw.js` (registered in production only) answers image requests from that cache first (refreshing in the background, so viewed pages are also cached), caches same-origin app files as they are fetched, and falls back to `index.html` for navigation.
- The service worker only caches JS chunks it has fetched, so `src/router.tsx` prefetches the lazy Reader chunk when idle so downloaded chapters open offline. Keep that if you change route splitting.

### Authentication

Login methods (`src/screens/Login`): NIP-07 extension, pasted nsec, NIP-46 bunker URI, nostrconnect QR / copyable link, NIP-55 signer app (Amber; Android only, via the custom Tauri plugin `src-tauri/tauri-plugin-amber-opener` in the native app), and passkeys (`nostr-passkey`, web only). The extension and passkey options are hidden in the Tauri build.

`authStore` persists the pubkey, method and (for bunker/QR) the serialized NostrConnect account; `NostrContext` rebuilds the signer at startup. A pasted nsec is kept in `sessionStorage` only (`mangatsu:nsec`).

---

## UI: shadcn/ui

- Components live in `src/components/ui` (style `radix-nova`, Radix primitives via the `radix-ui` package, lucide icons). Theme tokens (zinc palette) are in `src/index.css`; the app is dark-only (`class="dark"` on `<html>`). Use tokens (`bg-card`, `text-muted-foreground`, `border`, `text-destructive`) rather than raw `zinc-*` colours.
- Add components with `npx shadcn@latest add <name> -y`. Afterwards:
  - The CLI writes `import { cn } from "cn"` and installs the `cn` package. Change the import to `@/lib/utils` and `npm uninstall cn`.
  - If a component exports a `cva` variants object (button, badge, tabs), move it into `<name>-variants.ts` so `react-refresh/only-export-components` passes.
  - When it asks to overwrite an existing file (e.g. `button.tsx`), answer no (`yes n | npx shadcn ...`): the local copies have been split as above.
- CSP (`index.html`) has no `style-src`, so libraries that inject `<style>` tags are blocked. vaul's stylesheet is imported explicitly in `src/index.css` for that reason; react-remove-scroll's scroll-lock style is still blocked (harmless where pages scroll inside their own container).
- In jsdom, Radix/vaul need stubs that live in `src/test/setup.ts` (pointer capture, ResizeObserver); vaul also needs `matchMedia` (tests stub it per file). `userEvent.setup()` installs its own clipboard, so stub `navigator.clipboard` after calling it. Radix `Avatar` only renders the image after a load event, which jsdom never fires.

---

## Conventions

- Build events with `EventFactory` (`service.eventFactory.build`) where practical. Some paths sign templates directly with `account.signer.signEvent` (list edits, uploads, progress, boosts); keep using the account signer there rather than mixing approaches within one function.
- Store `blossom://` URIs in events; HTTP URLs are resolved at display time and never persisted in events.
- Route paths are defined in `src/router.tsx`; every screen except Login sits behind `ProtectedRoute`.
- Tests live in `src/test` (and `src/test/upload`). Tests that need real Nostr signatures (nostr-tools `finalizeEvent`) must run in Node: add `// @vitest-environment node`, since jsdom's `Uint8Array` fails the crypto checks.
- Tauri permissions are in `src-tauri/capabilities/default.json`. In the Android WebView the web clipboard API is permission-gated; use `@tauri-apps/plugin-clipboard-manager` when `isTauri()`.

## Releases

1. Merge to `master` (merge commits, `git merge --no-ff`).
2. Bump the version in `package.json`, both root entries of `package-lock.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and the `app` package in `src-tauri/Cargo.lock`.
3. Commit `chore: bump version to X.Y.Z`, tag `vX.Y.Z` (lightweight), push `master` and the tag.

Pushing a `v*` tag runs `.github/workflows/android.yml`: signed APK/AAB, GitHub Release, and Zapstore publish (`zapstore.yaml`). Wait for the previous release run to finish before pushing the next tag so releases stay in order.

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
