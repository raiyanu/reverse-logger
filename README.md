# reverse-logger ⚡

> Production-ready local reverse logger server that receives browser console logs and displays/stores them in a live terminal UI with SQLite database.

## Features

- 🚀 **Zero Config CLI**: Run `npx reverse-logger serve` to start instantly.
- 📱 **Live Terminal UI**: Built with [Ink](https://github.com/vadimdemedes/ink) to display live colored logs, server banner, and inspection view.
- 🗄️ **Local SQLite Storage**: Saves logs in `~/.reverse-logger/logs.db` using `better-sqlite3` with customizable max log retention.
- 🌐 **Auto Network & Port Detection**: Detects your machine's LAN IP and finds the first available port starting at `5050`.
- 🔌 **Standalone Browser Client**: Served via `/script/client.js` with automatic server discovery and console proxying (`console.log`, `info`, `warn`, `error`, `debug`).
- ⚡ **Fastify API**: High-performance HTTP server supporting time-range log queries and RESTful POST log ingestion.

## Installation & Quick Start

Run directly using `npx`:

```bash
npx reverse-logger serve
```

Or install globally:

```bash
npm install -g reverse-logger
reverse-logger serve
```

Or add to your project:

```bash
npm install --save-dev reverse-logger
```

## CLI Usage

Start reverse logger server:

```bash
reverse-logger serve
```

Configure maximum log retention limit (default: 10000):

```bash
reverse-logger serve --max-logs 5000
```

Specify custom starting port (default: 5050):

```bash
reverse-logger serve --port 8080
```

When started, the CLI will output:

```text
Server: http://192.168.1.15:5050
Script: http://192.168.1.15:5050/script/client.js

Tag:
<script src="http://192.168.1.15:5050/script/client.js"></script>
```

Add the `<script>` tag to any web application to start capturing logs.

## API Endpoints

### 1. Browser Client Script

```text
GET /script/client.js
```
Serves the standalone browser console interceptor script.

### 2. Retrieve Stored Logs

```text
GET /api/logs
```
Query parameters:
- `limit` (default: `20`) - Number of logs to retrieve.
- `search` / `q` (string) - Search text within log arguments, URL, or stack traces.
- `since` (timestamp in ms) - Return logs after this timestamp.
- `until` (timestamp in ms) - Return logs before this timestamp.
- `level` (`log` | `info` | `warn` | `error` | `debug`) - Filter by log level.

Example response:
```json
{
  "success": true,
  "count": 1,
  "total": 42,
  "logs": [
    {
      "id": 1,
      "timestamp": 1725730000000,
      "level": "error",
      "args": ["Failed to load resource", { "status": 404 }],
      "url": "http://localhost:3000/checkout",
      "stack": "Error: Failed to load resource\n    at fetchData (http://localhost:3000/app.js:42:12)",
      "userAgent": "Mozilla/5.0...",
      "createdAt": 1725730000000
    }
  ]
}
```

### 3. Send Logs Programmatically

```text
POST /api/logs
```
Payload:
```json
{
  "level": "warn",
  "args": ["User token expired"],
  "url": "http://localhost:3000/dashboard",
  "timestamp": 1725730000000
}
```

## Storage Location

Database is automatically initialized at:
```text
~/.reverse-logger/logs.db
```

Records beyond `--max-logs` are automatically truncated to prevent unlimited disk growth.

## Programmatic API

You can also start `reverse-logger` programmatically inside Node.js scripts:

```typescript
import { createServer, findAvailablePort, getLanIp } from 'reverse-logger';

async function run() {
  const port = await findAvailablePort(5050);
  const ip = getLanIp();
  
  const server = createServer({ maxLogs: 1000 });
  await server.listen(port);

  console.log(`Server listening on http://${ip}:${port}`);
}

run();
```

## License

MIT
