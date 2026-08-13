import { AdminModel, ScannerModel, UserModel } from '../../models/index.js';
import { Roles, type Role } from '../../types/index.js';
import { blindIndex } from '../../utils/fieldCrypto.js';

/**
 * Accounts are split across three collections (`admins`, `scanners`, `users`). This service
 * is the single place that knows how to resolve an account by mobile or by id+role, so the
 * rest of the auth flow stays collection-agnostic.
 */

export interface Account {
  id: string;
  mobile: string;
  name: string;
  role: Role;
  unit: string | null; // personnel (USER) only
  active: boolean;
  failedLoginCount: number;
  lockedUntil: Date | null;
  passwordHash?: string; // present only when explicitly selected
  touchLogin: () => Promise<void>;
  recordFailedLogin: () => Promise<{ failedCount: number; lockedUntil: Date | null }>;
  resetLockout: () => Promise<void>;
}

/** Mongoose model name backing a role (used for audit refPath). */
export function modelNameForRole(role: Role): 'Admin' | 'Scanner' | 'User' {
  if (role === Roles.ADMIN || role === Roles.SUPER_ADMIN) return 'Admin';
  if (role === Roles.SCANNER) return 'Scanner';
  return 'User';
}

/** Both admin tiers live in the `admins` collection. */
function isAdminRole(role: Role): boolean {
  return role === Roles.ADMIN || role === Roles.SUPER_ADMIN;
}

interface AccountDocLike {
  id?: string;
  _id?: unknown;
  mobile: string;
  name?: string;
  active: boolean;
  passwordHash?: string;
  unit?: unknown;
  lastLoginAt?: Date | null;
  failedLoginCount?: number;
  lockedUntil?: Date | null;
  save: () => Promise<unknown>;
}

function toAccount(doc: AccountDocLike, role: Role, overrideMobile?: string): Account {
  return {
    id: doc.id ?? String(doc._id),
    mobile: overrideMobile ?? doc.mobile,
    name: doc.name ?? '',
    role,
    unit: role === Roles.USER && doc.unit ? String(doc.unit) : null,
    active: doc.active,
    failedLoginCount: doc.failedLoginCount ?? 0,
    lockedUntil: doc.lockedUntil ?? null,
    passwordHash: doc.passwordHash,
    touchLogin: async () => {
      doc.lastLoginAt = new Date();
      doc.failedLoginCount = 0;
      doc.lockedUntil = null;
      await doc.save();
    },
    recordFailedLogin: async () => {
      const nextCount = (doc.failedLoginCount ?? 0) + 1;
      doc.failedLoginCount = nextCount;
      if (nextCount >= 5) {
        doc.lockedUntil = new Date(Date.now() + 15 * 60_000);
      }
      await doc.save();
      return { failedCount: nextCount, lockedUntil: doc.lockedUntil ?? null };
    },
    resetLockout: async () => {
      doc.failedLoginCount = 0;
      doc.lockedUntil = null;
      await doc.save();
    },
  };
}

async function findUserByIdentifier(identifier: string): Promise<Account | null> {
  const h = blindIndex(identifier);
  const user = await UserModel.findOne({
    $or: [
      { mobileHash: h },
      { spouseMobileHash: h },
      { usernameHash: h },
      { spouseUsernameHash: h },
    ],
  }).select('+passwordHash');
  if (!user) return null;
  return toAccount(user, Roles.USER, identifier);
}

/**
 * Find an account by mobile or username (with password hash). Caller may pass role hint.
 */
export async function findAccountByMobile(
  identifier: string,
  role?: Role,
): Promise<Account | null> {
  const h = blindIndex(identifier);
  if (role && isAdminRole(role)) {
    const admin = await AdminModel.findOne({ mobileHash: h }).select('+passwordHash');
    return admin ? toAccount(admin, admin.role as Role) : null;
  }
  if (role === Roles.SCANNER) {
    const scanner = await ScannerModel.findOne({ mobileHash: h }).select('+passwordHash');
    return scanner ? toAccount(scanner, Roles.SCANNER) : null;
  }
  if (role === Roles.USER) {
    return findUserByIdentifier(identifier);
  }

  // No role hint — search everything (admin wins, then scanner, then user).
  const [admin, scanner] = await Promise.all([
    AdminModel.findOne({ mobileHash: h }).select('+passwordHash'),
    ScannerModel.findOne({ mobileHash: h }).select('+passwordHash'),
  ]);
  if (admin) return toAccount(admin, admin.role as Role);
  if (scanner) return toAccount(scanner, Roles.SCANNER);
  return findUserByIdentifier(identifier);
}

