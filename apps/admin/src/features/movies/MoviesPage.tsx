import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Plus, Trash2, Pencil, Eye, LayoutGrid, ImagePlus, Film } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import type { Movie, MovieStatus, Paginated } from '@/types';
import { PageHeader, Badge, Card, LoadingState, EmptyState, ErrorState } from '@/components/ui/Misc';
import { Button } from '@/components/ui/Button';
import { Tooltip } from '@/components/ui/Tooltip';
import { Input } from '@/components/ui/Input';
import { Modal, ConfirmDialog } from '@/components/ui/Modal';
import { Table, Th, Td, Pagination } from '@/components/ui/Table';
import { AllocateSeatsModal } from '@/features/seats/AllocateSeatsModal';
import { useRole } from '@/lib/role';
import { useLiveMovies } from '@/hooks/useLiveMovies';
import { useLiveMovieDetail } from '@/hooks/useLiveMovieDetail';
import { cn } from '@/lib/cn';

const statusTone: Record<MovieStatus, 'neutral' | 'accent' | 'success' | 'warning' | 'danger'> = {
  DRAFT: 'neutral',
  SCHEDULED: 'accent',
  OPEN: 'success',
  COMPLETED: 'neutral',
  CLOSED: 'neutral',
  CANCELLED: 'danger',
};

function fmt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

// Booking opens `visibilityLeadMinutes` before showtime, and movies lock for edits from that
// moment. The lead is admin-configurable, so it has to be read — hardcoding an hour meant
// changing it in Settings moved the server's rule while this page carried on locking at 60
// minutes, so Edit looked available and then 409'd.
function bookingHasOpened(m: Movie, leadMinutes: number): boolean {
  return Date.now() >= new Date(m.startTime).getTime() - leadMinutes * 60_000;
}

// A finished show has nothing left to act on: its quota is spent, edit and delete are already
// locked by the booking window, and "open to all" can't change a screening that is over. The
// row keeps only View, which is what an admin actually wants there — who sat where.
const FINISHED: MovieStatus[] = ['COMPLETED', 'CLOSED', 'CANCELLED'];
function isFinished(m: Movie): boolean {
  return FINISHED.includes(m.status);
}

// Convert an ISO timestamp to the value a <input type="datetime-local"> expects.
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 16);
}

