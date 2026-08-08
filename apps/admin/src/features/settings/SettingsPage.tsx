import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { PageHeader, Card, Badge, LoadingState } from '@/components/ui/Misc';
import { Button } from '@/components/ui/Button';
import { Tooltip } from '@/components/ui/Tooltip';
import { Input, Select } from '@/components/ui/Input';
import { PasswordInput } from '@/components/ui/PasswordInput';
import { Modal, ConfirmDialog } from '@/components/ui/Modal';
import { onlyDigits10 } from '@/lib/mobile';
import { useAuthStore } from '@/stores/auth.store';
import { useRole } from '@/lib/role';

interface AdminRow {
  id: string;
  mobile: string;
  name: string;
  role?: 'SUPER_ADMIN' | 'ADMIN';
  active: boolean;
  createdAt: string;
}

export function SettingsPage() {
  const { canManageAdmins } = useRole();
  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle={canManageAdmins ? 'Your account, timings & administrators' : 'Your account & timings'}
      />
      {/* Full-width stacked sections. Side-by-side cards read badly here: the account card is
          two lines and the timings card is tall, so a two-column grid just left a hole. */}
      <div className="space-y-6">
        <MyAccountCard />
        <TimingsCard />
        {canManageAdmins && <AdminsCard />}
      </div>
    </div>
  );
}

interface AppTimings {
  visibilityLeadMinutes: number;
  noShowGraceMinutes: number;
  seatHoldSeconds: number;
}

const TIMING_FIELDS: Array<{
  key: keyof AppTimings;
  label: string;
  unit: string;
  min: number;
  max: number;
  help: string;
}> = [
  {
    key: 'visibilityLeadMinutes',
    label: 'Booking opens before showtime',
    unit: 'minutes',
    min: 1,
    max: 20160,
    help: 'Movies are listed as soon as they are scheduled; seats become bookable this long before the show starts.',
  },
  {
    key: 'noShowGraceMinutes',
    label: 'Check-in grace period',
    unit: 'minutes',
    min: 1,
    max: 1440,
    help: 'How long a ticket holder has to check in before their seat is returned. Counted from showtime, or from the booking itself for seats taken after the show has started.',
  },
  {
    key: 'seatHoldSeconds',
    label: 'Seat hold while booking',
    unit: 'seconds',
    min: 15,
    max: 3600,
    help: 'How long a seat stays reserved for someone who is still completing their booking.',
  },
];

/**
 * Operational timings — read-only here, edited in a dialog.
 *
 * These were live inputs on the page, which meant every keystroke was a pending change to
 * venue-wide policy sitting in an ambiguous state next to a Save button. Reading them is the
 * common case; changing them is deliberate, so it gets its own confirmable surface, matching
 * "My account" directly above.
 */
function TimingsCard() {
  const { canManageTimings } = useRole();
  const [editing, setEditing] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await api.get<{ settings: AppTimings }>('/settings')).data.settings,
  });

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-fg">Timings</h2>
          <p className="mt-1 text-xs text-muted">
            {canManageTimings
              ? 'Applies to every movie. Changes take effect within a minute.'
              : 'Managed by a super admin.'}
          </p>
        </div>
        {canManageTimings && data && (
          <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
            <Pencil className="h-3.5 w-3.5" /> Edit
          </Button>
        )}
      </div>

      {isLoading && <LoadingState />}
      {data && (
        <dl className="mt-4 space-y-3">
          {TIMING_FIELDS.map((f) => (
            <div key={f.key}>
              <dt className="text-sm text-fg">{f.label}</dt>
              <dd className="text-sm font-medium tabular-nums text-fg">
                {data[f.key]} <span className="font-normal text-muted">{f.unit}</span>
              </dd>
            </div>
          ))}
        </dl>
      )}

      {editing && data && <TimingsDialog current={data} onClose={() => setEditing(false)} />}
    </Card>
  );
}

