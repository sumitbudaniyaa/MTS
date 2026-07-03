import express, { type Express, type Request, type Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import mongoSanitize from 'express-mongo-sanitize';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { globalLimiter } from './middleware/rateLimit.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { ApiError } from './utils/apiError.js';
import { apiRouter } from './routes.js';

/**
 * Builds the Express application with the enterprise security pipeline:
 * helmet -> cors(whitelist) -> compression -> body parsing(size-limited) ->
 * cookie parsing -> mongo sanitize -> global rate limit -> routes -> 404 -> error handler.
 */
export function createApp(): Express {
  const app = express();

  // Behind a reverse proxy / load balancer (PM2, nginx): trust the first hop so client
  // IPs (used by rate limiters and audit logs) are accurate.
  app.set('trust proxy', 1);

  app.use(
    pinoHttp({
      logger,
      // Compact request log in EVERY environment — only method/url/status, never headers or
      // bodies. This guarantees bearer tokens and the refresh cookie are never written to logs
      // (the default pino-http serializers dump full req/res headers, which include them).
      serializers: {
        req: (req) => ({ method: req.method, url: req.url }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
      // Silence OPTIONS (CORS preflight) and health checks.
      autoLogging: {
        ignore: (req) =>
          req.method === 'OPTIONS' || req.url === '/health',
      },
    }),
  );

  // Secure headers.
  app.use(helmet());

  // CORS whitelist — only configured web-app origins, with credentials for cookies.
  app.use(
    cors({
      origin(origin, callback) {
        // Allow same-origin / server-to-server (no Origin header) and whitelisted origins.
        if (!origin || env.CORS_ORIGINS.includes(origin)) return callback(null, true);
        return callback(new ApiError(403, 'CORS_DENIED', `Origin not allowed: ${origin}`));
      },
      credentials: true,
    }),
  );

  app.use(compression());

  // Size-limited body parsing to blunt large-payload DoS.
  // 8mb accommodates base64 movie posters; everything else is far smaller.
  app.use(express.json({ limit: '8mb' }));
  app.use(express.urlencoded({ extended: true, limit: '8mb' }));
  app.use(cookieParser());

  // Strip `$`/`.` operators from user input to prevent NoSQL injection.
  app.use(mongoSanitize());

  // Baseline rate limit across the whole API (per-route tighter limits added per module).
  app.use(globalLimiter);

  // Liveness/health probe (unauthenticated by design).
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
  });

  app.use('/api/v1', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
