import type { FilterQuery } from 'mongoose';
import {
  ScannerModel,
  UnitModel,
  UserModel,
  type ScannerDoc,
  type UserDoc,
} from '../../models/index.js';
import { ApiError } from '../../utils/apiError.js';
import { hashPassword } from '../../utils/password.js';
import { buildMeta, type Paginated } from '../../utils/pagination.js';
import { mobileTaken } from '../auth/account.service.js';
import { blindIndex } from '../../utils/fieldCrypto.js';
import { MaritalStatus, Rank } from '../../constants/enums.js';
import { Roles, type Role } from '../../types/index.js';
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

export async function createPersonnel(input: CreatePersonnelInput): Promise<ManagedDoc> {
  // Uniqueness is per-collection: only clash with an existing account of the SAME role.
  if (await mobileTaken(input.mobile, input.role)) {
    throw ApiError.conflict('An account with this mobile already exists');
  }
  const passwordHash = await hashPassword(input.password);

  // SCANNER operators go to their own collection (no unit/family fields).
  if (input.role === Roles.SCANNER) {
    return ScannerModel.create({ mobile: input.mobile, passwordHash });
  }

  if (!input.unit) throw ApiError.badRequest('unit is required for USER personnel');
  await assertUnitExists(input.unit);

  // SINGLE personnel cannot record a spouse (model hook also enforces this).
  const married = input.maritalStatus === MaritalStatus.MARRIED;
  const spouseMobile = married ? (input.spouseMobile ?? null) : null;

  // The spouse mobile must be a free login identity in the users collection too (spouse logs
  // in with the same password as the member but their own mobile).
  if (spouseMobile && (await mobileTaken(spouseMobile, Roles.USER))) {
    throw ApiError.conflict('The spouse mobile is already used by another account');
  }

  // familySize is computed by the model pre-validate hook — never set here.
  return UserModel.create({
    mobile: input.mobile,
    passwordHash,
    unit: input.unit,
    rank: input.rank,
    maritalStatus: input.maritalStatus,
    spouseMobile,
    numberOfKids: input.numberOfKids,
  });
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
        password: row.password,
        role: Roles.USER,
        unit: input.unit,
        rank: row.rank ?? Rank.JAWAN,
        maritalStatus: row.maritalStatus ?? MaritalStatus.SINGLE,
        spouseMobile: row.spouseMobile,
        numberOfKids: row.numberOfKids ?? 0,
      });
      result.created += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      result.failed.push({ mobile: row.mobile, error: message });
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
  if (input.password) doc.passwordHash = await hashPassword(input.password);

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

/** Public-safe projection (never leaks passwordHash; family fields are internal). */
export function toPersonnelView(doc: ManagedDoc, role: Role = Roles.ADMIN) {
  const isUser = doc.role === Roles.USER;
  const base = {
    id: doc.id,
    mobile: doc.mobile,
    role: doc.role,
    rank: isUser ? (doc as UserDoc).rank : null,
    unit: isUser ? (doc as UserDoc).unit : null,
    active: doc.active,
  };
  if (role !== Roles.ADMIN || !isUser) return base;
  const user = doc as UserDoc;
  return {
    ...base,
    maritalStatus: user.maritalStatus,
    spouseMobile: user.spouseMobile,
    numberOfKids: user.numberOfKids,
    familySize: user.familySize,
    lastLoginAt: user.lastLoginAt,
  };
}
