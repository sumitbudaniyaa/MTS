import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2, Copy, Pencil } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { PageHeader, Card, LoadingState, EmptyState } from '@/components/ui/Misc';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { NumberInput } from '@/components/ui/NumberInput';
import { Modal } from '@/components/ui/Modal';
import { cn } from '@/lib/cn';

type Rank = 'OFFICER' | 'JCO' | 'JAWAN';
const RANKS: Rank[] = ['OFFICER', 'JCO', 'JAWAN'];

interface ApiSeat {
  number: number;
  allowedRanks: Rank[];
}
interface ApiRow {
  label: string;
  seats: ApiSeat[];
}
interface RowEdit {
  label: string;
  seatCount: number;
  allowedRanks: Rank[];
}

function rowLabel(i: number): string {
  let n = i + 1;
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const rankTint: Record<Rank, string> = {
  OFFICER: 'bg-blue-500/20 border-blue-500/40',
  JCO: 'bg-amber-500/20 border-amber-500/40',
  JAWAN: 'bg-emerald-500/20 border-emerald-500/40',
};
function seatTint(ranks: Rank[]): string {
  if (ranks.length === 0) return 'bg-surface-2 border-border';
  if (ranks.length === 1) return rankTint[ranks[0]!];
  return 'bg-fg/15 border-fg/30';
}

function collapse(rows: ApiRow[]): RowEdit[] {
  return rows.map((r) => ({
    label: r.label,
    seatCount: r.seats.length,
    allowedRanks: (r.seats[0]?.allowedRanks ?? []) as Rank[],
  }));
}
function expand(rows: RowEdit[]): ApiRow[] {
  return rows.map((r) => ({
    label: r.label.trim().toUpperCase(),
    seats: Array.from({ length: Math.max(0, r.seatCount) }, (_, i) => ({
      number: i + 1,
      allowedRanks: r.allowedRanks,
    })),
  }));
}

function RankToggles({ value, onToggle }: { value: Rank[]; onToggle: (r: Rank) => void }) {
  return (
    <div className="flex gap-1.5">
      {RANKS.map((rank) => {
        const on = value.includes(rank);
        return (
          <button
            key={rank}
            type="button"
            onClick={() => onToggle(rank)}
            className={cn(
              'rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors',
              on ? 'border-accent bg-accent/10 text-accent' : 'border-border text-muted',
            )}
          >
            {rank}
          </button>
        );
      })}
    </div>
  );
}

function Legend({ cls, label }: { cls: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={cn('h-3 w-3 rounded border', cls)} /> {label}
    </span>
  );
}

/** Read-only visual auditorium (screen + seat rows + legend). */
function AuditoriumView({ rows }: { rows: RowEdit[] }) {
  return (
    <Card className="p-5">
      <div className="mx-auto mb-6 w-2/3 max-w-md">
        <div className="h-2 rounded-t-[50%] bg-fg/70" />
        <p className="mt-1 text-center text-[10px] uppercase tracking-[0.3em] text-muted">Screen</p>
      </div>

      <div className="space-y-1.5 overflow-x-auto pb-2">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center justify-center gap-2">
            <span className="w-6 shrink-0 text-center text-[11px] font-semibold text-muted">
              {row.label}
            </span>
            <div className="flex gap-1">
              {Array.from({ length: Math.min(row.seatCount, 60) }, (_, n) => (
                <span
                  key={n}
                  title={`${row.label}${n + 1}`}
                  className={cn('h-5 w-5 rounded border', seatTint(row.allowedRanks))}
                />
              ))}
              {row.seatCount > 60 && (
                <span className="self-center pl-1 text-[10px] text-muted">+{row.seatCount - 60}</span>
              )}
            </div>
            <span className="w-6 shrink-0" />
          </div>
        ))}
      </div>

      <div className="mt-5 flex flex-wrap justify-center gap-x-4 gap-y-1 text-[10px] text-muted">
        <Legend cls="bg-surface-2 border-border" label="All ranks" />
        <Legend cls={rankTint.OFFICER} label="Officer" />
        <Legend cls={rankTint.JCO} label="JCO" />
        <Legend cls={rankTint.JAWAN} label="Jawan" />
        <Legend cls="bg-fg/15 border-fg/30" label="Mixed" />
      </div>
    </Card>
  );
}

export function AuditoriumPage() {
  const [editing, setEditing] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['auditorium'],
    queryFn: async () =>
      (await api.get<{ auditorium: { name: string; rows: ApiRow[] } }>('/seating/auditorium')).data
        .auditorium,
  });

  const rows = data ? collapse(data.rows) : [];
  const totalSeats = rows.reduce((s, r) => s + r.seatCount, 0);

  return (
    <div>
      <PageHeader
        title="Auditorium"
        subtitle={`Seating layout · ${totalSeats} seats`}
        action={
          <Button size="sm" onClick={() => setEditing(true)}>
            <Pencil className="h-3.5 w-3.5" /> Edit layout
          </Button>
        }
      />

      {isLoading && <LoadingState />}
      {data && rows.length === 0 && (
        <Card>
          <EmptyState title="No layout yet" hint="Click “Edit layout” to design the auditorium." />
        </Card>
      )}
      {data && rows.length > 0 && <AuditoriumView rows={rows} />}

      {editing && (
        <EditLayoutDialog initial={rows} onClose={() => setEditing(false)} />
      )}
    </div>
  );
}

