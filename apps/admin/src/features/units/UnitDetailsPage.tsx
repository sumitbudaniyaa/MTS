import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { ArrowLeft, Plus, Trash2, Search, Pencil, Upload, Download } from 'lucide-react';
import * as XLSX from 'xlsx';
import { api, apiErrorMessage } from '@/lib/api';
import { mobileField, onlyDigits10 } from '@/lib/mobile';
import type { Paginated, Personnel, Unit } from '@/types';
import { PageHeader, Badge, LoadingState, EmptyState, ErrorState } from '@/components/ui/Misc';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { PasswordInput } from '@/components/ui/PasswordInput';
import { NumberInput } from '@/components/ui/NumberInput';
import { Modal, ConfirmDialog } from '@/components/ui/Modal';
import { Table, Th, Td, Pagination } from '@/components/ui/Table';
import { useDebounce } from '@/hooks/useDebounce';
import { useRole } from '@/lib/role';

const RANKS = ['OFFICER', 'JCO', 'JAWAN'] as const;
/** '' means "all ranks" — the filter is omitted from the request entirely. */
type RankFilter = '' | (typeof RANKS)[number];

export function UnitDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { canManagePeople } = useRole();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search);
  const [rank, setRank] = useState<RankFilter>('');
  const [creating, setCreating] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [editing, setEditing] = useState<Personnel | null>(null);
  const [deleting, setDeleting] = useState<Personnel | null>(null);

  const { data: unit, isLoading: unitLoading } = useQuery({
    queryKey: ['unit', id],
    queryFn: async () => (await api.get<{ unit: Unit }>(`/units/${id}`)).data.unit,
  });

  const { data: personnel, isLoading: personnelLoading, isError, error } = useQuery({
    queryKey: ['personnel', 'unit', id, page, debounced, rank],
    queryFn: async () =>
      (
        await api.get<Paginated<Personnel>>('/personnel', {
          params: {
            page,
            search: debounced || undefined,
            unit: id,
            role: 'USER',
            rank: rank || undefined,
          },
        })
      ).data,
  });

  const del = useMutation({
    mutationFn: (personnelId: string) => api.delete(`/personnel/${personnelId}`),
    onSuccess: () => {
      toast.success('Personnel removed');
      setDeleting(null);
      qc.invalidateQueries({ queryKey: ['personnel', 'unit', id] });
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  if (unitLoading) return <LoadingState />;
  if (!unit) return <ErrorState message="Unit not found" />;

  return (
    <div>
      <div className="mb-4">
        <Link to="/units" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
          <ArrowLeft className="h-4 w-4" /> Back to Units
        </Link>
      </div>

      <PageHeader
        title={unit.name}
        subtitle={canManagePeople ? 'Unit personnel' : 'Unit personnel (read-only)'}
        action={
          canManagePeople ? (
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => setBulkOpen(true)}>
                <Upload className="h-3.5 w-3.5" /> Bulk upload
              </Button>
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus className="h-3.5 w-3.5" /> Add personnel
              </Button>
            </div>
          ) : undefined
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted" />
          <input
            className="input pl-9"
            placeholder="Search by mobile…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <select
          className="input w-auto"
          aria-label="Filter by rank"
          value={rank}
          onChange={(e) => {
            setRank(e.target.value as RankFilter);
            setPage(1);
          }}
        >
          <option value="">All ranks</option>
          {RANKS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        {rank && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setRank('');
              setPage(1);
            }}
          >
            Clear
          </Button>
        )}
      </div>

      {personnelLoading && <LoadingState />}
      {isError && <ErrorState message={apiErrorMessage(error)} />}
      {personnel && personnel.items.length === 0 && (
        <EmptyState
          title={rank ? `No ${rank} personnel in this unit` : 'No personnel in this unit'}
          hint={rank ? 'Try a different rank, or clear the filter.' : undefined}
        />
      )}

      {personnel && personnel.items.length > 0 && (
        <>
          <Table
            head={
              <tr>
                <Th>Mobile</Th>
                <Th>Rank</Th>
                <Th>Family Size</Th>
                <Th>Last Login</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            }
          >
            {personnel.items.map((p) => (
              <tr key={p.id}>
                <Td className="font-medium">{p.mobile}</Td>
                <Td>{p.rank ? <Badge tone="accent">{p.rank}</Badge> : '—'}</Td>
                <Td>{p.familySize ?? '—'}</Td>
                <Td>
                  {p.lastLoginAt ? new Date(p.lastLoginAt).toLocaleDateString() : 'Never'}
                </Td>
                <Td className="text-right">
                  {canManagePeople ? (
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(p)} title="Edit">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setDeleting(p)} title="Remove">
                        <Trash2 className="h-4 w-4 text-danger" />
                      </Button>
                    </div>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
          <Pagination
            page={personnel.page}
            totalPages={personnel.totalPages}
            total={personnel.total}
            onPage={setPage}
          />
        </>
      )}

      {creating && (
        <PersonnelFormModal
          unitId={unit.id}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            qc.invalidateQueries({ queryKey: ['personnel', 'unit', id] });
          }}
        />
      )}

      {editing && (
        <EditPersonnelModal
          person={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            qc.invalidateQueries({ queryKey: ['personnel', 'unit', id] });
          }}
        />
      )}

      {bulkOpen && (
        <BulkUploadDialog
          unitId={unit.id}
          onClose={() => setBulkOpen(false)}
          onDone={() => qc.invalidateQueries({ queryKey: ['personnel', 'unit', id] })}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && del.mutate(deleting.id)}
        title="Remove personnel"
        message={`Remove ${deleting?.mobile} from this unit?`}
        confirmLabel="Remove"
        danger
        loading={del.isPending}
      />
    </div>
  );
}

interface PersonnelForm {
  mobile: string;
  password: string;
  rank: 'OFFICER' | 'JCO' | 'JAWAN';
  maritalStatus: 'SINGLE' | 'MARRIED';
  spouseMobile?: string;
  numberOfKids: number;
}

function PersonnelFormModal({
  unitId,
  onClose,
  onSaved,
}: {
  unitId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<PersonnelForm>({
    defaultValues: { rank: 'JAWAN', maritalStatus: 'SINGLE', numberOfKids: 0 },
  });
  const married = watch('maritalStatus') === 'MARRIED';

  const save = useMutation({
    mutationFn: (v: PersonnelForm) => {
      const payload: Record<string, unknown> = {
        mobile: v.mobile,
        password: v.password,
        role: 'USER',
        unit: unitId,
        rank: v.rank,
        maritalStatus: v.maritalStatus,
        numberOfKids: Number(v.numberOfKids) || 0,
      };
      if (v.maritalStatus === 'MARRIED' && v.spouseMobile) {
        payload.spouseMobile = v.spouseMobile;
      }
      return api.post('/personnel', payload);
    },
    onSuccess: () => {
      toast.success('Personnel added');
      onSaved();
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Add personnel"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit((v) => save.mutate(v))} loading={save.isPending}>
            Create
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-4">
        <Input
          label="Mobile"
          error={errors.mobile?.message}
          {...mobileField(register('mobile', { required: 'Required', pattern: { value: /^\d{10}$/, message: '10 digits' } }))}
        />
        <PasswordInput
          label="Password"
          error={errors.password?.message}
          {...register('password', { required: 'Required', minLength: { value: 8, message: 'Min 8' } })}
        />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Select label="Rank" {...register('rank')}>
          <option value="OFFICER">Officer</option>
          <option value="JCO">JCO</option>
          <option value="JAWAN">Jawan</option>
        </Select>
        <Select label="Marital status" {...register('maritalStatus')}>
          <option value="SINGLE">Single</option>
          <option value="MARRIED">Married</option>
        </Select>
        <Input label="No. of kids" type="number" min={0} {...register('numberOfKids')} />
      </div>

      {married && (
        <Input
          label="Spouse mobile (spouse logs in with the same password)"
          {...mobileField(register('spouseMobile'))}
        />
      )}

      <p className="text-xs text-muted">
        Family size is computed automatically by the server (1 + spouse + kids). If a spouse
        password is set, the spouse can log in with their own mobile and shares this family's
        tickets and quota.
      </p>
    </Modal>
  );
}

function EditPersonnelModal({
  person,
  onClose,
  onSaved,
}: {
  person: Personnel;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [rank, setRank] = useState<'OFFICER' | 'JCO' | 'JAWAN'>(person.rank ?? 'JAWAN');
  const [maritalStatus, setMaritalStatus] = useState<'SINGLE' | 'MARRIED'>(
    person.maritalStatus ?? 'SINGLE',
  );
  const [spouseMobile, setSpouseMobile] = useState(person.spouseMobile ?? '');
  const [numberOfKids, setNumberOfKids] = useState(person.numberOfKids ?? 0);
  const [active, setActive] = useState(person.active);
  const [password, setPassword] = useState('');

  const save = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = {
        rank,
        maritalStatus,
        numberOfKids: Number(numberOfKids) || 0,
        active,
        spouseMobile: maritalStatus === 'MARRIED' ? spouseMobile || null : null,
      };
      if (password) payload.password = password;
      return api.patch(`/personnel/${person.id}`, payload);
    },
    onSuccess: () => {
      toast.success('Personnel updated');
      onSaved();
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={`Edit ${person.mobile}`}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" loading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-3 gap-4">
        <Select label="Rank" value={rank} onChange={(e) => setRank(e.target.value as typeof rank)}>
          <option value="OFFICER">Officer</option>
          <option value="JCO">JCO</option>
          <option value="JAWAN">Jawan</option>
        </Select>
        <Select
          label="Marital status"
          value={maritalStatus}
          onChange={(e) => setMaritalStatus(e.target.value as typeof maritalStatus)}
        >
          <option value="SINGLE">Single</option>
          <option value="MARRIED">Married</option>
        </Select>
        <NumberInput label="No. of kids" value={numberOfKids} onChange={setNumberOfKids} />
      </div>

      {maritalStatus === 'MARRIED' && (
        <Input
          label="Spouse mobile (logs in with the same password)"
          inputMode="numeric"
          maxLength={10}
          value={spouseMobile}
          onChange={(e) => setSpouseMobile(onlyDigits10(e.target.value))}
        />
      )}

      <Select label="Status" value={active ? 'active' : 'inactive'} onChange={(e) => setActive(e.target.value === 'active')}>
        <option value="active">Active</option>
        <option value="inactive">Inactive</option>
      </Select>

      <PasswordInput
        label="Reset password (optional)"
        placeholder="Leave blank to keep current"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
    </Modal>
  );
}

type ValidRank = 'OFFICER' | 'JCO' | 'JAWAN';
interface BulkItem {
  mobile: string;
  password: string;
  rank?: ValidRank;
  maritalStatus?: 'SINGLE' | 'MARRIED';
  spouseMobile?: string;
  numberOfKids?: number;
}

function normKey(k: string): string {
  return k.toLowerCase().replace(/[\s_]+/g, '');
}

/** Parse an uploaded spreadsheet into sanitized bulk items + a list of skipped rows. */
function parseRows(rows: Record<string, unknown>[]): { items: BulkItem[]; skipped: string[] } {
  const items: BulkItem[] = [];
  const skipped: string[] = [];
  rows.forEach((raw, i) => {
    const r: Record<string, unknown> = {};
    for (const k of Object.keys(raw)) r[normKey(k)] = raw[k];
    const mobile = String(r.mobile ?? '').trim();
    const password = String(r.password ?? '').trim();
    if (!/^\d{10}$/.test(mobile) || password.length < 8) {
      skipped.push(`Row ${i + 2}: ${mobile || '(no mobile)'} — needs a 10-digit mobile and 8+ char password`);
      return;
    }
    const rankRaw = String(r.rank ?? '').toUpperCase();
    const rank = (['OFFICER', 'JCO', 'JAWAN'] as const).includes(rankRaw as ValidRank)
      ? (rankRaw as ValidRank)
      : undefined;
    const maritalRaw = String(r.maritalstatus ?? r.marital ?? '').toUpperCase();
    const maritalStatus = maritalRaw === 'MARRIED' ? 'MARRIED' : maritalRaw === 'SINGLE' ? 'SINGLE' : undefined;
    const spouseRaw = String(r.spousemobile ?? r.spouse ?? '').trim();
    const spouseMobile = /^\d{10}$/.test(spouseRaw) ? spouseRaw : undefined;
    const kidsRaw = Number(r.numberofkids ?? r.kids ?? 0);
    const numberOfKids = Number.isFinite(kidsRaw) ? Math.max(0, Math.floor(kidsRaw)) : 0;
    items.push({ mobile, password, rank, maritalStatus, spouseMobile, numberOfKids });
  });
  return { items, skipped };
}

function downloadTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([
    ['mobile', 'password', 'rank', 'maritalStatus', 'spouseMobile', 'numberOfKids'],
    ['9876543210', 'Pass1234', 'JAWAN', 'SINGLE', '', 0],
    ['9876543211', 'Pass1234', 'OFFICER', 'MARRIED', '9876543212', 2],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'personnel');
  XLSX.writeFile(wb, 'personnel-template.xlsx');
}

function BulkUploadDialog({
  unitId,
  onClose,
  onDone,
}: {
  unitId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [items, setItems] = useState<BulkItem[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [fileName, setFileName] = useState('');

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const sheet = wb.Sheets[wb.SheetNames[0]!];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet!, { defval: '' });
      const parsed = parseRows(rows);
      setItems(parsed.items);
      setSkipped(parsed.skipped);
    } catch {
      toast.error('Could not read that file');
    }
  };

  const upload = useMutation({
    mutationFn: () =>
      api.post<{ created: number; failed: { mobile: string; error: string }[] }>('/personnel/bulk', {
        unit: unitId,
        items,
      }),
    onSuccess: (res) => {
      const { created, failed } = res.data;
      toast.success(`Imported ${created} personnel${failed.length ? `, ${failed.length} failed` : ''}`);
      onDone();
      if (failed.length === 0) onClose();
      else setSkipped(failed.map((f) => `${f.mobile}: ${f.error}`));
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Bulk upload personnel"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
          <Button size="sm" disabled={items.length === 0} loading={upload.isPending} onClick={() => upload.mutate()}>
            Import {items.length || ''}
          </Button>
        </>
      }
    >
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted">
          Upload an .xlsx/.csv with columns: mobile, password, rank, maritalStatus, spouseMobile,
          numberOfKids.
        </p>
        <Button variant="ghost" size="sm" onClick={downloadTemplate}>
          <Download className="h-3.5 w-3.5" /> Template
        </Button>
      </div>

      <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border py-8 text-center hover:bg-surface-2">
        <Upload className="h-5 w-5 text-muted" />
        <span className="text-sm font-medium">{fileName || 'Choose a spreadsheet'}</span>
        <span className="text-xs text-muted">.xlsx, .xls or .csv</span>
        <input
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(e) => onFile(e.target.files?.[0])}
        />
      </label>

      {items.length > 0 && (
        <p className="text-sm">
          <span className="font-semibold">{items.length}</span> ready to import.
        </p>
      )}
      {skipped.length > 0 && (
        <div className="max-h-40 overflow-auto rounded-md border border-warning/40 bg-warning/5 p-2 text-xs text-warning">
          {skipped.map((s, i) => (
            <div key={i}>{s}</div>
          ))}
        </div>
      )}
    </Modal>
  );
}
