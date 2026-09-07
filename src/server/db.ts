import Database from 'better-sqlite3';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { LogEntry, LogQueryOptions, RawLogRecord } from '../types';

export class LoggerDatabase {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const finalPath = dbPath || path.join(os.homedir(), '.reverse-logger', 'logs.db');
    const dir = path.dirname(finalPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(finalPath);
    this.initSchemaAndMigrate();
  }

  private initSchemaAndMigrate(): void {
    // Ensure table exists
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        timestamp_ms INTEGER NOT NULL,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        args TEXT NOT NULL,
        url TEXT,
        stack TEXT,
        user_agent TEXT,
        session_id TEXT,
        created_at TEXT NOT NULL
      );
    `);

    // Migration helper: check columns in case database was created with older schema
    const columnsInfo = this.db.prepare('PRAGMA table_info(logs)').all() as Array<{ name: string }>;
    const columnNames = new Set(columnsInfo.map((c) => c.name));

    if (!columnNames.has('timestamp_ms')) {
      this.db.exec('ALTER TABLE logs ADD COLUMN timestamp_ms INTEGER DEFAULT 0;');
      this.db.exec('UPDATE logs SET timestamp_ms = CAST(timestamp AS INTEGER) WHERE timestamp_ms = 0 AND timestamp GLOB "[0-9]*";');
    }
    if (!columnNames.has('message')) {
      this.db.exec('ALTER TABLE logs ADD COLUMN message TEXT DEFAULT "";');
      this.db.exec('UPDATE logs SET message = args WHERE message = "";');
    }
    if (!columnNames.has('session_id')) {
      this.db.exec('ALTER TABLE logs ADD COLUMN session_id TEXT;');
    }

    // Ensure sensible indexes
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp_ms);
      CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(level);
      CREATE INDEX IF NOT EXISTS idx_logs_session_id ON logs(session_id);
    `);
  }

  public insertLog(entry: Partial<LogEntry>, maxLogs: number = 10000): LogEntry {
    const nowMs = Date.now();
    let tsMs = nowMs;

    if (entry.timestamp) {
      const parsed = Date.parse(entry.timestamp);
      if (!isNaN(parsed)) {
        tsMs = parsed;
      } else if (typeof entry.timestamp === 'number') {
        tsMs = entry.timestamp;
      }
    }

    const isoTimestamp = new Date(tsMs).toISOString();
    const isoCreatedAt = new Date(nowMs).toISOString();
    const argsArray = Array.isArray(entry.args) ? entry.args : [entry.args ?? ''];

    let messageStr = entry.message;
    if (!messageStr) {
      messageStr = argsArray
        .map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a)))
        .join(' ');
    }

    const argsJson = JSON.stringify(argsArray);

    const stmt = this.db.prepare(`
      INSERT INTO logs (timestamp, timestamp_ms, level, message, args, url, stack, user_agent, session_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const info = stmt.run(
      isoTimestamp,
      tsMs,
      entry.level ? entry.level.toLowerCase() : 'info',
      messageStr,
      argsJson,
      entry.url || null,
      entry.stack || null,
      entry.userAgent || null,
      entry.sessionId || null,
      isoCreatedAt
    );

    const insertedId = info.lastInsertRowid as number;

    if (maxLogs > 0) {
      this.truncateLogs(maxLogs);
    }

    return {
      id: insertedId,
      timestamp: isoTimestamp,
      level: entry.level ? entry.level.toLowerCase() : 'info',
      message: messageStr,
      args: argsArray,
      url: entry.url || undefined,
      stack: entry.stack || undefined,
      userAgent: entry.userAgent || undefined,
      sessionId: entry.sessionId || undefined,
      createdAt: isoCreatedAt,
    };
  }

  public truncateLogs(maxLogs: number): void {
    const stmt = this.db.prepare(`
      DELETE FROM logs WHERE id NOT IN (
        SELECT id FROM logs ORDER BY id DESC LIMIT ?
      )
    `);
    stmt.run(maxLogs);
  }

  private buildWhereClause(options: LogQueryOptions = {}): { whereSql: string; params: any[] } {
    const conditions: string[] = [];
    const params: any[] = [];

    // Level filter
    if (options.level) {
      conditions.push('LOWER(level) = ?');
      params.push(options.level.toLowerCase());
    }

    // URL filter
    if (options.url) {
      conditions.push('url LIKE ?');
      params.push(`%${options.url.trim()}%`);
    }

    // Session ID filter
    if (options.sessionId) {
      conditions.push('session_id = ?');
      params.push(options.sessionId);
    }

    // Search / q filter
    if (options.search && options.search.trim() !== '') {
      conditions.push('(message LIKE ? OR args LIKE ? OR url LIKE ? OR stack LIKE ?)');
      const term = `%${options.search.trim()}%`;
      params.push(term, term, term, term);
    }

    // Time range filters (from / since, to / until)
    const fromVal = options.from ?? options.since;
    if (fromVal !== undefined) {
      const fromMs = this.parseToMs(fromVal);
      if (fromMs !== null) {
        conditions.push('timestamp_ms >= ?');
        params.push(fromMs);
      }
    }

    const toVal = options.to ?? options.until;
    if (toVal !== undefined) {
      const toMs = this.parseToMs(toVal);
      if (toMs !== null) {
        conditions.push('timestamp_ms <= ?');
        params.push(toMs);
      }
    }

    const whereSql = conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '';
    return { whereSql, params };
  }

  public getLogs(options: LogQueryOptions = {}): LogEntry[] {
    const limit = options.limit && options.limit > 0 ? options.limit : 20;
    const offset = options.offset && options.offset >= 0 ? options.offset : 0;

    const { whereSql, params } = this.buildWhereClause(options);
    const sql = `SELECT * FROM logs${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`;

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params, limit, offset) as RawLogRecord[];

    return rows.map((row) => ({
      id: row.id,
      timestamp: row.timestamp || new Date(row.timestamp_ms || Date.now()).toISOString(),
      level: row.level,
      message: row.message || '',
      args: this.safeParseJson(row.args),
      url: row.url || undefined,
      stack: row.stack || undefined,
      userAgent: row.user_agent || undefined,
      sessionId: row.session_id || undefined,
      createdAt: row.created_at || undefined,
    }));
  }

  public getLogCount(options: LogQueryOptions = {}): number {
    const { whereSql, params } = this.buildWhereClause(options);
    const sql = `SELECT COUNT(*) as count FROM logs${whereSql}`;

    const stmt = this.db.prepare(sql);
    const result = stmt.get(...params) as { count: number };
    return result ? result.count : 0;
  }

  public close(): void {
    this.db.close();
  }

  private parseToMs(val: string | number): number | null {
    if (typeof val === 'number') return val;
    if (!val) return null;
    const num = Number(val);
    if (!isNaN(num)) return num;
    const parsed = Date.parse(val);
    return isNaN(parsed) ? null : parsed;
  }

  private safeParseJson(str: string): any[] {
    try {
      return JSON.parse(str);
    } catch {
      return [str];
    }
  }
}
