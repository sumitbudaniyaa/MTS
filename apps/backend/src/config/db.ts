import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from './logger.js';

/**
 * Mongoose connection management.
 * Strict query mode; index build is enabled (dev) but should be managed via migrations
 * in production. Connection lifecycle events are logged for observability.
 */
mongoose.set('strictQuery', true);

export async function connectDatabase(uri: string = env.MONGO_URI): Promise<typeof mongoose> {
  mongoose.connection.on('connected', () => logger.info('[db] connected'));
  mongoose.connection.on('disconnected', () => logger.warn('[db] disconnected'));
  mongoose.connection.on('error', (err) => logger.error({ err }, '[db] connection error'));

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10_000,
    autoIndex: env.NODE_ENV !== 'production',
  });
  return mongoose;
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}
