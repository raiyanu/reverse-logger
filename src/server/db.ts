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
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        level TEXT NOT NULL,
        args TEXT NOT NULL,
        url TEXT,
        stack TEXT,
        user_agent TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp);
      CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(level);
    `);
  }

  /**
   * Inserts a log entry and truncates oldest entries beyond maxLogs.
   */
  public insertLog(entry: LogEntry, maxLogs: number = 10000): LogEntry {
    const now = Date.now();
    const timestamp = entry.timestamp || now;
    const argsJson = JSON.stringify(entry.args || []);

    const stmt = this.db.prepare(`
      INSERT INTO logs (timestamp, level, args, url, stack, user_agent, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const info = stmt.run(
      timestamp,
      entry.level,
      argsJson,
      entry.url || null,
      entry.stack || null,
      entry.userAgent || null,
      now
    );

    const insertedId = info.lastInsertRowid as number;

    // Truncate logs to maxLogs limit
    if (maxLogs > 0) {
      this.truncateLogs(maxLogs);
    }

    return {
      ...entry,
      id: insertedId,
      timestamp,
      createdAt: now,
    };
  }

  /**
   * Truncate oldest records keeping only the newest maxLogs records.
   */
  public truncateLogs(maxLogs: number): void {
    const stmt = this.db.prepare(`
      DELETE FROM logs WHERE id NOT IN (
        SELECT id FROM logs ORDER BY id DESC LIMIT ?
      )
    `);
    stmt.run(maxLogs);
  }

  /**
   * Retrieves logs matching options (limit, since, until, level, search).
   */
  public getLogs(options: LogQueryOptions = {}): LogEntry[] {
    const limit = options.limit && options.limit > 0 ? options.limit : 20;
    const whereConditions: string[] = [];
    const params: any[] = [];

    if (options.since !== undefined) {
      whereConditions.push('timestamp >= ?');
      params.push(options.since);
    }

    if (options.until !== undefined) {
      whereConditions.push('timestamp <= ?');
      params.push(options.until);
    }

    if (options.level) {
      whereConditions.push('level = ?');
      params.push(options.level);
    }

    if (options.search && options.search.trim() !== '') {
      whereConditions.push('(args LIKE ? OR url LIKE ? OR stack LIKE ?)');
      const term = `%${options.search.trim()}%`;
      params.push(term, term, term);
    }

    let sql = 'SELECT * FROM logs';
    if (whereConditions.length > 0) {
      sql += ' WHERE ' + whereConditions.join(' AND ');
    }
    sql += ' ORDER BY id DESC LIMIT ?';
    params.push(limit);

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as RawLogRecord[];

    return rows.map((row) => ({
      id: row.id,
      timestamp: row.timestamp,
      level: row.level,
      args: this.safeParseJson(row.args),
      url: row.url || undefined,
      stack: row.stack || undefined,
      userAgent: row.user_agent || undefined,
      createdAt: row.created_at,
    }));
  }

  /**
   * Returns count of log records matching options or total count.
   */
  public getLogCount(options: LogQueryOptions = {}): number {
    const whereConditions: string[] = [];
    const params: any[] = [];

    if (options.since !== undefined) {
      whereConditions.push('timestamp >= ?');
      params.push(options.since);
    }

    if (options.until !== undefined) {
      whereConditions.push('timestamp <= ?');
      params.push(options.until);
    }

    if (options.level) {
      whereConditions.push('level = ?');
      params.push(options.level);
    }

    if (options.search && options.search.trim() !== '') {
      whereConditions.push('(args LIKE ? OR url LIKE ? OR stack LIKE ?)');
      const term = `%${options.search.trim()}%`;
      params.push(term, term, term);
    }

    let sql = 'SELECT COUNT(*) as count FROM logs';
    if (whereConditions.length > 0) {
      sql += ' WHERE ' + whereConditions.join(' AND ');
    }

    const stmt = this.db.prepare(sql);
    const result = stmt.get(...params) as { count: number };
    return result ? result.count : 0;
  }

  /**
   * Closes the database connection.
   */
  public close(): void {
    this.db.close();
  }

  private safeParseJson(str: string): any[] {
    try {
      return JSON.parse(str);
    } catch {
      return [str];
    }
  }
}
