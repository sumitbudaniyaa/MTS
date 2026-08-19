import type { FilterQuery } from 'mongoose';
import {
  ScannerModel,
  UnitModel,
  UserModel,
  type ScannerDoc,
  type UserDoc,
} from '../../models/index.js';
import { ApiError } from '../../utils/apiError.js';
import { PASSWORD_GRACE_DAYS } from '../auth/account.service.js';
import { hashPassword } from '../../utils/password.js';
import { generateTempPassword } from '../../utils/ids.js';
import { buildMeta, type Paginated } from '../../utils/pagination.js';
import { mobileTaken } from '../auth/account.service.js';
import { blindIndex } from '../../utils/fieldCrypto.js';
import { MaritalStatus, Rank } from '../../constants/enums.js';
import { Roles, type Role } from '../../types/index.js';
import { DEFAULT_PERSONNEL_PASSWORD } from './personnel.schema.js';
import type {
  BulkPersonnelInput,
  CreatePersonnelInput,
  PersonnelListQuery,
  UpdatePersonnelInput,
} from './personnel.schema.js';

/** Either kind of managed account (personnel in `users`, operators in `scanners`). */
type ManagedDoc = UserDoc | ScannerDoc;

async function assertUnitExists(unitId: string): Promise<void> {
  const unit = await UnitModel.findById(unitId);
  if (!unit) throw ApiError.badRequest('Referenced unit does not exist');
  if (!unit.active) throw ApiError.badRequest('Referenced unit is inactive');
}

/**
 * A created account and, when we invented the password, the plaintext — returned **once** so the
 * admin can hand it over. Never stored; only the hash is.
 */
export interface CreatedPersonnel {
  doc: ManagedDoc;
  /** Set only for a generated password (scanner operators). Null when the caller supplied one
   *  or when the shared personnel default was applied, since that one is already known. */
  generatedPassword: string | null;
}

