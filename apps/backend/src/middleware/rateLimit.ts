import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';
import { isTest } from '../config/env.js';

/**
 * Per-bucket rate limiters for abuse protection. Disabled under NODE_ENV=test so the
 * suite isn't throttled. Each bucket has its own window/limit tuned to the threat.
 */
function makeLimiter(windowMs: number, max: number, code: string): RateLimitRequestHandler {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => isTest, // never throttle the test suite
    message: { error: { code, message: 'Too many requests, please try again later.' } },
  });
}

/** Global baseline limiter applied to the whole API. */
export const globalLimiter = makeLimiter(15 * 60_000, 1_000, 'RATE_LIMITED');

/** Login is the most attacked surface — tight window. */
export const loginLimiter = makeLimiter(15 * 60_000, 10, 'LOGIN_RATE_LIMITED');

/** Booking writes — prevents rapid-fire booking abuse. */
export const bookingLimiter = makeLimiter(60_000, 20, 'BOOKING_RATE_LIMITED');

/** Scanner verification — high but bounded for door throughput. */
export const scannerLimiter = makeLimiter(60_000, 120, 'SCANNER_RATE_LIMITED');
