#!/usr/bin/env node
// Runs Playwright with NODE_V8_COVERAGE so the spawned test worker(s) — which
// host an in-process Express app for api-integration tests — emit raw V8
// coverage to a temp directory. After Playwright exits, `c8 report` converts
// those raw v8 files into an LCOV report that SonarQube can ingest.
//
// Usage:
//   node scripts/playwright-coverage.mjs <tempDir> <reportDir> -- <playwright args>
//
// Example:
//   node scripts/playwright-coverage.mjs \
//     coverage/raw-api coverage/playwright-api -- --project=api-integration

import { spawnSync } from 'node:child_process';
import { rmSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

const args = process.argv.slice(2);
const sepIndex = args.indexOf('--');
const positional = sepIndex === -1 ? args : args.slice(0, sepIndex);
const playwrightArgs = sepIndex === -1 ? [] : args.slice(sepIndex + 1);

if (positional.length < 2) {
  console.error('Usage: playwright-coverage.mjs <tempDir> <reportDir> -- <playwright args>');
  process.exit(2);
}

const [tempDirArg, reportDirArg] = positional;
const tempDir = resolve(tempDirArg);
const reportDir = resolve(reportDirArg);

rmSync(tempDir, { recursive: true, force: true });
mkdirSync(tempDir, { recursive: true });
mkdirSync(reportDir, { recursive: true });

const playwright = spawnSync('npx', ['playwright', 'test', ...playwrightArgs], {
  stdio: 'inherit',
  env: { ...process.env, NODE_V8_COVERAGE: tempDir },
  shell: true,
});

const report = spawnSync(
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

process.exit(playwright.status ?? report.status ?? 0);
