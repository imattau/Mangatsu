# Upload Server Results & Explicit Publish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mirror uploads to all Blossom servers, show a per-server success summary, and require an explicit Publish button before signing and publishing Nostr events.

**Architecture:** `UploadStep` gains `uploadToAll` (attempts every server per file, collects successes). `UploadResult` gains `serverResults`. `PublishStep` starts in a `review` phase showing the summary table + Publish button, then transitions to `publishing` on click. `publishDraft.ts` spreads all successful servers into `page` and `cover` tags.

**Tech Stack:** React, TypeScript, Vitest, Tailwind CSS, blossom-client-sdk, Zustand

---

### Task 1: Update `UploadArtifact` type and fix `publishDraft.ts`

**Files:**
- Modify: `src/screens/Upload/publishDraft.ts`
- Modify: `src/test/upload/publishDraft.test.ts`

- [ ] **Step 1: Update the failing test first**

In `src/test/upload/publishDraft.test.ts`, update the fixture and assertions to use `servers: string[]`:

```ts
pageUploads: [
  { hash: 'hash1', servers: ['https://blossom-a.example', 'https://blossom-b.example'] },
  { hash: 'hash2', servers: ['https://blossom-a.example'] },
],
coverUpload: { hash: 'cover-hash', servers: ['https://blossom-a.example', 'https://blossom-cover.example'] },
```

Update the `expect` assertions:

```ts
expect(draft.events[0]).toMatchObject({
  kind: 30040,
  tags: expect.arrayContaining([
    ['cover', 'cover-hash', 'https://blossom-a.example', 'https://blossom-cover.example'],
  ]),
})
expect(draft.events[1]).toMatchObject({
  kind: 30041,
  tags: expect.arrayContaining([
    ['page', 'blossom://hash1', 'https://blossom-a.example', 'https://blossom-b.example'],
    ['page', 'blossom://hash2', 'https://blossom-a.example'],
  ]),
})
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npm test -- src/test/upload/publishDraft.test.ts
```

Expected: type errors or assertion failures referencing `server` vs `servers`.

- [ ] **Step 3: Update `UploadArtifact` and event construction in `publishDraft.ts`**

Replace the `UploadArtifact` interface and both tag constructions:

```ts
export interface UploadArtifact {
  hash: string
  servers: string[]
}
```

In `buildPublishDraft`, replace the cover tag:
```ts
if (input.coverUpload) {
  comicTags.push(['cover', input.coverUpload.hash, ...input.coverUpload.servers])
}
```

Replace the page tags:
```ts
...input.pageUploads.map((upload) => ['page', `blossom://${upload.hash}`, ...upload.servers]),
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- src/test/upload/publishDraft.test.ts
```

Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add src/screens/Upload/publishDraft.ts src/test/upload/publishDraft.test.ts
git commit -m "feat: update UploadArtifact to support multiple servers per file"
```

---

### Task 2: Add `ServerResult` type and `uploadToAll` logic to `UploadStep`

**Files:**
- Modify: `src/screens/Upload/UploadStep.tsx`

- [ ] **Step 1: Add `ServerResult` export and update `UploadResult`**

At the top of `src/screens/Upload/UploadStep.tsx`, add/update these interfaces:

```ts
export interface ServerResult {
  url: string
  uploaded: number
  total: number
}

export interface UploadResult {
  pageUploads: UploadArtifact[]
  coverUpload: UploadArtifact | null
  serverResults: ServerResult[]
}
```

- [ ] **Step 2: Replace `uploadWithRetry` with `uploadToAll`**

Remove the `uploadWithRetry` function and replace with:

```ts
async function uploadToAll(file: File, serverUrls: string[]): Promise<UploadArtifact> {
  const account = service.accountManager.active
  if (!account) throw new Error('Not logged in')

  let hash: string | null = null
  const successfulServers: string[] = []

  for (const serverUrl of serverUrls) {
    try {
      const result = await blossomService.upload(file, serverUrl, account.signer as never)
      setCachedHash(result.sha256, result.url)
      hash = result.sha256
      successfulServers.push(serverUrl)
    } catch {
      // continue to next server
    }
  }

  if (hash === null) {
    throw new Error('Failed to upload to any Blossom server.')
  }

  return { hash, servers: successfulServers }
}
```

