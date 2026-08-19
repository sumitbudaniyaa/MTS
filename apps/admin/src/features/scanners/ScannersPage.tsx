import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Plus, Trash2, Search, LockKeyholeOpen } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { mobileField } from '@/lib/mobile';
import type { Paginated, Personnel } from '@/types';
import { PageHeader, Card, Badge, LoadingState, EmptyState, ErrorState } from '@/components/ui/Misc';
import { Button } from '@/components/ui/Button';
import { Tooltip } from '@/components/ui/Tooltip';
import { Input } from '@/components/ui/Input';
import { Modal, ConfirmDialog } from '@/components/ui/Modal';
import { Table, Th, Td, Pagination } from '@/components/ui/Table';
import { useDebounce } from '@/hooks/useDebounce';

export function ScannersPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Personnel | null>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['scanners', page, debounced],
    queryFn: async () =>
      (
        await api.get<Paginated<Personnel>>('/personnel', {
          params: { page, search: debounced || undefined, role: 'SCANNER' },
        })
      ).data,
  });

  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/personnel/${id}`),
    onSuccess: () => {
      toast.success('Scanner removed');
      setDeleting(null);
      qc.invalidateQueries({ queryKey: ['scanners'] });
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const unlock = useMutation({
    mutationFn: (id: string) => api.post(`/personnel/${id}/unlock`),
    onSuccess: () => {
      toast.success('Account unlocked');
      qc.invalidateQueries({ queryKey: ['scanners'] });
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  return (
    <div>
      <PageHeader
        title="Scanners"
        subtitle="Door-verification operators"
        action={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" /> New scanner
          </Button>
        }
      />

      <div className="mb-4 max-w-xs">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted" />
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
      </div>

      {isLoading && <LoadingState />}
      {isError && <ErrorState message={apiErrorMessage(error)} />}
      {data && data.items.length === 0 && <EmptyState title="No scanners yet" />}

      {data && data.items.length > 0 && (
        <>
          {/* Phone layout — the operational admin manages door staff from the venue. */}
          <div className="space-y-2.5 md:hidden">
            {data.items.map((p) => {
              const isLocked = p.lockedUntil && new Date(p.lockedUntil).getTime() > Date.now();
              return (
                <Card key={p.id} className="flex items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-medium text-fg">{p.mobile}</p>
                      {isLocked && <Badge tone="warning">Locked</Badge>}
                    </div>
                    <p className="text-xs text-muted">{p.role}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    {isLocked && (
                      <Tooltip label="Unlock Account">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => unlock.mutate(p.id)}
                          disabled={unlock.isPending}
                        >
                          <LockKeyholeOpen className="h-4 w-4 text-warning" />
                        </Button>
                      </Tooltip>
                    )}
                    <Tooltip label="Remove">
                      <Button size="sm" variant="ghost" onClick={() => setDeleting(p)}>
                        <Trash2 className="h-4 w-4 text-danger" />
                      </Button>
                    </Tooltip>
                  </div>
                </Card>
              );
            })}
          </div>

          <div className="hidden md:block">
            <Table
              head={
                <tr>
                  <Th>Mobile</Th>
                  <Th>Role</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              }
            >
              {data.items.map((p) => {
                const isLocked = p.lockedUntil && new Date(p.lockedUntil).getTime() > Date.now();
                return (
                  <tr key={p.id}>
                    <Td className="font-medium">
                      <div className="flex items-center gap-2">
                        {p.mobile}
                        {isLocked && <Badge tone="warning">Locked</Badge>}
                      </div>
                    </Td>
                    <Td>{p.role}</Td>
                    <Td className="text-right">
                      <div className="flex justify-end gap-1">
                        {isLocked && (
                          <Tooltip label="Unlock Account">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => unlock.mutate(p.id)}
                              disabled={unlock.isPending}
                            >
                              <LockKeyholeOpen className="h-4 w-4 text-warning" />
                            </Button>
                          </Tooltip>
                        )}
                        <Tooltip label="Remove">
                          <Button size="sm" variant="ghost" onClick={() => setDeleting(p)}>
                            <Trash2 className="h-4 w-4 text-danger" />
                          </Button>
                        </Tooltip>
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </Table>
          </div>
          <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPage={setPage} />
        </>
      )}

      {creating && (
        <ScannerFormModal
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            qc.invalidateQueries({ queryKey: ['scanners'] });
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && del.mutate(deleting.id)}
        title="Remove scanner"
        message={`Remove ${deleting?.mobile}? This cannot be undone.`}
        confirmLabel="Remove"
        danger
        loading={del.isPending}
      />
    </div>
  );
}

interface ScannerForm {
  mobile: string;
}

function ScannerFormModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ScannerForm>();
  /** The generated password, shown once. Nothing stores the plaintext. */
  const [issued, setIssued] = useState<{ mobile: string; password: string } | null>(null);

  const save = useMutation({
    // No password field: the server generates one per operator. Scanner operators have no
    // self-service change screen, so a shared default would be a credential they could never
    // replace — each gets their own, handed over once.
    mutationFn: (v: ScannerForm) =>
      api
        .post<{ generatedPassword?: string }>('/personnel', { ...v, role: 'SCANNER' })
        .then((r) => ({ mobile: v.mobile, password: r.data.generatedPassword ?? '' })),
    onSuccess: (result) => {
      toast.success('Scanner created');
      setIssued(result);
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  // Once the password is on screen the account already exists, so the only action left is to
  // acknowledge it — closing also refreshes the list.
  if (issued) {
    return (
      <Modal
        open
        onClose={() => {
          onSaved();
          onClose();
        }}
        title="Scanner created"
        footer={
          <Button
            onClick={() => {
              onSaved();
              onClose();
            }}
          >
            Done
          </Button>
        }
      >
        <p className="text-sm text-muted">
          Give this password to <span className="font-medium text-fg">{issued.mobile}</span>. It is
          shown only once — if it is lost, reset the account instead.
        </p>
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-3 py-2.5">
          <code className="flex-1 select-all font-mono text-base tracking-wide text-fg">
            {issued.password}
          </code>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              void navigator.clipboard
                ?.writeText(issued.password)
                .then(() => toast.success('Copied'))
                .catch(() => toast.error('Could not copy — select it manually'));
            }}
          >
            Copy
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted">
          They must change it within 30 days, and the app will refuse to scan after that.
        </p>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      loading={save.isPending}
      title="New scanner"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button onClick={handleSubmit((v) => save.mutate(v))} loading={save.isPending}>
            Create
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4">
        <Input
          label="Mobile"
          error={errors.mobile?.message}
          disabled={save.isPending}
          {...mobileField(register('mobile', { required: 'Required', pattern: { value: /^\d{10}$/, message: '10 digits' } }))}
        />
      </div>
      <p className="text-xs text-muted">
        A password is generated for this operator and shown once after you create the account.
      </p>
    </Modal>
  );
}
