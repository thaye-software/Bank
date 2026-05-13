#!/usr/bin/env node
// Converts a directory of raw V8 coverage files (written by a Node process
// that ran with NODE_V8_COVERAGE=<dir>) into an LCOV report. Used by the
// E2E CI job, where the Express server is started with NODE_V8_COVERAGE,
// runs Playwright browser tests, then receives SIGTERM so V8 flushes its
// coverage. This script then post-processes the raw output.
//
// Usage:
//   node scripts/c8-report.mjs <tempDir> <reportDir>

import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

const [tempDirArg, reportDirArg] = process.argv.slice(2);

if (!tempDirArg || !reportDirArg) {
  console.error('Usage: c8-report.mjs <tempDir> <reportDir>');
  process.exit(2);
}

const tempDir = resolve(tempDirArg);
const reportDir = resolve(reportDirArg);

mkdirSync(reportDir, { recursive: true });

const result = spawnSync(
  'npx',
  [
    'c8',
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
  { stdio: 'inherit', shell: true },
);

process.exit(result.status ?? 0);
