import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, ArrowRight, Save } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import type { Paginated, SeatAllocation, Unit } from '@/types';
import { LoadingState, ErrorState, Badge } from '@/components/ui/Misc';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { NumberInput } from '@/components/ui/NumberInput';
import { cn } from '@/lib/cn';

type RankKey = 'OFFICER' | 'JCO' | 'JAWAN';
const RANKS: RankKey[] = ['OFFICER', 'JCO', 'JAWAN'];
const RANK_LABEL: Record<RankKey, string> = {
  OFFICER: 'Officer',
  JCO: 'JCO',
  JAWAN: 'Jawan',
};

type Mode = 'EQUAL' | 'MANUAL';

/**
 * Split `total` across `n` units as evenly as possible.
 *
 * The remainder cannot vanish, so it goes one seat at a time to the units at the front of the
 * list: 7 across 3 units is 3/2/2, never 2/2/2 with a seat quietly lost. The order is the unit
 * list's own order, so the same inputs always produce the same split.
 */
function equalSplit(total: number, n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor(total / n);
  const remainder = total % n;
  return Array.from({ length: n }, (_, i) => base + (i < remainder ? 1 : 0));
}

/**
 * Seat-allocation editor for one movie, in two deliberate steps:
 *
 *  1. **Pools by rank** — how many of the hall's seats belong to Officers, JCOs and Jawans.
 *     Must add up to capacity, because every seat has to belong to exactly one rank pool.
 *  2. **Distribution** — per rank, either split that pool equally across units or type each
 *     unit's share by hand.
 *
 * They are separate steps because they are separate decisions. The previous single-grid version
 * derived the rank pools *from* the per-unit numbers, and its "distribute equally" button
 * invented rank totals from hardcoded 25/30/45% ratios whenever they were still zero — a policy
 * choice nobody had made.
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
  const [step, setStep] = useState<1 | 2>(1);
  const [pools, setPools] = useState<Record<RankKey, number>>({ OFFICER: 0, JCO: 0, JAWAN: 0 });
  const [mode, setMode] = useState<Record<RankKey, Mode>>({
    OFFICER: 'EQUAL',
    JCO: 'EQUAL',
    JAWAN: 'EQUAL',
  });
  /** Manual per-unit overrides, keyed `${unitId}:${rank}`. Only read when that rank is MANUAL. */
  const [manual, setManual] = useState<Record<string, number>>({});

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

  const activeUnits = useMemo(() => units?.items.filter((u) => u.active) ?? [], [units]);

  // Seed from whatever is already saved. An existing split starts in MANUAL so reopening the
  // dialog never silently re-flattens numbers someone set deliberately.
  useEffect(() => {
    const existing = allocQuery.data;
    if (!existing?.length) return;
    const nextPools: Record<RankKey, number> = { OFFICER: 0, JCO: 0, JAWAN: 0 };
    const nextManual: Record<string, number> = {};
    existing.forEach((a) => {
      const unitId = typeof a.unit === 'string' ? a.unit : a.unit.id;
      const rank = (a.rank ?? 'JAWAN') as RankKey;
      nextPools[rank] += a.allocated;
      nextManual[`${unitId}:${rank}`] = a.allocated;
    });
    setPools(nextPools);
    setManual(nextManual);
    setMode({ OFFICER: 'MANUAL', JCO: 'MANUAL', JAWAN: 'MANUAL' });
  }, [allocQuery.data]);

  const poolTotal = RANKS.reduce((sum, r) => sum + (pools[r] || 0), 0);
  const poolsMatch = poolTotal === capacity && capacity > 0;

  /** What each unit actually gets for a rank, under that rank's current mode. */
  const sharesFor = (rank: RankKey): number[] => {
    if (mode[rank] === 'EQUAL') return equalSplit(pools[rank] || 0, activeUnits.length);
    return activeUnits.map((u) => manual[`${u.id}:${rank}`] ?? 0);
  };

  /** A rank reconciles when its per-unit shares add up to its pool. */
  const rankSum = (rank: RankKey) => sharesFor(rank).reduce((a, b) => a + b, 0);
  const rankOk = (rank: RankKey) => rankSum(rank) === (pools[rank] || 0);
  const allRanksOk = RANKS.every(rankOk);

  const save = useMutation({
    mutationFn: () => {
      const allocations: { unit: string; rank: RankKey; allocated: number }[] = [];
      RANKS.forEach((rank) => {
        const shares = sharesFor(rank);
        activeUnits.forEach((u, i) => {
          const allocated = shares[i] ?? 0;
          if (allocated > 0) allocations.push({ unit: u.id, rank, allocated });
        });
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
      // Blocks Escape-to-close while the save is in flight.
      loading={save.isPending}
      title={movieTitle ? `Allocate seats — ${movieTitle}` : 'Allocate seats'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            {isNewMovie ? 'Skip for now' : 'Close'}
          </Button>
          {step === 1 ? (
            <Button disabled={!poolsMatch || !!noUnits} onClick={() => setStep(2)}>
              Next: divide into units <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <>
              <Button variant="secondary" onClick={() => setStep(1)} disabled={save.isPending}>
                <ArrowLeft className="h-3.5 w-3.5" /> Back
              </Button>
              <Button
                onClick={() => save.mutate()}
                disabled={!allRanksOk}
                loading={save.isPending}
              >
                <Save className="h-3.5 w-3.5" /> Save allocations
              </Button>
            </>
          )}
        </>
      }
    >
      {isNewMovie && step === 1 && (
        <p className="-mt-1 text-sm text-muted">
          Movie created. Split its {capacity} seats by rank now, or skip — unallocated seats stay
          in the common pool.
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
          {/* Step indicator */}
          <div className="flex items-center gap-2 text-xs">
            {([1, 2] as const).map((n) => (
              <span
                key={n}
                className={cn(
                  'rounded-full px-2.5 py-1 font-medium',
                  step === n ? 'bg-fg text-bg' : 'bg-surface-2 text-muted',
                )}
              >
                {n}. {n === 1 ? 'Seats per rank' : 'Divide into units'}
              </span>
            ))}
          </div>

          {step === 1 ? (
            <>
              <p className="text-sm text-muted">
                Every seat belongs to one rank, so these must add up to the hall&rsquo;s{' '}
                {capacity} seats. Only that rank can book them.
              </p>
              <div className="space-y-3">
                {RANKS.map((rank) => (
                  <div key={rank} className="flex items-center justify-between gap-3">
                    <label className="text-sm font-medium text-fg">{RANK_LABEL[rank]}</label>
                    <NumberInput
                      className="h-9 w-24"
                      value={pools[rank]}
                      onChange={(n) => setPools((p) => ({ ...p, [rank]: n }))}
                    />
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3 text-sm">
                <span>
                  Allocated <span className="font-semibold text-fg">{poolTotal}</span> of{' '}
                  {capacity}
                </span>
                {poolsMatch ? (
                  <Badge tone="success">Matches capacity</Badge>
                ) : (
                  <Badge tone="warning">
                    {poolTotal > capacity
                      ? `${poolTotal - capacity} over`
                      : `${capacity - poolTotal} left to assign`}
                  </Badge>
                )}
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-muted">
                {activeUnits.length} unit{activeUnits.length === 1 ? '' : 's'}. Choose how each
                rank&rsquo;s seats are shared out.
              </p>

              {RANKS.map((rank) => {
                const shares = sharesFor(rank);
                const sum = rankSum(rank);
                const ok = rankOk(rank);
                if ((pools[rank] || 0) === 0) {
                  return (
                    <div key={rank} className="rounded-xl border border-border p-3">
                      <p className="text-sm font-medium text-fg">{RANK_LABEL[rank]}</p>
                      <p className="mt-0.5 text-xs text-muted">No seats assigned to this rank.</p>
                    </div>
                  );
                }
                return (
                  <div key={rank} className="rounded-xl border border-border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium text-fg">
                        {RANK_LABEL[rank]}{' '}
                        <span className="font-normal text-muted">
                          &middot; {pools[rank]} seats
                        </span>
                      </p>
                      <div className="flex overflow-hidden rounded-lg border border-border">
                        {(['EQUAL', 'MANUAL'] as const).map((m) => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => {
                              // Switching to manual starts from the equal split, so the numbers
                              // already reconcile and only the ones you change need thought.
                              if (m === 'MANUAL') {
                                const seed = equalSplit(pools[rank] || 0, activeUnits.length);
                                setManual((prev) => {
                                  const next = { ...prev };
                                  activeUnits.forEach((u, i) => {
                                    next[`${u.id}:${rank}`] = seed[i] ?? 0;
                                  });
                                  return next;
                                });
                              }
                              setMode((prev) => ({ ...prev, [rank]: m }));
                            }}
                            className={cn(
                              'px-2.5 py-1 text-xs font-medium transition-colors',
                              mode[rank] === m
                                ? 'bg-fg text-bg'
                                : 'bg-surface text-muted hover:bg-surface-2',
                            )}
                          >
                            {m === 'EQUAL' ? 'Equally' : 'Manual'}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="mt-3 space-y-1.5">
                      {activeUnits.map((u, i) => (
                        <div key={u.id} className="flex items-center justify-between gap-3">
                          <span className="min-w-0 truncate text-sm text-fg">{u.name}</span>
                          {mode[rank] === 'EQUAL' ? (
                            <span className="shrink-0 text-sm font-semibold tabular-nums text-fg">
                              {shares[i] ?? 0}
                            </span>
                          ) : (
                            <NumberInput
                              className="h-8 w-20 shrink-0"
                              value={manual[`${u.id}:${rank}`] ?? 0}
                              disabled={save.isPending}
                              onChange={(n) =>
                                setManual((prev) => ({ ...prev, [`${u.id}:${rank}`]: n }))
                              }
                            />
                          )}
                        </div>
                      ))}
                    </div>

                    {mode[rank] === 'MANUAL' && (
                      <div className="mt-2 flex items-center gap-2 border-t border-border pt-2 text-xs">
                        <span className="tabular-nums">
                          {sum} of {pools[rank]}
                        </span>
                        {ok ? (
                          <Badge tone="success">Balanced</Badge>
                        ) : (
                          <Badge tone="warning">
                            {sum > (pools[rank] || 0)
                              ? `${sum - pools[rank]} over`
                              : `${pools[rank] - sum} left`}
                          </Badge>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* An uneven pool can't split evenly — say so rather than letting it look arbitrary. */}
              {RANKS.some(
                (r) =>
                  mode[r] === 'EQUAL' &&
                  (pools[r] || 0) > 0 &&
                  (pools[r] || 0) % activeUnits.length !== 0,
              ) && (
                <p className="text-xs text-muted">
                  Where a rank&rsquo;s seats don&rsquo;t divide evenly, the spare seats go to the
                  first units in the list.
                </p>
              )}
            </>
          )}
        </>
      )}
    </Modal>
  );
}
