# Upload Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a 5-step wizard for uploading new comics and chapters to Nostr/Blossom, accessible at `/upload` (new comic) and `/comic/:dTag/upload` (chapter-only).

**Architecture:** A stateful wizard component in `src/screens/Upload/index.tsx` holds all form data and delegates each step to a focused sub-component. `BlossomService.upload()` is implemented using `blossom-client-sdk`'s `Actions.uploadBlob`. JSZip parses CBZ files in-browser; signed Nostr events are built from raw tag arrays and signed via the active account's signer.

**Tech Stack:** React 18, TypeScript, Vite, Zustand, applesauce-core/relay/accounts/factory, blossom-client-sdk v5, JSZip (to install), nostr-tools (to install for NIP-19 decode), Tailwind CSS, Vitest + React Testing Library.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/screens/Upload/slugify.ts` | Create | Pure `slugify(title) → string` utility |
| `src/screens/Upload/AuthorPubkeyInput.tsx` | Create | Paste + search author pubkey input widget |
| `src/screens/Upload/MetadataStep.tsx` | Create | Step 1 form (title, author, cover, etc.) |
| `src/screens/Upload/ChapterStep.tsx` | Create | Step 2 CBZ drop-zone + JSZip parse + preview |
| `src/screens/Upload/UploadStep.tsx` | Create | Step 3 sequential Blossom upload + progress bar |
| `src/screens/Upload/PublishStep.tsx` | Create | Step 4 sign + publish events to relays |
| `src/screens/Upload/DoneStep.tsx` | Create | Step 5 success UI + navigation |
| `src/screens/Upload/index.tsx` | Replace stub | Wizard orchestrator; all shared state |
| `src/services/BlossomService.ts` | Modify | Implement `upload()` using blossom-client-sdk |
| `src/router.tsx` | Modify | Add `/comic/:dTag/upload` route |
| `src/test/upload/slugify.test.ts` | Create | Unit tests for slugify |
| `src/test/upload/BlossomService.test.ts` | Create | Unit tests for upload (mocked fetch) |
| `src/test/upload/UploadScreen.test.tsx` | Create | Wizard integration tests |

---

## Task 1: Install dependencies

**Files:** `package.json`

- [ ] **Step 1: Install jszip and nostr-tools**

```bash
cd /home/mattthomson/workspace/Mangatsu && npm install jszip nostr-tools
npm install --save-dev @types/jszip
```

Expected: both packages appear in `node_modules/`, no type errors.

- [ ] **Step 2: Verify type resolution**

```bash
cd /home/mattthomson/workspace/Mangatsu && npx tsc --noEmit 2>&1 | head -20
```

Expected: no new errors introduced.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add jszip and nostr-tools dependencies"
```

---

## Task 2: slugify utility

**Files:**
- Create: `src/screens/Upload/slugify.ts`
- Create: `src/test/upload/slugify.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/test/upload/slugify.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { slugify } from '@/screens/Upload/slugify'

describe('slugify', () => {
  it('lowercases and trims', () => {
    expect(slugify('  Hello World  ')).toBe('hello-world')
  })

  it('replaces spaces and underscores with hyphens', () => {
    expect(slugify('My_Comic Title')).toBe('my-comic-title')
  })

  it('strips non-word characters', () => {
    expect(slugify('One Piece! Vol.1')).toBe('one-piece-vol1')
  })

  it('collapses multiple hyphens', () => {
    expect(slugify('A---B')).toBe('a-b')
  })

  it('strips leading and trailing hyphens', () => {
    expect(slugify('--hello--')).toBe('hello')
  })

  it('handles Japanese characters (keeps unicode word chars)', () => {
    expect(slugify('進撃の巨人')).toBe('進撃の巨人')
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
cd /home/mattthomson/workspace/Mangatsu && npm test -- src/test/upload/slugify.test.ts 2>&1 | tail -10
```

Expected: FAIL — `slugify` not found.

- [ ] **Step 3: Implement slugify**

Create `src/screens/Upload/slugify.ts`:

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

- [ ] **Step 4: Run tests to verify pass**

```bash
cd /home/mattthomson/workspace/Mangatsu && npm test -- src/test/upload/slugify.test.ts 2>&1 | tail -10
```

Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/screens/Upload/slugify.ts src/test/upload/slugify.test.ts
git commit -m "feat: add slugify utility with tests"
```

---

## Task 3: Implement BlossomService.upload

**Files:**
- Modify: `src/services/BlossomService.ts`
- Create: `src/test/upload/BlossomService.test.ts`

The `blossom-client-sdk` `Actions.uploadBlob(server, blob, opts)` function handles the BUD-06 PUT `/upload` flow. When a server returns 401, it calls `opts.onAuth(server, sha256, "upload", blob)` and expects back a signed Nostr event (kind 27235). The returned `BlobDescriptor` has a `sha256` string field.

- [ ] **Step 1: Write failing tests**

Create `src/test/upload/BlossomService.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the blossom-client-sdk Actions module before importing BlossomService
vi.mock('blossom-client-sdk', () => ({
  Actions: {
    uploadBlob: vi.fn(),
  },
}))

import { Actions } from 'blossom-client-sdk'
import { BlossomService } from '@/services/BlossomService'

const mockSigner = {
  signEvent: vi.fn(async (template: object) => ({ ...template, id: 'abc', sig: 'sig', pubkey: 'pk' })),
}

