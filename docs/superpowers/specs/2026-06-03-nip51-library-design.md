# NIP-51 Encrypted Library List

**Date:** 2026-06-03  
**Status:** Approved

## Goal

Replace the implicit "library = your kind 30040 events" model with an explicit, encrypted NIP-51 bookmark list. Users can save foreign comics privately. Own comics are shown separately under "My Comics".

---

## Data Model

- **Kind:** 30003 (NIP-51 bookmark set, parameterized replaceable)
- **`d` tag:** `"mangatsu-library"`
- **`content`:** NIP-44 encrypted JSON array of `a` tags
  ```json
  ["30040:<pubkey>:<dTag>", "30040:<pubkey2>:<dTag2>"]
  ```
- **Cleartext tags:** `["d", "mangatsu-library"]` only — no `a` tags leaked in plaintext

---

## Architecture

### New files

**`src/lib/nip51.ts`**
- `encryptLibraryList(aTags: string[], signer): Promise<string>` — JSON-serialise then NIP-44 encrypt
- `decryptLibraryList(content: string, signer): Promise<string[]>` — decrypt then JSON-parse; returns `[]` on any failure

Encryption fallback order:
1. Signer exposes `nip44.encrypt` (NIP-07 extension or bunker) → use it
2. Otherwise use `nip44` from `nostr-tools` directly with the in-page key from `authStore`

**`src/stores/libraryStore.ts`**
```ts
interface LibraryState {
  savedATags: string[]          // ordered list of "30040:<pubkey>:<dTag>"
  add: (aTag: string) => void
  remove: (aTag: string) => void
  isIn: (aTag: string) => boolean
  setAll: (aTags: string[]) => void
}
```
Persisted to `localStorage` (key: `"library"`). `savedATags` is an array (ordered, serialisable).

### Modified files

**`src/services/NostrService.ts`**
- `subscribeToLibraryList(pubkey, onEvent)` — subscribes to `{ kinds: [30003], authors: [pubkey], '#d': ['mangatsu-library'] }`
- `publishLibraryList(aTags: string[])` — encrypts content, builds + signs + publishes kind 30003

**`src/context/NostrContext.tsx`**
- On login, call `subscribeToLibraryList` → decrypt → `libraryStore.setAll()`
- For each saved `a` tag not in `comicStore`, fire a one-shot fetch for that `30040:<pubkey>:<dTag>`

**`src/screens/Library/index.tsx`**
- **"My Comics"** section: kind 30040 events by own pubkey (existing behaviour)
- **"Saved"** section: comics resolved from `libraryStore.savedATags` via `comicStore`
- "Sign in to access your saved comics" shown when logged out and saved list is empty

**`src/screens/ComicDetail/index.tsx`**
- Foreign comics: show **Save / Unsave** button (hidden when logged out)
- Save: `libraryStore.add(aTag)` + `publishLibraryList`
- Unsave: `libraryStore.remove(aTag)` + `publishLibraryList`
- Own comics: no save button (already in "My Comics")

---

## Flow

### Saving a comic
1. User taps "Save" on a foreign ComicDetail
2. `libraryStore.add(aTag)` — instant local update
3. `NostrService.publishLibraryList(allATags)` — encrypt full list, publish kind 30003 (fire-and-forget)

### Loading the library on login
1. Subscribe to own kind 30003 `d=mangatsu-library`
2. On event: decrypt content → `libraryStore.setAll(aTags)`
3. For each `a` tag not in `comicStore`: fetch `{ kinds: [30040], authors: [pubkey], '#d': [dTag] }` one-shot

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| Decryption fails | Treat as empty list; show subtle warning in Saved section |
| Publish fails | Swallow silently; local state is source of truth |
| No signer / logged out | Save/Unsave buttons hidden; "Sign in" notice in Saved section |
| Saved comic metadata missing | One-shot relay fetch on library load |
| Multiple devices / conflict | Last-write-wins (replaceable event), no special handling |

---

## Out of Scope

- Multiple named lists
- Reordering saved comics
- Offline download of saved comics
- Sharing library with others
