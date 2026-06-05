# Mangatsu

![Mangatsu logo](public/favicon.webp)

Mangatsu is a comic and manga reader/publisher for the Nostr network.

It is designed around a few core ideas:

- comics and chapters are published as Nostr events
- image assets are stored on Blossom servers
- your saved library and Blossom server list are synced across devices
- reading works well on desktop and mobile
- uploads stay browser-side, including PDF to WebP conversion

## What it does

- Read comics in a fast library/feed/reader flow
- Browse a global feed, a follows feed, and an author feed
- Filter the feed by tags or authors, with author avatars and names from Nostr profiles
- Publish new comics and chapters
- Edit comic metadata and cover art after publishing
- Add chapters to an existing comic without changing its metadata
- Edit or delete individual chapters after publication
- Save comics to a synced, encrypted library list
- Mark comics for offline reading
- Sync Blossom servers to your Nostr profile
- Upload CBZ or PDF chapters
- Convert uploaded images to WebP in-browser before upload
- Support NIP-07, pasted `nsec`, bunker URIs, and QR/NIP-46 sign-in
- Zap comics through a connected wallet

## Tech Stack

- React 19
- TypeScript
- Vite
- Tailwind CSS
- Zustand
- Applesauce Nostr libraries
- Blossom client SDK
- pdf.js for PDF rasterisation

## Getting Started

### Install

```bash
npm install
```

### Run locally

```bash
npm run dev
```

Then open the Vite dev server URL shown in the terminal.

### Production build

```bash
npm run build
```

The static build is written to `dist/`.

### Preview the production build

```bash
npm run preview
```

### Tests

```bash
npm test
```

### Lint

```bash
npm run lint
```

## Sign-in Options

Mangatsu supports several Nostr account flows:

- NIP-07 browser extension login
- pasted `nsec`
- bunker URI / NIP-46
- QR / NIP-46 connection flow

The app restores the active session on refresh when possible.

## Main Screens

### Library

The library shows:

- your own published comics
- saved comics from your synced encrypted library list
- queued drafts waiting to be published
- a continue-reading card when progress exists

Saved comics can hydrate their metadata even on a fresh device or browser session.

### Feed

The feed shows discovered comics and supports filtering by tag or author.

It includes:

- a global feed
- a follows feed
- an author feed
- author avatars and display names when Nostr profile data is available

Clicking a tag or author filters the current feed view.

### Comic Detail

The comic detail page shows:

- cover image
- title and metadata
- tags
- chapters
- Blossom availability for declared assets
- offline availability and caching controls
- owner actions such as:
  - add chapter
  - edit details
  - edit chapter metadata
  - delete chapter
  - delete comic
  - save / unsave
  - add to library

### Reader

The reader supports:

- chapter navigation
- page progress persistence
- mobile-friendly scroll snapping and touch-friendly paging
- image fallback across multiple Blossom servers

### Settings

Settings lets you manage:

- Blossom servers
- relay list
- Nostr Wallet Connect connection string
- sign-out

## Publishing Flow

### New comic

The default upload flow is:

1. enter comic metadata
2. add a chapter
3. upload files to Blossom
4. publish the Nostr events

### Add a chapter

From comic detail, owners can add a new chapter to an existing comic without changing the comic metadata.

### Edit details

Owners can also edit comic metadata separately from chapter uploads. This is for fixing:

- title mistakes
- description mistakes
- tag mistakes
- cover image mistakes

Editing metadata does not require a new chapter.

### Edit a chapter

From comic detail, owners can edit an existing chapter’s metadata and republish the chapter event without creating a new chapter.

### Delete a chapter

From comic detail, owners can delete individual chapters. The chapter is removed locally and the delete is republished so other devices can converge on the same state.

## Upload Formats

Mangatsu accepts:

- `CBZ`
- `PDF`

### CBZ

CBZ archives are unpacked in the browser and each page is uploaded as a WebP file.

### PDF

PDFs are rendered in the browser with `pdf.js`, then converted page-by-page into WebP before upload.

## Upload Limits

The app enforces upload limits to avoid mobile memory blow-ups and oversized uploads:

- maximum source file size: `100 MB`
- maximum chapter pages: `120`
- image conversion cap: `2000px` on the long edge
- PDF page rendering cap: `2000px` on the long edge

Images smaller than the cap keep their native size. Larger images are downscaled before WebP conversion.

## Nostr Data Model

Mangatsu uses Nostr events and a few app conventions:

- comic metadata: `kind 30040`
- chapter metadata: `kind 30041`
- encrypted saved library list: `kind 30003` with `d=mangatsu-library`
- Blossom server list: `kind 10063`
- relay list: `kind 10002`

Comics and chapters are also linked to Blossom asset hashes so images can be resolved later.

### Library sync

The encrypted library list is the source of truth for saved comics across devices.

That means:

- saving a comic locally also updates the synced library list
- deleting a comic removes it from the local library and republishes the updated list
- a fresh browser or device can still show saved entries once the library event is synced

## Blossom Behavior

Mangatsu uploads comic images to one or more Blossom servers.

Highlights:

- uploads fan out to configured Blossom servers and default fallbacks
- images are converted to WebP before upload
- image resolution is normalized before upload
- the reader and comic detail page try multiple candidate servers
- image resolution can fall back when a server is missing an asset
- uploads record which Blossom servers successfully stored each asset
- partial coverage is allowed as long as each asset has at least one reachable copy

## Offline Reading

The comic detail page can cache a comic for offline reading.

When you mark a comic offline:

- the cover and chapter pages are cached locally through the service worker
- only one successful Blossom URL per asset is cached
- the cached asset can then be opened later without a network connection

The comic detail page also shows a Blossom availability panel that checks whether the declared comic assets are actually reachable.

## Project Structure

The main code is organized like this:

- `src/screens/Upload` - upload, convert, and publish workflows
- `src/screens/ComicDetail` - comic details, owner actions, asset availability
- `src/screens/Reader` - chapter reading experience
- `src/screens/Library` - library, saved comics, queued uploads
- `src/screens/Feed` - feed browsing and tag filtering
- `src/screens/Settings` - relay, Blossom, and wallet settings
- `src/context/NostrContext.tsx` - account restoration, relay connection, sync orchestration
- `src/services/NostrService.ts` - relay/event-store publishing and subscriptions
- `src/lib/blossom.ts` - Blossom asset helpers and availability checks
- `src/lib/nip51.ts` - encrypted library list encoding/decoding

## Remote Deployment

There is a helper script for building locally and deploying to a remote host:

```bash
scripts/deploy-remote.sh --host user@server --domain manga.example
```

Common options:

- `--port 3000` to change the app port
- `--install-dir /var/www/mangatsu` to change the remote install path
- `--proxy auto|caddy|nginx|none` to control reverse-proxy setup
- `--skip-build` to reuse an existing local build
- `--dry-run` to print the actions without executing them

Environment overrides are also supported via `MANGATSU_*` variables.

## Development Notes

- The app uses browser-side persistence for auth, saved library state, Blossom settings, relay settings, and progress.
- The reader and image components try to be resilient to stale or missing Blossom URLs.
- Uploads are intentionally browser-side so the user keeps control of their files and relay sign-in method.

## Contributing

If you make changes, the basic verification set is:

```bash
npm test
npm run build
```

For UI or flow changes, it is worth checking the affected screen in the browser as well.