describe('BlossomService.upload', () => {
  let service: BlossomService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new BlossomService()
  })

  it('returns sha256 from BlobDescriptor on success', async () => {
    const mockFile = new File(['data'], 'page.jpg', { type: 'image/jpeg' })
    ;(Actions.uploadBlob as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      sha256: 'abc123',
      url: 'https://server/blob/abc123',
      size: 4,
      type: 'image/jpeg',
      created: 0,
    })

    const sha256 = await service.upload(mockFile, 'https://blossom.example.com', mockSigner as never)

    expect(sha256).toBe('abc123')
    expect(Actions.uploadBlob).toHaveBeenCalledWith(
      'https://blossom.example.com',
      mockFile,
      expect.objectContaining({ onAuth: expect.any(Function) }),
    )
  })

  it('calls onAuth to get a signed event when challenged', async () => {
    const mockFile = new File(['x'], 'p.jpg', { type: 'image/jpeg' })
    let capturedOnAuth: ((server: string, sha256: string, authType: string, blob: File) => Promise<object>) | undefined

    ;(Actions.uploadBlob as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async (_server: string, _blob: File, opts: { onAuth: typeof capturedOnAuth }) => {
        capturedOnAuth = opts.onAuth
        // simulate calling onAuth
        const authEvent = await opts.onAuth!('https://blossom.example.com', 'deadbeef', 'upload', mockFile)
        expect(authEvent).toHaveProperty('kind', 27235)
        return { sha256: 'deadbeef', url: '', size: 1, type: 'image/jpeg', created: 0 }
      },
    )

    await service.upload(mockFile, 'https://blossom.example.com', mockSigner as never)
    expect(mockSigner.signEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 27235 }),
    )
  })

  it('resolveUrl builds correct URL', () => {
    const service2 = new BlossomService()
    expect(service2.resolveUrl('abc123', 'https://blossom.example.com')).toBe(
      'https://blossom.example.com/blob/abc123',
    )
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
cd /home/mattthomson/workspace/Mangatsu && npm test -- src/test/upload/BlossomService.test.ts 2>&1 | tail -15
```

Expected: FAIL — `upload` throws "Not implemented".

- [ ] **Step 3: Implement upload in BlossomService**

Replace `src/services/BlossomService.ts` with:

```ts
import { Actions } from 'blossom-client-sdk'
import type { SignedEvent } from 'blossom-client-sdk'

export interface BlossomSigner {
  signEvent(template: object): Promise<SignedEvent>
}

export class BlossomService {
  resolveUrl(hash: string, serverUrl: string): string {
    return `${serverUrl.replace(/\/$/, '')}/blob/${hash}`
  }

  async upload(file: File, serverUrl: string, signer: BlossomSigner): Promise<string> {
    const descriptor = await Actions.uploadBlob(serverUrl, file, {
      onAuth: async (server, sha256, _authType, _blob) => {
        const uploadUrl = `${server.replace(/\/$/, '')}/upload`
        const template = {
          kind: 27235,
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            ['u', uploadUrl],
            ['method', 'PUT'],
            ['payload', sha256],
          ],
          content: '',
        }
        return signer.signEvent(template)
      },
    })
    return descriptor.sha256
  }
}

export const blossomService = new BlossomService()
```

- [ ] **Step 4: Run tests to verify pass**

```bash
cd /home/mattthomson/workspace/Mangatsu && npm test -- src/test/upload/BlossomService.test.ts 2>&1 | tail -10
```

Expected: all 3 tests PASS.

- [ ] **Step 5: Type-check**

```bash
cd /home/mattthomson/workspace/Mangatsu && npx tsc --noEmit 2>&1 | grep BlossomService
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/services/BlossomService.ts src/test/upload/BlossomService.test.ts
git commit -m "feat: implement BlossomService.upload via blossom-client-sdk"
```

---

## Task 4: Add `/comic/:dTag/upload` route

**Files:**
- Modify: `src/router.tsx`

- [ ] **Step 1: Add route**

In `src/router.tsx`, add the chapter-upload route directly after the existing `/upload` entry:

```ts
{ path: '/comic/:dTag/upload', element: <UploadScreen /> },
```

The full children array becomes:
```ts
children: [
  { path: '/', element: <LibraryScreen /> },
  { path: '/feed', element: <FeedScreen /> },
  { path: '/comic/:dTag', element: <ComicDetailScreen /> },
  { path: '/comic/:dTag/chapter/:chapterId', element: <ReaderScreen /> },
  { path: '/upload', element: <UploadScreen /> },
  { path: '/comic/:dTag/upload', element: <UploadScreen /> },
  { path: '/settings', element: <SettingsScreen /> },
],
```

- [ ] **Step 2: Type-check**

```bash
cd /home/mattthomson/workspace/Mangatsu && npx tsc --noEmit 2>&1 | head -10
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/router.tsx
git commit -m "feat: add /comic/:dTag/upload route"
```

---

## Task 5: AuthorPubkeyInput component

**Files:**
- Create: `src/screens/Upload/AuthorPubkeyInput.tsx`

Note: `nostr-tools/nip19` exports `decode(npub) → { type, data }`. For a valid npub, `data` is a hex pubkey string.

- [ ] **Step 1: Create the component**

Create `src/screens/Upload/AuthorPubkeyInput.tsx`:

```tsx
import { useState, useEffect, useRef } from 'react'
import { decode } from 'nostr-tools/nip19'
import { useNostr } from '@/context/NostrContext'

export interface AuthorPubkeyInputProps {
  value: string          // hex pubkey or ''
  onChange: (hex: string, displayName: string) => void
}

type Mode = 'paste' | 'search'

interface ProfileResult {
  pubkey: string
  displayName: string
  nip05?: string
}

function isHex(s: string): boolean {
  return /^[0-9a-f]{64}$/i.test(s)
}

function tryDecodeNpub(raw: string): string | null {
  try {
    const result = decode(raw)
    if (result.type === 'npub' && typeof result.data === 'string') {
      return result.data
    }
  } catch {
    /* invalid bech32 */
  }
  return null
}

function parseDisplayName(contentJson: string): string {
  try {
    const obj = JSON.parse(contentJson)
    return obj.display_name || obj.name || ''
  } catch {
    return ''
  }
}

export function AuthorPubkeyInput({ value, onChange }: AuthorPubkeyInputProps) {
  const [mode, setMode] = useState<Mode>('paste')
  const [pasteRaw, setPasteRaw] = useState(value)
  const [pasteError, setPasteError] = useState('')
  const [resolvedName, setResolvedName] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<ProfileResult[]>([])
  const [searching, setSearching] = useState(false)
  const { service } = useNostr()
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Resolve display name when hex value changes
  useEffect(() => {
    if (!value) {
      setResolvedName('')
      return
    }
    const sub = service.relayPool.subscription(
      service['getRelays']?.() ?? [],
      [{ kinds: [0], authors: [value], limit: 1 }],
      { eventStore: service.eventStore },
    )
    const s = sub.subscribe({
      next: (event) => {
        const name = parseDisplayName(event.content)
        if (name) setResolvedName(name)
        s.unsubscribe()
      },
    })
    return () => s.unsubscribe()
  }, [value, service])

  function handlePasteInput(raw: string) {
    setPasteRaw(raw)
    setPasteError('')
    const trimmed = raw.trim()
    if (!trimmed) {
      onChange('', '')
      return
    }
    if (isHex(trimmed)) {
      onChange(trimmed, '')
      return
    }
    const hex = tryDecodeNpub(trimmed)
    if (hex) {
      onChange(hex, '')
      return
    }
    setPasteError('Enter a valid npub1... or 64-char hex pubkey')
  }

  function handleSearchInput(q: string) {
    setSearchQuery(q)
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    if (!q.trim()) {
      setSearchResults([])
      return
    }
    searchTimerRef.current = setTimeout(async () => {
      setSearching(true)
      const results: ProfileResult[] = []
      const sub = service.relayPool.subscription(
        service['getRelays']?.() ?? [],
        [{ kinds: [0], limit: 20 }],
        { eventStore: service.eventStore },
      )
      const s = sub.subscribe({
        next: (event) => {
          try {
            const obj = JSON.parse(event.content)
            const displayName: string = obj.display_name || obj.name || ''
            const nip05: string = obj.nip05 || ''
            const queryLower = q.toLowerCase()
            if (
              displayName.toLowerCase().includes(queryLower) ||
              nip05.toLowerCase().includes(queryLower)
            ) {
              results.push({ pubkey: event.pubkey, displayName, nip05 })
            }
          } catch { /* skip */ }
        },
      })
      setTimeout(() => {
        s.unsubscribe()
        setSearchResults(results.slice(0, 10))
        setSearching(false)
      }, 2000)
    }, 400)
  }

  function selectResult(result: ProfileResult) {
    onChange(result.pubkey, result.displayName)
    setPasteRaw(result.pubkey)
    setMode('paste')
    setSearchResults([])
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <label className="text-sm text-zinc-400">Author Pubkey</label>
        <button
          type="button"
          onClick={() => setMode(mode === 'paste' ? 'search' : 'paste')}
          className="ml-auto rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-400 hover:text-zinc-200"
        >
          {mode === 'paste' ? 'Search by name' : 'Paste pubkey'}
        </button>
      </div>

      {mode === 'paste' ? (
        <div>
          <input
            type="text"
            placeholder="npub1... or hex pubkey"
            value={pasteRaw}
            onChange={(e) => handlePasteInput(e.target.value)}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-zinc-500 focus:outline-none"
          />
          {pasteError && <p className="mt-1 text-xs text-red-400">{pasteError}</p>}
          {resolvedName && !pasteError && (
            <p className="mt-1 text-xs text-zinc-400">Resolved: {resolvedName}</p>
          )}
        </div>
      ) : (
        <div>
          <input
            type="text"
            placeholder="Search by name or NIP-05..."
            value={searchQuery}
            onChange={(e) => handleSearchInput(e.target.value)}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-zinc-500 focus:outline-none"
          />
          {searching && <p className="mt-1 text-xs text-zinc-500">Searching relays...</p>}
          {searchResults.length > 0 && (
            <ul className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900">
              {searchResults.map((r) => (
                <li key={r.pubkey}>
                  <button
                    type="button"
                    onClick={() => selectResult(r)}
                    className="w-full px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-800"
                  >
                    <span className="font-medium">{r.displayName}</span>
                    {r.nip05 && (
                      <span className="ml-2 text-xs text-zinc-500">{r.nip05}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
cd /home/mattthomson/workspace/Mangatsu && npx tsc --noEmit 2>&1 | grep AuthorPubkey
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/screens/Upload/AuthorPubkeyInput.tsx
git commit -m "feat: add AuthorPubkeyInput component with paste and search modes"
```

---

## Task 6: MetadataStep component

**Files:**
- Create: `src/screens/Upload/MetadataStep.tsx`

- [ ] **Step 1: Create MetadataStep**

Create `src/screens/Upload/MetadataStep.tsx`:

```tsx
import { AuthorPubkeyInput } from './AuthorPubkeyInput'

export interface MetadataFormValues {
  title: string
  authorName: string
  authorPubkey: string
  authorDisplayName: string
  description: string
  tags: string          // comma-separated raw input
  language: string
  coverFile: File | null
  coverMode: 'file' | 'first-page'
}

interface MetadataStepProps {
  values: MetadataFormValues
  onChange: (values: MetadataFormValues) => void
  onNext: () => void
}

function inputClass(extra = '') {
  return `w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-zinc-500 focus:outline-none ${extra}`
}

export function MetadataStep({ values, onChange, onNext }: MetadataStepProps) {
  function set<K extends keyof MetadataFormValues>(key: K, val: MetadataFormValues[K]) {
    onChange({ ...values, [key]: val })
  }

  function handleCoverFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null
    onChange({ ...values, coverFile: file, coverMode: file ? 'file' : values.coverMode })
  }

  const canProceed = values.title.trim().length > 0

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-semibold text-zinc-100">Step 1 — Comic Details</h2>

      {/* Title */}
      <div className="space-y-1">
        <label className="text-sm text-zinc-400">
          Title <span className="text-red-400">*</span>
        </label>
        <input
          type="text"
          placeholder="My Amazing Manga"
          value={values.title}
          onChange={(e) => set('title', e.target.value)}
          className={inputClass()}
          required
        />
      </div>

      {/* Author name */}
      <div className="space-y-1">
        <label className="text-sm text-zinc-400">Author Name</label>
        <input
          type="text"
          placeholder="Author display name"
          value={values.authorName}
          onChange={(e) => set('authorName', e.target.value)}
          className={inputClass()}
        />
      </div>

      {/* Author pubkey */}
      <AuthorPubkeyInput
        value={values.authorPubkey}
        onChange={(hex, displayName) =>
          onChange({ ...values, authorPubkey: hex, authorDisplayName: displayName })
        }
      />

      {/* Description */}
      <div className="space-y-1">
        <label className="text-sm text-zinc-400">Description</label>
        <textarea
          placeholder="Brief description of the comic..."
          value={values.description}
          onChange={(e) => set('description', e.target.value)}
          rows={3}
          className={inputClass('resize-none')}
        />
      </div>

      {/* Tags */}
      <div className="space-y-1">
        <label className="text-sm text-zinc-400">Tags (comma-separated)</label>
        <input
          type="text"
          placeholder="action, adventure, fantasy"
          value={values.tags}
          onChange={(e) => set('tags', e.target.value)}
          className={inputClass()}
        />
      </div>

      {/* Language */}
      <div className="space-y-1">
        <label className="text-sm text-zinc-400">Language</label>
        <input
          type="text"
          placeholder="en"
          value={values.language}
          onChange={(e) => set('language', e.target.value)}
          className={inputClass('max-w-[8rem]')}
        />
      </div>

      {/* Cover image */}
      <div className="space-y-2">
        <label className="text-sm text-zinc-400">Cover Image</label>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="cursor-pointer rounded-lg border border-dashed border-zinc-700 px-4 py-3 text-sm text-zinc-400 hover:border-zinc-500 hover:text-zinc-200">
            {values.coverFile ? values.coverFile.name : 'Choose JPG/PNG/WebP...'}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={handleCoverFile}
            />
          </label>
          <span className="text-xs text-zinc-600">or</span>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-400">
            <input
              type="checkbox"
              checked={values.coverMode === 'first-page'}
              onChange={(e) =>
                set('coverMode', e.target.checked ? 'first-page' : 'file')
              }
              className="accent-zinc-400"
            />
            Use first page of CBZ
          </label>
        </div>
        {values.coverFile && values.coverMode === 'file' && (
          <img
            src={URL.createObjectURL(values.coverFile)}
            alt="Cover preview"
            className="h-24 w-auto rounded-lg object-cover"
          />
        )}
      </div>

      <button
        type="button"
        onClick={onNext}
        disabled={!canProceed}
        className="w-full rounded-full bg-white px-5 py-3 text-sm font-medium text-zinc-950 transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Next: Add Chapter
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
cd /home/mattthomson/workspace/Mangatsu && npx tsc --noEmit 2>&1 | grep MetadataStep
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/screens/Upload/MetadataStep.tsx
git commit -m "feat: add MetadataStep component for upload wizard"
```

---

## Task 7: ChapterStep component

**Files:**
- Create: `src/screens/Upload/ChapterStep.tsx`

JSZip API: `const zip = await JSZip.loadAsync(file)` → iterate `zip.files` (a `{ [name: string]: JSZip.JSZipObject }` map). Each entry has `.async('blob')` to extract content. `ComicInfo.xml` is a top-level or root-folder file with XML; parse with `DOMParser`.

- [ ] **Step 1: Create ChapterStep**

Create `src/screens/Upload/ChapterStep.tsx`:

```tsx
import { useState, useCallback } from 'react'
import JSZip from 'jszip'

export interface ChapterFormValues {
  chapterTitle: string
  chapterNumber: number
  pages: File[]
  firstPageObjectUrl: string | null  // for cover-from-first-page preview
}

interface ChapterStepProps {
  values: ChapterFormValues
  coverMode: 'file' | 'first-page'
  onChange: (values: ChapterFormValues) => void
  onNext: () => void
  onBack: () => void
}

const IMAGE_EXTENSIONS = /\.(jpg|jpeg|png|webp)$/i

function parseTitleFromFilename(filename: string): { number: number; title: string } {
  // e.g. "Chapter 03 - The Beginning.cbz" or "ch_003.cbz"
  const withoutExt = filename.replace(/\.cbz$/i, '')
  const numMatch = withoutExt.match(/\d+(?:\.\d+)?/)
  const number = numMatch ? parseFloat(numMatch[0]) : 1
  const title = withoutExt
    .replace(/^(chapter|ch\.?|vol\.?)\s*\d+(\.\d+)?\s*[-–—]?\s*/i, '')
    .trim() || withoutExt
  return { number, title }
}

async function parseComicInfoXml(
  xmlText: string,
): Promise<{ number: number | null; title: string | null }> {
  const parser = new DOMParser()
  const doc = parser.parseFromString(xmlText, 'application/xml')
  const numberEl = doc.querySelector('Number')
  const titleEl = doc.querySelector('Title')
  return {
    number: numberEl?.textContent ? parseFloat(numberEl.textContent) : null,
    title: titleEl?.textContent ?? null,
  }
}

export function ChapterStep({ values, coverMode, onChange, onNext, onBack }: ChapterStepProps) {
  const [dragging, setDragging] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState('')

  const handleCbz = useCallback(
    async (file: File) => {
      if (!file.name.toLowerCase().endsWith('.cbz')) {
        setParseError('Please select a .cbz file')
        return
      }
      setParseError('')
      setParsing(true)
      try {
        const zip = await JSZip.loadAsync(file)

        // Collect image entries sorted by path
        const imageEntries = Object.values(zip.files)
          .filter((entry) => !entry.dir && IMAGE_EXTENSIONS.test(entry.name))
          .sort((a, b) => a.name.localeCompare(b.name))

        if (imageEntries.length === 0) {
          setParseError('No images found in the CBZ file')
          setParsing(false)
          return
        }

        // Parse ComicInfo.xml if present
        let infoNumber: number | null = null
        let infoTitle: string | null = null
        const comicInfoEntry = Object.values(zip.files).find(
          (e) => e.name.toLowerCase() === 'comicinfo.xml' ||
                 e.name.toLowerCase().endsWith('/comicinfo.xml'),
        )
        if (comicInfoEntry) {
          const xmlText = await comicInfoEntry.async('text')
          const parsed = await parseComicInfoXml(xmlText)
          infoNumber = parsed.number
          infoTitle = parsed.title
        }

        // Fallback to filename
        const fallback = parseTitleFromFilename(file.name)
        const chapterNumber = infoNumber ?? fallback.number
        const chapterTitle = infoTitle ?? fallback.title

        // Convert image entries to File objects
        const pages: File[] = await Promise.all(
          imageEntries.map(async (entry) => {
            const blob = await entry.async('blob')
            const ext = entry.name.match(/\.\w+$/)?.[0] ?? '.jpg'
            const mimeMap: Record<string, string> = {
              '.jpg': 'image/jpeg',
              '.jpeg': 'image/jpeg',
              '.png': 'image/png',
              '.webp': 'image/webp',
            }
            return new File([blob], entry.name, { type: mimeMap[ext] ?? 'image/jpeg' })
          }),
        )

        // First page URL for cover preview
        const firstPageBlob = await imageEntries[0].async('blob')
        const firstPageObjectUrl = URL.createObjectURL(firstPageBlob)

        onChange({ chapterTitle, chapterNumber, pages, firstPageObjectUrl })
      } catch (err) {
        setParseError(`Failed to parse CBZ: ${err instanceof Error ? err.message : String(err)}`)
      } finally {
        setParsing(false)
      }
    },
    [onChange],
  )

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleCbz(file)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleCbz(file)
  }

  const canProceed = values.pages.length > 0

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-semibold text-zinc-100">Step 2 — Chapter</h2>

      {/* Drop zone */}
      <label
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={`flex min-h-[12rem] cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed transition ${
          dragging ? 'border-zinc-400 bg-zinc-800' : 'border-zinc-700 bg-zinc-900/50'
        }`}
      >
        <p className="text-sm text-zinc-400">
          {parsing ? 'Parsing CBZ...' : 'Drop a .cbz file here, or click to browse'}
        </p>
        <input type="file" accept=".cbz" className="hidden" onChange={handleFileInput} />
      </label>

      {parseError && <p className="text-sm text-red-400">{parseError}</p>}

      {values.pages.length > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 space-y-3">
          <p className="text-sm text-zinc-400">{values.pages.length} pages found</p>

          {/* First page preview */}
          {(coverMode === 'first-page' || true) && values.firstPageObjectUrl && (
            <img
              src={values.firstPageObjectUrl}
              alt="First page preview"
              className="h-24 w-auto rounded-lg object-cover"
            />
          )}

          {/* Chapter title & number (editable) */}
          <div className="space-y-1">
            <label className="text-xs text-zinc-500">Chapter Number</label>
            <input
              type="number"
              min={1}
              value={values.chapterNumber}
              onChange={(e) => onChange({ ...values, chapterNumber: parseFloat(e.target.value) || 1 })}
              className="w-24 rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-100 focus:border-zinc-500 focus:outline-none"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-zinc-500">Chapter Title</label>
            <input
              type="text"
              value={values.chapterTitle}
              onChange={(e) => onChange({ ...values, chapterTitle: e.target.value })}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 focus:border-zinc-500 focus:outline-none"
            />
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onBack}
          className="rounded-full border border-zinc-700 px-5 py-3 text-sm text-zinc-300 transition hover:border-zinc-500"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!canProceed}
          className="flex-1 rounded-full bg-white px-5 py-3 text-sm font-medium text-zinc-950 transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next: Upload
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
cd /home/mattthomson/workspace/Mangatsu && npx tsc --noEmit 2>&1 | grep ChapterStep
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/screens/Upload/ChapterStep.tsx
git commit -m "feat: add ChapterStep component with JSZip CBZ parsing"
```

---

## Task 8: UploadStep component

**Files:**
- Create: `src/screens/Upload/UploadStep.tsx`

- [ ] **Step 1: Create UploadStep**

Create `src/screens/Upload/UploadStep.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { blossomService } from '@/services/BlossomService'
import { useBlossomStore } from '@/stores/blossomStore'
import { useNostr } from '@/context/NostrContext'

export interface UploadResult {
  pageHashes: string[]
  coverHash: string | null
}

interface UploadStepProps {
  pages: File[]
  coverFile: File | null
  coverMode: 'file' | 'first-page'
  onDone: (result: UploadResult) => void
  onBack: () => void
}

export function UploadStep({ pages, coverFile, coverMode, onDone, onBack }: UploadStepProps) {
  const primaryServer = useBlossomStore((s) => s.primaryServer)
  const { service } = useNostr()
  const [uploaded, setUploaded] = useState(0)
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)
  const ranRef = useRef(false)

  const total = pages.length + (coverFile || coverMode === 'first-page' ? 1 : 0)

  useEffect(() => {
    if (ranRef.current) return
    ranRef.current = true
    run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function uploadWithRetry(file: File, serverUrl: string): Promise<string> {
    const account = service.accountManager.active
    if (!account) throw new Error('Not logged in')
    try {
      return await blossomService.upload(file, serverUrl, account.signer as never)
    } catch {
      // Retry once
      return await blossomService.upload(file, serverUrl, account.signer as never)
    }
  }

  async function run() {
    setRunning(true)
    setError('')
    const server = primaryServer()
    const pageHashes: string[] = []

    for (const page of pages) {
      try {
        const hash = await uploadWithRetry(page, server)
        pageHashes.push(hash)
        setUploaded((n) => n + 1)
      } catch (err) {
        setError(`Failed to upload page: ${err instanceof Error ? err.message : String(err)}`)
        setRunning(false)
        return
      }
    }

    let coverHash: string | null = null
    const coverSource = coverMode === 'first-page' ? pages[0] : coverFile
    if (coverSource) {
      try {
        coverHash = await uploadWithRetry(coverSource, server)
        setUploaded((n) => n + 1)
      } catch (err) {
        setError(`Failed to upload cover: ${err instanceof Error ? err.message : String(err)}`)
        setRunning(false)
        return
      }
    }

    setRunning(false)
    onDone({ pageHashes, coverHash })
  }

  const percent = total > 0 ? Math.round((uploaded / total) * 100) : 0

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-zinc-100">Step 3 — Uploading</h2>

      <div className="space-y-2">
        <div className="flex justify-between text-sm text-zinc-400">
          <span>
            {running
              ? `Uploading ${uploaded + 1} of ${total}...`
              : uploaded === total
              ? 'Upload complete'
              : 'Ready'}
          </span>
          <span>{percent}%</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full rounded-full bg-white transition-all duration-300"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>

      {error && (
        <div className="space-y-3">
          <p className="text-sm text-red-400">{error}</p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onBack}
              className="rounded-full border border-zinc-700 px-5 py-3 text-sm text-zinc-300 transition hover:border-zinc-500"
            >
              Back
            </button>
            <button
              type="button"
              onClick={() => { ranRef.current = false; run() }}
              className="flex-1 rounded-full bg-white px-5 py-3 text-sm font-medium text-zinc-950 hover:bg-zinc-200"
            >
              Retry
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
cd /home/mattthomson/workspace/Mangatsu && npx tsc --noEmit 2>&1 | grep UploadStep
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/screens/Upload/UploadStep.tsx
git commit -m "feat: add UploadStep component with sequential upload and retry"
```

---

## Task 9: PublishStep and DoneStep

**Files:**
- Create: `src/screens/Upload/PublishStep.tsx`
- Create: `src/screens/Upload/DoneStep.tsx`

`EventFactory` from `applesauce-factory` may not expose build methods for arbitrary kinds. We will build event templates manually and sign them with `account.signer.signEvent(template)`, then publish with `nostrService.publishEvent(signed)`.

- [ ] **Step 1: Create PublishStep**

Create `src/screens/Upload/PublishStep.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { nostrService } from '@/services/NostrService'
import type { MetadataFormValues } from './MetadataStep'
import type { ChapterFormValues } from './ChapterStep'
import { slugify } from './slugify'

interface PublishStepProps {
  isNewComic: boolean
  existingDTag?: string
  metadata: MetadataFormValues
  chapter: ChapterFormValues
  pageHashes: string[]
  coverHash: string | null
  onDone: (comicDTag: string) => void
}

export function PublishStep({
  isNewComic,
  existingDTag,
  metadata,
  chapter,
  pageHashes,
  coverHash,
  onDone,
}: PublishStepProps) {
  const [status, setStatus] = useState<'publishing' | 'done' | 'error'>('publishing')
  const [errorMsg, setErrorMsg] = useState('')
  const ranRef = useRef(false)

  useEffect(() => {
    if (ranRef.current) return
    ranRef.current = true
    publish()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function publish() {
    const account = nostrService.accountManager.active
    if (!account) {
      setErrorMsg('Not logged in')
      setStatus('error')
      return
    }
    const now = Math.floor(Date.now() / 1000)
    const comicDTag = existingDTag ?? slugify(metadata.title)

    try {
      if (isNewComic) {
        const comicTags: string[][] = [
          ['d', comicDTag],
          ['title', metadata.title],
        ]
        if (metadata.authorName) comicTags.push(['author', metadata.authorName])
        if (metadata.authorPubkey) comicTags.push(['author_pubkey', metadata.authorPubkey])
        if (metadata.description) comicTags.push(['description', metadata.description])
        if (coverHash) comicTags.push(['cover', coverHash])
        for (const t of metadata.tags.split(',').map((s) => s.trim()).filter(Boolean)) {
          comicTags.push(['t', t])
        }
        if (metadata.language) comicTags.push(['language', metadata.language])

        const comicTemplate = {
          kind: 30402,
          created_at: now,
          tags: comicTags,
          content: metadata.description,
        }
        const signedComic = await account.signer.signEvent(comicTemplate)
        await nostrService.publishEvent(signedComic)
      }

      const chapterDTag = `${comicDTag}/chapter-${chapter.chapterNumber}`
      const chapterTags: string[][] = [
        ['d', chapterDTag],
        ['title', chapter.chapterTitle],
        ...pageHashes.map((h) => ['page', `blossom://${h}`]),
      ]
      const chapterTemplate = {
        kind: 30403,
        created_at: now,
        tags: chapterTags,
        content: '',
      }
      const signedChapter = await account.signer.signEvent(chapterTemplate)
      await nostrService.publishEvent(signedChapter)

      setStatus('done')
      onDone(comicDTag)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err))
      setStatus('error')
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-zinc-100">Step 4 — Publishing</h2>
      {status === 'publishing' && (
        <p className="text-sm text-zinc-400">Signing and publishing events to relays...</p>
      )}
      {status === 'error' && (
        <p className="text-sm text-red-400">Error: {errorMsg}</p>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Create DoneStep**

Create `src/screens/Upload/DoneStep.tsx`:

```tsx
import { Link } from 'react-router-dom'

interface DoneStepProps {
  comicDTag: string
  onUploadAnother: () => void
}

export function DoneStep({ comicDTag, onUploadAnother }: DoneStepProps) {
  return (
    <div className="space-y-6 text-center">
      <h2 className="text-2xl font-semibold text-zinc-100">Published!</h2>
      <p className="text-sm text-zinc-400">Your comic has been published to the Nostr network.</p>
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
        <Link
          to={`/comic/${comicDTag}`}
          className="rounded-full bg-white px-6 py-3 text-sm font-medium text-zinc-950 transition hover:bg-zinc-200"
        >
          View Comic
        </Link>
        <button
          type="button"
          onClick={onUploadAnother}
          className="rounded-full border border-zinc-700 px-6 py-3 text-sm text-zinc-300 transition hover:border-zinc-500"
        >
          Upload Another
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Type-check**

```bash
cd /home/mattthomson/workspace/Mangatsu && npx tsc --noEmit 2>&1 | grep -E 'PublishStep|DoneStep'
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/screens/Upload/PublishStep.tsx src/screens/Upload/DoneStep.tsx
git commit -m "feat: add PublishStep and DoneStep components"
```

---

## Task 10: Upload wizard orchestrator

**Files:**
- Modify: `src/screens/Upload/index.tsx`

This replaces the stub. It reads `dTag` from URL params (present on `/comic/:dTag/upload`, absent on `/upload`) and drives the 5-step flow.

- [ ] **Step 1: Replace the stub**

Replace `src/screens/Upload/index.tsx` with:

```tsx
import { useState, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { MetadataStep, type MetadataFormValues } from './MetadataStep'
import { ChapterStep, type ChapterFormValues } from './ChapterStep'
import { UploadStep, type UploadResult } from './UploadStep'
import { PublishStep } from './PublishStep'
import { DoneStep } from './DoneStep'

type Step = 'metadata' | 'chapter' | 'upload' | 'publish' | 'done'

const STEP_LABELS: Record<Step, string> = {
  metadata: 'Details',
  chapter: 'Chapter',
  upload: 'Upload',
  publish: 'Publish',
  done: 'Done',
}

const STEP_ORDER: Step[] = ['metadata', 'chapter', 'upload', 'publish', 'done']

function defaultMetadata(): MetadataFormValues {
  return {
    title: '',
    authorName: '',
    authorPubkey: '',
    authorDisplayName: '',
    description: '',
    tags: '',
    language: '',
    coverFile: null,
    coverMode: 'file',
  }
}

function defaultChapter(): ChapterFormValues {
  return {
    chapterTitle: '',
    chapterNumber: 1,
    pages: [],
    firstPageObjectUrl: null,
  }
}

export function UploadScreen() {
  const { dTag: existingDTag } = useParams<{ dTag?: string }>()
  const isNewComic = !existingDTag

  const [step, setStep] = useState<Step>(isNewComic ? 'metadata' : 'chapter')
  const [metadata, setMetadata] = useState<MetadataFormValues>(defaultMetadata)
  const [chapter, setChapter] = useState<ChapterFormValues>(defaultChapter)
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null)
  const [publishedDTag, setPublishedDTag] = useState('')

  const stepIndex = STEP_ORDER.indexOf(step)

  function reset() {
    setStep(isNewComic ? 'metadata' : 'chapter')
    setMetadata(defaultMetadata())
    setChapter(defaultChapter())
    setUploadResult(null)
    setPublishedDTag('')
  }

  const handleUploadDone = useCallback((result: UploadResult) => {
    setUploadResult(result)
    setStep('publish')
  }, [])

  const handlePublishDone = useCallback((comicDTag: string) => {
    setPublishedDTag(comicDTag)
    setStep('done')
  }, [])

  // Determine which steps to show in the stepper (skip metadata for chapter-only)
  const visibleSteps = isNewComic ? STEP_ORDER : STEP_ORDER.filter((s) => s !== 'metadata')
  const visibleIndex = visibleSteps.indexOf(step)

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,rgba(9,9,11,1),rgba(15,15,18,1)_50%,rgba(9,9,11,1))] px-4 py-6 text-zinc-100">
      <div className="mx-auto w-full max-w-lg">
        <div className="mb-8">
          <p className="text-[0.65rem] uppercase tracking-[0.45em] text-zinc-500">Mangatsu</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
            {isNewComic ? 'Upload Comic' : 'Add Chapter'}
          </h1>
        </div>

        {/* Step indicator */}
        {step !== 'done' && (
          <div className="mb-8 flex gap-2">
            {visibleSteps.filter((s) => s !== 'done').map((s, i) => (
              <div
                key={s}
                className={`flex-1 rounded-full py-1 text-center text-xs font-medium transition ${
                  i <= visibleIndex
                    ? 'bg-zinc-700 text-zinc-100'
                    : 'bg-zinc-900 text-zinc-600'
                }`}
              >
                {STEP_LABELS[s]}
              </div>
            ))}
          </div>
        )}

        {/* Step content */}
        {step === 'metadata' && (
          <MetadataStep
            values={metadata}
            onChange={setMetadata}
            onNext={() => setStep('chapter')}
          />
        )}
        {step === 'chapter' && (
          <ChapterStep
            values={chapter}
            coverMode={metadata.coverMode}
            onChange={setChapter}
            onNext={() => setStep('upload')}
            onBack={() => setStep(isNewComic ? 'metadata' : 'chapter')}
          />
        )}
        {step === 'upload' && (
          <UploadStep
            pages={chapter.pages}
            coverFile={metadata.coverFile}
            coverMode={metadata.coverMode}
            onDone={handleUploadDone}
            onBack={() => setStep('chapter')}
          />
        )}
        {step === 'publish' && uploadResult && (
          <PublishStep
            isNewComic={isNewComic}
            existingDTag={existingDTag}
            metadata={metadata}
            chapter={chapter}
            pageHashes={uploadResult.pageHashes}
            coverHash={uploadResult.coverHash}
            onDone={handlePublishDone}
          />
        )}
        {step === 'done' && (
          <DoneStep
            comicDTag={publishedDTag}
            onUploadAnother={reset}
          />
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
cd /home/mattthomson/workspace/Mangatsu && npx tsc --noEmit 2>&1
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/screens/Upload/index.tsx
git commit -m "feat: implement Upload wizard orchestrator (5-step flow)"
```

---

## Task 11: Integration tests

**Files:**
- Create: `src/test/upload/UploadScreen.test.tsx`

- [ ] **Step 1: Write tests**

Create `src/test/upload/UploadScreen.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { UploadScreen } from '@/screens/Upload'

// Mock contexts and services
vi.mock('@/context/NostrContext', () => ({
  useNostr: () => ({
    service: {
      accountManager: {
        active: {
          signer: {
            signEvent: vi.fn(async (t: object) => ({ ...t, id: 'id1', sig: 'sig', pubkey: 'pk' })),
          },
        },
      },
      relayPool: {
        subscription: vi.fn(() => ({ subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })) })),
      },
      eventStore: {},
    },
  }),
}))

vi.mock('@/stores/blossomStore', () => ({
  useBlossomStore: (sel: (s: { primaryServer: () => string }) => unknown) =>
    sel({ primaryServer: () => 'https://blossom.test' }),
}))

vi.mock('@/services/BlossomService', () => ({
  blossomService: {
    upload: vi.fn(async () => 'fakehash'),
    resolveUrl: vi.fn((h: string, s: string) => `${s}/blob/${h}`),
  },
}))

vi.mock('@/services/NostrService', () => ({
  nostrService: {
    accountManager: {
      active: {
        signer: {
          signEvent: vi.fn(async (t: object) => ({ ...t, id: 'id1', sig: 'sig', pubkey: 'pk' })),
        },
      },
    },
    publishEvent: vi.fn(async () => {}),
  },
}))

vi.mock('@/stores/authStore', () => ({
  useAuthStore: (sel: (s: { pubkey: string }) => unknown) => sel({ pubkey: 'pk' }),
}))

function renderUpload(path = '/upload') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/upload" element={<UploadScreen />} />
        <Route path="/comic/:dTag/upload" element={<UploadScreen />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('UploadScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders step 1 (Metadata) for /upload', () => {
    renderUpload('/upload')
    expect(screen.getByText(/Comic Details/i)).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/My Amazing Manga/i)).toBeInTheDocument()
  })

  it('renders step 2 (Chapter) directly for /comic/:dTag/upload', () => {
    renderUpload('/comic/my-comic/upload')
    expect(screen.getByText(/Chapter/i)).toBeInTheDocument()
    expect(screen.getByText(/Drop a .cbz/i)).toBeInTheDocument()
  })

  it('disables Next button when title is empty', () => {
    renderUpload('/upload')
    const nextBtn = screen.getByRole('button', { name: /next/i })
    expect(nextBtn).toBeDisabled()
  })

  it('enables Next button when title is filled', () => {
    renderUpload('/upload')
    const titleInput = screen.getByPlaceholderText(/My Amazing Manga/i)
    fireEvent.change(titleInput, { target: { value: 'My Comic' } })
    const nextBtn = screen.getByRole('button', { name: /next/i })
    expect(nextBtn).not.toBeDisabled()
  })

  it('advances to Chapter step after filling title and clicking Next', async () => {
    renderUpload('/upload')
    fireEvent.change(screen.getByPlaceholderText(/My Amazing Manga/i), {
      target: { value: 'Test Comic' },
    })
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    await waitFor(() => {
      expect(screen.getByText(/Step 2/i)).toBeInTheDocument()
    })
  })
})
```

- [ ] **Step 2: Run tests**

```bash
cd /home/mattthomson/workspace/Mangatsu && npm test -- src/test/upload/UploadScreen.test.tsx 2>&1 | tail -20
```

Expected: all 5 tests PASS. If DOM-related matchers fail, check that `@testing-library/jest-dom` is set up in the Vitest config — if not, adjust assertions to use `.toBeTruthy()` / `.toBe(true)`.

- [ ] **Step 3: Run full test suite**

```bash
cd /home/mattthomson/workspace/Mangatsu && npm test 2>&1 | tail -15
```

Expected: all tests pass.

- [ ] **Step 4: Final type-check**

```bash
cd /home/mattthomson/workspace/Mangatsu && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/test/upload/UploadScreen.test.tsx
git commit -m "test: add Upload wizard integration tests"
```

---

## Self-Review Checklist

Spec coverage verified:

- `/upload` new comic entry point — Task 10 (UploadScreen reads `dTag` param; absent = new comic)
- `/comic/:dTag/upload` chapter-only entry point — Task 4 (router) + Task 10 (wizard skips metadata step)
- Step 1 Metadata — Task 6 (MetadataStep)
- Step 2 Chapter / JSZip CBZ parse — Task 7 (ChapterStep)
- Step 3 Upload with progress + retry — Task 8 (UploadStep)
- Step 4 Publish kind 30402 + 30403 — Task 9 (PublishStep)
- Step 5 Done + navigate — Task 9 (DoneStep)
- Author pubkey paste + search — Task 5 (AuthorPubkeyInput)
- BlossomService.upload implemented — Task 3
- slugify utility — Task 2
- jszip install — Task 1
- nostr-tools install — Task 1
- Router updated — Task 4
- Tests — Tasks 2, 3, 11

No placeholders found. Types are consistent across all tasks (`MetadataFormValues`, `ChapterFormValues`, `UploadResult` defined in tasks 6, 7, 8 and imported in tasks 9, 10).
