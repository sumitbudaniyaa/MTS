import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Save } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import type { Movie, Paginated, SeatAllocation, Unit } from '@/types';
import { PageHeader, LoadingState, ErrorState, Badge } from '@/components/ui/Misc';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { NumberInput } from '@/components/ui/NumberInput';
import { MoviePicker } from '@/components/MoviePicker';

export function AllocationsPage() {
  const qc = useQueryClient();
  const [movieId, setMovieId] = useState('');
  const [values, setValues] = useState<Record<string, number>>({});

  const { data: movies } = useQuery({
    queryKey: ['movies', 'all'],
    queryFn: async () => (await api.get<Paginated<Movie>>('/movies', { params: { limit: 100 } })).data,
  });
  const { data: units } = useQuery({
    queryKey: ['units', 'all'],
    queryFn: async () => (await api.get<Paginated<Unit>>('/units', { params: { limit: 100 } })).data,
  });

  const selectedMovie = movies?.items.find((m) => m.id === movieId);

  const allocQuery = useQuery({
    queryKey: ['allocations', movieId],
    enabled: !!movieId,
    queryFn: async () =>
      (await api.get<{ allocations: SeatAllocation[] }>(`/seat-allocations/${movieId}`)).data.allocations,
  });

  // Seed editable values from existing allocations when a movie is chosen.
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

  const total = useMemo(() => Object.values(values).reduce((s, n) => s + (Number(n) || 0), 0), [values]);
  const capacity = selectedMovie?.totalSeats ?? 0;
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
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  return (
    <div>
      <PageHeader title="Seat Allocation" subtitle="Distribute auditorium capacity across units" />

      <div className="mb-6">
        <h2 className="mb-2.5 text-sm font-medium text-fg">Select a movie to allocate seats</h2>
        <MoviePicker value={movieId} onChange={setMovieId} />
      </div>

      <Modal
        open={!!movieId}
        onClose={() => setMovieId('')}
        title={selectedMovie ? `Allocate — ${selectedMovie.title}` : 'Allocate seats'}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setMovieId('')}>
              Close
            </Button>
            <Button size="sm" onClick={() => save.mutate()} disabled={!matches} loading={save.isPending}>
              <Save className="h-3.5 w-3.5" /> Save
            </Button>
          </>
        }
      >
        {allocQuery.isLoading && <LoadingState />}
        {allocQuery.isError && <ErrorState message={apiErrorMessage(allocQuery.error)} />}
        {units && (
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
            <div className="grid max-h-[55vh] grid-cols-2 gap-2 overflow-auto">
              {units.items.map((u) => (
                <div
                  key={u.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-border p-2.5"
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
    </div>
  );
}
