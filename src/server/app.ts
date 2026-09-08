import fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { LoggerDatabase } from './db';
import { getDashboardHtml } from './dashboardHtml';
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

  function getScriptConfig() {
    var origin = window.location.origin;
    var token;
    if (document.currentScript) {
      var el = document.currentScript;
      if (el.src) {
        try {
          var parsed = new URL(el.src);
          origin = parsed.origin;
          var t = parsed.searchParams.get('token');
          if (t) token = t;
        } catch (e) {}
      }
      var dt = el.getAttribute('data-token');
      if (dt) token = dt;
    }
    return { origin: origin, token: token };
  }

  var cfg = getScriptConfig();
  var apiEndpoint = cfg.origin + '/api/logs';
  var authToken = cfg.token;

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

  function sendLog(level, rawArgs, extra) {
    try {
      var serializedArgs = rawArgs.map(safeSerialize);
      var payload = {
        timestamp: new Date().toISOString(),
        level: level,
        message: extra && extra.message ? extra.message : rawArgs.map(function(a) { return typeof a === 'object' ? JSON.stringify(a) : String(a); }).join(' '),
        args: serializedArgs,
        url: typeof window !== 'undefined' ? window.location.href : '',
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
        starred: extra && extra.starred ? true : false,
        source: extra && extra.source ? extra.source : 'console'
      };
      var headers = { 'Content-Type': 'application/json' };
      if (authToken) headers['Authorization'] = 'Bearer ' + authToken;

      if (typeof fetch === 'function') {
        fetch(apiEndpoint, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify(payload),
          mode: 'cors',
          keepalive: true
        }).catch(function () {});
      }
    } catch (e) {}
  }

  var levels = ['log', 'info', 'warn', 'error', 'debug'];
  levels.forEach(function (level) {
    if (typeof console[level] === 'function') {
      var orig = console[level].bind(console);
      console[level] = function () {
        var args = Array.prototype.slice.call(arguments);
        try { orig.apply(console, args); } catch (e) {}
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
  const app = fastify({
    logger: false,
    bodyLimit: 20 * 1024 * 1024, // 20 MB payload limit for large logs
  });
  const db = new LoggerDatabase(options.dbPath);
  const events = new EventEmitter();
  const maxLogs = options.maxLogs ?? 10000;
  const token = options.token;

  // Register CORS
  app.register(cors, {
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS', 'HEAD'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  });

  // Token Authentication Middleware
  if (token) {
    app.addHook('onRequest', async (request, reply) => {
      const urlPath = request.url.split('?')[0];

      // Skip authentication for client script, web dashboard, and preflights
      if (
        urlPath === '/script/client.js' ||
        urlPath === '/logs' ||
        urlPath === '/dashboard' ||
        urlPath === '/' ||
        request.method === 'OPTIONS'
      ) {
        return;
      }

      // Check Authorization header or query parameter
      const authHeader = request.headers.authorization;
      const queryToken = (request.query as Record<string, string>).token;

      let providedToken: string | undefined;
      if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
        providedToken = authHeader.substring(7).trim();
      } else if (queryToken) {
        providedToken = queryToken;
      }

      if (!providedToken || providedToken !== token) {
        reply.status(401);
        return reply.send({ error: 'Unauthorized' });
      }
    });
  }

  // Web Dashboard Route
  app.get('/logs', async (request, reply) => {
    reply.type('text/html');
    return getDashboardHtml();
  });

  app.get('/dashboard', async (request, reply) => {
    reply.type('text/html');
    return getDashboardHtml();
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

  // GET /api/logs/starred
  app.get('/api/logs/starred', async (request, reply) => {
    const query = request.query as Record<string, string>;
    const limit = query.limit ? parseInt(query.limit, 10) : 20;
    const offset = query.offset ? parseInt(query.offset, 10) : 0;
    const search = query.search || query.q || undefined;

    const queryOptions = {
      limit,
      offset,
      search,
      starred: true,
    };

    const logs = db.getLogs(queryOptions);
    const total = db.getLogCount(queryOptions);

    return {
      logs,
      total,
      limit,
      offset,
    };
  });

  // POST /api/logs/:id/star
  app.post('/api/logs/:id/star', async (request, reply) => {
    const params = request.params as { id: string };
    const id = parseInt(params.id, 10);

    if (isNaN(id)) {
      reply.status(400);
      return { success: false, error: 'Invalid log ID' };
    }

    const body = request.body as { starred?: boolean } | undefined;
    const isStarred = db.toggleStarred(id, body?.starred);

    return {
      success: true,
      id,
      starred: isStarred,
    };
  });

  // GET /api/logs/:id/payload - Retrieve full un-truncated payload for large entries
  app.get('/api/logs/:id/payload', async (request, reply) => {
    const params = request.params as { id: string };
    const id = parseInt(params.id, 10);

    if (isNaN(id)) {
      reply.status(400);
      return { success: false, error: 'Invalid log ID' };
    }

    const payload = db.getLogPayload(id);
    if (!payload) {
      reply.status(404);
      return { success: false, error: 'Log payload not found' };
    }

    return {
      success: true,
      payload,
    };
  });

  // GET /api/logs
  app.get('/api/logs', async (request, reply) => {
    const query = request.query as Record<string, string>;
    const limit = query.limit ? parseInt(query.limit, 10) : 20;
    const offset = query.offset ? parseInt(query.offset, 10) : 0;
    const since = query.since ? parseInt(query.since, 10) : undefined;
    const until = query.until ? parseInt(query.until, 10) : undefined;
    const from = query.from || since;
    const to = query.to || until;
    const level = query.level as LogLevel | undefined;
    const search = query.search || query.q || undefined;
    const urlFilter = query.url || undefined;
    const sessionId = query.sessionId || query.session_id || undefined;
    const starredParam = query.starred === 'true' ? true : query.starred === 'false' ? false : undefined;

    const queryOptions = {
      limit,
      offset,
      from,
      to,
      level,
      search,
      url: urlFilter,
      sessionId,
      starred: starredParam,
    };

    const logs = db.getLogs(queryOptions);
    const total = db.getLogCount(queryOptions);

    return {
      logs,
      total,
      limit,
      offset,
    };
  });

  // POST /api/logs
  app.post('/api/logs', async (request, reply) => {
    const body = request.body as any;

    if (!body || typeof body !== 'object') {
      reply.status(400);
      return { success: false, error: 'Invalid log payload' };
    }

    const rawEntries: Partial<LogEntry>[] = Array.isArray(body)
      ? body
      : Array.isArray(body.logs)
      ? body.logs
      : [body];

    if (rawEntries.length === 0) {
      reply.status(400);
      return { success: false, error: 'Empty log payload' };
    }

    const processedEntries: Partial<LogEntry>[] = rawEntries.map((entry) => {
      const level = entry.level && ['log', 'info', 'warn', 'error', 'debug', 'special'].includes(entry.level.toLowerCase())
        ? entry.level.toLowerCase()
        : 'info';

      return {
        timestamp: entry.timestamp || new Date().toISOString(),
        level,
        message: entry.message,
        args: Array.isArray(entry.args) ? entry.args : [entry.args ?? ''],
        url: entry.url || (request.headers.referer || (request.headers.origin as string)) || '',
        stack: entry.stack,
        userAgent: entry.userAgent || (request.headers['user-agent'] as string) || '',
        sessionId: entry.sessionId,
        starred: Boolean(entry.starred),
        source: entry.source || (level === 'special' ? 'reverseLogger' : 'console'),
      };
    });

    if (processedEntries.length === 1) {
      const inserted = db.insertLog(processedEntries[0], maxLogs);
      events.emit('log', inserted);
      return {
        success: true,
        log: inserted,
      };
    } else {
      const insertedList = db.insertLogsBatch(processedEntries, maxLogs);
      for (const inserted of insertedList) {
        events.emit('log', inserted);
      }
      return {
        success: true,
        count: insertedList.length,
        logs: insertedList,
      };
    }
  });

  return {
    app,
    db,
    events,
    listen: async (port: number, host: string = options.host || '0.0.0.0') => {
      return await app.listen({ port, host });
    },
    close: async () => {
      await app.close();
      db.close();
    },
  };
}