function TimingsDialog({ current, onClose }: { current: AppTimings; onClose: () => void }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<AppTimings>(current);

  const save = useMutation({
    mutationFn: (patch: AppTimings) =>
      api.patch<{ settings: AppTimings }>('/settings', patch).then((r) => r.data.settings),
    onSuccess: (updated) => {
      // Seed the cache so the Movies page — which reads the same key for its edit-lock window —
      // picks the new lead up without a refetch.
      qc.setQueryData(['settings'], updated);
      toast.success('Timings updated');
      onClose();
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const dirty = TIMING_FIELDS.some((f) => draft[f.key] !== current[f.key]);
  const invalid = TIMING_FIELDS.some((f) => {
    const v = draft[f.key];
    return !Number.isFinite(v) || v < f.min || v > f.max;
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit timings"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={save.isPending}
            disabled={!dirty || invalid}
            onClick={() => save.mutate(draft)}
          >
            Save
          </Button>
        </>
      }
    >
      {TIMING_FIELDS.map((f) => (
        <div key={f.key}>
          <div className="flex items-end gap-2">
            <Input
              label={f.label}
              type="number"
              min={f.min}
              max={f.max}
              className="max-w-[10rem]"
              value={String(draft[f.key])}
              onChange={(e) => setDraft({ ...draft, [f.key]: Number(e.target.value) })}
            />
            <span className="pb-2 text-xs text-muted">{f.unit}</span>
          </div>
          <p className="mt-1 text-xs text-muted">{f.help}</p>
        </div>
      ))}
    </Modal>
  );
}

/** The signed-in admin's own details, editable via a dialog. */
function MyAccountCard() {
  const user = useAuthStore((s) => s.user);
  const [open, setOpen] = useState(false);
  if (!user) return null;

  return (
    <Card>
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-sm font-semibold text-fg">My account</h2>
          <p className="mt-2 text-sm">
            <span className="text-muted">Name:</span> {user.name || '—'}
          </p>
          <p className="text-sm">
            <span className="text-muted">Mobile:</span> {user.mobile}
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          <Pencil className="h-3.5 w-3.5" /> Edit
        </Button>
      </div>
      {open && <MyAccountDialog onClose={() => setOpen(false)} />}
    </Card>
  );
}

function MyAccountDialog({ onClose }: { onClose: () => void }) {
  const { user, accessToken, setAuth } = useAuthStore();
  const [name, setName] = useState(user?.name ?? '');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');

  const save = useMutation({
    mutationFn: async () => {
      if (name !== (user?.name ?? '')) await api.patch(`/admins/${user!.id}`, { name });
      if (next) {
        if (!current) throw new Error('Enter your current password to change it');
        await api.post('/auth/change-password', { currentPassword: current, newPassword: next });
      }
    },
    onSuccess: () => {
      if (user && accessToken) setAuth({ ...user, name }, accessToken);
      toast.success('Account updated');
      onClose();
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  return (
    <Modal
      open
      onClose={onClose}
      loading={save.isPending}
      title="Edit my account"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <Input label="Name" value={name} disabled={save.isPending} onChange={(e) => setName(e.target.value)} />
      <Input label="Mobile" value={user?.mobile ?? ''} disabled />
      <div className="border-t border-border pt-3">
        <p className="mb-2 text-xs font-medium text-muted">Change password (optional)</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <PasswordInput
            label="Current"
            value={current}
            disabled={save.isPending}
            onChange={(e) => setCurrent(e.target.value)}
          />
          <PasswordInput label="New" value={next} disabled={save.isPending} onChange={(e) => setNext(e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}

/** List of all administrators with create / edit / delete. */
function AdminsCard() {
  const qc = useQueryClient();
  const me = useAuthStore((s) => s.user);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AdminRow | null>(null);
  const [deleting, setDeleting] = useState<AdminRow | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admins'],
    queryFn: async () => (await api.get<{ items: AdminRow[] }>('/admins')).data.items,
  });

  const del = useMutation({
    mutationFn: (adminId: string) => api.delete(`/admins/${adminId}`),
    onSuccess: () => {
      toast.success('Administrator removed');
      setDeleting(null);
      qc.invalidateQueries({ queryKey: ['admins'] });
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-fg">Administrators</h2>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="h-3.5 w-3.5" /> New admin
        </Button>
      </div>

      {isLoading && <LoadingState />}
      <div className="divide-y divide-border">
        {data?.map((a) => (
          <div key={a.id} className="flex items-center justify-between py-2.5">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium">
                {a.name || 'Administrator'}
                <Badge tone={a.role === 'SUPER_ADMIN' ? 'success' : 'neutral'}>
                  {a.role === 'SUPER_ADMIN' ? 'Super Admin' : 'Admin'}
                </Badge>
                {a.id === me?.id && <Badge tone="accent">You</Badge>}
                {!a.active && <Badge tone="neutral">Inactive</Badge>}
              </div>
              <div className="text-xs text-muted">{a.mobile}</div>
            </div>
            <div className="flex gap-1">
              <Tooltip label="Edit">
                <Button size="sm" variant="ghost" onClick={() => setEditing(a)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              </Tooltip>
              <Tooltip label={a.id === me?.id ? 'You cannot remove your own account' : 'Delete'}>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={a.id === me?.id}
                  onClick={() => setDeleting(a)}
                >
                  <Trash2 className="h-3.5 w-3.5 text-danger" />
                </Button>
              </Tooltip>
            </div>
          </div>
        ))}
      </div>

      {creating && (
        <CreateAdminDialog
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            qc.invalidateQueries({ queryKey: ['admins'] });
          }}
        />
      )}
      {editing && (
        <EditAdminDialog
          admin={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            qc.invalidateQueries({ queryKey: ['admins'] });
          }}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && del.mutate(deleting.id)}
        title="Remove administrator"
        message={`Remove ${deleting?.name || deleting?.mobile}? This cannot be undone.`}
        confirmLabel="Remove"
        danger
        loading={del.isPending}
      />
    </Card>
  );
}

function CreateAdminDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [mobile, setMobile] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'ADMIN' | 'SUPER_ADMIN'>('ADMIN');

  const save = useMutation({
    mutationFn: () => api.post('/admins', { mobile, name: name || undefined, password, role }),
    onSuccess: () => {
      toast.success('Administrator added');
      onSaved();
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const valid = /^\d{10}$/.test(mobile) && password.length >= 8;

  return (
    <Modal
      open
      onClose={onClose}
      loading={save.isPending}
      title="New administrator"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button disabled={!valid || save.isPending} loading={save.isPending} onClick={() => save.mutate()}>
            Create
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input
          label="Mobile"
          inputMode="numeric"
          maxLength={10}
          placeholder="10-digit mobile"
          value={mobile}
          disabled={save.isPending}
          onChange={(e) => setMobile(onlyDigits10(e.target.value))}
        />
        <Input label="Name (optional)" value={name} disabled={save.isPending} onChange={(e) => setName(e.target.value)} />
      </div>
      <PasswordInput
        label="Password"
        placeholder="Min 8 characters"
        value={password}
        disabled={save.isPending}
        onChange={(e) => setPassword(e.target.value)}
      />
      <Select label="Tier" value={role} disabled={save.isPending} onChange={(e) => setRole(e.target.value as 'ADMIN' | 'SUPER_ADMIN')}>
        <option value="ADMIN">Admin — movies, auditorium & operations</option>
        <option value="SUPER_ADMIN">Super Admin — units, personnel & admins</option>
      </Select>
    </Modal>
  );
}

function EditAdminDialog({
  admin,
  onClose,
  onSaved,
}: {
  admin: AdminRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(admin.name);
  const [active, setActive] = useState(admin.active);
  const [password, setPassword] = useState('');

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/admins/${admin.id}`, {
        name,
        active,
        ...(password ? { password } : {}),
      }),
    onSuccess: () => {
      toast.success('Administrator updated');
      onSaved();
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  return (
    <Modal
      open
      onClose={onClose}
      loading={save.isPending}
      title={`Edit ${admin.mobile}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <Input label="Name" value={name} disabled={save.isPending} onChange={(e) => setName(e.target.value)} />
      <Input label="Mobile" value={admin.mobile} disabled />
      <Select label="Status" value={active ? 'active' : 'inactive'} disabled={save.isPending} onChange={(e) => setActive(e.target.value === 'active')}>
        <option value="active">Active</option>
        <option value="inactive">Inactive</option>
      </Select>
      <PasswordInput
        label="Reset password (optional)"
        placeholder="Leave blank to keep current"
        value={password}
        disabled={save.isPending}
        onChange={(e) => setPassword(e.target.value)}
      />
    </Modal>
  );
}
