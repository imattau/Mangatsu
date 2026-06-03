# Mangatsu
Comic/Manga Reader for the Nostr Network

## Development

```bash
npm install
npm run dev
```

## Production Build

```bash
npm run build
```

The static output is written to `dist/`.

## Remote Deploy

Use the helper script to build locally, sync the repo, and install a simple remote service that serves `dist/`:

```bash
scripts/deploy-remote.sh --host user@server --domain manga.example
```

Common flags:

- `--port 3000` to change the local service port
- `--install-dir /var/www/mangatsu` to change the remote path
- `--proxy none` to skip reverse-proxy config
- `--dry-run` to print actions without executing them

Environment overrides are also supported via `MANGATSU_*` variables.
