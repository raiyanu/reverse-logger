export type LogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

export interface LogEntry {
  id?: number;
  timestamp: string; // ISO 8601 string format
  level: string;
  message: string;
  args: unknown[];
  url?: string;
  stack?: string;
  userAgent?: string;
  sessionId?: string;
  createdAt?: string;
}

export interface RawLogRecord {
  id: number;
  timestamp: string;
  timestamp_ms: number;
  level: string;
  message: string;
  args: string;
  url: string | null;
  stack: string | null;
  user_agent: string | null;
  session_id: string | null;
  created_at: string;
}

export interface ServerOptions {
  port?: number;
  host?: string;
  maxLogs?: number;
  token?: string;
  dbPath?: string;
}

export interface ConfigOptions {
  port?: number;
  host?: string;
  maxLogs?: number;
  token?: string;
  dbPath?: string;
}

export interface LogQueryOptions {
  limit?: number;
  offset?: number;
  since?: number;
  until?: number;
  from?: string | number;
  to?: string | number;
  level?: string;
  search?: string;
  url?: string;
  sessionId?: string;
}

export interface LogResponsePayload {
  logs: LogEntry[];
  total: number;
  limit: number;
  offset: number;
}
