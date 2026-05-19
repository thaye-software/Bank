import pino, { type StreamEntry } from 'pino';
import pretty from 'pino-pretty';

const isTest = process.env['NODE_ENV'] === 'test';
const isDev = process.env['NODE_ENV'] === 'development';

// Route `error` and above to stderr in addition to stdout, so process
// supervisors / log collectors (e.g. the stress-test wrapper that splits
// server.log vs server.err.log) can isolate errors without parsing JSON.
const streams: StreamEntry[] = isDev
  ? [
      { level: 'info', stream: pretty({ colorize: true, destination: 1 }) },
      { level: 'error', stream: pretty({ colorize: true, destination: 2 }) },
    ]
  : [
      { level: 'info', stream: process.stdout },
      { level: 'error', stream: process.stderr },
    ];

export const logger = pino(
  { level: isTest ? 'silent' : 'info' },
  pino.multistream(streams),
);
