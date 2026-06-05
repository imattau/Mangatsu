# NSFW Flag — Design Spec

**Date:** 2026-06-05

## Overview

Allow uploaders to mark a comic as NSFW. The Feed blurs NSFW covers by default; a Settings toggle lets users opt in to see them unblurred.

---

## 1. Data Model

### Nostr event (kind 30040)

When a comic is NSFW, add the NIP-36 tag to the event:

```
["content-warning", "NSFW"]
```

### `Comic` type (`src/types/index.ts`)

Add field:

```ts
nsfw: boolean
```

### `parseComicEvent` (`src/lib/comic.ts`)

Set `nsfw: true` when the event contains a `content-warning` tag.

```ts
nsfw: event.tags.some((tag) => tag[0] === 'content-warning'),
```

---

## 2. Upload UI

### `MetadataFormValues` (`src/screens/Upload/MetadataStep.tsx`)

Add field:

```ts
nsfw: boolean
```

### `MetadataStep` component

Add a checkbox below the Tags field:

```
☐  Mark as NSFW (adds a content warning)
```

Uses the same `set('nsfw', e.target.checked)` pattern as the existing cover mode checkbox.

### `buildPublishDraft` (`src/screens/Upload/publishDraft.ts`)

When `input.metadata.nsfw` is true, push the tag into `comicTags`:

```ts
if (input.metadata.nsfw) comicTags.push(['content-warning', 'NSFW'])
```

---

## 3. Settings Store

Add `showNsfw: boolean` (default `false`) to the settings store, persisted to `localStorage`. Expose a `setShowNsfw` setter.

Settings store location: `src/stores/settingsStore.ts` (create if it doesn't exist, or add to an existing store).

---

## 4. Feed Behaviour

### `ComicCover` (`src/screens/Feed/index.tsx`)

The component receives a `blurred` prop. When `comic.nsfw && !showNsfw`:

- Render the same `aspect-[2/3]` card
- Apply `blur-sm brightness-50` Tailwind classes to the image (or a grey placeholder if no cover)
- Overlay a small centred label: `NSFW`

The comic card remains clickable and the title is still shown — only the cover image is blurred.

### Settings screen

Add a toggle row: **"Show NSFW content"** — controls `showNsfw` in the settings store.

---

## 5. Out of Scope

- Library screen: no NSFW blurring (user has explicitly saved these comics)
- ComicDetail screen: no changes (cover not prominently shown)
- Filtering NSFW comics out entirely (blur is the chosen behaviour)
