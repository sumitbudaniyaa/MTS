import { describe, it, expect } from 'vitest';
import { UnitModel, UserModel } from '../src/models/index.js';
import { hashPassword } from '../src/utils/password.js';
import { blindIndex, isCiphertext } from '../src/utils/fieldCrypto.js';
import { MaritalStatus } from '../src/constants/enums.js';
import { Roles } from '../src/types/index.js';

describe('at-rest field encryption', () => {
  it('stores mobile + spouse mobile as ciphertext with blind indexes, but reads back plaintext', async () => {
    const unit = await UnitModel.create({ name: 'Signals' });
    await UserModel.create({
      mobile: '9876500001',
      passwordHash: await hashPassword('Secret123'),
      role: Roles.USER,
      unit: unit._id,
      maritalStatus: MaritalStatus.MARRIED,
      spouseMobile: '9876500002',
    });

    // RAW document (bypasses getters) — what actually lives in MongoDB.
    const raw = await UserModel.collection.findOne<{
      mobile: string;
      spouseMobile: string;
      mobileHash: string;
      spouseMobileHash: string;
    }>({ mobileHash: blindIndex('9876500001') });

    expect(raw).toBeTruthy();
    expect(isCiphertext(raw!.mobile)).toBe(true); // not the plaintext number
    expect(raw!.mobile).not.toContain('9876500001');
    expect(isCiphertext(raw!.spouseMobile)).toBe(true);
    expect(raw!.mobileHash).toBe(blindIndex('9876500001'));
    expect(raw!.spouseMobileHash).toBe(blindIndex('9876500002'));

    // Through the model, the getter transparently decrypts.
    const doc = await UserModel.findOne({ mobileHash: blindIndex('9876500001') });
    expect(doc?.mobile).toBe('9876500001');
    expect(doc?.spouseMobile).toBe('9876500002');
    // Serialized output is plaintext and never leaks the blind index.
    const json = doc!.toJSON() as Record<string, unknown>;
    expect(json.mobile).toBe('9876500001');
    expect(json.mobileHash).toBeUndefined();
  });

  it('stores unit name encrypted and enforces uniqueness on its blind index', async () => {
    await UnitModel.create({ name: 'Engineers' });
    const raw = await UnitModel.collection.findOne<{ name: string; nameHash: string }>({
      nameHash: blindIndex('Engineers'),
    });
    expect(isCiphertext(raw!.name)).toBe(true);
    expect(raw!.name).not.toContain('Engineers');

    // Duplicate name is blocked by the unique blind index.
    await expect(UnitModel.create({ name: 'Engineers' })).rejects.toMatchObject({ code: 11000 });
  });
});