- [ ] **Step 3: Replace `convertAndUploadWithRetry` with `convertAndUploadToAll`**

```ts
async function convertAndUploadToAll(file: File, serverUrls: string[]): Promise<UploadArtifact> {
  setPhase('converting')
  const webpFile = await convertImageFileToWebp(file)
  setPhase('uploading')
  return uploadToAll(webpFile, serverUrls)
}
```

- [ ] **Step 4: Update `run()` to use new function and compute `serverResults`**

Replace the `run` function body:

```ts
async function run() {
  setRunning(true)
  setError('')
  setPhase('idle')
  const serverUrls = getUploadServers()
  const pageUploads: UploadArtifact[] = []

  for (const page of pages) {
    try {
      const upload = await convertAndUploadToAll(page, serverUrls)
      pageUploads.push(upload)
      setUploaded((n) => n + 1)
    } catch (err) {
      setError(`Failed to upload page: ${err instanceof Error ? err.message : String(err)}`)
      setRunning(false)
      setPhase('idle')
      return
    }
  }

  let coverUpload: UploadArtifact | null = null
  const coverSource = coverMode === 'first-page' ? pages[0] : coverFile
  if (coverSource) {
    try {
      coverUpload = await convertAndUploadToAll(coverSource, serverUrls)
      setUploaded((n) => n + 1)
    } catch (err) {
      setError(`Failed to upload cover: ${err instanceof Error ? err.message : String(err)}`)
      setRunning(false)
      setPhase('idle')
      return
    }
  }

  const allUploads = [...pageUploads, ...(coverUpload ? [coverUpload] : [])]
  const serverResults: ServerResult[] = serverUrls.map((url) => ({
    url,
    uploaded: allUploads.filter((u) => u.servers.includes(url)).length,
    total: allUploads.length,
  }))

  setRunning(false)
  setPhase('idle')
  onDone({ pageUploads, coverUpload, serverResults })
}
```

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit
```

Expected: errors in `index.tsx` and `PublishStep.tsx` about missing `serverResults` prop — that's expected, fix in next tasks.

- [ ] **Step 6: Commit (after downstream fixes in tasks 3 and 4 make tsc clean)**

Hold this commit until Task 4 completes.

---

### Task 3: Update `index.tsx` to thread `serverResults` to `PublishStep`

**Files:**
- Modify: `src/screens/Upload/index.tsx`

- [ ] **Step 1: Import `ServerResult` and extend the passed props**

Add `ServerResult` to the import from `UploadStep`:

```ts
import { UploadStep, type UploadResult, type ServerResult } from './UploadStep'
```

- [ ] **Step 2: Pass `serverResults` to `PublishStep`**

In the JSX where `PublishStep` is rendered, add the prop:

```tsx
{step === 'publish' && uploadResult && (
  <PublishStep
    isNewComic={isNewComic}
    existingDTag={existingDTag}
    metadata={metadata}
    chapter={chapter}
    pageUploads={uploadResult.pageUploads}
    coverUpload={uploadResult.coverUpload}
    serverResults={uploadResult.serverResults}
    onDone={handlePublishDone}
  />
)}
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: error only in `PublishStep.tsx` about the unknown `serverResults` prop — fix in Task 4.

---

### Task 4: Update `PublishStep` with review phase and server results table

**Files:**
- Modify: `src/screens/Upload/PublishStep.tsx`

- [ ] **Step 1: Add `serverResults` prop and review phase state**

Update the props interface and initial state:

