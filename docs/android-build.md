# Android build (Tauri)

Mangatsu ships as an Android app by wrapping the existing web frontend with
[Tauri v2](https://v2.tauri.app/). There's no local Android SDK/NDK in this
project's dev environment, so all Android scaffolding and packaging happens
in CI (`.github/workflows/android.yml`). Locally, only the desktop-level
Tauri scaffold (`src-tauri/`) is used, e.g. to run `cargo check` or generate
icons — never `tauri android build`.

The generated Gradle/Android Studio project (`src-tauri/gen/android`) is
**not committed**. CI runs `tauri android init` fresh on every run; any
Android customization (permissions, SDK versions, app icon) should go
through `src-tauri/tauri.conf.json`, not hand-edited generated files.

## Triggering a build

- **Debug APK**: automatic on every push to `master`, or manually via
  Actions → "Android build" → "Run workflow" (leave `release` unchecked).
- **Signed release (APK + AAB)**: Actions → "Android build" → "Run workflow"
  with `release` checked, or push a `v*` tag (e.g. `v0.2.0`), which also
  attaches the build to a GitHub Release.

Download artifacts from the workflow run's "Artifacts" section (or from the
Release page for tagged builds).

## Signing secrets

The release job needs these repo secrets:

- `ANDROID_KEYSTORE_BASE64` — the release keystore, base64-encoded
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

Mangatsu reuses the same signing key already used for
[imattau/scrollstr](https://github.com/imattau/scrollstr) — copy those
secret values into this repo rather than generating a new keystore:

```bash
gh secret set ANDROID_KEYSTORE_BASE64 --repo <owner>/Mangatsu < keystore.b64
gh secret set ANDROID_KEYSTORE_PASSWORD --repo <owner>/Mangatsu
gh secret set ANDROID_KEY_ALIAS --repo <owner>/Mangatsu
gh secret set ANDROID_KEY_PASSWORD --repo <owner>/Mangatsu
```

GitHub secrets can't be read back once set (by anyone, including tooling),
so the actual keystore/passwords need to come from wherever they were
originally saved (password manager, the `.keystore`/`.jks` file itself),
not from `gh secret list`, which only shows secret *names*.

To generate a brand new keystore instead (only if the scrollstr key
shouldn't be reused after all):

```bash
keytool -genkeypair -v -keystore release.keystore -alias mangatsu \
  -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 release.keystore > keystore.b64
```

## Zapstore release

Tag pushes (`v*`) also broadcast the release to [Zapstore](https://zapstore.dev/)
(a Nostr-based app store) using [`zsp`](https://github.com/zapstore/zsp),
configured via [`zapstore.yaml`](../zapstore.yaml) at the repo root. This
mirrors the [imattau/scrollstr](https://github.com/imattau/scrollstr) setup
and reuses its `ZAPSTORE_NSEC` — the same publisher identity is used across
both apps, so followers of one on Zapstore can discover the other.

Required secret: `ZAPSTORE_NSEC` (the publisher's Nostr private key, used to
sign the release announcement event).

- Automatic: any `v*` tag push builds the signed release, attaches it to a
  GitHub Release, and immediately broadcasts it to Zapstore relays.
- Manual re-broadcast without a new tag: `workflow_dispatch` with `release:
  true` and `publish_to_zapstore: true`.
- The `Validate Zapstore config` step (`zsp publish --check zapstore.yaml`)
  runs on every release build regardless of trigger, so config mistakes
  surface even on ad-hoc runs that don't actually publish.

## Known smoke-test checklist (first real device install)

These aren't blockers for the CI/build setup, but should be verified on an
actual Android device/emulator before relying on the app day-to-day:

- **Login persistence**: the nsec session key lives in `sessionStorage`
  ([src/context/NostrContext.tsx](../src/context/NostrContext.tsx)); Android
  may kill a backgrounded app's WebView process more eagerly than a desktop
  browser tab keeps a tab alive, which would log the user out more often.
- **Offline chapter caching**: the service worker
  ([public/sw.js](../public/sw.js)) and Cache API-based offline flow.
- **WebTorrent/WebRTC**: seeding and downloading via
  [src/services/WebTorrentService.ts](../src/services/WebTorrentService.ts).
- **Saving images from the reader**: blob-URL-based downloads
  (`URL.createObjectURL`) may need different handling in Tauri's Android
  WebView than in a normal mobile browser.
- **Signer App login (Amber/NIP-55)**: the "Signer App" button on the Login
  screen ([src/screens/Login/index.tsx](../src/screens/Login/index.tsx)) uses
  applesauce-signers' `AmberClipboardSigner`, which launches the signer app
  via `window.open('intent://...#Intent;scheme=nostrsigner;...;end')` and
  reads the result back from the clipboard once the WebView regains focus.
  This is the standard integration for browsers/webviews per
  [Amber's web-apps docs](https://github.com/greenart7c3/Amber/blob/master/docs/web-apps.md),
  but it's unverified inside Tauri's Android WebView specifically — confirm
  the `intent://` URL actually launches Amber (rather than silently
  no-op'ing) and that `document.visibilitychange` fires correctly when
  switching back from Amber. If it doesn't work, the fallback is a small
  native Kotlin Tauri plugin that calls `Intent.parseUri` + `startActivity`
  directly instead of relying on WebView URL-scheme resolution.
