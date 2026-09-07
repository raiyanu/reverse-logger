export type LogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

export interface LogEntry {
  id?: number;
  timestamp: number;
  level: LogLevel;
  args: any[];
  url?: string;
  stack?: string;
  userAgent?: string;
  createdAt?: number;
}

export interface RawLogRecord {
  id: number;
  timestamp: number;
  level: LogLevel;
  args: string;
  url: string | null;
  stack: string | null;
  user_agent: string | null;
  created_at: number;
}

export interface ServerOptions {
  port?: number;
  maxLogs?: number;
  dbPath?: string;
}

export interface LogQueryOptions {
  limit?: number;
  since?: number;
  until?: number;
  level?: LogLevel;
  search?: string;
}
