import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, apiErrorMessage } from '@/lib/api';
import type { AuditLog, Paginated } from '@/types';
import { PageHeader, Badge, LoadingState, EmptyState, ErrorState } from '@/components/ui/Misc';
import { Select } from '@/components/ui/Input';
import { Table, Th, Td, Pagination } from '@/components/ui/Table';

// Staff-only actions (personnel/USER actions are not surfaced in this view).
const ACTIONS = [
  'LOGIN',
  'LOGOUT',
  'MOVIE_CREATE',
  'UNIT_CREATE',
  'PERSONNEL_CREATE',
  'TICKET_VERIFY',
];

type Actor = '' | 'ADMIN' | 'SCANNER';
const ACTORS: { key: Actor; label: string }[] = [
  { key: '', label: 'All staff' },
  { key: 'ADMIN', label: 'Admins' },
  { key: 'SCANNER', label: 'Scanners' },
];

function fmt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
}

export function AuditPage() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [actor, setActor] = useState<Actor>('');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['audit', page, action, actor],
    queryFn: async () =>
      (
        await api.get<Paginated<AuditLog>>('/audit-logs', {
          params: { page, action: action || undefined, actor: actor || undefined },
        })
      ).data,
  });

  return (
    <div>
      <PageHeader title="Audit Logs" subtitle="Admin & scanner activity" />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        {/* Actor segmented toggle */}
        <div className="inline-flex rounded-lg border border-border p-0.5">
          {ACTORS.map((a) => (
            <button
              key={a.key || 'all'}
              onClick={() => {
                setActor(a.key);
                setPage(1);
              }}
              className={
                'rounded-md px-3 py-1 text-xs font-medium transition-colors ' +
                (actor === a.key ? 'bg-fg text-bg' : 'text-muted hover:text-fg')
              }
            >
              {a.label}
            </button>
          ))}
        </div>

        <div className="w-44">
          <Select
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All actions</option>
            {ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {isLoading && <LoadingState />}
      {isError && <ErrorState message={apiErrorMessage(error)} />}
      {data && data.items.length === 0 && <EmptyState title="No audit entries" />}

      {data && data.items.length > 0 && (
        <>
          <Table
            head={
              <tr>
                <Th>Time</Th>
                <Th>Action</Th>
                <Th>Actor</Th>
                <Th>IP</Th>
                <Th>Result</Th>
              </tr>
            }
          >
            {data.items.map((log) => (
              <tr key={log.id}>
                <Td className="whitespace-nowrap">{fmt(log.createdAt)}</Td>
                <Td>
                  <Badge tone="accent">{log.action}</Badge>
                </Td>
                <Td>{log.user ? `${log.user.mobile} (${log.user.role})` : '—'}</Td>
                <Td className="text-muted">{log.ip ?? '—'}</Td>
                <Td>
                  <Badge tone={log.success ? 'success' : 'danger'}>
                    {log.success ? 'OK' : 'FAIL'}
                  </Badge>
                </Td>
              </tr>
            ))}
          </Table>
          <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPage={setPage} />
        </>
      )}
    </div>
  );
}
