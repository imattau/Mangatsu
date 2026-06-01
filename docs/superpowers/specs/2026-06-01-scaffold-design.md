# Mangatsu – Project Scaffold Design

**Date:** 2026-06-01  
**Status:** Approved

## Stack

| Concern | Choice |
|---|---|
| Build | Vite + React + TypeScript |
| Styling | Tailwind CSS v3 + shadcn/ui |
| Routing | React Router v6 (`createBrowserRouter`) |
| State | Zustand with `persist` middleware → `localStorage` |
| Testing | Vitest + React Testing Library |
| Nostr | `@applesauce/core`, `relay`, `accounts`, `signers`, `factory`, `loaders` |
| Blossom | `blossom-client-sdk` |

## Folder Structure

```
src/
  components/       # shared/reusable UI components
  screens/          # route-level components
    Library/
    ComicDetail/
    Reader/
    Upload/
    Settings/
  services/
    NostrService.ts
    BlossomService.ts
  stores/           # Zustand stores: auth, comic, read, blossom
  hooks/            # custom React hooks
  types/            # shared TypeScript types
  lib/              # small utilities
  router.tsx        # all route definitions
  main.tsx
```

## What the Scaffold Includes

- Vite config with path aliases (`@/` → `src/`)
- Tailwind CSS configured with `darkMode: 'class'`
- shadcn/ui initialized
- React Router v6 with all 5 screen stubs wired
- Zustand store shells with correct TypeScript interfaces
- `NostrService` and `BlossomService` class stubs with method signatures
- Vitest + React Testing Library config
- `.gitignore` updated for `.superpowers/`

## What Is Deferred

- Actual Nostr relay connections and event subscriptions
- Blossom upload/download implementation
- Comic reader component integration
- Auth flow (NIP-07, nsec, bunker)
- Offline/service worker setup