export async function createPersonnel(input: CreatePersonnelInput): Promise<CreatedPersonnel> {
  const supplied = input.password && input.password.trim() ? input.password : null;
  const isScanner = input.role === Roles.SCANNER;
  // Scanner operators never get the shared default: they have no self-service change screen, so
  // a password everyone knows would be one they could not replace. Each gets its own generated
  // credential, surfaced once to whoever created the account.
  const generatedPassword = !supplied && isScanner ? generateTempPassword() : null;
  const rawPassword = supplied ?? generatedPassword ?? DEFAULT_PERSONNEL_PASSWORD;
  const passwordHash = await hashPassword(rawPassword);
  // The forced change applies to **personnel only**, because they are the ones handed a shared
  // password everyone knows. A scanner operator gets a credential generated just for them, so
  // there is no shared secret to rotate and no deadline.
  const mustChangePassword = !isScanner;
  const passwordExpiresAt = mustChangePassword
    ? new Date(Date.now() + PASSWORD_GRACE_DAYS * 24 * 60 * 60_000)
    : null;

  // SCANNER operators go to their own collection (no unit/family fields).
  if (input.role === Roles.SCANNER) {
    if (!input.mobile) throw ApiError.badRequest('Mobile is required for scanner operators');
    if (await mobileTaken(input.mobile, Roles.SCANNER)) {
      throw ApiError.conflict('An account with this mobile already exists');
    }
    const scanner = await ScannerModel.create({
      mobile: input.mobile,
      passwordHash,
      mustChangePassword,
      passwordExpiresAt,
    });
    return { doc: scanner, generatedPassword };
  }

  if (!input.unit) throw ApiError.badRequest('unit is required for USER personnel');
  const unitDoc = await UnitModel.findById(input.unit);
  if (!unitDoc) throw ApiError.badRequest('Referenced unit does not exist');
  if (!unitDoc.active) throw ApiError.badRequest('Referenced unit is inactive');

  const isUsernameMode = unitDoc.loginMode === 'USERNAME';
  let mobile = input.mobile;
  const username = input.username?.trim();

  if (isUsernameMode) {
    if (!username) throw ApiError.badRequest('Username is required for personnel in this unit');
    const { usernameTaken } = await import('../auth/account.service.js');
    if (await usernameTaken(username)) {
      throw ApiError.conflict('An account with this username already exists');
    }
    if (!mobile) {
      mobile = `u_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    }
  } else {
    if (!mobile) throw ApiError.badRequest('Mobile number is required for personnel in this unit');
    if (await mobileTaken(mobile, Roles.USER)) {
      throw ApiError.conflict('An account with this mobile already exists');
    }
  }

  // SINGLE personnel cannot record a spouse (model hook also enforces this).
  const married = input.maritalStatus === MaritalStatus.MARRIED;
  const spouseMobile = married ? (input.spouseMobile ?? null) : null;
  const spouseUsername = married ? (input.spouseUsername?.trim() ?? undefined) : undefined;

  if (spouseMobile && (await mobileTaken(spouseMobile, Roles.USER))) {
    throw ApiError.conflict('The spouse mobile is already used by another account');
  }

  if (spouseUsername) {
    const { usernameTaken } = await import('../auth/account.service.js');
    if (await usernameTaken(spouseUsername)) {
      throw ApiError.conflict('The spouse username is already used by another account');
    }
  }

  const user = await UserModel.create({
    mustChangePassword,
    passwordExpiresAt,
    mobile,
    username: username ?? undefined,
    passwordHash,
    unit: input.unit,
    rank: input.rank,
    maritalStatus: input.maritalStatus,
    spouseMobile,
    spouseUsername,
    numberOfKids: input.numberOfKids,
  });
  return { doc: user, generatedPassword };
}

export interface BulkResult {
  created: number;
  failed: { mobile: string; error: string }[];
}

/**
 * Bulk-create USER personnel for a unit (rows parsed from an uploaded spreadsheet). Each row
 * is created independently; failures (e.g. duplicate mobile) are collected and reported so a
 * single bad row doesn't abort the whole import.
 */
export async function createPersonnelBulk(input: BulkPersonnelInput): Promise<BulkResult> {
  await assertUnitExists(input.unit);
  const result: BulkResult = { created: 0, failed: [] };

  for (const row of input.items) {
    try {
      await createPersonnel({
        mobile: row.mobile,
        username: row.username,
        password: row.password ?? DEFAULT_PERSONNEL_PASSWORD,
        role: Roles.USER,
        unit: input.unit,
        rank: row.rank ?? Rank.JAWAN,
        maritalStatus: row.maritalStatus ?? MaritalStatus.SINGLE,
        spouseMobile: row.spouseMobile,
        spouseUsername: row.spouseUsername,
        numberOfKids: row.numberOfKids ?? 0,
      });
      result.created += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      result.failed.push({ mobile: row.mobile || row.username || 'Row', error: message });
    }
  }
  return result;
}

export async function listPersonnel(query: PersonnelListQuery): Promise<Paginated<ManagedDoc>> {
  // Mobile is encrypted → exact-match search via its blind index (no substring search).
  const search = query.search ? { mobileHash: blindIndex(query.search) } : {};

  const wantUsers = query.role !== Roles.SCANNER;
  // Scanner accounts carry no rank, so a rank filter can only ever mean "personnel" —
  // including them would silently widen the result past what was asked for.
  const wantScanners = query.role !== Roles.USER && !query.rank;
  const take = query.page * query.limit; // over-fetch per collection, then merge

  const userFilter: FilterQuery<UserDoc> = { ...search };
  if (query.unit) userFilter.unit = query.unit;
  if (query.rank) userFilter.rank = query.rank;

  const [users, scanners, userCount, scannerCount] = await Promise.all([
    wantUsers
      ? UserModel.find(userFilter).populate('unit', 'name').sort('-createdAt').limit(take)
      : Promise.resolve([] as UserDoc[]),
    wantScanners && !query.unit
      ? ScannerModel.find(search).sort('-createdAt').limit(take)
      : Promise.resolve([] as ScannerDoc[]),
    wantUsers ? UserModel.countDocuments(userFilter) : Promise.resolve(0),
    wantScanners && !query.unit ? ScannerModel.countDocuments(search) : Promise.resolve(0),
  ]);

  const merged = [...users, ...scanners].sort(
    (a, b) =>
      new Date((b as { createdAt: Date }).createdAt).getTime() -
      new Date((a as { createdAt: Date }).createdAt).getTime(),
  );
  const start = (query.page - 1) * query.limit;
  const items = merged.slice(start, start + query.limit);

  return { items, ...buildMeta(userCount + scannerCount, query.page, query.limit) };
}

/** Look an account up in whichever managed collection holds it. */
async function findManaged(id: string): Promise<ManagedDoc | null> {
  const user = await UserModel.findById(id).populate('unit', 'name');
  if (user) return user;
  return ScannerModel.findById(id);
}

export async function getPersonnel(id: string): Promise<ManagedDoc> {
  const doc = await findManaged(id);
  if (!doc) throw ApiError.notFound('Personnel not found');
  return doc;
}

export async function updatePersonnel(
  id: string,
  input: UpdatePersonnelInput,
): Promise<ManagedDoc> {
  const doc = await findManaged(id);
  if (!doc) throw ApiError.notFound('Personnel not found');

  if (input.active !== undefined) doc.active = input.active;
  if (input.password) {
    doc.passwordHash = await hashPassword(input.password);
    // Personnel only — see `createPersonnel`. A scanner operator's reset is just a new credential.
    if (doc.role === Roles.USER) {
      doc.mustChangePassword = true;
      doc.passwordExpiresAt = new Date(Date.now() + PASSWORD_GRACE_DAYS * 24 * 60 * 60_000);
    }
    // A reset is almost always *because* they are locked out, so clear the lockout too —
    // otherwise the new password still fails until the timer runs down.
    doc.failedLoginCount = 0;
    doc.lockedUntil = null;
  }

  // Personnel-only (USER) fields.
  if (doc.role === Roles.USER) {
    const user = doc as UserDoc;
    if (input.unit !== undefined) {
      await assertUnitExists(input.unit);
      user.unit = input.unit as unknown as UserDoc['unit'];
    }
    if (input.rank !== undefined) user.rank = input.rank;
    if (input.maritalStatus !== undefined) user.maritalStatus = input.maritalStatus;
    if (input.numberOfKids !== undefined) user.numberOfKids = input.numberOfKids;
    if (input.spouseMobile !== undefined) {
      if (input.spouseMobile && (await mobileTaken(input.spouseMobile, Roles.USER, user.id))) {
        throw ApiError.conflict('The spouse mobile is already used by another account');
      }
      user.spouseMobile = input.spouseMobile;
    }
    if (input.spouseUsername !== undefined) {
      if (input.spouseUsername) {
        const { usernameTaken } = await import('../auth/account.service.js');
        if (await usernameTaken(input.spouseUsername, user.id)) {
          throw ApiError.conflict('The spouse username is already used by another account');
        }
      }
      user.spouseUsername = input.spouseUsername ?? undefined;
    }
  }

  await doc.save();
  return doc;
}

export async function deletePersonnel(id: string): Promise<void> {
  const user = await UserModel.findByIdAndDelete(id);
  if (user) return;
  const scanner = await ScannerModel.findByIdAndDelete(id);
  if (!scanner) throw ApiError.notFound('Personnel not found');
}

export async function unlockPersonnel(id: string): Promise<ManagedDoc> {
  const doc = await findManaged(id);
  if (!doc) throw ApiError.notFound('Personnel not found');
  doc.failedLoginCount = 0;
  doc.lockedUntil = null;
  await doc.save();
  return doc;
}

/** Public-safe projection (never leaks passwordHash; family fields are internal). */
export function toPersonnelView(doc: ManagedDoc, role: Role = Roles.ADMIN) {
  const isUser = doc.role === Roles.USER;
  const base = {
    id: doc.id,
    mobile: doc.mobile,
    username: isUser ? ((doc as UserDoc).username ?? null) : null,
    role: doc.role,
    rank: isUser ? (doc as UserDoc).rank : null,
    unit: isUser ? (doc as UserDoc).unit : null,
    active: doc.active,
    failedLoginCount: doc.failedLoginCount ?? 0,
    lockedUntil: doc.lockedUntil ?? null,
    // Surfaced so an admin can see who is still on a password they didn't choose, and how long
    // they have left — otherwise the shared default is invisible until it locks someone out.
    mustChangePassword: doc.mustChangePassword ?? false,
    passwordExpiresAt: doc.passwordExpiresAt ?? null,
  };
  if (role !== Roles.ADMIN || !isUser) return base;
  const user = doc as UserDoc;
  return {
    ...base,
    maritalStatus: user.maritalStatus,
    spouseMobile: user.spouseMobile,
    spouseUsername: user.spouseUsername ?? null,
    numberOfKids: user.numberOfKids,
    familySize: user.familySize,
    lastLoginAt: user.lastLoginAt,
  };
}
