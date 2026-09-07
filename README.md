# reverse-logger ⚡

> Production-ready local reverse logger server that receives browser console logs and displays/stores them in a live terminal UI with SQLite database.

## Features

- 🚀 **Zero Config CLI**: Run `npx reverse-logger serve` to start instantly.
- 📱 **Live Terminal UI & Terminal Banner**: Plain text banner on startup for standard terminal text selection, plus live Ink TUI with keyboard controls (`c` to copy script URL, `t` to copy script tag, `p` to pause/resume, `q` to quit, `↑`/`↓` to scroll).
- 🗄️ **Local SQLite Storage**: Saves logs in `~/.reverse-logger/logs.db` (`better-sqlite3`) with configurable retention limit (`--max-logs`). Indexed by timestamp, level, and sessionId.
- 🌐 **Auto Network & Port Detection**: Detects LAN IP and picks first available port starting from `5050`.
- 🔑 **Optional Token Auth**: Secure log API with `--token <secret>` (or config `"token"`).
- 🛡️ **Hardened Browser Client**: Standalone dependency-free `/script/client.js` with session tracking (`sessionId`), circular reference handling, payload size limits, and an offline retry queue (flushes when server recovers).
- ⚙️ **Config File Support**: Global configuration support at `~/.reverse-logger/config.json`.
- ⚡ **Advanced Filtering & Pagination**: Filter logs by `search`/`q`, `level`, `url`, `sessionId`, ISO `from`/`to` time ranges, `limit`, and `offset`.

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

### Startup Output

When starting, plain text banner is printed to standard output for easy mouse selection:

```text
Reverse Logger

Server : http://192.168.1.15:5050
Script : http://192.168.1.15:5050/script/client.js

Tag:
<script src="http://192.168.1.15:5050/script/client.js"></script>
```

### TUI Keyboard Controls

While the TUI is active in terminal:

- `c`: Copy script URL to system clipboard
- `t`: Copy script `<script>` tag to system clipboard
- `p`: Pause / resume live log updates
- `q`: Quit server and exit
- `↑` / `↓`: Scroll log entries list
- `1` - `5`: Level filter shortcuts (1:ALL, 2:LOG, 3:INFO, 4:WARN, 5:ERR)

## Configuration File (`~/.reverse-logger/config.json`)

You can save default configurations in `~/.reverse-logger/config.json`:

```json
{
  "maxLogs": 10000,
  "port": 5050,
  "host": "0.0.0.0",
  "token": "my_secret_token"
}
```

*Note: CLI flags always take precedence over configuration file values.*

## Log Schema

Log entries adhere to the standardized structure:

```typescript
interface LogEntry {
  id: number;
  timestamp: string;     // ISO 8601 string (e.g., "2026-09-07T18:00:00.000Z")
  level: string;         // "log" | "info" | "warn" | "error" | "debug"
  message: string;       // Primary text representation of console arguments
  args: unknown[];       // Raw arguments array
  url?: string;          // Origin page URL
  stack?: string;        // Error stack trace (if available)
  userAgent?: string;    // Browser user agent
  sessionId?: string;    // Unique browser session ID
  createdAt?: string;    // Server ingestion timestamp
}
```

## API Endpoints

### 1. Standalone Client Script

```text
GET /script/client.js
```
Serves the dependency-free browser client proxy script. When `--token` is active, the script automatically extracts `?token=YOUR_TOKEN` from its script tag `src` attribute.

### 2. Retrieve Logs with Combined Filtering & Pagination

```text
GET /api/logs
```

#### Query Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `level` | `string` | Filter by level (`log`, `info`, `warn`, `error`, `debug`) |
| `search` / `q` | `string` | Substring search across message, arguments, URL, or stack |
| `url` | `string` | Partial or exact URL filter |
| `from` | `string` / `number` | Start ISO timestamp or time ms |
| `to` | `string` / `number` | End ISO timestamp or time ms |
| `limit` | `number` | Result limit (default: `20`) |
| `offset` | `number` | Result offset for pagination (default: `0`) |

#### Example Query

```text
GET /api/logs?q=auth&level=error&url=example.com&limit=10&offset=0
```

#### Example Response

```json
{
  "logs": [
    {
      "id": 42,
      "timestamp": "2026-09-07T18:15:00.000Z",
      "level": "error",
      "message": "Auth failed: Invalid credentials",
      "args": ["Auth failed: Invalid credentials", { "code": 401 }],
      "url": "http://example.com/auth",
      "stack": "Error: Auth failed\n    at login (http://example.com/app.js:10:5)",
      "userAgent": "Mozilla/5.0...",
      "sessionId": "s_a1b2c3d4e",
      "createdAt": "2026-09-07T18:15:00.100Z"
    }
  ],
  "total": 1,
  "limit": 10,
  "offset": 0
}
```

### 3. Ingest Log Entry

```text
POST /api/logs
```

Requires `Authorization: Bearer <token>` or `?token=<token>` when authentication is enabled.

```json
{
  "level": "warn",
  "message": "High memory usage detected",
  "args": ["High memory usage detected"],
  "url": "http://localhost:3000/dashboard",
  "sessionId": "s_a1b2c3d4e"
}
```

## Running Tests

Run the comprehensive test suite covering search, level, URL, combined filters, pagination, ISO time ranges, authentication, CORS, retention limits, payload limits, and malformed request handling:

```bash
npm test
```

## License

MIT
