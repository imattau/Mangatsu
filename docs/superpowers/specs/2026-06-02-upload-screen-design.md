# Upload Screen Design Spec

## Overview

The Upload screen lets a logged-in user publish a new comic with its first chapter, or add a chapter to an existing comic. Comics are stored as Nostr kind 30402 (metadata) and kind 30403 (chapter) events; page images are uploaded to a Blossom server and referenced as `blossom://<sha256>` URIs.

---

## Entry Points

| Route | Behaviour |
|---|---|
| `/upload` | Full form: metadata + chapter. Publishes both kind 30402 and 30403. |
| `/comic/:dTag/upload` | Chapter-only upload. Metadata is pre-filled from the existing kind 30402 event and the form jumps to Step 2. Only kind 30403 is published. |

The `/comic/:dTag/upload` route is new; add it to `src/router.tsx` alongside the existing `/upload` route.

---

## UI: 5-Step Wizard

A stepper indicator shows the current position. Steps are sequential; the user cannot skip forward but can go back to edit earlier steps.

### Step 1 — Metadata

Fields:

| Field | Type | Required | Notes |
|---|---|---|---|
| Title | text input | Yes | Used to derive the `d` tag via `slugify()` |
| Author name | text input | No | Freetext display name |
| Author pubkey | custom component | No | See "Author Pubkey Input" below |
| Description | textarea | No | Populates `content` + `description` tag |
| Tags | text input | No | Comma-separated; split into individual `t` tags |
| Language | text input | No | BCP-47 code e.g. `en`, `ja` |
| Cover image | file picker | No | JPG/PNG/WebP; OR select "use first page of CBZ" (resolved in step 2) |

Validation: title must be non-empty before proceeding to step 2.

### Step 2 — Chapter

- CBZ drag-and-drop zone + "Browse" button (accepts `.cbz` files).
- Parse with **JSZip** in-browser:
  - Read `ComicInfo.xml` if present; extract `<Title>` → chapter title, `<Number>` → chapter number.
  - Fallback: parse chapter title and number from the filename (e.g. `Chapter 03 - The Beginning.cbz` → number 3, title "The Beginning").
- Filter ZIP entries to image files (`*.jpg`, `*.jpeg`, `*.png`, `*.webp`), sort by filename.
- Show preview: page count, first-page thumbnail, detected chapter title and number (editable).
- If cover was set to "use first page of CBZ", display the first-page thumbnail as a preview.

### Step 3 — Upload

- Upload pages sequentially to the primary Blossom server (from `useBlossomStore().primaryServer()`).
- Progress indicator: "Uploading page X of Y".
- Each page: call `blossomService.upload(file, serverUrl)`, receive sha256 hash.
- On failure: retry once automatically; if retry fails, show error with option to skip the page or abort.
- If cover was set to "use first page of CBZ", upload it separately; receive its sha256.

### Step 4 — Publish

- Build and sign events via `nostrService.accountManager.active.signer`:
  - **New comic** (`/upload`): build kind 30402 + kind 30403.
  - **Chapter-only** (`/comic/:dTag/upload`): build kind 30403 only.
- Publish via `nostrService.publishEvent(event)`.
- Show spinner. On success, advance to step 5.

### Step 5 — Done

- Display success message: "Comic published!"
- Two buttons: "View comic" → navigate to `/comic/:dTag`; "Upload another" → reset wizard to step 1.

---

## Author Pubkey Input Component

Located at `src/screens/Upload/AuthorPubkeyInput.tsx`.

Two modes, toggled by a button:

**Paste mode (default)**
- Text input accepting `npub1...` (NIP-19 bech32) or raw 64-char hex pubkey.
- On input change: validate format.
  - If valid npub: decode to hex using `nip19.decode` from `nostr-tools`.
  - If valid hex: use as-is.
- After decode: subscribe to relays for kind 0 (profile metadata) matching the pubkey; show the resolved display name below the input as confirmation (e.g. "Resolved: Alice").

