#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdirSync, createWriteStream } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { basename } from 'node:path';

const args = parseArgs(process.argv.slice(2));
const plan = args.plan ?? 'tests/stress/jmeter/stress/withdraw-contention.stress.jmx';
const port = Number(args.port ?? 3000);

const testName  = basename(plan, '.jmx');
const stamp     = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
const reportDir = `tests/stress/reports/${testName}-${stamp}`;
const jtlFile   = `${reportDir}/results.jtl`;
const serverLog = `${reportDir}/server.log`;
const serverErr = `${reportDir}/server.err.log`;

mkdirSync(reportDir, { recursive: true });

let serverProc = null;
const cleanup = () => {
  if (serverProc && !serverProc.killed) {
    console.log(`\nStopping server (PID ${serverProc.pid})...`);
    serverProc.kill();
  }
};
process.on('SIGINT', () => { cleanup(); process.exit(130); });
process.on('SIGTERM', () => { cleanup(); process.exit(143); });

try {
  await step('1/5  Ensuring Postgres is up (docker compose)',
    () => run('docker', ['compose', 'up', '-d', '--wait', 'postgres']));

  await step('2/5  Building production server',
    () => run('npm', ['run', 'build:server']));

  await step('3/5  Starting prod build with NODE_ENV=development', startServer);

  await step('4/5  Seeding stress data',
    () => run('npx', ['tsx', 'tests/stress/scripts/seed.ts']));

  await step(`5/5  Running JMeter — ${plan}`,
    () => run('jmeter', ['-n', '-t', plan, '-l', jtlFile, '-e', '-o', `${reportDir}/html`]));

  console.log('\n=== DONE ===');
  console.log(`  HTML report : ${reportDir}/html/index.html`);
  console.log(`  Raw JTL     : ${jtlFile}`);
  console.log(`  Server log  : ${serverLog}`);
} catch (e) {
  console.error('\nFAILED:', e.message);
  process.exitCode = 1;
} finally {
  cleanup();
  await sleep(500);
}

async function step(label, fn) {
  console.log(`\n=== ${label} ===`);
  await fn();
}

// `shell: true` is required on Windows so npm/npx/docker/jmeter (.cmd / .bat
// shims) resolve via PATHEXT. On Unix it's a harmless no-op.
function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'inherit', shell: true, ...opts });
    p.on('error', reject);
    p.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`)));
  });
}

async function startServer() {
  const out = createWriteStream(serverLog, { flags: 'a' });
  const err = createWriteStream(serverErr, { flags: 'a' });
  serverProc = spawn('node', ['./dist/src/server.js'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_ENV: 'development' },
  });
  serverProc.stdout.pipe(out);
  serverProc.stderr.pipe(err);
  serverProc.on('exit', (code) => {
    if (code !== null && code !== 0) console.error(`Server exited unexpectedly (code ${code}). See ${serverLog}`);
  });

  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(`http://localhost:${port}/health`);
      if (r.ok) { console.log(`  Server ready (PID ${serverProc.pid}).`); return; }
    } catch { /* not up yet */ }
    await sleep(1000);
  }
  throw new Error(`Server did not respond on :${port} within 30s. See ${serverLog}`);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      const val = next && !next.startsWith('--') ? argv[++i] : 'true';
      out[key] = val;
    }
  }
  return out;
}
