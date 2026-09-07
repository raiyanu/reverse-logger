---
name: reverse-logger
description: Production-ready local reverse logger server to receive, monitor, search, and store browser console activity and application events in real time. Use when starting reverse-logger server, capturing web browser console logs, searching/filtering logs via API, viewing web dashboard, or initializing client script.
---

# reverse-logger Skill

`reverse-logger` is a local reverse logger server and browser console monitoring tool. It captures browser console output (`console.log`, `info`, `warn`, `error`, `debug`) and custom application events (`window.reverseLogger.star`), storing them in SQLite (`~/.reverse-logger/logs.db`) and displaying them via a live Terminal UI, a browser developer overlay (Shadow DOM), and a Web Dashboard (`/logs`).

---

## 1. Quick Start Commands

### Start the Logger Server

```bash
npx reverse-logger serve
```

### Options & Flags

```bash
npx reverse-logger serve [options]
```

- `--max-logs <number>`: Maximum log records retained in SQLite (default: `10000`).
- `--port <number>`: Starting port to bind server (default: `5050`).
- `--host <string>`: Network host interface (default: `0.0.0.0`).
- `--token <string>`: Optional Bearer authentication token for API security.

Example with token and custom port:

```bash
npx reverse-logger serve --port 5050 --token secret123 --max-logs 50000
```

---

## 2. Browser Integration

Add the `<script>` tag to the target HTML application:

```html
<script src="http://<server-ip>:5050/script/client.js"></script>
```

If authentication `--token` is active:

```html
<script src="http://<server-ip>:5050/script/client.js?token=secret123"></script>
```

---

## 3. In-Browser Developer Overlay

Once `client.js` is loaded:
- **Floating Badge**: Appears at bottom-right showing `RL <count>  ⚠ <warn>  ✕ <error>` and connection status (`●` / `○`).
- **Keyboard Shortcut**: Press **`Cmd + Shift + L`** (macOS) or **`Ctrl + Shift + L`** (Windows/Linux) to toggle the overlay open/close.
- **Shadow DOM**: Fully isolated from host page styles.

---

## 4. Public Browser JavaScript API (`window.reverseLogger`)

```javascript
// Standard logging wrappers
window.reverseLogger.log("Application initialized");
window.reverseLogger.info("User session started", { userId: "usr_102" });
window.reverseLogger.warn("High memory usage warning");
window.reverseLogger.error("API error", new Error("500 Internal Error"));
window.reverseLogger.debug("State transition", { state: "READY" });

// Starred / Special Important Events (creates level: "special", starred: true)
window.reverseLogger.star("Order Completed", { orderId: "ORD-9912", amount: 99.50 });

// Controls
window.reverseLogger.clear();          // Clear local overlay display
window.reverseLogger.pause();          // Pause live log updates
window.reverseLogger.resume();         // Resume live log updates
console.log(window.reverseLogger.isConnected()); // Returns boolean server status
```

---

## 5. Web Dashboard (`/logs`)

Access the web dashboard in any browser at:

```text
http://<server-ip>:5050/logs
```

- **Tabs**: `All Logs`, `⭐ Starred`, `⚠️ Errors`
- **Features**: Full-text search, level selector, time range filter, log detail inspector, pagination, copy text/JSON, star/unstar toggle.

---

## 6. HTTP REST API Reference

### Retrieve Logs

```text
GET /api/logs
```

Query Parameters:
- `level`: `log` | `info` | `warn` | `error` | `debug` | `special`
- `search` / `q`: Search string across message, args, url, stack
- `url`: Substring filter for page URL
- `sessionId`: Session ID filter
- `starred`: `true` | `false`
- `from` & `to`: Start/end ISO date strings or millisecond timestamps
- `limit`: Default `20`
- `offset`: Default `0`

Example:
```text
GET /api/logs?q=auth&level=error&limit=10&offset=0
```

### Retrieve Starred Logs
```text
GET /api/logs/starred
```

### Toggle Star Status
```text
POST /api/logs/:id/star
```

### Ingest Log
```text
POST /api/logs
```

---

## 7. Configuration File (`~/.reverse-logger/config.json`)

Set default server options globally:

```json
{
  "maxLogs": 10000,
  "port": 5050,
  "host": "0.0.0.0",
  "token": "secret123"
}
```
