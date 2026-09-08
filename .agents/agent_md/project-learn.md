# Project Memory: reverse-logger

## Overview
`reverse-logger` is a production-ready npm package providing a local reverse logger server that receives browser console logs and displays/stores them via a live Ink TUI, browser developer overlay, web dashboard, and SQLite storage.

## Tech Stack
- **TypeScript**: Target ES2022 / ESNext with React JSX and bundler resolution.
- **Node.js**: Target Node 20+ runtime.
- **Ink**: React-based Terminal UI (`App.tsx` with stdout plain text banner before TUI, live log stream, status bar notifications, keyboard shortcuts `c` to copy script URL, `t` to copy tag, `p` to pause/resume, `q` to quit, `1-5` level filters, `↑`/`↓` scrolling).
- **Fastify**: High-performance HTTP server & API with CORS enabled, optional Bearer token authentication middleware, and web dashboard served at `/logs`.
- **better-sqlite3**: Local SQLite database storage at `~/.reverse-logger/logs.db` with `--max-logs` auto-truncation and indexed queries (`timestamp_ms`, `level`, `session_id`, `starred`).
- **tsup**: Bundler creating Node CLI (`dist/cli.mjs`), dual CJS/ESM library (`dist/index.cjs`, `dist/index.js`), and standalone browser client (`dist/client.js`).
- **Changesets**: Versioning & changelog setup (`.changeset/config.json`).
- **Config loader**: Support for default configurations in `~/.reverse-logger/config.json` (`maxLogs`, `port`, `host`, `token`, `dbPath`).
- **Browser Developer Overlay**: Lightweight Shadow DOM overlay injected by `client.js` with floating badge (`RL 12 ⚠ 2 ✕ 1`), real-time log list, search, level filters, expandable log details, copy buttons, star/unstar toggle, `requestAnimationFrame`-throttled UI updates (to safely handle 1,000+ logs without freezing the main thread or unresponding badge), and `Cmd/Ctrl+Shift+L` keyboard shortcut.
- **Public Browser API**: `window.reverseLogger` exposing `log`, `info`, `warn`, `error`, `debug`, `star` (special logs), `clear`, `pause`, `resume`, `isConnected`.

## Key Commands
```bash
npx reverse-logger serve --token <secret>
npm run build
npm run lint
npm test
```

## API Endpoints & Response Schema
- `GET /script/client.js`: Standalone dependency-free browser client wrapper (public).
- `GET /logs` & `GET /dashboard`: Interactive web dashboard (public).
- `GET /api/logs`: Returns `{ logs: LogEntry[], total: number, limit: number, offset: number }`. Supports `search`/`q`, `level`, `url`, `sessionId`, `starred`, `from` / `to` (ISO strings/timestamp ms), `limit`, `offset`.
- `GET /api/logs/starred`: Alias for `GET /api/logs?starred=true`.
- `POST /api/logs/:id/star`: Toggles or sets starred state for log entry.
- `POST /api/logs`: Ingests JSON log entries up to 20MB. Accepts single log object or batch arrays `{ logs: LogEntry[] }` or `LogEntry[]` using SQLite transactions (`insertLogsBatch`) for ultra-high throughput (1,000 logs in <40ms). Logs >32KB store a truncated preview in `logs` and full payload in `log_payloads`.
- `GET /api/logs/:id/payload`: Retrieves full un-truncated payload (`{ success: true, payload: { logId, message, args, stack, payloadSize } }`) for large log entries on-demand.
- `DELETE /api/logs`: Flushes away all existing logs from the database. Triggered on server start with CLI flag `--flush` (aliases: `--fresh`, `--clean`).


