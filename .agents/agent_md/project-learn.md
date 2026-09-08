# Project Memory: reverse-logger

## Overview
`reverse-logger` is a production-ready npm package providing a local reverse logger server that receives browser console logs and displays/stores them via a live Ink TUI, browser developer overlay, web dashboard, and SQLite storage.

## Tech Stack
- **TypeScript**: Target ES2022 / ESNext with React JSX and bundler resolution.
- **Node.js**: Target Node 20+ runtime.
- **Ink**: React-based Terminal UI (`App.tsx` with stdout plain text banner before TUI, live log stream, status bar notifications, keyboard shortcuts `c` to copy script URL, `t` to copy tag, `p` to pause/resume, `q` to quit, `1-5` level filters, `↑`/`↓` scrolling). Multi-screen state machine: `SERVER_INFO`, `LIVE_LOGS`, `HELP` toggled via `Enter`/`s`/`h`.
- **Fastify**: High-performance HTTP server & API with CORS enabled, optional Bearer token authentication middleware, and web dashboard served at `/logs`.
- **better-sqlite3**: Local SQLite database storage at `~/.reverse-logger/logs.db` with `--max-logs` auto-truncation and indexed queries (`timestamp_ms`, `level`, `session_id`, `starred`).
- **tsup**: Bundler creating Node CLI (`dist/cli.mjs`), dual CJS/ESM library (`dist/index.cjs`, `dist/index.js`), and standalone browser client (`dist/client.js`).
- **Changesets**: Versioning & changelog setup (`.changeset/config.json`).
- **Config loader**: Support for default configurations in `~/.reverse-logger/config.json` (`maxLogs`, `port`, `host`, `token`, `dbPath`).
- **Browser Developer Overlay**: Shadow DOM overlay with floating badge + lazy window-mode panel. Uses ring buffer (O(1) push), coalesced 500ms UI timer (max 2 badge updates/sec), DocumentFragment batch DOM insertion, and lazy detail expansion. Panel structure built once on first open, never destroyed. All UI updates are fully decoupled from log capture — `captureLog()` never touches the DOM.
- **Public Browser API**: `window.reverseLogger` exposing `log`, `info`, `warn`, `error`, `debug`, `star` (special logs), `clear`, `pause`, `resume`, `isConnected`.

## Key Commands
```bash
npx reverse-logger serve --token <secret>
npm run build
npm run lint
npm test
npm run dev          # tsx src/cli.ts serve (no watch, preserves TTY)
npm run build:watch  # tsup --watch
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

## Performance Architecture (Client-Side)
- **Ring Buffer**: Fixed-capacity circular buffer (300 items) for local log storage. O(1) push, no Array.unshift reindexing. `ringSnapshot()` returns newest-first order.
- **Decoupled UI**: `captureLog()` only pushes to ring buffer + network queue. Zero DOM work.
- **Coalesced Timer**: `setInterval(uiTick, 500)` handles all UI updates — badge text and panel list.
- **Lazy Panel**: Panel structure (header, tabs, controls, list) built once on first badge click. Never destroyed/rebuilt.
- **Version Tracking**: `ringVersion` monotonic counter to skip redundant panel list renders.

## Performance Architecture (TUI)
- **Batched React State**: Incoming logs buffered in array, flushed to `setLogs()` every 500ms. Keeps React renders ≤ 2/sec even under 1000+ logs/sec.

## Critical Ink/TUI Pitfalls
- **NEVER use `process.stdout.write('\x1Bc')` with Ink**. The RIS escape sequence destroys Ink's virtual terminal buffer, causing blank screens. Ink manages its own rendering.
- Use `useRef` + functional state setters to avoid stale closures in `useInput`.
- Use `tsx` (not `tsx watch`) for dev server to preserve TTY raw mode.


