import type { FilterQuery } from 'mongoose';
import { UnitModel, UserModel, type UnitDoc } from '../../models/index.js';
import { ApiError } from '../../utils/apiError.js';
import { buildMeta, type ListQuery, type Paginated } from '../../utils/pagination.js';
import { blindIndex } from '../../utils/fieldCrypto.js';

export async function createUnit(input: { name: string }): Promise<UnitDoc> {
  // Uniqueness is on the encrypted name's blind index (ciphertext isn't comparable).
  const exists = await UnitModel.findOne({ nameHash: blindIndex(input.name) });
  if (exists) throw ApiError.conflict('A unit with this name already exists');
  return UnitModel.create({ name: input.name });
}

export async function listUnits(query: ListQuery): Promise<Paginated<UnitDoc>> {
  const filter: FilterQuery<UnitDoc> = {};
  if (query.search) {
    // Encrypted name → exact-match search via the blind index (no substring search).
    filter.nameHash = blindIndex(query.search);
  }
  const [items, total] = await Promise.all([
    UnitModel.find(filter)
      .sort(query.sort ?? '-createdAt')
      .skip((query.page - 1) * query.limit)
      .limit(query.limit),
    UnitModel.countDocuments(filter),
  ]);
  return { items, ...buildMeta(total, query.page, query.limit) };
}

export async function getUnit(id: string): Promise<UnitDoc> {
  const unit = await UnitModel.findById(id);
  if (!unit) throw ApiError.notFound('Unit not found');
  return unit;
}

export async function updateUnit(
  id: string,
  input: { name?: string; active?: boolean },
): Promise<UnitDoc> {
  if (input.name) {
    const clash = await UnitModel.findOne({ name: input.name, _id: { $ne: id } });
    if (clash) throw ApiError.conflict('A unit with this name already exists');
  }
  const unit = await UnitModel.findByIdAndUpdate(id, input, { new: true, runValidators: true });
  if (!unit) throw ApiError.notFound('Unit not found');
  return unit;
}

export async function deleteUnit(id: string): Promise<void> {
  // Guard referential integrity: a unit with personnel cannot be removed.
  const personnel = await UserModel.countDocuments({ unit: id });
  if (personnel > 0) {
    throw ApiError.conflict(`Cannot delete: ${personnel} personnel still belong to this unit`);
  }
  const res = await UnitModel.findByIdAndDelete(id);
  if (!res) throw ApiError.notFound('Unit not found');
}