**Search mode**
- Text input for a name or NIP-05 identifier.
- On submit (debounced 400 ms): query relays for `{ kinds: [0], search: query, limit: 10 }` (NIP-50; relay permitting) OR `{ kinds: [0], limit: 20 }` with client-side string matching on `content` JSON.
- Show a scrollable list of results: avatar (if available), display name, npub abbreviation.
- On select: populate the resolved pubkey and switch back to paste mode display.

Props interface:
```ts
interface AuthorPubkeyInputProps {
  value: string        // hex pubkey or ''
  onChange: (hex: string, displayName: string) => void
}
```

---

## Nostr Event Schemas

### Kind 30402 — Comic Metadata

```
{
  kind: 30402,
  content: description,
  tags: [
    ["d", slugify(title)],
    ["title", title],
    ["author", authorName],           // omit if empty
    ["author_pubkey", authorPubkeyHex], // omit if empty
    ["description", description],     // omit if empty
    ["cover", coverHash],             // omit if empty
    ["t", tag1],                      // one tag per entry
    ["t", tag2],
    ["language", language],           // omit if empty
  ]
}
```

### Kind 30403 — Chapter

```
{
  kind: 30403,
  content: "",
  tags: [
    ["d", `${comicDTag}/chapter-${chapterNumber}`],
    ["title", chapterTitle],
    ["page", "blossom://sha256-of-page-1"],
    ["page", "blossom://sha256-of-page-2"],
    // ...
  ]
}
```

---

## BlossomService.upload Implementation

`uploadBlob` from `blossom-client-sdk` handles the PUT `/upload` protocol (BUD-06), including optional auth via an `onAuth` callback. The implementation should:

1. Compute sha256 via the SDK helper (`getBlobSha256` is internal; use `crypto.subtle.digest` on the `ArrayBuffer`).
2. Call `Actions.uploadBlob(serverUrl, file, { onAuth })` where `onAuth` builds a NIP-98 auth event signed by the active account's signer.
3. Return the `sha256` from the returned `BlobDescriptor`.

The `onAuth` callback must produce a signed Nostr event with:
- `kind: 27235`
- `tags: [["u", uploadUrl], ["method", "PUT"], ["payload", sha256]]`
- `created_at`: current Unix timestamp

---

## `slugify` Function

```ts
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
```

---

## Files To Create/Modify

| File | Action | Responsibility |
|---|---|---|
| `src/screens/Upload/index.tsx` | Replace stub | Wizard orchestrator; holds all step state |
| `src/screens/Upload/MetadataStep.tsx` | Create | Step 1 form fields |
| `src/screens/Upload/ChapterStep.tsx` | Create | CBZ picker, JSZip parsing, page preview |
| `src/screens/Upload/UploadStep.tsx` | Create | Sequential upload with progress UI |
| `src/screens/Upload/PublishStep.tsx` | Create | Event building and relay publishing |
| `src/screens/Upload/DoneStep.tsx` | Create | Success UI with navigation |
| `src/screens/Upload/AuthorPubkeyInput.tsx` | Create | Paste + search author pubkey input |
| `src/screens/Upload/slugify.ts` | Create | Pure `slugify` utility |
| `src/services/BlossomService.ts` | Modify | Implement `upload()` using blossom-client-sdk |
| `src/router.tsx` | Modify | Add `/comic/:dTag/upload` route |
| `src/test/upload/slugify.test.ts` | Create | Unit tests for slugify |
| `src/test/upload/BlossomService.test.ts` | Create | Unit tests for upload (mocked fetch) |
| `src/test/upload/UploadScreen.test.tsx` | Create | Integration tests for the wizard |

---

## Dependencies

- **JSZip** — not yet installed. Add `jszip` + `@types/jszip` to `package.json`.
- **nostr-tools** — needed for `nip19.decode` (check if already installed).
- **blossom-client-sdk** v5 — already installed.

---

## Out of Scope

- Bulk multi-chapter uploads in a single session.
- Editing existing comic metadata (separate "Edit" screen).
- Cashu payment handling for paid Blossom servers.
- Offline-cached CBZ reading (separate download flow).
