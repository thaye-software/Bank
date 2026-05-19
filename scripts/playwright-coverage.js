#!/usr/bin/env node
// Runs Playwright with NODE_V8_COVERAGE so the spawned test worker(s) — which
// host an in-process Express app for api-integration tests — emit raw V8
// coverage to a temp directory. After Playwright exits, `c8 report` converts
// those raw v8 files into an LCOV report that SonarQube can ingest.
//
// IMPORTANT: c8 is invoked with `shell: false` and a resolved binary path.
// Using `shell: true` causes bash to glob-expand the --include/--exclude
// patterns (e.g. `src/**` → `src/app.ts src/config src/controllers …`)
// BEFORE c8 sees them, which silently filters out everything except the
// first matched file. See the lcov output of an earlier broken run for the
// symptom.
//
// Usage:
//   node scripts/playwright-coverage.js <tempDir> <reportDir> -- <playwright args>
//
// Example:
//   node scripts/playwright-coverage.js \
//     coverage/raw-api coverage/playwright-api -- --project=api-integration

import { spawnSync } from 'node:child_process';
import { rmSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import process from 'node:process';

const require = createRequire(import.meta.url);
const C8_BIN = require.resolve('c8/bin/c8.js');

const args = process.argv.slice(2);
const sepIndex = args.indexOf('--');
const positional = sepIndex === -1 ? args : args.slice(0, sepIndex);
const playwrightArgs = sepIndex === -1 ? [] : args.slice(sepIndex + 1);

if (positional.length < 2) {
  console.error('Usage: playwright-coverage.js <tempDir> <reportDir> -- <playwright args>');
  process.exit(2);
}

const [tempDirArg, reportDirArg] = positional;
const tempDir = resolve(tempDirArg);
const reportDir = resolve(reportDirArg);

rmSync(tempDir, { recursive: true, force: true });
mkdirSync(tempDir, { recursive: true });
mkdirSync(reportDir, { recursive: true });

// Playwright is invoked through npx + shell on purpose: it accepts no glob
// args, and `shell: true` is what lets npx resolve to npx.cmd on Windows.
// (Modern Node refuses to spawn .cmd files without a shell.)
// The NODE_V8_COVERAGE env var is inherited by every spawned worker.
const playwright = spawnSync(
  'npx',
  ['playwright', 'test', ...playwrightArgs],
  {
    stdio: 'inherit',
    env: { ...process.env, NODE_V8_COVERAGE: tempDir },
    shell: true,
  },
);

// c8 must NOT go through a shell — args contain glob patterns the shell
// would expand before c8 sees them.
const report = spawnSync(
  process.execPath,
  [
    C8_BIN,
    'report',
    '--temp-directory', tempDir,
    '--reporter', 'lcov',
    '--reporter', 'text',
    '--reporter', 'text-summary',
    '--report-dir', reportDir,
    '--include', 'src/**',
    '--exclude', 'src/generated/**',
    '--exclude', 'src/server.ts',
    '--exclude', 'src/config/**',
    '--exclude', '**/*.test.ts',
  ],
  { stdio: 'inherit', shell: false },
);

process.exit(playwright.status ?? report.status ?? 0);
