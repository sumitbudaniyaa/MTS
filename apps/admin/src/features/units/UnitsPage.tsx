import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, Search, Users } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import type { Paginated, Unit } from '@/types';
import { PageHeader, Badge, LoadingState, EmptyState, ErrorState, Card } from '@/components/ui/Misc';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal, ConfirmDialog } from '@/components/ui/Modal';
import { Pagination } from '@/components/ui/Table';
import { useDebounce } from '@/hooks/useDebounce';

interface UnitForm {
  name: string;
}

export function UnitsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search);
  const [editing, setEditing] = useState<Unit | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Unit | null>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['units', page, debounced],
    queryFn: async () =>
      (await api.get<Paginated<Unit>>('/units', { params: { page, search: debounced || undefined } }))
        .data,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['units'] });

  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/units/${id}`),
    onSuccess: () => {
      toast.success('Unit deleted');
      setDeleting(null);
      invalidate();
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  return (
    <div>
      <PageHeader
        title="Units"
        subtitle="Army units and their personnel"
        action={
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> New unit
          </Button>
        }
      />

      <div className="mb-6 max-w-xs">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted" />
          <input
            className="input pl-9"
            placeholder="Search units…"
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
      {data && data.items.length === 0 && (
        <EmptyState title="No units yet" hint="Create your first unit to get started." />
      )}

      {data && data.items.length > 0 && (
        <>
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.items.map((u) => (
              <Card
                key={u.id}
                className="group relative flex cursor-pointer flex-col overflow-hidden transition-all hover:border-accent hover:shadow-sm"
                onClick={() => navigate(`/units/${u.id}`)}
              >
                <div className="mb-4 flex items-start justify-between">
                  <div>
                    <h3 className="font-medium text-fg">{u.name}</h3>
                  </div>
                  <Badge tone={u.active ? 'success' : 'neutral'}>
                    {u.active ? 'Active' : 'Inactive'}
                  </Badge>
                </div>
                
                <div className="mt-auto flex items-center justify-between border-t border-border pt-4">
                  <div className="flex items-center gap-1.5 text-sm text-muted">
                    <Users className="h-4 w-4" />
                    <span>View personnel</span>
                  </div>
                  <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditing(u);
                      }}
                      title="Edit"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleting(u);
                      }}
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4 text-danger" />
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
          <Pagination
            page={data.page}
            totalPages={data.totalPages}
            total={data.total}
            onPage={setPage}
          />
        </>
      )}

      {(creating || editing) && (
        <UnitFormModal
          unit={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            invalidate();
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && del.mutate(deleting.id)}
        title="Delete unit"
        message={`Delete "${deleting?.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        danger
        loading={del.isPending}
      />
    </div>
  );
}

function UnitFormModal({
  unit,
  onClose,
  onSaved,
}: {
  unit: Unit | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!unit;
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<UnitForm>({
    defaultValues: { name: unit?.name ?? '' },
  });

  const save = useMutation({
    mutationFn: (values: UnitForm) =>
      isEdit
        ? api.patch(`/units/${unit!.id}`, { name: values.name })
        : api.post('/units', values),
    onSuccess: () => {
      toast.success(isEdit ? 'Unit updated' : 'Unit created');
      onSaved();
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? 'Edit unit' : 'New unit'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit((v) => save.mutate(v))} loading={save.isPending}>
            {isEdit ? 'Save' : 'Create'}
          </Button>
        </>
      }
    >
      <Input
        label="Name"
        placeholder="e.g. Signals"
        error={errors.name?.message}
        {...register('name', { required: 'Name is required' })}
      />
    </Modal>
  );
}