```ts
import type { ServerResult } from './UploadStep'

interface PublishStepProps {
  isNewComic: boolean
  existingDTag?: string
  metadata: MetadataFormValues
  chapter: ChapterFormValues
  pageUploads: UploadArtifact[]
  coverUpload: UploadArtifact | null
  serverResults: ServerResult[]
  onDone: (comicDTag: string) => void
}
```

Change the initial status state from `'publishing'` to `'review'`:

```ts
const [status, setStatus] = useState<'review' | 'publishing' | 'done' | 'error'>('review')
```

- [ ] **Step 2: Remove the `useEffect` auto-fire**

Delete the entire `useEffect` block (lines 61–66 in the original file). Publishing will be triggered manually.

- [ ] **Step 3: Add a `handlePublish` click handler**

```ts
function handlePublish() {
  setStatus('publishing')
  void publish()
}
```

- [ ] **Step 4: Replace the JSX with review + publishing rendering**

```tsx
return (
  <div className="space-y-6">
    <h2 className="text-lg font-semibold text-zinc-100">Step 4 — Publish</h2>

    {(status === 'review' || status === 'publishing' || status === 'error') && (
      <>
        <div className="overflow-hidden rounded-xl border border-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-left text-xs text-zinc-500">
                <th className="px-4 py-2 font-medium">Server</th>
                <th className="px-4 py-2 font-medium text-right">Files</th>
                <th className="px-4 py-2 font-medium text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {serverResults.map((r) => {
                const isPartial = r.uploaded < r.total
                return (
                  <tr key={r.url} className="border-b border-zinc-800/50 last:border-0">
                    <td className="px-4 py-2 text-zinc-300 font-mono text-xs truncate max-w-[180px]">
                      {new URL(r.url).hostname}
                    </td>
                    <td className="px-4 py-2 text-right text-zinc-400">
                      {r.uploaded}/{r.total}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {isPartial ? (
                        <span className="text-yellow-400">⚠ partial</span>
                      ) : (
                        <span className="text-green-400">✓</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {serverResults.some((r) => r.uploaded < r.total) && (
          <p className="text-sm text-yellow-400">
            Some servers accepted only part of the upload — they won't be recorded in the event.
          </p>
        )}
      </>
    )}

    {status === 'review' && (
      <button
        type="button"
        onClick={handlePublish}
        className="w-full rounded-full bg-white px-5 py-3 text-sm font-medium text-zinc-950 hover:bg-zinc-200"
      >
        Publish
      </button>
    )}

    {status === 'publishing' && (
      <p className="text-sm text-zinc-400">Signing and publishing events to relays...</p>
    )}

    {status === 'error' && (
      <p className="text-sm text-red-400">Error: {errorMsg}</p>
    )}
  </div>
)
```

- [ ] **Step 5: Type-check and run all upload tests**

```bash
npx tsc --noEmit
npm test -- src/test/upload/
```

Expected: all passing, no type errors.

- [ ] **Step 6: Commit tasks 2–4 together**

```bash
git add src/screens/Upload/UploadStep.tsx src/screens/Upload/PublishStep.tsx src/screens/Upload/index.tsx
git commit -m "feat: mirror uploads to all blossom servers and add explicit publish with server results"
```

---

### Task 5: Verify in the browser

**Files:** none

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

- [ ] **Step 2: Navigate to the upload flow and upload a comic chapter**

Go to `http://localhost:5173` → Upload. Complete metadata and chapter steps, then start the upload.

- [ ] **Step 3: Verify upload step**

Progress bar should show "Converting N of M..." then "Uploading N of M..." for each file. All configured servers should be attempted per file.

- [ ] **Step 4: Verify review phase**

After upload completes, the Publish step should show the server results table (hostname, file count, ✓ or ⚠). The Publish button should be visible and enabled.

- [ ] **Step 5: Verify publish**

Click Publish. Should show "Signing and publishing events to relays..." then advance to the Done step.

- [ ] **Step 6: Verify event tags (optional, using a relay inspector)**

If you have a relay inspector or Nostr client, confirm that the published chapter event contains `page` tags with multiple server URLs where all servers succeeded.
