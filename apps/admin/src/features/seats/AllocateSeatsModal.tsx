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
  /** Shown when the modal follows straight on from creating a movie. */
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

  // Seed editable values from any existing allocations.
  useEffect(() => {
    if (!units) return;
    const seed: Record<string, number> = {};
    units.items.forEach((u) => (seed[u.id] = 0));
    allocQuery.data?.forEach((a) => {
      const id = typeof a.unit === 'string' ? a.unit : a.unit.id;
      seed[id] = a.allocated;
    });
    setValues(seed);
  }, [units, allocQuery.data, movieId]);

  const total = useMemo(
    () => Object.values(values).reduce((s, n) => s + (Number(n) || 0), 0),
    [values],
  );
  const matches = total === capacity && capacity > 0;

  const save = useMutation({
    mutationFn: () => {
      const allocations = Object.entries(values)
        .filter(([, n]) => Number(n) > 0)
        .map(([unit, allocated]) => ({ unit, allocated: Number(allocated) }));
      return api.put(`/seat-allocations/${movieId}`, { allocations });
    },
    onSuccess: () => {
      toast.success('Allocations saved');
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
      title={movieTitle ? `Allocate seats — ${movieTitle}` : 'Allocate seats'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {/* Allocation is optional: an un-allocated movie still sells from the open pool. */}
            {isNewMovie ? 'Skip for now' : 'Close'}
          </Button>
          <Button
           
            onClick={() => save.mutate()}
            disabled={!matches}
            loading={save.isPending}
          >
            <Save className="h-3.5 w-3.5" /> Save
          </Button>
        </>
      }
    >
      {isNewMovie && (
        <p className="-mt-1 mb-4 text-sm text-muted">
          Movie created. Split its {capacity} seats across units now, or skip — unallocated
          seats stay in the common pool and anyone can book them.
        </p>
      )}

      {allocQuery.isLoading && <LoadingState />}
      {allocQuery.isError && <ErrorState message={apiErrorMessage(allocQuery.error)} />}
      {noUnits && (
        <p className="text-sm text-muted">
          No units exist yet, so there is nothing to allocate to. All {capacity} seats remain in
          the common pool.
        </p>
      )}

      {units && !noUnits && (
        <>
          <div className="mb-3 text-sm">
            Allocated <span className="font-semibold">{total}</span> / {capacity}
            <span className="ml-3">
              {matches ? (
                <Badge tone="success">Matches capacity</Badge>
              ) : (
                <Badge tone="warning">Must equal {capacity}</Badge>
              )}
            </span>
          </div>
          <div className="grid max-h-[55vh] grid-cols-1 gap-2 overflow-auto sm:grid-cols-2">
            {units.items.map((u) => (
              <div
                key={u.id}
                className="flex items-center justify-between gap-2 rounded-xl border border-border p-2.5"
              >
                <div className="truncate text-sm font-medium">{u.name}</div>
                <NumberInput
                  className="h-8 w-20"
                  value={values[u.id] ?? 0}
                  onChange={(n) => setValues((v) => ({ ...v, [u.id]: n }))}
                />
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}