/** Find an account by id within the collection implied by its role. */
export async function findAccountById(id: string, role: Role): Promise<Account | null> {
  if (isAdminRole(role)) {
    const doc = await AdminModel.findById(id);
    return doc ? toAccount(doc, doc.role as Role) : null;
  }
  if (role === Roles.SCANNER) {
    const doc = await ScannerModel.findById(id);
    return doc ? toAccount(doc, Roles.SCANNER) : null;
  }
  const doc = await UserModel.findById(id);
  return doc ? toAccount(doc, Roles.USER) : null;
}

/** Current bcrypt hash for an account (for password verification). */
export async function getPasswordHashById(id: string, role: Role): Promise<string | null> {
  if (isAdminRole(role)) {
    return (await AdminModel.findById(id).select('+passwordHash'))?.passwordHash ?? null;
  }
  if (role === Roles.SCANNER) {
    return (await ScannerModel.findById(id).select('+passwordHash'))?.passwordHash ?? null;
  }
  return (await UserModel.findById(id).select('+passwordHash'))?.passwordHash ?? null;
}

/** Replace an account's password hash. */
export async function setPasswordById(
  id: string,
  role: Role,
  passwordHash: string,
): Promise<void> {
  const update = { $set: { passwordHash } };
  if (isAdminRole(role)) await AdminModel.updateOne({ _id: id }, update);
  else if (role === Roles.SCANNER) await ScannerModel.updateOne({ _id: id }, update);
  else await UserModel.updateOne({ _id: id }, update);
}

/**
 * Whether a mobile is already used as a login identity **within the given role's collection**.
 * Uniqueness is per-collection: the same number may exist as an admin, a scanner AND a user
 * independently, but not twice inside the same collection. For USER, a personnel `spouseMobile`
 * also counts as taken; `exceptUserId` skips one user record so a self-update doesn't clash.
 */
export async function mobileTaken(
  mobile: string,
  role: Role,
  exceptUserId?: string,
): Promise<boolean> {
  const h = blindIndex(mobile);
  if (isAdminRole(role)) return Boolean(await AdminModel.exists({ mobileHash: h }));
  if (role === Roles.SCANNER) return Boolean(await ScannerModel.exists({ mobileHash: h }));
  const userFilter = exceptUserId
    ? { $or: [{ mobileHash: h }, { spouseMobileHash: h }], _id: { $ne: exceptUserId } }
    : { $or: [{ mobileHash: h }, { spouseMobileHash: h }] };
  return Boolean(await UserModel.exists(userFilter));
}

/** Whether a username is already taken in the users collection (as member or spouse username). */
export async function usernameTaken(
  username: string,
  exceptUserId?: string,
): Promise<boolean> {
  const h = blindIndex(username);
  const userFilter = exceptUserId
    ? { $or: [{ usernameHash: h }, { spouseUsernameHash: h }], _id: { $ne: exceptUserId } }
    : { $or: [{ usernameHash: h }, { spouseUsernameHash: h }] };
  return Boolean(await UserModel.exists(userFilter));
}

/** Explicitly unlock an account by clearing failed login attempts and lockedUntil timestamp. */
export async function unlockAccount(id: string, role: Role): Promise<boolean> {
  const update = { $set: { failedLoginCount: 0, lockedUntil: null } };
  if (isAdminRole(role)) {
    const res = await AdminModel.updateOne({ _id: id }, update);
    return res.matchedCount > 0;
  }
  if (role === Roles.SCANNER) {
    const res = await ScannerModel.updateOne({ _id: id }, update);
    return res.matchedCount > 0;
  }
  const res = await UserModel.updateOne({ _id: id }, update);
  return res.matchedCount > 0;
}
