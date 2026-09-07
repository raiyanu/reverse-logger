# Project Memory: reverse-logger

## Overview
`reverse-logger` is a production-ready npm package providing a local reverse logger server that receives browser console logs and displays/stores them via a live Ink TUI and SQLite storage.

## Tech Stack
- **TypeScript**: Target ES2022 / ESNext with React JSX and bundler resolution.
- **Node.js**: Target Node 20+ runtime.
- **Ink**: React-based Terminal UI (`App.tsx` with stdout plain text banner before TUI, live log stream, status bar notifications, keyboard shortcuts `c` to copy script URL, `t` to copy tag, `p` to pause/resume, `q` to quit, `1-5` level filters, `↑`/`↓` scrolling).
- **Fastify**: High-performance HTTP server & API with CORS enabled and optional Bearer token authentication middleware.
- **better-sqlite3**: Local SQLite database storage at `~/.reverse-logger/logs.db` with `--max-logs` auto-truncation and indexed queries (`timestamp_ms`, `level`, `session_id`).
- **tsup**: Bundler creating Node CLI (`dist/cli.mjs`), dual CJS/ESM library (`dist/index.cjs`, `dist/index.js`), and standalone browser client (`dist/client.js`).
- **Changesets**: Versioning & changelog setup (`.changeset/config.json`).
- **Config loader**: Support for default configurations in `~/.reverse-logger/config.json` (`maxLogs`, `port`, `host`, `token`, `dbPath`).

## Key Commands
```bash
npx reverse-logger serve --token <secret>
npm run build
npm run lint
npm test
```

## API Endpoints & Response Schema
- `GET /script/client.js`: Standalone dependency-free browser console wrapper (public).
- `GET /api/logs`: Returns `{ logs: LogEntry[], total: number, limit: number, offset: number }`. Supports `search`/`q`, `level`, `url`, `sessionId`, `from` / `to` (ISO strings/timestamp ms), `limit`, `offset`.
- `POST /api/logs`: Ingests JSON log entries.
