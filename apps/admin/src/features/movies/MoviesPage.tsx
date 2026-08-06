import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Plus, Trash2, Pencil, Eye, LayoutGrid } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import type { Movie, MovieStatus, Paginated } from '@/types';
import { PageHeader, Badge, LoadingState, EmptyState, ErrorState } from '@/components/ui/Misc';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal, ConfirmDialog } from '@/components/ui/Modal';
import { Table, Th, Td, Pagination } from '@/components/ui/Table';
import { AllocateSeatsModal } from '@/features/seats/AllocateSeatsModal';
import { useRole } from '@/lib/role';
import { cn } from '@/lib/cn';

const statusTone: Record<MovieStatus, 'neutral' | 'accent' | 'success' | 'warning' | 'danger'> = {
  DRAFT: 'neutral',
  SCHEDULED: 'accent',
  OPEN: 'success',
  POOL_RELEASED: 'warning',
  COMPLETED: 'neutral',
  CLOSED: 'neutral',
  CANCELLED: 'danger',
};

function fmt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

// Booking opens 1h before showtime; movies are locked from edits after that.
function bookingHasOpened(m: Movie): boolean {
  return Date.now() >= new Date(m.startTime).getTime() - 60 * 60_000;
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
    onSuccess: (_d, v) => {
      toast.success(v.open ? 'Booking opened to all ranks' : 'Rank restrictions restored');
      qc.invalidateQueries({ queryKey: ['movies'] });
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

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
                <Td className="font-medium">{m.title}</Td>
                <Td>{fmt(m.startTime)}</Td>
                <Td>
                  {m.seatsBooked}/{m.totalSeats}
                </Td>
                <Td>
                  <div className="flex items-center gap-1.5">
                    <Badge tone={statusTone[m.status]}>{m.status}</Badge>
                    {m.openToAll && <Badge tone="success">All ranks</Badge>}
                  </div>
                </Td>
                <Td className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setViewing(m)}
                      title="View layout, booked seats & who booked them"
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </Button>
                    {canManageMovies && (
                      <>
                        <Button
                          size="sm"
                          variant="secondary"
                          loading={openAll.isPending && openAll.variables?.id === m.id}
                          onClick={() => openAll.mutate({ id: m.id, open: !m.openToAll })}
                          title="Allow any rank to book this movie"
                        >
                          {m.openToAll ? 'Restrict ranks' : 'Open to all'}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setAllocating(m)}
                          title="Allocate seats across units"
                        >
                          <LayoutGrid className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={bookingHasOpened(m)}
                          onClick={() => setEditing(m)}
                          title={bookingHasOpened(m) ? 'Locked — booking has opened' : 'Edit'}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setDeleting(m)} title="Delete">
                          <Trash2 className="h-3.5 w-3.5 text-danger" />
                        </Button>
                      </>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
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
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && del.mutate(deleting.id)}
        title="Delete movie"
        message={`Delete "${deleting?.title}"? Movies with allocations cannot be deleted.`}
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
      title="New movie"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={totalSeats === 0}
            onClick={handleSubmit((v) => save.mutate(v))}
            loading={save.isPending}
          >
            Create
          </Button>
        </>
      }
    >
      <Input label="Title" error={errors.title?.message} {...register('title', { required: 'Required' })} />
      <Input label="Description (optional)" {...register('description')} />

      {/* Poster upload */}
      <div>
        <label className="label">Poster</label>
        <div className="flex items-center gap-3">
          {poster ? (
            <img src={poster} alt="poster" className="h-16 w-12 rounded-md object-cover" />
          ) : (
            <div className="flex h-16 w-12 items-center justify-center rounded-md border border-dashed border-border text-[10px] text-muted">
              none
            </div>
          )}
          <div className="flex items-center gap-2">
            <label className="cursor-pointer rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-surface-2">
              Upload image
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => onPoster(e.target.files?.[0])}
              />
            </label>
            {poster && (
              <button type="button" className="text-xs text-danger" onClick={() => setPoster('')}>
                Remove
              </button>
            )}
          </div>
        </div>
      </div>

      <Input
        label="Show date & time"
        type="datetime-local"
        error={errors.startTime?.message}
        {...register('startTime', { required: 'Required' })}
      />

      <Input
        label="Duration (minutes)"
        type="number"
        inputMode="numeric"
        defaultValue={180}
        error={errors.durationMinutes?.message}
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
      title="Edit movie"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" loading={save.isPending} onClick={handleSubmit((v) => save.mutate(v))}>
            Save
          </Button>
        </>
      }
    >
      <Input label="Title" error={errors.title?.message} {...register('title', { required: 'Required' })} />
      <Input label="Description" {...register('description')} />
      <div>
        <label className="label">Poster</label>
        <div className="flex items-center gap-3">
          {poster ? (
            <img src={poster} alt="poster" className="h-16 w-12 rounded-md object-cover" />
          ) : (
            <div className="flex h-16 w-12 items-center justify-center rounded-md border border-dashed border-border text-[10px] text-muted">
              none
            </div>
          )}
          <div className="flex items-center gap-2">
            <label className="cursor-pointer rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-surface-2">
              Upload image
              <input type="file" accept="image/*" className="hidden" onChange={(e) => onPoster(e.target.files?.[0])} />
            </label>
            {poster && (
              <button type="button" className="text-xs text-danger" onClick={() => setPoster('')}>
                Remove
              </button>
            )}
          </div>
        </div>
      </div>
      <Input
        label="Show date & time"
        type="datetime-local"
        error={errors.startTime?.message}
        {...register('startTime', { required: 'Required' })}
      />
      <Input
        label="Duration (minutes)"
        type="number"
        inputMode="numeric"
        error={errors.durationMinutes?.message}
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
}

function MovieDetailModal({ movie, onClose }: { movie: Movie; onClose: () => void }) {
  const [selected, setSelected] = useState<DetailSeat | null>(null);
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
            {data.movie.openToAll && <Badge tone="success">All ranks</Badge>}
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
