import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Save } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import type { Paginated, SeatAllocation, Unit } from '@/types';
import { LoadingState, ErrorState, Badge } from '@/components/ui/Misc';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { NumberInput } from '@/components/ui/NumberInput';

/**
 * Seat-allocation editor for one movie. Shared by the standalone Seat Allocation page and by
 * the movie-creation flow, so both routes edit allocations through exactly the same rules
 * (the total must equal capacity before it can be saved).
 */
export function AllocateSeatsModal({
  movieId,
  movieTitle,
  capacity,
  onClose,
  onSaved,
  isNewMovie = false,
}: {
  movieId: string;
  movieTitle?: string;
  capacity: number;
  onClose: () => void;
  onSaved?: () => void;
  isNewMovie?: boolean;
}) {
  const qc = useQueryClient();
  // Keyed by `${unitId}:${rank}`
  const [values, setValues] = useState<Record<string, number>>({});

  const { data: units } = useQuery({
    queryKey: ['units', 'all'],
    queryFn: async () =>
      (await api.get<Paginated<Unit>>('/units', { params: { limit: 100 } })).data,
  });

  const allocQuery = useQuery({
    queryKey: ['allocations', movieId],
    enabled: !!movieId,
    queryFn: async () =>
      (await api.get<{ allocations: SeatAllocation[] }>(`/seat-allocations/${movieId}`)).data
        .allocations,
  });

  // Seed editable values from existing allocations.
  useEffect(() => {
    if (!units) return;
    const seed: Record<string, number> = {};
    units.items.forEach((u) => {
      seed[`${u.id}:OFFICER`] = 0;
      seed[`${u.id}:JCO`] = 0;
      seed[`${u.id}:JAWAN`] = 0;
    });
    allocQuery.data?.forEach((a) => {
      const uId = typeof a.unit === 'string' ? a.unit : a.unit.id;
      const rank = a.rank ?? 'JAWAN';
      seed[`${uId}:${rank}`] = a.allocated;
    });
    setValues(seed);
  }, [units, allocQuery.data, movieId]);

  const activeUnits = useMemo(() => units?.items.filter((u) => u.active) ?? [], [units]);

  const totalsByRank = useMemo(() => {
    const res = { OFFICER: 0, JCO: 0, JAWAN: 0 };
    Object.entries(values).forEach(([key, num]) => {
      const rank = key.split(':')[1] as keyof typeof res;
      if (rank && res[rank] !== undefined) {
        res[rank] += Number(num) || 0;
      }
    });
    return res;
  }, [values]);

  const total = useMemo(
    () => totalsByRank.OFFICER + totalsByRank.JCO + totalsByRank.JAWAN,
    [totalsByRank],
  );
  const matches = total === capacity && capacity > 0;

  // Auto-distribute equally across active units based on current rank target totals (or equal split)
  const handleEqualDistribute = () => {
    if (!activeUnits.length) return;
    const count = activeUnits.length;
    // Default split ratios if totals are zero: Jawan ~45%, JCO ~30%, Officer ~25%
    const currentOfficerTotal = totalsByRank.OFFICER || Math.floor(capacity * 0.25);
    const currentJcoTotal = totalsByRank.JCO || Math.floor(capacity * 0.30);
    const currentJawanTotal = capacity - currentOfficerTotal - currentJcoTotal;

    const distributePool = (totalAmount: number, rank: 'OFFICER' | 'JCO' | 'JAWAN') => {
      const base = Math.floor(totalAmount / count);
      let remainder = totalAmount % count;
      const res: Record<string, number> = {};
      activeUnits.forEach((u) => {
        const extra = remainder > 0 ? 1 : 0;
        if (remainder > 0) remainder -= 1;
        res[`${u.id}:${rank}`] = base + extra;
      });
      return res;
    };

    const next: Record<string, number> = {
      ...distributePool(currentOfficerTotal, 'OFFICER'),
      ...distributePool(currentJcoTotal, 'JCO'),
      ...distributePool(currentJawanTotal, 'JAWAN'),
    };

    setValues(next);
    toast.success('Seats distributed equally across units');
  };

  const save = useMutation({
    mutationFn: () => {
      const allocations: { unit: string; rank: 'OFFICER' | 'JCO' | 'JAWAN'; allocated: number }[] = [];
      Object.entries(values).forEach(([key, count]) => {
        const [unit, rank] = key.split(':') as [string, 'OFFICER' | 'JCO' | 'JAWAN'];
        const allocated = Number(count) || 0;
        if (unit && rank && allocated > 0) {
          allocations.push({ unit, rank, allocated });
        }
      });
      return api.put(`/seat-allocations/${movieId}`, { allocations });
    },
    onSuccess: () => {
      toast.success('Rank-wise seat allocations saved');
      qc.invalidateQueries({ queryKey: ['allocations', movieId] });
      qc.invalidateQueries({ queryKey: ['movies'] });
      onSaved?.();
      onClose();
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const noUnits = units && units.items.length === 0;

  return (
    <Modal
      open
      onClose={onClose}
      loading={save.isPending}
      title={movieTitle ? `Allocate seats — ${movieTitle}` : 'Allocate seats'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            {isNewMovie ? 'Skip for now' : 'Close'}
          </Button>
          <Button onClick={() => save.mutate()} disabled={!matches} loading={save.isPending}>
            <Save className="h-3.5 w-3.5" /> Save allocations
          </Button>
        </>
      }
    >
      {isNewMovie && (
        <p className="-mt-1 mb-4 text-sm text-muted">
          Movie created. Split its {capacity} seats rank-wise and unit-wise now, or skip — unallocated
          seats stay in the common pool.
        </p>
      )}

      {allocQuery.isLoading && <LoadingState />}
      {allocQuery.isError && <ErrorState message={apiErrorMessage(allocQuery.error)} />}
      {noUnits && (
        <p className="text-sm text-muted">
          No units exist yet. All {capacity} seats remain in the common pool.
        </p>
      )}

      {units && !noUnits && (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-sm">
            <div className="flex items-center gap-2">
              <span>
                Total Allocated: <span className="font-semibold text-fg">{total}</span> / {capacity}
              </span>
              {matches ? (
                <Badge tone="success">Matches capacity</Badge>
              ) : (
                <Badge tone="warning">Must equal {capacity}</Badge>
              )}
            </div>

            <Button size="sm" variant="secondary" onClick={handleEqualDistribute}>
              Distribute Equally Across Units
            </Button>
          </div>

          <div className="mb-3 flex items-center justify-around rounded-lg border border-border bg-subtle/40 p-2.5 text-xs font-medium">
            <div>Officer Pool: <span className="text-fg font-semibold">{totalsByRank.OFFICER}</span></div>
            <div>JCO Pool: <span className="text-fg font-semibold">{totalsByRank.JCO}</span></div>
            <div>Jawan Pool: <span className="text-fg font-semibold">{totalsByRank.JAWAN}</span></div>
          </div>

          <div className="max-h-[50vh] overflow-x-auto overflow-y-auto rounded-xl border border-border">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-subtle text-muted">
                <tr>
                  <th className="p-3 font-medium">Unit</th>
                  <th className="p-3 font-medium">Officer Seats</th>
                  <th className="p-3 font-medium">JCO Seats</th>
                  <th className="p-3 font-medium">Jawan Seats</th>
                  <th className="p-3 text-right font-medium">Unit Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {activeUnits.map((u) => {
                  const off = values[`${u.id}:OFFICER`] ?? 0;
                  const jco = values[`${u.id}:JCO`] ?? 0;
                  const jwn = values[`${u.id}:JAWAN`] ?? 0;
                  const uTotal = off + jco + jwn;

                  return (
                    <tr key={u.id} className="hover:bg-subtle/30">
                      <td className="p-3 font-medium text-fg">{u.name}</td>
                      <td className="p-2">
                        <NumberInput
                          className="h-8 w-20"
                          value={off}
                          disabled={save.isPending}
                          onChange={(n) => setValues((v) => ({ ...v, [`${u.id}:OFFICER`]: n }))}
                        />
                      </td>
                      <td className="p-2">
                        <NumberInput
                          className="h-8 w-20"
                          value={jco}
                          disabled={save.isPending}
                          onChange={(n) => setValues((v) => ({ ...v, [`${u.id}:JCO`]: n }))}
                        />
                      </td>
                      <td className="p-2">
                        <NumberInput
                          className="h-8 w-20"
                          value={jwn}
                          disabled={save.isPending}
                          onChange={(n) => setValues((v) => ({ ...v, [`${u.id}:JAWAN`]: n }))}
                        />
                      </td>
                      <td className="p-3 text-right font-semibold text-fg">{uTotal}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Modal>
  );
}
