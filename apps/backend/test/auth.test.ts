import { describe, it, expect, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.js';
import { UserModel, RefreshTokenModel, ScannerModel } from '../src/models/index.js';
import { hashPassword } from '../src/utils/password.js';
import { hashRefreshToken } from '../src/utils/jwt.js';
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

/** Pull an app's refresh cookie (refresh_token_user / _admin / _scanner) out of Set-Cookie. */
function refreshCookie(res: Response, app: 'user' | 'admin' | 'scanner' = 'user'): string | null {
  const raw = res.headers.get('set-cookie');
  if (!raw) return null;
  const name = `refresh_token_${app}`;
  const match = new RegExp(`${name}=([^;]+)`).exec(raw);
  return match ? `${name}=${match[1]}` : null;
}

/** POST /auth/refresh the way the real apps do: cookie + the calling app's audience. */
function postRefresh(url: string, cookie: string, role = Roles.USER): Promise<Response> {
  return fetch(`${url}/api/v1/auth/refresh`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ role }),
  });
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
      const refreshRes = await postRefresh(url, cookie!);
      expect(refreshRes.status).toBe(200);
      const rotated = refreshCookie(refreshRes);
      expect(rotated).toBeTruthy();
      expect(rotated).not.toEqual(cookie);

      // Rotation is resilient to the reload/two-tab race: reusing the just-rotated token
      // still succeeds (issues a fresh token) rather than logging the user out.
      const raceRes = await postRefresh(url, cookie!);
      expect(raceRes.status).toBe(200);

      // But logout truly invalidates: after logout the refresh token is rejected.
      await fetch(`${url}/api/v1/auth/logout`, {
        method: 'POST',
        headers: { authorization: `Bearer ${accessToken}`, cookie: rotated! },
      });
      const afterLogout = await postRefresh(url, rotated!);
      expect(afterLogout.status).toBe(401);
    } finally {
      close();
    }
  });

  it('detects refresh-token reuse after the grace window and revokes the whole family', async () => {
    const { url, close } = await startApp();
    try {
      const loginRes = await fetch(`${url}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mobile: MOBILE, password: PASSWORD }),
      });
      const t0 = refreshCookie(loginRes)!; // "refresh_token_user=<raw>"
      const t0raw = t0.split('=')[1]!;

      // Rotate once: T0 -> T1.
      const rotate = await postRefresh(url, t0);
      expect(rotate.status).toBe(200);
      const t1 = refreshCookie(rotate)!;

      // Age T0's rotation past the grace window so re-presenting it looks like a leaked replay.
      await RefreshTokenModel.updateOne(
        { tokenHash: hashRefreshToken(t0raw) },
        { $set: { revokedAt: new Date(Date.now() - 60_000) } },
      );

      // Reusing the old token is now rejected as reuse…
      const reuse = await postRefresh(url, t0);
      expect(reuse.status).toBe(401);

      // …and the whole family is killed, so even the good successor T1 no longer works.
      const successor = await postRefresh(url, t1);
      expect(successor.status).toBe(401);
    } finally {
      close();
    }
  });

  it('revokes the session on logout even when the access token has expired', async () => {
    const { url, close } = await startApp();
    try {
      const loginRes = await fetch(`${url}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mobile: MOBILE, password: PASSWORD, role: Roles.USER }),
      });
      const cookie = refreshCookie(loginRes)!;

      // No Authorization header at all — the same situation as an idle tab whose 15-minute
      // access token lapsed. Previously this 401'd, the UI cleared, and the refresh family
      // stayed alive server-side for its full 7-day lifetime.
      const out = await fetch(`${url}/api/v1/auth/logout`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ role: Roles.USER }),
      });
      expect(out.status).toBe(200);

      // The session is genuinely dead, not just forgotten by the client.
      const after = await postRefresh(url, cookie);
      expect(after.status).toBe(401);
    } finally {
      close();
    }
  });

  it('keeps each app’s session independent (per-app refresh cookies)', async () => {
    const { url, close } = await startApp();
    try {
      await ScannerModel.create({
        mobile: '9000000001',
        passwordHash: await hashPassword(PASSWORD),
        role: Roles.SCANNER,
      });

      const userLogin = await fetch(`${url}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mobile: MOBILE, password: PASSWORD, role: Roles.USER }),
      });
      const userCookie = refreshCookie(userLogin, 'user')!;

      // Signing into the scanner app must NOT evict the user app's cookie — they are
      // different names, so both live in the shared jar side by side.
      const scannerLogin = await fetch(`${url}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mobile: '9000000001', password: PASSWORD, role: Roles.SCANNER }),
      });
      const scannerCookie = refreshCookie(scannerLogin, 'scanner')!;
      expect(scannerCookie).toBeTruthy();

      // Reloading the user app after that still returns the USER (previously it rotated the
      // scanner's token, got role SCANNER, and the client logged itself out).
      const bothCookies = `${userCookie}; ${scannerCookie}`;
      const reload = await postRefresh(url, bothCookies, Roles.USER);
      expect(reload.status).toBe(200);
      expect(((await reload.json()) as { user: { role: string } }).user.role).toBe(Roles.USER);

      // And a token presented by the wrong app is refused outright.
      const crossApp = await postRefresh(url, scannerCookie, Roles.USER);
      expect(crossApp.status).toBe(401);
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
