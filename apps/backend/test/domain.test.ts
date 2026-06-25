import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.js';
import { AdminModel, UserModel } from '../src/models/index.js';
import { hashPassword } from '../src/utils/password.js';
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

/** Minimal typed JSON client carrying the bearer token. */
function client(url: string, token?: string) {
  return async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${url}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, json: (await res.json().catch(() => null)) as never };
  };
}

async function adminToken(url: string): Promise<string> {
  await AdminModel.create({
    mobile: '9000000000',
    passwordHash: await hashPassword('Admin123'),
  });
  const res = await fetch(`${url}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mobile: '9000000000', password: 'Admin123' }),
  });
  return ((await res.json()) as { accessToken: string }).accessToken;
}

describe('domain (M4)', () => {
  let url: string;
  let close: () => void;
  let token: string;

  beforeEach(async () => {
    ({ url, close } = await startApp());
    token = await adminToken(url);
  });

  afterEach(() => close());

  it('derives familySize server-side and ignores client-sent values', async () => {
    const api = client(url, token);
    const unit = await api('POST', '/api/v1/units', { name: 'Signals', code: 'SIG' });
    expect(unit.status).toBe(201);
    const unitId = (unit.json as { unit: { id: string } }).unit.id;

    // Client tries to sneak familySize=99; server must ignore and compute 1+1+2=4.
    const p = await api('POST', '/api/v1/personnel', {
      mobile: '9111111111',
      password: 'Pass123',
      unit: unitId,
      maritalStatus: 'MARRIED',
      spouseMobile: '9222222222',
      numberOfKids: 2,
      familySize: 99,
    });
    expect(p.status).toBe(201);
    expect((p.json as { personnel: { familySize: number } }).personnel.familySize).toBe(4);
  });

  it('rejects allocations whose sum != total capacity, accepts when equal', async () => {
    const api = client(url, token);
    const sig = (await api('POST', '/api/v1/units', { name: 'Signals', code: 'SIG' }))
      .json as { unit: { id: string } };
    const asc = (await api('POST', '/api/v1/units', { name: 'ASC', code: 'ASC' }))
      .json as { unit: { id: string } };

    const movie = await api('POST', '/api/v1/movies', {
      title: 'Top Gun',
      showDate: new Date(Date.now() + 86400000).toISOString(),
      startTime: new Date(Date.now() + 86400000).toISOString(),
      totalSeats: 50,
    });
    const movieId = (movie.json as { movie: { id: string } }).movie.id;

    // Sum = 40 != 50 -> 400.
    const bad = await api('PUT', `/api/v1/seat-allocations/${movieId}`, {
      allocations: [
        { unit: sig.unit.id, allocated: 25 },
        { unit: asc.unit.id, allocated: 15 },
      ],
    });
    expect(bad.status).toBe(400);

    // Sum = 50 == 50 -> ok.
    const ok = await api('PUT', `/api/v1/seat-allocations/${movieId}`, {
      allocations: [
        { unit: sig.unit.id, allocated: 30 },
        { unit: asc.unit.id, allocated: 20 },
      ],
    });
    expect(ok.status).toBe(200);
    expect((ok.json as { allocations: unknown[] }).allocations).toHaveLength(2);
  });

  it('lists upcoming movies but only opens booking within the 1h window', async () => {
    const api = client(url, token);
    const sig = (await api('POST', '/api/v1/units', { name: 'Signals', code: 'SIG' }))
      .json as { unit: { id: string } };

    // Far-future movie — shown to users early, but booking NOT yet open.
    const far = new Date(Date.now() + 5 * 86400000).toISOString();
    await api('POST', '/api/v1/movies', { title: 'Future', startTime: far, totalSeats: 10, status: 'SCHEDULED' });

    // Movie starting in 30 min (inside the 60-min window) — booking open.
    const soon = new Date(Date.now() + 30 * 60000).toISOString();
    await api('POST', '/api/v1/movies', { title: 'Soon', startTime: soon, totalSeats: 10, status: 'SCHEDULED' });

    await UserModel.create({
      mobile: '9333333333', passwordHash: await hashPassword('User123'),
      role: Roles.USER, unit: sig.unit.id,
    });
    const loginRes = await fetch(`${url}/api/v1/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mobile: '9333333333', password: 'User123' }),
    });
    const userToken = ((await loginRes.json()) as { accessToken: string }).accessToken;

    const avail = await client(url, userToken)('GET', '/api/v1/movies/available');
    expect(avail.status).toBe(200);
    const items = (avail.json as { items: { title: string; bookingOpen: boolean }[] }).items;
    const byTitle = Object.fromEntries(items.map((m) => [m.title, m.bookingOpen]));
    // Both are listed; only the imminent one is bookable.
    expect(byTitle).toHaveProperty('Soon', true);
    expect(byTitle).toHaveProperty('Future', false);
  });
});
