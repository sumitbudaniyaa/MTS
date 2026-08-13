import { describe, it, expect } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.js';
import { UnitModel, UserModel } from '../src/models/index.js';
import { hashPassword } from '../src/utils/password.js';
import { Roles } from '../src/types/index.js';
import { MaritalStatus } from '../src/constants/enums.js';

function startApp(): Promise<{ url: string; close: () => void }> {
  const app = createApp();
  return new Promise((resolve) => {
    const server: Server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close() });
    });
  });
}

async function loginJson(url: string, mobile: string, password: string) {
  const res = await fetch(`${url}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mobile, password }),
  });
  return {
    status: res.status,
    body: (await res.json().catch(() => null)) as { user?: { id: string } },
  };
}

describe('spouse dual-credential login (shared password)', () => {
  it('lets the member and spouse log in to the same account with the same password', async () => {
    const unit = await UnitModel.create({ name: 'Signals' });
    const user = await UserModel.create({
      mobile: '9000000001',
      passwordHash: await hashPassword('FamilyPass1'),
      role: Roles.USER,
      unit: unit._id,
      maritalStatus: MaritalStatus.MARRIED,
      spouseMobile: '9000000002',
      numberOfKids: 1,
    });

    const { url, close } = await startApp();
    try {
      const primary = await loginJson(url, '9000000001', 'FamilyPass1');
      expect(primary.status).toBe(200);
      expect(primary.body.user?.id).toBe(user.id);

      // Spouse: own mobile, SAME password -> same account id.
      const spouse = await loginJson(url, '9000000002', 'FamilyPass1');
      expect(spouse.status).toBe(200);
      expect(spouse.body.user?.id).toBe(user.id);

      // Wrong password rejected.
      const bad = await loginJson(url, '9000000002', 'wrongpass');
      expect(bad.status).toBe(401);
    } finally {
      close();
    }
  });

  it('lets the spouse log in using spouseUsername in username-mode units', async () => {
    const unit = await UnitModel.create({ name: 'Engineers', loginMode: 'USERNAME' });
    const user = await UserModel.create({
      mobile: 'u_test_123',
      username: 'member123',
      passwordHash: await hashPassword('Pass@2026'),
      role: Roles.USER,
      unit: unit._id,
      maritalStatus: MaritalStatus.MARRIED,
      spouseUsername: 'spouse123',
      numberOfKids: 0,
    });

    const { url, close } = await startApp();
    try {
      const primary = await loginJson(url, 'member123', 'Pass@2026');
      expect(primary.status).toBe(200);
      expect(primary.body.user?.id).toBe(user.id);

      // Spouse: spouseUsername + same password -> same account id.
      const spouse = await loginJson(url, 'spouse123', 'Pass@2026');
      expect(spouse.status).toBe(200);
      expect(spouse.body.user?.id).toBe(user.id);
    } finally {
      close();
    }
  });
});
