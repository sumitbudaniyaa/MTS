import { afterAll, afterEach, beforeAll } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
// Registers every model so their indexes can be built up front (see beforeAll).
import '../src/models/index.js';

/**
 * Shared test harness. Boots an in-memory MongoDB **replica set** (required for multi-doc
 * transactions used by the booking engine) before the suite, clears all collections
 * between tests for isolation, and tears everything down afterwards.
 */
let replSet: MongoMemoryReplSet;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  process.env.MONGO_URI = replSet.getUri();
  await mongoose.connect(process.env.MONGO_URI, { directConnection: true });
  // Index builds are asynchronous. Wait for them before any test runs, otherwise a
  // uniqueness assertion can race a half-built index and see the duplicate succeed.
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
});

afterEach(async () => {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
});

afterAll(async () => {
  await mongoose.disconnect();
  await replSet.stop();
});
