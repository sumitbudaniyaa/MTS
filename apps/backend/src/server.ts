import type { Server } from 'node:http';
import { createApp } from './app.js';
import { connectDatabase, disconnectDatabase } from './config/db.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { startScheduler, stopScheduler } from './jobs/scheduler.js';
import { initRealtime } from './realtime/gateway.js';

/**
 * Process entry point. Connects the database, starts the HTTP server, and wires
 * graceful shutdown so in-flight requests drain and the DB connection closes cleanly.
 */
async function bootstrap(): Promise<void> {
  await connectDatabase();

  const app = createApp();
  const server: Server = app.listen(env.PORT, () => {
    logger.info(`[server] listening on :${env.PORT} (${env.NODE_ENV})`);
  });

  // Real-time seat map (socket.io) attaches to the same HTTP server.
  initRealtime(server);

  // Background reconciliation: open-pool release + no-show expiry + seat-hold expiry.
  startScheduler();

  setupGracefulShutdown(server);
}

function setupGracefulShutdown(server: Server): void {
  const shutdown = (signal: string) => {
    logger.info(`[server] ${signal} received, shutting down gracefully`);
    stopScheduler();
    server.close(() => {
      void disconnectDatabase().finally(() => {
        logger.info('[server] shutdown complete');
        process.exit(0);
      });
    });
    // Hard stop if draining hangs.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, '[server] unhandled rejection');
  });
  process.on('uncaughtException', (err) => {
    logger.error({ err }, '[server] uncaught exception — exiting');
    process.exit(1);
  });
}

bootstrap().catch((err) => {
  logger.error({ err }, '[server] failed to start');
  process.exit(1);
});
