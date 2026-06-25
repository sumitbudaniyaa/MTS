import { describe, it, expect, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.js';
import { UserModel } from '../src/models/index.js';
import { hashPassword } from '../src/utils/password.js';
import { Roles } from '../src/types/index.js';

/** Spin up the real app on an ephemeral port and return a base URL + closer. */
function startApp(): Promise<{ url: string; close: () => void }> {
  const app = createApp();
  return new Promise((resolve) => {
    const server: Server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close() });
    });
  });
}

const MOBILE = '9876543210';
const PASSWORD = 'Secret123';

async function seedUser(): Promise<void> {
  await UserModel.create({
    mobile: MOBILE,
    passwordHash: await hashPassword(PASSWORD),
    role: Roles.USER,
  });
}

/** Pull the refresh_token value out of a Set-Cookie header. */
function refreshCookie(res: Response): string | null {
  const raw = res.headers.get('set-cookie');
  if (!raw) return null;
  const match = /refresh_token=([^;]+)/.exec(raw);
  return match ? `refresh_token=${match[1]}` : null;
}

describe('auth', () => {
  beforeEach(seedUser);

  it('rejects invalid credentials', async () => {
    const { url, close } = await startApp();
    try {
      const res = await fetch(`${url}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mobile: MOBILE, password: 'wrong-pass' }),
      });
      expect(res.status).toBe(401);
    } finally {
      close();
    }
  });

  it('logs in, returns access token + me, and rotates refresh tokens', async () => {
    const { url, close } = await startApp();
    try {
      const loginRes = await fetch(`${url}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mobile: MOBILE, password: PASSWORD }),
      });
      expect(loginRes.status).toBe(200);
      const { accessToken, user } = (await loginRes.json()) as {
        accessToken: string;
        user: { role: string };
      };
      expect(accessToken).toBeTruthy();
      expect(user.role).toBe(Roles.USER);

      // /me with the access token.
      const meRes = await fetch(`${url}/api/v1/auth/me`, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(meRes.status).toBe(200);

      // Refresh rotation: old cookie -> new cookie + new access token.
      const cookie = refreshCookie(loginRes);
      expect(cookie).toBeTruthy();
      const refreshRes = await fetch(`${url}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { cookie: cookie! },
      });
      expect(refreshRes.status).toBe(200);
      const rotated = refreshCookie(refreshRes);
      expect(rotated).toBeTruthy();
      expect(rotated).not.toEqual(cookie);

      // Rotation is resilient to the reload/two-tab race: reusing the just-rotated token
      // still succeeds (issues a fresh token) rather than logging the user out.
      const raceRes = await fetch(`${url}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { cookie: cookie! },
      });
      expect(raceRes.status).toBe(200);

      // But logout truly invalidates: after logout the refresh token is rejected.
      await fetch(`${url}/api/v1/auth/logout`, {
        method: 'POST',
        headers: { authorization: `Bearer ${accessToken}`, cookie: rotated! },
      });
      const afterLogout = await fetch(`${url}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { cookie: rotated! },
      });
      expect(afterLogout.status).toBe(401);
    } finally {
      close();
    }
  });

  it('blocks /me without a token', async () => {
    const { url, close } = await startApp();
    try {
      const res = await fetch(`${url}/api/v1/auth/me`);
      expect(res.status).toBe(401);
    } finally {
      close();
    }
  });
});
