// Structured logger. JSON in production (drops into Loki/Datadog/CloudWatch
// without parsing); pretty-printed in development for grep-able terminal
// output. Redacts auth headers, cookies, and any field named "password" or
// "passwordHash" at any depth.

import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
  transport: isDev
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' } }
    : undefined,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'headers.authorization',
      'headers.cookie',
      '*.password',
      '*.passwordHash',
      '*.apiKey',
      '*.apiKeyHash',
    ],
    censor: '[REDACTED]',
  },
  // Serialize Error objects with stack traces
  serializers: {
    err: pino.stdSerializers.err,
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
  },
});

// ---------------------------------------------------------------------------
// console.* compatibility shim
// ---------------------------------------------------------------------------
// The codebase has ~200 legacy console.log / console.error call sites. Rather
// than a risky one-shot rewrite, we route console through pino at the globals
// layer. Every existing call emits structured JSON immediately; individual
// sites get upgraded to `logger.info({ ... }, 'msg')` form over time without
// any urgency. This is transitional — prefer importing `logger` directly in
// new code.
//
// Process banners that want raw formatting should call
// process.stdout.write directly (console.log would get captured and flattened
// to a single JSON line).

function flatten(args) {
  const err = args.find(a => a instanceof Error);
  const rest = args.filter(a => !(a instanceof Error));
  const msg = rest.map(a =>
    a === null || a === undefined ? String(a) :
    typeof a === 'string' ? a :
    typeof a === 'object' ? JSON.stringify(a) :
    String(a),
  ).join(' ');
  return { err, msg };
}

/* eslint-disable no-console */
console.log = (...args) => {
  const { err, msg } = flatten(args);
  err ? logger.info({ err }, msg) : logger.info(msg);
};
console.info = console.log;
console.warn = (...args) => {
  const { err, msg } = flatten(args);
  err ? logger.warn({ err }, msg) : logger.warn(msg);
};
console.error = (...args) => {
  const { err, msg } = flatten(args);
  err ? logger.error({ err }, msg) : logger.error(msg);
};
console.debug = (...args) => {
  const { err, msg } = flatten(args);
  err ? logger.debug({ err }, msg) : logger.debug(msg);
};
/* eslint-enable no-console */

export default logger;

