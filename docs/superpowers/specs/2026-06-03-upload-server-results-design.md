# Upload Server Results & Explicit Publish Design

**Date:** 2026-06-03  
**Status:** Approved

## Overview

After files are uploaded to Blossom servers, the user sees a per-server success summary before publishing. The Publish button is explicit — no auto-fire. Each file is mirrored to all configured servers; the Nostr event records every server that fully accepted all files.

---

## Data Model Changes

### `UploadArtifact` (publishDraft.ts)

```ts
// Before
export interface UploadArtifact {
  hash: string
  server: string
}

// After
export interface UploadArtifact {
  hash: string
  servers: string[]  // all servers that successfully accepted this file
}
```

### `ServerResult` (UploadStep.tsx, exported)

```ts
export interface ServerResult {
  url: string
  uploaded: number  // files this server accepted
  total: number     // total files attempted
}
```

### `UploadResult` (UploadStep.tsx)

```ts
export interface UploadResult {
  pageUploads: UploadArtifact[]
  coverUpload: UploadArtifact | null
  serverResults: ServerResult[]
}
```

---

## Upload Logic (`UploadStep.tsx`)

`uploadWithRetry` is replaced by `uploadToAll`. It attempts every configured server for each file, collects all that succeed, and returns `{ hash, servers }`. It does not throw if at least one server succeeded; it throws only if all servers fail.

`ServerResult[]` is computed after all uploads complete: for each server URL, count how many files it appears in across `pageUploads` and `coverUpload`.

`onDone` is called with the extended `UploadResult` including `serverResults`.

---

## `PublishStep` Changes

New prop: `serverResults: ServerResult[]`.

**Two internal phases** (replacing the current auto-fire):

### Phase: `review`

Renders a server results table:

| Server | Files | Status |
|--------|-------|--------|
| server-a.com | 47/47 | ✓ |
| server-b.com | 40/47 | ⚠ partial |

- If any server is partial, show a yellow warning: "Some servers accepted only part of the upload — they won't be recorded in the event."
- **Publish button** always enabled.

### Phase: `publishing`

Triggered by Publish button click. Fires existing `buildPublishDraft` / `publishDraft` logic.

---

## Event Construction (`publishDraft.ts`)

Chapter `page` tags include all fully-successful servers per file:

```ts
// Before
['page', `blossom://${upload.hash}`, upload.server]

// After
['page', `blossom://${upload.hash}`, ...upload.servers]
```

A server is included in a file's `servers` array only if it successfully accepted that specific file. The event naturally records only servers with complete coverage for each blob.

The `cover` tag on the comic event follows the same pattern:
```ts
// Before
['cover', hash, server]

// After
['cover', hash, ...servers]
```

---

## Orchestration (`index.tsx`)

No step changes. `handleUploadDone` receives the updated `UploadResult` and passes `serverResults` to `PublishStep`. The wizard remains 4 steps with the same breadcrumb labels.

---

## Error Handling

- If all servers fail for a single file: upload stops, error shown, Retry available (same as today).
- If a server partially fails (some files succeed, some don't): counted in `ServerResult`, shown as partial in review UI, excluded from the event for affected files only.
- Publish button is always enabled when review state is reached — user decides whether partial results are acceptable.
