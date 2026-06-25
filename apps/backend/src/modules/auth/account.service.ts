import { AdminModel, ScannerModel, UserModel } from '../../models/index.js';
import { Roles, type Role } from '../../types/index.js';

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
  passwordHash?: string; // present only when explicitly selected
  touchLogin: () => Promise<void>;
}

/** Mongoose model name backing a role (used for audit refPath). */
export function modelNameForRole(role: Role): 'Admin' | 'Scanner' | 'User' {
  if (role === Roles.ADMIN) return 'Admin';
  if (role === Roles.SCANNER) return 'Scanner';
  return 'User';
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
  save: () => Promise<unknown>;
}

function toAccount(doc: AccountDocLike, role: Role): Account {
  return {
    id: doc.id ?? String(doc._id),
    mobile: doc.mobile,
    name: doc.name ?? '',
    role,
    unit: role === Roles.USER && doc.unit ? String(doc.unit) : null,
    active: doc.active,
    passwordHash: doc.passwordHash,
    touchLogin: async () => {
      doc.lastLoginAt = new Date();
      await doc.save();
    },
  };
}

/**
 * Find an account by mobile across all collections (with password hash). A personnel record
 * matches either its own `mobile` OR its `spouseMobile`; when matched as the spouse, the
 * spouse credential is used and the spouse's mobile is shown, but the account id (and thus
 * the family quota / bookings) is the SAME shared record.
 */
export async function findAccountByMobile(mobile: string): Promise<Account | null> {
  const [admin, scanner, user] = await Promise.all([
    AdminModel.findOne({ mobile }).select('+passwordHash'),
    ScannerModel.findOne({ mobile }).select('+passwordHash'),
    UserModel.findOne({ $or: [{ mobile }, { spouseMobile: mobile }] }).select('+passwordHash'),
  ]);
  if (admin) return toAccount(admin, Roles.ADMIN);
  if (scanner) return toAccount(scanner, Roles.SCANNER);
  if (user) {
    // The spouse signs in with their own mobile but the SAME password as the member, and
    // resolves to the same family account (shared tickets/quota).
    return {
      id: user.id,
      mobile, // the identity actually used to log in
      name: '',
      role: Roles.USER,
      unit: user.unit ? String(user.unit) : null,
      active: user.active,
      passwordHash: user.passwordHash,
      touchLogin: async () => {
        user.lastLoginAt = new Date();
        await user.save();
      },
    };
  }
  return null;
}

/** Find an account by id within the collection implied by its role. */
export async function findAccountById(id: string, role: Role): Promise<Account | null> {
  if (role === Roles.ADMIN) {
    const doc = await AdminModel.findById(id);
    return doc ? toAccount(doc, Roles.ADMIN) : null;
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
  if (role === Roles.ADMIN) {
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
  if (role === Roles.ADMIN) await AdminModel.updateOne({ _id: id }, update);
  else if (role === Roles.SCANNER) await ScannerModel.updateOne({ _id: id }, update);
  else await UserModel.updateOne({ _id: id }, update);
}

/**
 * Whether a number is already used as ANY login identity — a primary mobile in any
 * collection, or a personnel spouse mobile. `exceptUserId` skips one user record so a
 * personnel update doesn't clash with itself.
 */
export async function mobileTaken(mobile: string, exceptUserId?: string): Promise<boolean> {
  const userFilter = exceptUserId
    ? { $or: [{ mobile }, { spouseMobile: mobile }], _id: { $ne: exceptUserId } }
    : { $or: [{ mobile }, { spouseMobile: mobile }] };
  const [a, s, u] = await Promise.all([
    AdminModel.exists({ mobile }),
    ScannerModel.exists({ mobile }),
    UserModel.exists(userFilter),
  ]);
  return Boolean(a || s || u);
}
