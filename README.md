# Reverse Logger ⚡

> Production-ready local reverse logger server that receives browser console logs and displays/stores them in a live terminal UI, standalone browser developer overlay, and web dashboard with SQLite database.

## 🤖 AI Agent Skill (`skills.sh`)

Install this skill into your AI Coding Assistant (Antigravity, Cursor, Claude Code, Windsurf, etc.) via `skills.sh`:

```bash
npx skills add raiyanu/reverse-logger
```

Or use without installing:

```bash
npx skills use raiyanu/reverse-logger@reverse-logger
```

## Features

- ⚡ **High-Throughput Log Streaming**: Built to handle rapid bursts of logs (1,000+ entries) smoothly without freezing your browser UI or locking up application threads.
- 📦 **Large Payload Support**: Effortlessly captures large console entries (up to 3MB+ per log) with instant on-demand full payload inspection.
- 🎨 **Browser Developer Overlay**: Embedded floating badge and overlay panel (`Cmd/Ctrl + Shift + L`) displaying live logs, level filters, real-time search, and expandable argument details.
- ⭐ **Starred & Special Logs API**: Use `window.reverseLogger.star(...)` to pin critical events or errors across client and server sessions.
- 📊 **Web Dashboard**: Interactive web dashboard (`/logs`) for inspecting, searching, filtering, and exporting log history from any browser.
- ⌨️ **Terminal UI (TUI)**: Live interactive terminal view with fast keyboard shortcuts (`c` to copy script URL, `t` to copy script tag, `p` to pause stream, `q` to quit).
- 🗄️ **Persistent Local Storage**: Automatically saves logs to a local database with configurable retention limits (`--max-logs`).
- 🔑 **Token Authentication**: Optional Bearer token security for restricted environment logging.
- 🛡️ **Zero-Dependency Client Script**: Drop-in `/script/client.js` with automatic circular reference handling, session tracking, and offline queueing.
- ⚙️ **Custom Configuration**: Flexible global configuration file support (`~/.reverse-logger/config.json`).

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

## 🌟 Best Recommended Usage & Debugging Workflow

### Step 1: Start Server
```bash
npx reverse-logger serve --port 5050
```

### Step 2: Inject Client Script
Add to your web application HTML:
```html
<script src="http://localhost:5050/script/client.js"></script>
```

### Step 3: Write Minimal Tagged Console Logs
Use native `console` functions prefixed with `"RLogger | "` to keep code zero-dependency and easy to remove:
```javascript
console.log("RLogger | Route navigate", { from: "/home", to: "/checkout" });
console.warn("RLogger | Payment retry", { attempt: 2 });
console.error("RLogger | Cart sync failed", err);

// Pin milestones with the public star API
window.reverseLogger?.star("Checkout Completed", { orderId: "ORD-9912" });
```

### Step 4: Access & Inspect Logs (4 Interfaces)
- 🎨 **Browser Overlay**: Press **`Cmd/Ctrl + Shift + L`** on your web page. Search `"RLogger"` or expand entries.
- ⌨️ **Terminal UI**: Press `1`-`5` to filter levels, `p` to pause/resume live stream.
- 📊 **Web Dashboard**: Visit `http://localhost:5050/logs` for full log browsing, search, and export.
- 🤖 **REST API (CLI / AI Agents)**: Query programmatically via `curl "http://localhost:5050/api/logs?q=RLogger"`.

### Step 5: 1-Click Cleanup
Remove debug statements before release with a single search: `grep -rn "RLogger | " src/`

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
- **Features**: Full text search, level selector, pagination, detailed argument inspector, star/unstar toggle, on-demand large payload loading, and copy as JSON/text.

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
  message: string;       // Primary text representation of arguments (or truncated preview if large)
  args: unknown[];       // Raw arguments array
  url?: string;          // Origin page URL
  stack?: string;        // Error stack trace (if available)
  userAgent?: string;    // Browser user agent
  sessionId?: string;    // Unique browser session ID
  starred: boolean;      // True if starred/important
  source?: "console" | "reverseLogger"; // Log origin source
  createdAt?: string;    // Server ingestion timestamp
  isLarge?: boolean;     // True if payload > 32KB stored in tiered storage
  payloadSize?: number;  // Total size in bytes of log payload
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

### 4. Fetch Full Payload for Large Logs (>32KB)
```text
GET /api/logs/:id/payload
```
Returns `{ success: true, payload: { logId, message, args, stack, payloadSize } }`.

### 5. Toggle Starred State
```text
POST /api/logs/:id/star
```
Payload: `{ "starred": true }` or `{ "starred": false }`. Toggles state if body is empty.

### 6. Ingest Log Entries (Single or Batch)
```text
POST /api/logs
```
Payload: Single `LogEntry` object OR batch array `{ "logs": [ ... ] }` / `[ ... ]`. Maximum HTTP body payload size: 20MB.

## Running Tests

Run full test suite:

```bash
npm test
```

## License

MIT
