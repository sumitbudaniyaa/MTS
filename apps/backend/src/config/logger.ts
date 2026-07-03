import { pino } from 'pino';
import { env, isProd } from './env.js';

/**
 * Structured logger. Pretty in dev, JSON in prod (for log shippers).
 * Redacts sensitive fields so secrets/tokens never reach logs.
 */
export const logger = pino({
  level: env.NODE_ENV === 'test' ? 'silent' : isProd ? 'info' : 'debug',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      'password',
      'passwordHash',
      'token',
      'refreshToken',
      'accessToken',
    ],
    censor: '[redacted]',
  },
  transport: isProd
    ? undefined
    : { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } },
});
