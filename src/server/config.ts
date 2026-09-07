import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { ConfigOptions, ServerOptions } from '../types';

export function getConfigFilepath(): string {
  return path.join(os.homedir(), '.reverse-logger', 'config.json');
}

export function readConfigFile(): ConfigOptions {
  const filepath = getConfigFilepath();
  try {
    if (fs.existsSync(filepath)) {
      const content = fs.readFileSync(filepath, 'utf-8');
      return JSON.parse(content) as ConfigOptions;
    }
  } catch (err) {
    // Ignore invalid JSON / read errors, fallback to empty config
  }
  return {};
}

export function resolveServerOptions(cliOptions: ServerOptions = {}): ServerOptions {
  const fileConfig = readConfigFile();

  return {
    port: cliOptions.port ?? fileConfig.port ?? 5050,
    host: cliOptions.host ?? fileConfig.host ?? '0.0.0.0',
    maxLogs: cliOptions.maxLogs ?? fileConfig.maxLogs ?? 10000,
    token: cliOptions.token ?? fileConfig.token ?? undefined,
    dbPath: cliOptions.dbPath ?? fileConfig.dbPath ?? undefined,
  };
}
