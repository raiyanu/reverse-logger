# Project Memory: reverse-logger

## Overview
`reverse-logger` is a production-ready npm package providing a local reverse logger server that receives browser console logs and displays/stores them via a live Ink TUI and SQLite storage.

## Tech Stack
- **TypeScript**: Target ES2022 / ESNext with React JSX and bundler resolution.
- **Node.js**: Target Node 20+ runtime.
- **Ink**: React-based Terminal UI (`App.tsx` with colored log table, stats header, log inspector, filter levels 1-5, arrow key navigation, `q` to quit).
- **Fastify**: High-performance HTTP server & API (`@fastify/cors` enabled).
- **better-sqlite3**: Local SQLite database storage at `~/.reverse-logger/logs.db` with `--max-logs` auto-truncation and indexed time/search queries.
- **tsup**: Bundler creating Node CLI (`dist/cli.mjs`), dual CJS/ESM library (`dist/index.cjs`, `dist/index.js`), and standalone browser client (`dist/client.js`).
- **Changesets**: Versioning & changelog setup (`.changeset/config.json`).

## Key CLI Commands
```bash
npx reverse-logger serve
reverse-logger serve --max-logs 10000 --port 5050
npm run build
npm run lint
```

## API Endpoints
- `GET /script/client.js`: Standalone browser console wrapper
- `GET /api/logs`: Returns logs (supports `search`/`q`, `limit`, `since`, `until`, `level` filters)
- `POST /api/logs`: Accepts JSON log entries from browser client
