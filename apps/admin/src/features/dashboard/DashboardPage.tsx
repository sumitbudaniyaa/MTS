import type { LucideIcon } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import {
  Building2,
  Users,
  ScanLine,
  Film,
  Ticket,
  CheckCircle2,
  Clock,
  RotateCcw,
  XCircle,
} from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import type { MovieStatus, Overview } from '@/types';
import { PageHeader, Card, Badge, LoadingState, EmptyState, ErrorState } from '@/components/ui/Misc';
import { Table, Th, Td } from '@/components/ui/Table';

/** KPI tile: a plain card carrying an icon, the value and its label. */
function Stat({ label, value, icon: Icon }: { label: string; value: number; icon: LucideIcon }) {
  return (
    <Card className="p-4">
      <Icon className="h-4 w-4 text-muted" />
      <div className="mt-6 text-2xl font-semibold tracking-tight text-fg">{value}</div>
      <div className="mt-0.5 text-xs text-muted">{label}</div>
    </Card>
  );
}

const statusTone: Record<MovieStatus, 'neutral' | 'accent' | 'success' | 'warning' | 'danger'> = {
  DRAFT: 'neutral',
  SCHEDULED: 'accent',
  OPEN: 'success',
  POOL_RELEASED: 'warning',
  CLOSED: 'neutral',
  CANCELLED: 'danger',
};

function fmt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
function ago(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function DashboardPage() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['overview'],
    queryFn: async () => (await api.get<Overview>('/reports/overview')).data,
  });

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="System overview at a glance" />
      {isLoading && <LoadingState />}
      {isError && <ErrorState message={apiErrorMessage(error)} />}
      {data && (
        <div className="space-y-6">
          {/* Counters */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 xl:grid-cols-5">
            <Stat label="Units" value={data.units} icon={Building2} />
            <Stat label="Personnel" value={data.personnel} icon={Users} />
            <Stat label="Scanners" value={data.scanners} icon={ScanLine} />
            <Stat label="Upcoming movies" value={data.upcomingMovies} icon={Film} />
            <Stat label="Booked" value={data.tickets.booked} icon={Ticket} />
            <Stat label="Checked in" value={data.tickets.checkedIn} icon={CheckCircle2} />
            <Stat label="Not checked in" value={data.tickets.expired} icon={Clock} />
            <Stat label="Released" value={data.tickets.released} icon={RotateCcw} />
            <Stat label="Cancelled" value={data.tickets.cancelled} icon={XCircle} />
          </div>

          {/* Upcoming movies with bookings */}
          <section>
            <h2 className="mb-3 text-sm font-semibold text-fg">Upcoming movies</h2>
            {data.upcoming.length === 0 ? (
              <Card>
                <EmptyState title="No upcoming movies" />
              </Card>
            ) : (
              <Table
                head={
                  <tr>
                    <Th>Movie</Th>
                    <Th>Showtime</Th>
                    <Th>Status</Th>
                    <Th>Booked</Th>
                    <Th>Pool</Th>
                  </tr>
                }
              >
                {data.upcoming.map((m) => {
                  const pct = m.totalSeats ? Math.round((m.seatsBooked / m.totalSeats) * 100) : 0;
                  return (
                    <tr key={m.id}>
                      <Td className="font-medium">{m.title}</Td>
                      <Td className="whitespace-nowrap">{fmt(m.startTime)}</Td>
                      <Td>
                        <Badge tone={statusTone[m.status]}>{m.status}</Badge>
                      </Td>
                      <Td>
                        <span className="font-medium">
                          {m.seatsBooked}/{m.totalSeats}
                        </span>
                        <span className="ml-1 text-xs text-muted">({pct}%)</span>
                      </Td>
                      <Td>{m.poolSeats}</Td>
                    </tr>
                  );
                })}
              </Table>
            )}
          </section>

          {/* Recent bookings */}
          <section>
            <h2 className="mb-2.5 text-sm font-medium text-fg">Recent bookings</h2>
            {data.recentBookings.length === 0 ? (
              <Card>
                <EmptyState title="No bookings yet" />
              </Card>
            ) : (
              <Table
                head={
                  <tr>
                    <Th>User</Th>
                    <Th>Movie</Th>
                    <Th>Qty</Th>
                    <Th>Status</Th>
                    <Th>When</Th>
                  </tr>
                }
              >
                {data.recentBookings.map((b) => (
                  <tr key={b.id}>
                    <Td className="font-medium">{b.mobile}</Td>
                    <Td>{b.movieTitle}</Td>
                    <Td>{b.quantity}</Td>
                    <Td>
                      <Badge tone={b.status === 'CANCELLED' ? 'danger' : 'success'}>{b.status}</Badge>
                    </Td>
                    <Td className="whitespace-nowrap text-muted">{ago(b.createdAt)}</Td>
                  </tr>
                ))}
              </Table>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
