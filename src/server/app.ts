import fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { LoggerDatabase } from './db';
import { LogEntry, LogLevel, ServerOptions } from '../types';

export interface ServerInstance {
  app: FastifyInstance;
  db: LoggerDatabase;
  events: EventEmitter;
  listen: (port: number, host?: string) => Promise<string>;
  close: () => Promise<void>;
}

const DEFAULT_CLIENT_SCRIPT = `(function () {
  if (window.__REVERSE_LOGGER_INITIALIZED__) return;
  window.__REVERSE_LOGGER_INITIALIZED__ = true;

  function getServerOrigin() {
    if (document.currentScript && document.currentScript.src) {
      try { return new URL(document.currentScript.src).origin; } catch (e) {}
    }
    return window.location.origin;
  }

  var serverOrigin = getServerOrigin();
  var apiEndpoint = serverOrigin + '/api/logs';
  var isSending = false;

  function safeSerialize(obj) {
    var cache = new WeakSet();
    return JSON.parse(JSON.stringify(obj, function (key, value) {
      if (typeof value === 'object' && value !== null) {
        if (cache.has(value)) return '[Circular]';
        cache.add(value);
      }
      if (value instanceof Error) {
        return { name: value.name, message: value.message, stack: value.stack };
      }
      if (typeof Element !== 'undefined' && value instanceof Element) {
        return '<' + value.tagName.toLowerCase() + (value.id ? '#' + value.id : '') + (value.className ? '.' + String(value.className).replace(/\\s+/g, '.') : '') + '>';
      }
      if (typeof value === 'function') {
        return '[Function: ' + (value.name || 'anonymous') + ']';
      }
      return value;
    }));
  }

  function extractStack(args) {
    for (var i = 0; i < args.length; i++) {
      if (args[i] instanceof Error && args[i].stack) return args[i].stack;
    }
    var err = new Error();
    if (err.stack) {
      return err.stack.split('\\n').filter(function (l) {
        return !l.includes('client.js') && !l.includes('safeSerialize');
      }).join('\\n');
    }
    return undefined;
  }

  function sendLog(level, rawArgs) {
    if (isSending) return;
    isSending = true;
    try {
      var serializedArgs = rawArgs.map(safeSerialize);
      var stack = extractStack(rawArgs);
      var payload = {
        timestamp: Date.now(),
        level: level,
        args: serializedArgs,
        url: typeof window !== 'undefined' ? window.location.href : '',
        stack: stack,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : ''
      };
      if (typeof fetch === 'function') {
        fetch(apiEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          mode: 'cors',
          keepalive: true
        }).catch(function () {}).finally(function () { isSending = false; });
      } else {
        isSending = false;
      }
    } catch (e) {
      isSending = false;
    }
  }

  var levels = ['log', 'info', 'warn', 'error', 'debug'];
  levels.forEach(function (level) {
    if (typeof console[level] === 'function') {
      var orig = console[level].bind(console);
      console[level] = function () {
        var args = Array.prototype.slice.call(arguments);
        orig.apply(console, args);
        sendLog(level, args);
      };
    }
  });
})();`;

function getDirname(): string {
  try {
    if (typeof import.meta !== 'undefined' && import.meta.url) {
      return path.dirname(fileURLToPath(import.meta.url));
    }
  } catch {
    // fallback
  }
  return typeof __dirname !== 'undefined' ? __dirname : process.cwd();
}

export function createServer(options: ServerOptions = {}): ServerInstance {
  const app = fastify({ logger: false });
  const db = new LoggerDatabase(options.dbPath);
  const events = new EventEmitter();
  const maxLogs = options.maxLogs || 10000;

  // Enable CORS for all browser clients
  app.register(cors, {
    origin: true,
  });

  // Serve browser client script
  app.get('/script/client.js', async (request, reply) => {
    reply.type('application/javascript');
    
    const currentDir = getDirname();
    const clientPaths = [
      path.join(currentDir, 'client.js'),
      path.join(currentDir, 'client.global.js'),
      path.join(currentDir, '../client.js'),
      path.join(currentDir, '../../dist/client.js'),
      path.join(currentDir, '../dist/client.js'),
      path.join(process.cwd(), 'dist/client.js'),
    ];

    for (const p of clientPaths) {
      try {
        if (fs.existsSync(p)) {
          return fs.readFileSync(p, 'utf-8');
        }
      } catch {
        // ignore read error
      }
    }

    return DEFAULT_CLIENT_SCRIPT;
  });

  // GET /api/logs
  app.get('/api/logs', async (request, reply) => {
    const query = request.query as Record<string, string>;
    const limit = query.limit ? parseInt(query.limit, 10) : 20;
    const since = query.since ? parseInt(query.since, 10) : undefined;
    const until = query.until ? parseInt(query.until, 10) : undefined;
    const level = query.level as LogLevel | undefined;
    const search = query.search || query.q || undefined;

    const queryOptions = {
      limit,
      since,
      until,
      level,
      search,
    };

    const logs = db.getLogs(queryOptions);

    return {
      success: true,
      count: logs.length,
      total: db.getLogCount(queryOptions),
      logs,
    };
  });

  // POST /api/logs
  app.post('/api/logs', async (request, reply) => {
    const body = request.body as Partial<LogEntry>;

    if (!body || typeof body !== 'object') {
      reply.status(400);
      return { success: false, error: 'Invalid log payload' };
    }

    const level: LogLevel = body.level && ['log', 'info', 'warn', 'error', 'debug'].includes(body.level)
      ? body.level
      : 'info';

    const entry: LogEntry = {
      timestamp: body.timestamp || Date.now(),
      level,
      args: Array.isArray(body.args) ? body.args : [body.args ?? ''],
      url: body.url || (request.headers.referer || request.headers.origin as string) || '',
      stack: body.stack,
      userAgent: body.userAgent || (request.headers['user-agent'] as string) || '',
    };

    const inserted = db.insertLog(entry, maxLogs);
    events.emit('log', inserted);

    return {
      success: true,
      log: inserted,
    };
  });

  return {
    app,
    db,
    events,
    listen: async (port: number, host: string = '0.0.0.0') => {
      return await app.listen({ port, host });
    },
    close: async () => {
      await app.close();
      db.close();
    },
  };
}
