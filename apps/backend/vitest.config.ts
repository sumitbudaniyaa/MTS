import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    env: {
      NODE_ENV: 'test',
      JWT_ACCESS_SECRET: 'test-access-secret-test-access-secret-0123456789',
      JWT_REFRESH_SECRET: 'test-refresh-secret-test-refresh-secret-0123456789',
      MONGO_URI: 'mongodb://127.0.0.1:27017/test',
      BCRYPT_ROUNDS: '10',
      COOKIE_SECURE: 'false',
    },
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
    pool: 'forks', // isolate DB state per test file
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
