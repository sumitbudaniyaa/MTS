import type { Request } from 'express';
import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';
import { isTest } from '../config/env.js';

type KeyFn = (req: Request) => string;

/**
 * Per-bucket rate limiters for abuse protection. Disabled under NODE_ENV=test so the
 * suite isn't throttled. Each bucket has its own window/limit tuned to the threat.
 *
 * `keyGenerator` lets a limiter throttle per-identity (mobile / account) instead of per-IP.
 * That matters on shared-NAT networks (e.g. a base behind one gateway IP): IP-keyed limits
 * would lock everyone out at once, and let an attacker rotate IPs to bypass.
 */
function makeLimiter(
  windowMs: number,
  max: number,
  code: string,
  keyGenerator?: KeyFn,
): RateLimitRequestHandler {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => isTest, // never throttle the test suite
    // `validate: false` silences express-rate-limit's dev-time config warnings for our custom
    // (non-IP) keyGenerator; the limiter behaviour itself is unaffected.
    ...(keyGenerator ? { keyGenerator, validate: false } : {}),
    message: { error: { code, message: 'Too many requests, please try again later.' } },
  });
}

/** Global baseline limiter applied to the whole API (per-IP). */
export const globalLimiter = makeLimiter(15 * 60_000, 1_000, 'RATE_LIMITED');

/**
 * Login is the most attacked surface — keyed by the **target mobile** so brute-forcing one
 * account is capped without locking out everyone sharing an IP. Cross-account spraying is
 * still bounded by the global per-IP limiter.
 */
export const loginLimiter = makeLimiter(
  15 * 60_000,
  10,
  'LOGIN_RATE_LIMITED',
  (req) => `login:${String((req.body as { mobile?: string })?.mobile ?? req.ip ?? 'unknown')}`,
);

/** Booking writes — keyed by the authenticated **user** so one busy user can't throttle others. */
export const bookingLimiter = makeLimiter(
  60_000,
  20,
  'BOOKING_RATE_LIMITED',
  (req) => `book:${req.principal?.sub ?? req.ip ?? 'unknown'}`,
);

/** Scanner verification — high but bounded for door throughput (per scanner operator). */
export const scannerLimiter = makeLimiter(
  60_000,
  120,
  'SCANNER_RATE_LIMITED',
  (req) => `scan:${req.principal?.sub ?? req.ip ?? 'unknown'}`,
);