export function MoviesPage() {
  const qc = useQueryClient();
  const { canManageMovies } = useRole();
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [allocating, setAllocating] = useState<Movie | null>(null);
  // Distinguishes "just created" (shows the intro copy + Skip) from editing an existing split.
  const [justCreatedId, setJustCreatedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Movie | null>(null);
  const [deleting, setDeleting] = useState<Movie | null>(null);
  const [viewing, setViewing] = useState<Movie | null>(null);
  // Opening the pool cannot be undone (the server refuses to close it), so it gets a confirm.
  const [opening, setOpening] = useState<Movie | null>(null);

  // Status and seat counts move on their own (cron jobs) — keep the table in step.
  useLiveMovies();

  // Both admin tiers may read the timings; only the lead matters here. Falls back to the
  // server's own default until it loads.
  const { data: timings } = useQuery({
    queryKey: ['settings'],
    queryFn: async () =>
      (await api.get<{ settings: { visibilityLeadMinutes: number } }>('/settings')).data.settings,
    staleTime: 60_000,
  });
  const leadMinutes = timings?.visibilityLeadMinutes ?? 60;

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['movies', page],
    queryFn: async () => (await api.get<Paginated<Movie>>('/movies', { params: { page } })).data,
  });

  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/movies/${id}`),
    onSuccess: () => {
      toast.success('Movie deleted');
      setDeleting(null);
      qc.invalidateQueries({ queryKey: ['movies'] });
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const openAll = useMutation({
    mutationFn: ({ id, open }: { id: string; open: boolean }) =>
      api.post(`/seating/movies/${id}/open-all`, { open }),
    onSuccess: () => {
      toast.success('Pool opened — unit allocations no longer apply');
      setOpening(null);
      qc.invalidateQueries({ queryKey: ['movies'] });
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  /**
   * Row actions, shared by the desktop table and the mobile card list so the visibility rules
   * (delete only while unbooked, edit/allocate only before booking opens, open-to-all only
   * while the show is live) live in exactly one place.
   */
  const actionsFor = (m: Movie) => (
    <div className="flex justify-end gap-1">
      <Tooltip label="View layout, booked seats & who booked them">
        <Button size="sm" variant="ghost" onClick={() => setViewing(m)}>
          <Eye className="h-3.5 w-3.5" />
        </Button>
      </Tooltip>
      {canManageMovies && !isFinished(m) && (
        <>
          {/* Open to all stays available right through the screening — it is how
              an admin frees up a half-empty show mid-run. */}
          {/* No "close pool" counterpart: it is a one-way door, so offering a toggle would
              promise something the server refuses. Once open, the badge on the row says so. */}
          {!m.openToAll && (
            <Button
              size="sm"
              variant="secondary"
              loading={openAll.isPending && openAll.variables?.id === m.id}
              onClick={() => setOpening(m)}
              title="Release unbooked seats to the general pool — cannot be undone"
            >
              Open pool
            </Button>
          )}
          {/* Allocation and details are frozen the moment booking opens: people
              are choosing seats against these numbers from that point on. */}
          {!bookingHasOpened(m, leadMinutes) && (
            <>
              <Tooltip label="Allocate seats across units">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setAllocating(m)}
                >
                  <LayoutGrid className="h-3.5 w-3.5" />
                </Button>
              </Tooltip>
              <Tooltip label="Edit">
                <Button size="sm" variant="ghost" onClick={() => setEditing(m)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              </Tooltip>
            </>
          )}
          {/* Deletable for exactly as long as nobody holds a ticket. */}
          {m.seatsBooked === 0 && (
            <Tooltip label="Delete">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setDeleting(m)}
              >
                <Trash2 className="h-3.5 w-3.5 text-danger" />
              </Button>
            </Tooltip>
          )}
        </>
      )}
    </div>
  );


  return (
    <div>
      <PageHeader
        title="Movies"
        subtitle={canManageMovies ? 'Scheduled shows' : 'Scheduled shows (read-only)'}
        action={
          canManageMovies ? (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="h-3.5 w-3.5" /> New movie
            </Button>
          ) : undefined
        }
      />

      {isLoading && <LoadingState />}
      {isError && <ErrorState message={apiErrorMessage(error)} />}
      {data && data.items.length === 0 && <EmptyState title="No movies yet" />}

      {data && data.items.length > 0 && (
        <>
          {/* Phones get cards. A five-column table on a handset either scrolls sideways or
              crushes every column, and the operational admin works from a phone at the venue. */}
          <div className="space-y-2.5 md:hidden">
            {data.items.map((m) => (
              <Card key={m.id} className="p-4">
                <div className="flex items-start gap-3">
                  <Poster src={m.poster} className="h-[4.5rem] w-12" />
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate font-medium text-fg">{m.title}</h2>
                    <p className="mt-0.5 text-xs text-muted">{fmt(m.startTime)}</p>
                  </div>
                  <span className="shrink-0 text-xs tabular-nums text-muted">
                    {m.seatsBooked}/{m.totalSeats}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <Badge tone={statusTone[m.status]}>{m.status}</Badge>
                  {m.openToAll && <Badge tone="success">Open pool</Badge>}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-1 border-t border-border pt-3">
                  {actionsFor(m)}
                </div>
              </Card>
            ))}
          </div>

          <div className="hidden md:block">
          <Table
            head={
              <tr>
                <Th>Title</Th>
                <Th>Start time</Th>
                <Th>Seats</Th>
                <Th>Status</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            }
          >
            {data.items.map((m) => (
              <tr key={m.id}>
                <Td className="font-medium">
                  <div className="flex items-center gap-2.5">
                    <Poster src={m.poster} className="h-11 w-[1.85rem]" />
                    <span className="min-w-0 truncate">{m.title}</span>
                  </div>
                </Td>
                <Td>{fmt(m.startTime)}</Td>
                <Td>
                  {m.seatsBooked}/{m.totalSeats}
                </Td>
                <Td>
                  <div className="flex items-center gap-1.5">
                    <Badge tone={statusTone[m.status]}>{m.status}</Badge>
                    {m.openToAll && <Badge tone="success">Open pool</Badge>}
                  </div>
                </Td>
                <Td className="text-right">{actionsFor(m)}</Td>
              </tr>
            ))}
          </Table>
          </div>
          <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPage={setPage} />
        </>
      )}

      {creating && (
        <MovieFormModal
          onClose={() => setCreating(false)}
          onSaved={(movie) => {
            setCreating(false);
            qc.invalidateQueries({ queryKey: ['movies'] });
            // Continue straight into seat allocation rather than making the admin find it
            // under a separate nav item. Skipping is allowed — see AllocateSeatsModal.
            setJustCreatedId(movie.id);
            setAllocating(movie);
          }}
        />
      )}

      {allocating && (
        <AllocateSeatsModal
          isNewMovie={allocating.id === justCreatedId}
          movieId={allocating.id}
          movieTitle={allocating.title}
          capacity={allocating.totalSeats}
          onClose={() => {
            setAllocating(null);
            setJustCreatedId(null);
          }}
        />
      )}

      {editing && (
        <EditMovieModal
          movie={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            qc.invalidateQueries({ queryKey: ['movies'] });
          }}
        />
      )}

      {viewing && <MovieDetailModal movie={viewing} onClose={() => setViewing(null)} />}

      <ConfirmDialog
        open={!!opening}
        onClose={() => setOpening(null)}
        onConfirm={() => opening && openAll.mutate({ id: opening.id, open: true })}
        title="Open the pool?"
        message={
          `Release "${opening?.title}" to the general pool? Unit allocations stop applying ` +
          `immediately and anyone may book any remaining seat. This cannot be undone.`
        }
        confirmLabel="Open pool"
        loading={openAll.isPending}
      />

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && del.mutate(deleting.id)}
        title="Delete movie"
        // Stale copy claimed allocations block deletion — they never did. The only rule is
        // `seatsBooked > 0`, and the button is hidden in that case, so this dialog is only ever
        // reached for a movie nobody has booked. Say what actually happens instead.
        message={`Delete "${deleting?.title}"? Its seats and unit allocations go with it. This cannot be undone.`}
        confirmLabel="Delete"
        danger
        loading={del.isPending}
      />
    </div>
  );
}

interface MovieForm {
  title: string;
  description?: string;
  startTime: string;
  durationMinutes: number;
}

function MovieFormModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (movie: Movie) => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<MovieForm>();

  const [poster, setPoster] = useState<string>('');

  // Total seats come from the auditorium layout (single source of truth).
  const { data: auditorium } = useQuery({
    queryKey: ['auditorium'],
    queryFn: async () =>
      (await api.get<{ auditorium: { rows: { seats: unknown[] }[] } }>('/seating/auditorium')).data
        .auditorium,
  });
  const totalSeats = (auditorium?.rows ?? []).reduce((s, r) => s + r.seats.length, 0);

  const onPoster = (file: File | undefined) => {
    if (!file) return;
    if (file.size > 4_000_000) {
      toast.error('Image too large (max 4MB)');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setPoster(String(reader.result));
    reader.readAsDataURL(file);
  };

  const save = useMutation({
    mutationFn: async (v: MovieForm) =>
      (
        await api.post<{ movie: Movie }>('/movies', {
          title: v.title,
          description: v.description || undefined,
          poster: poster || undefined,
          startTime: new Date(v.startTime).toISOString(),
          durationMinutes: Number(v.durationMinutes) || 180,
        })
      ).data.movie,
    onSuccess: (movie) => {
      toast.success('Movie created');
      onSaved(movie);
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  return (
    <Modal
      open
      onClose={onClose}
      loading={save.isPending}
      title="New movie"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button
           
            disabled={totalSeats === 0 || save.isPending}
            onClick={handleSubmit((v) => save.mutate(v))}
            loading={save.isPending}
          >
            Create
          </Button>
        </>
      }
    >
      <Input label="Title" error={errors.title?.message} disabled={save.isPending} {...register('title', { required: 'Required' })} />
      <Input label="Description (optional)" disabled={save.isPending} {...register('description')} />

      <PosterField value={poster} onChange={setPoster} onFile={onPoster} disabled={save.isPending} />

      <Input
        label="Show date & time"
        type="datetime-local"
        error={errors.startTime?.message}
        disabled={save.isPending}
        {...register('startTime', { required: 'Required' })}
      />

      <Input
        label="Duration (minutes)"
        type="number"
        inputMode="numeric"
        defaultValue={180}
        error={errors.durationMinutes?.message}
        disabled={save.isPending}
        {...register('durationMinutes', {
          valueAsNumber: true,
          min: { value: 1, message: 'Must be at least 1 minute' },
        })}
      />
      <p className="-mt-1 text-xs text-muted">
        Booking stays open until the show ends (start + duration).
      </p>

      {/* Total seats are fixed by the auditorium layout */}
      <div className="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm">
        {totalSeats > 0 ? (
          <span>
            Total seats: <span className="font-semibold">{totalSeats}</span>{' '}
            <span className="text-muted">(from the auditorium layout)</span>
          </span>
        ) : (
          <span className="text-danger">Design the auditorium layout before creating a movie.</span>
        )}
      </div>
    </Modal>
  );
}

interface EditMovieForm {
  title: string;
  description?: string;
  startTime: string;
  durationMinutes: number;
  status: MovieStatus;
}

function EditMovieModal({
  movie,
  onClose,
  onSaved,
}: {
  movie: Movie;
  onClose: () => void;
  onSaved: () => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<EditMovieForm>({
    defaultValues: {
      title: movie.title,
      description: movie.description,
      startTime: toLocalInput(movie.startTime),
      durationMinutes: movie.durationMinutes ?? 180,
      status: movie.status,
    },
  });
  const [poster, setPoster] = useState<string>(movie.poster ?? '');

  const onPoster = (file: File | undefined) => {
    if (!file) return;
    if (file.size > 4_000_000) {
      toast.error('Image too large (max 4MB)');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setPoster(String(reader.result));
    reader.readAsDataURL(file);
  };

  const save = useMutation({
    mutationFn: (v: EditMovieForm) =>
      api.patch(`/movies/${movie.id}`, {
        title: v.title,
        description: v.description ?? '',
        poster,
        startTime: new Date(v.startTime).toISOString(),
        durationMinutes: Number(v.durationMinutes) || 180,
        status: v.status,
      }),
    onSuccess: () => {
      toast.success('Movie updated');
      onSaved();
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  return (
    <Modal
      open
      onClose={onClose}
      loading={save.isPending}
      title="Edit movie"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button loading={save.isPending} onClick={handleSubmit((v) => save.mutate(v))}>
            Save
          </Button>
        </>
      }
    >
      <Input label="Title" error={errors.title?.message} disabled={save.isPending} {...register('title', { required: 'Required' })} />
      <Input label="Description" disabled={save.isPending} {...register('description')} />
      <PosterField value={poster} onChange={setPoster} onFile={onPoster} disabled={save.isPending} />
      <Input
        label="Show date & time"
        type="datetime-local"
        error={errors.startTime?.message}
        disabled={save.isPending}
        {...register('startTime', { required: 'Required' })}
      />
      <Input
        label="Duration (minutes)"
        type="number"
        inputMode="numeric"
        error={errors.durationMinutes?.message}
        disabled={save.isPending}
        {...register('durationMinutes', {
          valueAsNumber: true,
          min: { value: 1, message: 'Must be at least 1 minute' },
        })}
      />
      <p className="text-xs text-muted">Editing is locked once booking opens (1 hour before showtime).</p>
    </Modal>
  );
}

// ---- Movie detail: layout + who booked what --------------------------------

interface DetailSeat {
  label: string;
  row: string;
  number: number;
  status: 'FREE' | 'HELD' | 'BOOKED';
  allowedRanks: string[];
  ticketCode: string | null;
  checkedIn: boolean;
  bookedBy: { mobile: string; rank: string | null; unit: string | null } | null;
}
interface DetailBooking {
  id: string;
  mobile: string;
  rank: string | null;
  unit: string | null;
  cancelled: boolean;
  createdAt: string;
  tickets: { seatLabel: string | null; status: string; checkedIn: boolean }[];
}
interface DetailAllocation {
  unit: string;
  allocated: number;
  /** Seats the unit's members actually hold — can exceed `allocated` once the pool is open. */
  booked: number;
  /** The quota counter, which stops moving at pool-open. Kept only to distinguish the two. */
  quotaUsed: number;
  released: number;
  remaining: number;
  /** Seats beyond the allocation, i.e. taken from the open pool. */
  overQuota: number;
}
interface MovieDetail {
  movie: {
    id: string;
    title: string;
    startTime: string;
    durationMinutes?: number;
    endTime: string;
    status: MovieStatus;
    totalSeats: number;
    seatsBooked: number;
    openToAll?: boolean;
  };
  rows: string[];
  seats: DetailSeat[];
  bookings: DetailBooking[];
  allocations: DetailAllocation[];
}

function MovieDetailModal({ movie, onClose }: { movie: Movie; onClose: () => void }) {
  const [selected, setSelected] = useState<DetailSeat | null>(null);
  // Watching a show fill up is the reason this dialog gets opened, so keep it live rather than
  // showing a snapshot from whenever it happened to open.
  useLiveMovieDetail(movie.id);
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['movie-detail', movie.id],
    queryFn: async () =>
      (await api.get<MovieDetail>(`/seating/movies/${movie.id}/detail`)).data,
  });

  const grouped = (() => {
    if (!data) return [] as { row: string; seats: DetailSeat[] }[];
    const map = new Map<string, DetailSeat[]>();
    data.seats.forEach((s) => {
      if (!map.has(s.row)) map.set(s.row, []);
      map.get(s.row)!.push(s);
    });
    return [...map.entries()].map(([row, seats]) => ({
      row,
      seats: seats.sort((a, b) => a.number - b.number),
    }));
  })();

  const booked = data?.seats.filter((s) => s.status === 'BOOKED').length ?? 0;
  const checkedIn = data?.seats.filter((s) => s.checkedIn).length ?? 0;
  const held = data?.seats.filter((s) => s.status === 'HELD').length ?? 0;

  return (
    <Modal open onClose={onClose} title={movie.title} size="xl">
      {isLoading && <LoadingState />}
      {isError && <ErrorState message={apiErrorMessage(error)} />}
      {data && (
        <div className="space-y-5">
          {/* summary */}
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge tone={statusTone[data.movie.status]}>{data.movie.status}</Badge>
            {data.movie.openToAll && <Badge tone="success">Open pool</Badge>}
            <Badge tone="accent">
              {booked}/{data.movie.totalSeats} booked
            </Badge>
            <Badge tone="success">{checkedIn} checked in</Badge>
            {held > 0 && <Badge tone="warning">{held} on hold</Badge>}
            <span className="text-muted">
              {fmt(data.movie.startTime)} → {fmt(data.movie.endTime)}
            </span>
          </div>

          {/* legend */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
            <LegendDot cls="border border-border bg-surface" label="Free" />
            <LegendDot cls="bg-accent" label="Booked" />
            <LegendDot cls="bg-success" label="Checked in" />
            <LegendDot cls="bg-warning" label="On hold" />
          </div>

          {/* layout */}
          {data.seats.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">No seats generated for this movie.</p>
          ) : (
            <div className="overflow-x-auto">
              <div className="mx-auto w-max">
                <div className="mb-4">
                  <div className="h-1.5 rounded-full bg-fg/70" />
                  <p className="mt-1 text-center text-[10px] uppercase tracking-widest text-muted">
                    Screen
                  </p>
                </div>
                <div className="space-y-1.5">
                  {grouped.map(({ row, seats }) => (
                    <div key={row} className="flex items-center justify-center gap-1.5">
                      <span className="w-4 shrink-0 text-center text-[10px] font-medium text-muted">
                        {row}
                      </span>
                      <div className="flex gap-1">
                        {seats.map((s) => {
                          const tone =
                            s.checkedIn
                              ? 'bg-success text-white'
                              : s.status === 'BOOKED'
                                ? 'bg-accent text-white'
                                : s.status === 'HELD'
                                  ? 'bg-warning text-white'
                                  : 'border border-border bg-surface text-fg';
                          const isSel = selected?.label === s.label;
                          return (
                            <button
                              key={s.label}
                              onClick={() => setSelected(s)}
                              title={
                                s.bookedBy
                                  ? `${s.label} · ${s.bookedBy.mobile}${s.bookedBy.rank ? ` (${s.bookedBy.rank})` : ''}`
                                  : s.label
                              }
                              className={cn(
                                'flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[9px] font-medium transition',
                                tone,
                                isSel && 'ring-2 ring-fg ring-offset-1 ring-offset-surface',
                              )}
                            >
                              {s.number}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* selected seat detail */}
          {selected && (
            <div className="rounded-lg border border-border bg-surface-2 p-3 text-sm">
              <div className="mb-1 flex items-center justify-between">
                <span className="font-semibold">Seat {selected.label}</span>
                <Badge
                  tone={
                    selected.checkedIn
                      ? 'success'
                      : selected.status === 'BOOKED'
                        ? 'accent'
                        : selected.status === 'HELD'
                          ? 'warning'
                          : 'neutral'
                  }
                >
                  {selected.checkedIn ? 'CHECKED IN' : selected.status}
                </Badge>
              </div>
              {selected.bookedBy ? (
                <div className="text-muted">
                  Booked by <span className="font-medium text-fg">{selected.bookedBy.mobile}</span>
                  {selected.bookedBy.rank && ` · ${selected.bookedBy.rank}`}
                  {selected.bookedBy.unit && ` · ${selected.bookedBy.unit}`}
                </div>
              ) : (
                <div className="text-muted">
                  {selected.status === 'FREE' ? 'Available' : 'On temporary hold'} ·{' '}
                  {selected.allowedRanks.length ? `Ranks: ${selected.allowedRanks.join('/')}` : 'All ranks'}
                </div>
              )}
            </div>
          )}

          {/* allocation quota */}
          {data.allocations.length > 0 && (
            <div>
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold">Seats by unit</h3>
                {data.movie.openToAll && (
                  <p className="text-xs text-muted">
                    Pool is open — units may book beyond their allocation.
                  </p>
                )}
              </div>
              <Table
                head={
                  <tr>
                    <Th>Unit</Th>
                    <Th>Allocated</Th>
                    <Th>Holding</Th>
                    <Th>Released</Th>
                    <Th>Status</Th>
                  </tr>
                }
              >
                {data.allocations.map((a) => (
                  <tr key={a.unit}>
                    <Td className="font-medium">{a.unit}</Td>
                    <Td>{a.allocated}</Td>
                    {/* Live count, not the frozen quota counter — so it reads above `allocated`
                        when a unit has taken seats from the open pool. */}
                    <Td className={cn('tabular-nums', a.overQuota > 0 && 'font-semibold text-fg')}>
                      {a.booked}
                    </Td>
                    <Td>{a.released}</Td>
                    <Td>
                      {a.overQuota > 0 ? (
                        <Badge tone="accent">+{a.overQuota} from pool</Badge>
                      ) : a.remaining === 0 ? (
                        <Badge tone="warning">Full</Badge>
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          {a.remaining}
                          <Badge tone="success">Available</Badge>
                        </span>
                      )}
                    </Td>
                  </tr>
                ))}
              </Table>
            </div>
          )}

          {/* bookings list */}
          <div>
            <h3 className="mb-2 text-sm font-semibold">Bookings ({data.bookings.length})</h3>
            {data.bookings.length === 0 ? (
              <p className="text-sm text-muted">No bookings yet.</p>
            ) : (
              <Table
                head={
                  <tr>
                    <Th>Mobile</Th>
                    <Th>Rank</Th>
                    <Th>Unit</Th>
                    <Th>Seats</Th>
                    <Th>Booked</Th>
                  </tr>
                }
              >
                {data.bookings.map((b) => {
                  const live = b.tickets.filter((t) => t.status === 'BOOKED' || t.status === 'CHECKED_IN');
                  const seatLabels = live.map((t) => t.seatLabel).filter(Boolean).join(', ');
                  return (
                    <tr key={b.id} className={b.cancelled ? 'opacity-50' : undefined}>
                      <Td className="font-medium">{b.mobile}</Td>
                      <Td>{b.rank ?? '—'}</Td>
                      <Td>{b.unit ?? '—'}</Td>
                      <Td>
                        {b.cancelled ? (
                          <span className="text-muted line-through">cancelled</span>
                        ) : (
                          seatLabels || '—'
                        )}
                        {b.tickets.some((t) => t.checkedIn) && (
                          <span className="ml-1.5 inline-block">
                            <Badge tone="success">checked in</Badge>
                          </span>
                        )}
                      </Td>
                      <Td className="whitespace-nowrap text-muted">{fmt(b.createdAt)}</Td>
                    </tr>
                  );
                })}
              </Table>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function LegendDot({ cls, label }: { cls: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={cn('h-3 w-3 rounded', cls)} /> {label}
    </span>
  );
}

/**
 * Poster picker. A single large drop-target that *is* the preview once an image is chosen —
 * the old version was a thumbnail beside a text button, which on a phone gave you a 12x16
 * preview too small to tell one poster from another and two tiny tap targets.
 *
 * Accepts a drop as well as a tap, and keeps the 2:3 poster aspect so what you see here is
 * what the card and the user app will show.
 */
function PosterField({
  value,
  onChange,
  onFile,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onFile: (file: File | undefined) => void;
  disabled?: boolean;
}) {
  const [over, setOver] = useState(false);

  return (
    <div>
      <label className="label">Poster</label>
      <div
        onDragOver={(e) => {
          if (disabled) return;
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => !disabled && setOver(false)}
        onDrop={(e) => {
          if (disabled) return;
          e.preventDefault();
          setOver(false);
          onFile(e.dataTransfer.files?.[0]);
        }}
        className={cn(
          'relative overflow-hidden rounded-2xl border-2 border-dashed transition-colors',
          over ? 'border-accent bg-accent/5' : 'border-border bg-surface-2/40',
        )}
      >
        {value ? (
          <div className="flex items-center gap-4 p-3">
            <img
              src={value}
              alt=""
              decoding="async"
              className="h-28 w-[4.75rem] shrink-0 rounded-xl object-cover ring-1 ring-border"
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-fg">Poster added</p>
              <p className="mt-0.5 text-xs text-muted">Shown on the movie card and in the app.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <label className={cn("cursor-pointer rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-fg hover:bg-surface-2", disabled && "opacity-50 cursor-not-allowed pointer-events-none")}>
                  Replace
                  <input
                    type="file"
                    accept="image/*"
                    disabled={disabled}
                    className="hidden"
                    onChange={(e) => onFile(e.target.files?.[0])}
                  />
                </label>
                <button
                  type="button"
                  disabled={disabled}
                  className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-danger hover:bg-surface-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={() => onChange('')}
                >
                  Remove
                </button>
              </div>
            </div>
          </div>
        ) : (
          <label className={cn("flex cursor-pointer flex-col items-center justify-center gap-1.5 px-4 py-7 text-center", disabled && "opacity-50 cursor-not-allowed pointer-events-none")}>
            <ImagePlus className="h-6 w-6 text-muted" />
            <span className="text-sm font-medium text-fg">Add a poster</span>
            <span className="text-xs text-muted">Tap to choose &middot; or drop an image here</span>
            <span className="text-[11px] text-muted">JPG or PNG, up to 4&nbsp;MB</span>
            <input
              type="file"
              accept="image/*"
              disabled={disabled}
              className="hidden"
              onChange={(e) => onFile(e.target.files?.[0])}
            />
          </label>
        )}
      </div>
    </div>
  );
}

/**
 * Movie poster thumbnail, 2:3 like the real thing. Falls back to a film glyph rather than an
 * empty box so a row without artwork still reads as a movie and the list stays aligned.
 */
function Poster({ src, className }: { src?: string; className?: string }) {
  if (!src) {
    return (
      <div
        className={cn(
          'flex shrink-0 items-center justify-center rounded-lg bg-surface-2 ring-1 ring-border',
          className,
        )}
      >
        <Film className="h-4 w-4 text-muted" />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt=""
      // Posters are base64 data URLs and can be large; keep the decode off the main thread.
      decoding="async"
      loading="lazy"
      className={cn('shrink-0 rounded-lg bg-surface-2 object-cover ring-1 ring-border', className)}
    />
  );
}
