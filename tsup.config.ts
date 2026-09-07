import { defineConfig } from 'tsup';

export default defineConfig([
  // Node CLI entry (ESM format as .mjs)
  {
    entry: ['src/cli.ts'],
    format: ['esm'],
    target: 'node20',
    outDir: 'dist',
    clean: true,
    outExtension() {
      return {
        js: '.mjs',
      };
    },
    banner: {
      js: '#!/usr/bin/env node',
    },
    external: ['better-sqlite3'],
  },
  // Main Library exports
  {
    entry: ['src/index.ts'],
    format: ['cjs', 'esm'],
    dts: true,
    target: 'node20',
    outDir: 'dist',
    external: ['better-sqlite3'],
  },
  // Browser Client standalone bundle
  {
    entry: ['src/client/client.ts'],
    format: ['iife'],
    target: 'es2020',
    platform: 'browser',
    outDir: 'dist',
    outExtension() {
      return {
        js: '.js',
      };
    },
    minify: true,
    sourcemap: true,
  },
]);