function EditLayoutDialog({ initial, onClose }: { initial: RowEdit[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [rows, setRows] = useState<RowEdit[]>(initial);
  const [selected, setSelected] = useState<number | null>(null);
  const [bulkRows, setBulkRows] = useState(5);
  const [bulkSeats, setBulkSeats] = useState(12);
  const [bulkRanks, setBulkRanks] = useState<Rank[]>([]);

  const total = rows.reduce((s, r) => s + (Number(r.seatCount) || 0), 0);

  const save = useMutation({
    mutationFn: () => api.put('/seating/auditorium', { rows: expand(rows) }),
    onSuccess: () => {
      toast.success('Auditorium layout saved');
      qc.invalidateQueries({ queryKey: ['auditorium'] });
      onClose();
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const setRow = (i: number, patch: Partial<RowEdit>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const addBulk = () => {
    const start = rows.length;
    const added = Array.from({ length: Math.max(1, bulkRows) }, (_, k) => ({
      label: rowLabel(start + k),
      seatCount: Math.max(1, bulkSeats),
      allowedRanks: [...bulkRanks],
    }));
    setRows((rs) => [...rs, ...added]);
  };

  const sel = selected !== null ? rows[selected] : null;

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit auditorium layout"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" loading={save.isPending} onClick={() => save.mutate()}>
            Save · {total} seats
          </Button>
        </>
      }
    >
      {/* Bulk add */}
      <div className="rounded-md border border-border p-3">
        <p className="mb-2 text-xs font-medium text-muted">Bulk add identical rows</p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-16">
            <NumberInput label="Rows" value={bulkRows} onChange={setBulkRows} />
          </div>
          <div className="w-20">
            <NumberInput label="Seats" value={bulkSeats} onChange={setBulkSeats} />
          </div>
          <div>
            <label className="label">Ranks</label>
            <RankToggles
              value={bulkRanks}
              onToggle={(r) =>
                setBulkRanks((v) => (v.includes(r) ? v.filter((x) => x !== r) : [...v, r]))
              }
            />
          </div>
          <Button size="sm" variant="secondary" onClick={addBulk}>
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        </div>
      </div>

      {/* Visual layout — click a row to edit it */}
      <div className="rounded-md border border-border p-3">
        <div className="mx-auto mb-4 w-2/3 max-w-xs">
          <div className="h-1.5 rounded-t-[50%] bg-fg/70" />
          <p className="mt-1 text-center text-[9px] uppercase tracking-[0.25em] text-muted">Screen</p>
        </div>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted">
            No rows yet — use “Bulk add” or “Add single row”.
          </p>
        ) : (
          <div className="max-h-[32vh] space-y-1.5 overflow-auto">
            {rows.map((row, i) => (
              <button
                key={i}
                onClick={() => setSelected(i === selected ? null : i)}
                className={cn(
                  'flex w-full items-center justify-center gap-2 rounded px-2 py-1 transition-colors',
                  i === selected ? 'bg-accent/5 ring-1 ring-accent' : 'hover:bg-surface-2',
                )}
              >
                <span className="w-5 shrink-0 text-center text-[10px] font-semibold text-muted">
                  {row.label}
                </span>
                <div className="flex gap-1">
                  {Array.from({ length: Math.min(row.seatCount, 50) }, (_, n) => (
                    <span key={n} className={cn('h-4 w-4 shrink-0 rounded border', seatTint(row.allowedRanks))} />
                  ))}
                  {row.seatCount > 50 && <span className="self-center pl-1 text-[10px] text-muted">+{row.seatCount - 50}</span>}
                </div>
                <span className="w-5 shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Selected-row editor */}
      {sel && selected !== null && (
        <div className="rounded-md border border-accent/40 bg-accent/5 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold">Row {sel.label}</span>
            <button onClick={() => setSelected(null)} className="text-[11px] text-muted hover:text-fg">
              Done
            </button>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-14">
              <Input label="Row" value={sel.label} onChange={(e) => setRow(selected, { label: e.target.value })} />
            </div>
            <div className="w-16">
              <NumberInput label="Seats" value={sel.seatCount} onChange={(n) => setRow(selected, { seatCount: n })} />
            </div>
            <div>
              <label className="label">Ranks (none = all)</label>
              <RankToggles
                value={sel.allowedRanks}
                onToggle={(r) =>
                  setRow(selected, {
                    allowedRanks: sel.allowedRanks.includes(r)
                      ? sel.allowedRanks.filter((x) => x !== r)
                      : [...sel.allowedRanks, r],
                  })
                }
              />
            </div>
            <div className="ml-auto flex gap-1">
              <Button
                size="sm"
                variant="ghost"
                title="Duplicate"
                onClick={() =>
                  setRows((rs) => [
                    ...rs.slice(0, selected + 1),
                    { ...sel, label: rowLabel(rs.length) },
                    ...rs.slice(selected + 1),
                  ])
                }
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                title="Delete"
                onClick={() => {
                  setRows((rs) => rs.filter((_, idx) => idx !== selected));
                  setSelected(null);
                }}
              >
                <Trash2 className="h-3.5 w-3.5 text-danger" />
              </Button>
            </div>
          </div>
        </div>
      )}

      <Button
        variant="secondary"
        size="sm"
        onClick={() => setRows((rs) => [...rs, { label: rowLabel(rs.length), seatCount: 10, allowedRanks: [] }])}
      >
        <Plus className="h-3.5 w-3.5" /> Add single row
      </Button>
    </Modal>
  );
}
