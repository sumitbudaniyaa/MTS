import { describe, it, expect, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.js';
import { AdminModel, MovieModel } from '../src/models/index.js';
import { hashPassword } from '../src/utils/password.js';
import { loadSettings, settings } from '../src/config/settings.js';
import { isMovieVisible } from '../src/models/movie.model.js';
import { Roles } from '../src/types/index.js';

function startApp(): Promise<{ url: string; close: () => void }> {
  const app = createApp();
  return new Promise((resolve) => {
    const server: Server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close() });
    });
  });
}

const PASSWORD = 'Admin123';

async function tokens(url: string): Promise<{ admin: string; superAdmin: string }> {
  await AdminModel.create({
    mobile: '9100000001',
    passwordHash: await hashPassword(PASSWORD),
    role: Roles.ADMIN,
  });
  await AdminModel.create({
    mobile: '9100000002',
    passwordHash: await hashPassword(PASSWORD),
    role: Roles.SUPER_ADMIN,
  });
  const login = async (mobile: string): Promise<string> => {
    const res = await fetch(`${url}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mobile, password: PASSWORD, role: Roles.ADMIN }),
    });
    return ((await res.json()) as { accessToken: string }).accessToken;
  };
  return { admin: await login('9100000001'), superAdmin: await login('9100000002') };
}

describe('runtime settings', () => {
  beforeEach(async () => {
    await loadSettings(); // recreate the singleton wiped by the shared afterEach
  });

  it('lets an operational admin change timings, and applies them immediately', async () => {
    const { url, close } = await startApp();
    try {
      const { admin } = await tokens(url);

      const before = await fetch(`${url}/api/v1/settings`, {
        headers: { authorization: `Bearer ${admin}` },
      });
      expect(before.status).toBe(200);

      // A partial patch is the normal case — and the one that used to collide with the
      // insert-time seed and fail with a Mongo path conflict.
      const res = await fetch(`${url}/api/v1/settings`, {
        method: 'PATCH',
        headers: { authorization: `Bearer ${admin}`, 'content-type': 'application/json' },
        body: JSON.stringify({ noShowGraceMinutes: 25 }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { settings: { noShowGraceMinutes: number } };
      expect(body.settings.noShowGraceMinutes).toBe(25);

      // Applied to the live cache that the hot paths read, not just persisted.
      expect(settings().noShowGraceMinutes).toBe(25);
    } finally {
      close();
    }
  });

  it('changes the booking window that isMovieVisible enforces', async () => {
    const { url, close } = await startApp();
    try {
      const { admin } = await tokens(url);
      // Starts in 90 minutes: outside the default 60-minute lead.
      const movie = await MovieModel.create({
        title: 'Lead',
        showDate: new Date(Date.now() + 90 * 60_000),
        startTime: new Date(Date.now() + 90 * 60_000),
        totalSeats: 10,
      });
      expect(isMovieVisible(movie)).toBe(false);

      await fetch(`${url}/api/v1/settings`, {
        method: 'PATCH',
        headers: { authorization: `Bearer ${admin}`, 'content-type': 'application/json' },
        body: JSON.stringify({ visibilityLeadMinutes: 120 }),
      });

      // Booking now opens two hours out, so the same movie is bookable.
      expect(isMovieVisible(movie)).toBe(true);
    } finally {
      close();
    }
  });

  it('is read-only for a super admin and rejects out-of-range values', async () => {
    const { url, close } = await startApp();
    try {
      const { admin, superAdmin } = await tokens(url);

      // Super admins may look…
      const read = await fetch(`${url}/api/v1/settings`, {
        headers: { authorization: `Bearer ${superAdmin}` },
      });
      expect(read.status).toBe(200);

      // …but not touch: these are operational knobs, like movies and the auditorium.
      const write = await fetch(`${url}/api/v1/settings`, {
        method: 'PATCH',
        headers: { authorization: `Bearer ${superAdmin}`, 'content-type': 'application/json' },
        body: JSON.stringify({ noShowGraceMinutes: 30 }),
      });
      expect(write.status).toBe(403);

      // Bounds are enforced server-side regardless of what the form allows.
      const bad = await fetch(`${url}/api/v1/settings`, {
        method: 'PATCH',
        headers: { authorization: `Bearer ${admin}`, 'content-type': 'application/json' },
        body: JSON.stringify({ seatHoldSeconds: 0 }),
      });
      expect(bad.status).toBe(400);

      // And an unauthenticated caller gets nothing.
      const anon = await fetch(`${url}/api/v1/settings`);
      expect(anon.status).toBe(401);
    } finally {
      close();
    }
  });
});
