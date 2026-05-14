#!/usr/bin/env node
// Converts a directory of raw V8 coverage files (written by a Node process
// that ran with NODE_V8_COVERAGE=<dir>) into an LCOV report. Used by the
// E2E CI job, where the Express server is started with NODE_V8_COVERAGE,
// runs Playwright browser tests, then receives SIGTERM so V8 flushes its
// coverage. This script then post-processes the raw output.
//
// IMPORTANT: c8 is invoked with `shell: false` and a resolved binary path.
// Using `shell: true` causes bash to glob-expand the --include/--exclude
// patterns BEFORE c8 sees them, silently filtering out everything except
// the first matched file.
//
// Usage:
//   node scripts/c8-report.js <tempDir> <reportDir>

import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import process from 'node:process';

const require = createRequire(import.meta.url);
const C8_BIN = require.resolve('c8/bin/c8.js');

const [tempDirArg, reportDirArg] = process.argv.slice(2);

if (!tempDirArg || !reportDirArg) {
  console.error('Usage: c8-report.js <tempDir> <reportDir>');
  process.exit(2);
}

const tempDir = resolve(tempDirArg);
const reportDir = resolve(reportDirArg);

mkdirSync(reportDir, { recursive: true });

const result = spawnSync(
  process.execPath,
  [
    C8_BIN,
    'report',
    '--temp-directory', tempDir,
    '--reporter', 'lcov',
    '--reporter', 'text-summary',
    '--report-dir', reportDir,
    '--include', 'src/**',
    '--exclude', 'src/generated/**',
    '--exclude', 'src/server.ts',
    '--exclude', '**/*.test.ts',
  ],
  { stdio: 'inherit', shell: false },
);

process.exit(result.status ?? 0);
