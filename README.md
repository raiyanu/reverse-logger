# reverse-logger ⚡

> Production-ready local reverse logger server that receives browser console logs and displays/stores them in a live terminal UI, standalone browser developer overlay, and web dashboard with SQLite database.

## Features

- 🚀 **Zero Config CLI**: Run `npx reverse-logger serve` to start instantly.
- 🎨 **Browser Developer Overlay**: Lightweight Shadow DOM overlay injected by `/script/client.js` with floating badge (`RL 12 ⚠ 2 ✕ 1`), real-time log list, search, level filtering, expandable log details, and copy buttons.
- ⭐ **Starred & Special Logs API**: Public `window.reverseLogger.star(message, ...args)` API to mark important events (`level: "special"`, `starred: true`, `source: "reverseLogger"`). Star state is persisted locally and on server.
- 📊 **Web Dashboard**: Responsive web page served at `http://localhost:5050/logs` featuring tabs for **All Logs**, **Starred**, and **Errors**, with search, level filters, time ranges, and pagination.
- ⌨️ **TUI & Keyboard Controls**: Live terminal UI (`c` to copy script URL, `t` to copy tag, `p` to pause/resume, `q` to quit). Keyboard shortcut `Cmd/Ctrl + Shift + L` toggles browser overlay.
- 🗄️ **Local SQLite Storage**: Saves logs in `~/.reverse-logger/logs.db` (`better-sqlite3`) with configurable retention limit (`--max-logs`). Indexed by timestamp, level, session ID, and starred status.
- 🔑 **Optional Token Auth**: Secure log API with `--token <secret>` (or config `"token"`).
- 🛡️ **Hardened Browser Client**: Standalone dependency-free `/script/client.js` with session tracking (`sessionId`), circular reference handling, payload size limits, and an offline retry queue.
- ⚙️ **Config File Support**: Global configuration support at `~/.reverse-logger/config.json`.

## Installation & Quick Start

Run directly via `npx`:

```bash
npx reverse-logger serve
```

Or install globally:

```bash
npm install -g reverse-logger
reverse-logger serve
```

## Public Browser API (`window.reverseLogger`)

When `/script/client.js` is included in a web application, it exposes the global `window.reverseLogger` object:

```javascript
// Log standard entries programmatically
window.reverseLogger.log("Application started");
window.reverseLogger.info("User logged in", { userId: 42 });
window.reverseLogger.warn("High memory usage");
window.reverseLogger.error("API call failed", new Error("404 Not Found"));
window.reverseLogger.debug("State update", { state: "READY" });

// Log important/starred events (creates level: "special", starred: true)
window.reverseLogger.star("Checkout completed", { orderId: "123", amount: 49.99 });

// Utility methods
window.reverseLogger.clear();          // Clear local overlay display logs
window.reverseLogger.pause();          // Pause overlay live stream updates
window.reverseLogger.resume();         // Resume overlay live stream updates
console.log(window.reverseLogger.isConnected()); // Returns true if server is online
```

### Browser Overlay Keyboard Shortcut

Press **`Cmd + Shift + L`** (macOS) or **`Ctrl + Shift + L`** (Windows/Linux) to toggle the browser developer overlay panel open or closed. Shortcut is automatically ignored while typing in text inputs or textareas.

## Web Dashboard (`/logs`)

Open `http://<server-ip>:<port>/logs` in any browser to access the interactive web dashboard:
- **Tabs**: `All Logs`, `⭐ Starred`, `⚠️ Errors`
- **Features**: Full text search, level selector, pagination, detailed argument inspector, star/unstar toggle, and copy as JSON/text.

## CLI Usage & Options

```bash
reverse-logger serve [options]
```

### Options

| Option | Description | Default |
| --- | --- | --- |
| `--max-logs <number>` | Maximum logs to retain in local SQLite database | `10000` |
| `--port <number>` | Starting port number to bind server | `5050` |
| `--host <string>` | Host interface address | `0.0.0.0` |
| `--token <string>` | Optional Bearer authentication token for API access | `undefined` |

### TUI Controls

- `c`: Copy script URL
- `t`: Copy HTML `<script>` tag
- `p`: Pause / resume live log updates
- `q`: Quit server and exit
- `1` - `5`: Level filter shortcuts (ALL, LOG, INFO, WARN, ERR)

## Configuration File (`~/.reverse-logger/config.json`)

```json
{
  "maxLogs": 10000,
  "port": 5050,
  "host": "0.0.0.0",
  "token": "my_secret_token"
}
```

## Log Schema

```typescript
interface LogEntry {
  id: number;
  timestamp: string;     // ISO 8601 string
  level: string;         // "log" | "info" | "warn" | "error" | "debug" | "special"
  message: string;       // Primary text representation of arguments
  args: unknown[];       // Raw arguments array
  url?: string;          // Origin page URL
  stack?: string;        // Error stack trace (if available)
  userAgent?: string;    // Browser user agent
  sessionId?: string;    // Unique browser session ID
  starred: boolean;      // True if starred/important
  source?: "console" | "reverseLogger"; // Log origin source
  createdAt?: string;    // Server ingestion timestamp
}
```

## API Endpoints

### 1. Browser Client Script
```text
GET /script/client.js
```

### 2. Retrieve Logs with Combined Filtering & Pagination
```text
GET /api/logs
```
Query Parameters: `level`, `search`/`q`, `url`, `sessionId`, `starred` (`true`/`false`), `from`, `to`, `limit`, `offset`.

### 3. Retrieve Starred Logs
```text
GET /api/logs/starred
```
Alias for `GET /api/logs?starred=true`.

### 4. Toggle Starred State
```text
POST /api/logs/:id/star
```
Payload: `{ "starred": true }` or `{ "starred": false }`. Toggles state if body is empty.

### 5. Ingest Log Entry
```text
POST /api/logs
```

## Running Tests

Run full test suite:

```bash
npm test
```

## License

MIT
