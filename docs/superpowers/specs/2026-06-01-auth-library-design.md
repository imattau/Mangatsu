# Auth + Library Design

**Date:** 2026-06-01
**Scope:** Login flow (4 methods) + Library screen with applesauce React integration

---

## Architecture

A `<NostrProvider>` wraps the app in `main.tsx`. It instantiates one `NostrService` and exposes it via a `useNostr()` hook. On mount it connects to the default relay list.

Two complementary layers:

| Layer | Responsibility |
|---|---|
| **applesauce** (`EventStore`, `RelayPool`, `AccountManager`) | Live relay data, reactive queries, signing |
| **Zustand stores** (`authStore`, `comicStore`, `readStore`, `blossomStore`) | Persisted/offline cache via `localStorage` |

Screens read from both layers. Writes go through `NostrService` methods only — screens never touch `EventStore` or `RelayPool` directly.

---

## Auth Flow

`LoginScreen` is rendered when `authStore.pubkey` is null (guarded in the router).

### Layout

Vertical list (mobile-first). All four methods equal weight, stacked:

1. Browser Extension (NIP-07)
2. Paste nsec key
3. Bunker URI (NIP-46)
4. QR Code (NIP-46 inbound)

### Method Details

**NIP-07 — Browser Extension**
- Button triggers `window.nostr.getPublicKey()` via `Nip07Signer` from `applesauce-signers`
- No input required; fails gracefully if no extension is detected

**nsec — Private Key**
- Password-style text input
- `PrivateKeySigner` derives pubkey from the key
- Key stored in `sessionStorage` only (never `localStorage`); user warned explicitly
- Input cleared immediately after signer is created

**Bunker URI (NIP-46)**
- Text input for a `bunker://` URI
- `NostrConnectSigner` performs the NIP-46 handshake
- Loading state shown during handshake

**QR Code (NIP-46 inbound)**
- App generates a `nostrconnect://` URI and displays it as a QR code
- Remote signer (e.g. mobile Nostr app) scans and completes the handshake
- `NostrConnectSigner` waits for the callback

### Success Path (all methods)

```
signer created
  → accountManager.addAccount(account)
  → accountManager.setActive(pubkey)
  → authStore.setPubkey(pubkey)
  → router.navigate("/library")
```

### Startup Restoration

On app load, if `authStore.pubkey` is set:
- NIP-07: reconstruct `Nip07Signer` silently (stateless)
- nsec: check `sessionStorage`; if missing, clear pubkey and show login
- Bunker/QR: clear pubkey and show login (handshake must be redone)

---

## Library Screen

### Data Loading

On login, `NostrProvider` subscribes to kind `30402` events authored by the active pubkey via `RelayPool`. As events arrive they land in `EventStore`; a side-effect reaction parses them and calls `comicStore.setComic()`. Kind `30403` chapter events are fetched lazily when a comic is opened (not on library load).

`LibraryScreen` subscribes to `EventStore` via `applesauce-react` hooks — no manual fetch calls. The `comicStore` provides the offline-persisted fallback.

### Layout (option C — "Continue Reading" + grid)

**Continue Reading hero** (top, shown only when progress exists)
- Driven by `readStore.progress` — picks the entry with the most recent `updatedAt`
- Resolves to comic + chapter from `comicStore`
- Shows: cover thumbnail, title, "Ch. N · p.X", "Continue" CTA → navigates to Reader

**All Comics grid**
- 3-column cover grid
- Cover images: `blossom://` hashes resolved at render via `blossomStore.primaryServer()`
- Tap → navigate to `ComicDetail`
- Empty state: prompt to discover or upload comics

### Offline Behaviour

If relays are unreachable on load, the library renders from `comicStore` (persisted). A subtle indicator shows relay connection status. No error screen — stale data is better than blank.

---

## Files Affected

**New:**
- `src/context/NostrContext.tsx` — provider + `useNostr()` hook
- `src/screens/Login/index.tsx` — login screen with 4-method list
- `src/screens/Login/QrCodeView.tsx` — QR display sub-component

**Modified:**
- `src/main.tsx` — wrap app in `<NostrProvider>`
- `src/router.tsx` — auth guard redirecting to `/login` when no pubkey
- `src/services/NostrService.ts` — add `subscribeToComics()` method, relay subscription logic
- `src/stores/comicStore.ts` — no changes expected
- `src/screens/Library/index.tsx` — implement full layout

**Unchanged:**
- All other stores, `BlossomService`, `ComicDetail`, `Reader`, `Upload`, `Settings`

---

## Out of Scope

- Discover/search (finding comics from other pubkeys)
- Upload flow
- Reader screen
- Offline download / service worker
- Settings screen
