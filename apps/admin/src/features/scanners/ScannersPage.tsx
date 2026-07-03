import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Plus, Trash2, Search } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { mobileField } from '@/lib/mobile';
import type { Paginated, Personnel } from '@/types';
import { PageHeader, LoadingState, EmptyState, ErrorState } from '@/components/ui/Misc';
import { Button } from '@/components/ui/Button';
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

  return (
    <div>
      <PageHeader
        title="Scanners"
        subtitle="Door-verification operators"
        action={
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> New scanner
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
          <Table
            head={
              <tr>
                <Th>Mobile</Th>
                <Th>Role</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            }
          >
            {data.items.map((p) => (
              <tr key={p.id}>
                <Td className="font-medium">{p.mobile}</Td>
                <Td>{p.role}</Td>
                <Td className="text-right">
                  <Button size="sm" variant="ghost" onClick={() => setDeleting(p)} title="Remove">
                    <Trash2 className="h-4 w-4 text-danger" />
                  </Button>
                </Td>
              </tr>
            ))}
          </Table>
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
  password: string;
}

function ScannerFormModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ScannerForm>();

  const save = useMutation({
    mutationFn: (v: ScannerForm) => api.post('/personnel', { ...v, role: 'SCANNER' }),
    onSuccess: () => {
      toast.success('Scanner created');
      onSaved();
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="New scanner"
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
        <Input
          label="Password"
          type="password"
          error={errors.password?.message}
          {...register('password', { required: 'Required', minLength: { value: 8, message: 'Min 8' } })}
        />
      </div>
    </Modal>
  );
}
