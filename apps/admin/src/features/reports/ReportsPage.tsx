import { useState } from 'react';
import axios from 'axios';
import { useQuery } from '@tanstack/react-query';
import { api, apiErrorMessage } from '@/lib/api';
import { Download } from 'lucide-react';
import { PageHeader, Card, LoadingState, ErrorState, EmptyState } from '@/components/ui/Misc';
import { Button } from '@/components/ui/Button';
import { Table, Th, Td } from '@/components/ui/Table';
import { Modal } from '@/components/ui/Modal';
import { MoviePicker } from '@/components/MoviePicker';
import { downloadMovieReportPdf } from '@/lib/reportPdf';

interface UnitBooking {
  unit: string;
  allocated: number | null;
  booked: number;
  checkedIn: number;
}
interface MovieReport {
  movie: {
    id: string;
    title: string;
    totalSeats: number;
    seatsBooked: number;
    poolSeats: number;
    availableSeats: number;
    status: string;
  };
  unitBookings: UnitBooking[];
  endTime: string;
  attendance: {
    booked: number;
    checkedIn: number;
    expired: number;
    released: number;
    cancelled: number;
  };
}

/**
 * The API answers 409 while a movie is still running; that is a state, not a failure. It also
 * sends the show's end time as `details.availableAt`, so the admin gets a definite "come back
 * at…" rather than being told to guess.
 */
function notYetAvailableUntil(err: unknown): Date | null | false {
  if (!axios.isAxiosError(err) || err.response?.status !== 409) return false;
  const details = (err.response?.data as { error?: { details?: { availableAt?: string } } })?.error
    ?.details;
  const at = details?.availableAt ? new Date(details.availableAt) : null;
  return at && !Number.isNaN(at.getTime()) ? at : null;
}

function whenLabel(at: Date): string {
  const mins = Math.max(0, Math.round((at.getTime() - Date.now()) / 60_000));
  const rel =
    mins < 1 ? 'in under a minute' : mins < 60 ? `in ${mins} min` : `in ${Math.round(mins / 60)} h`;
  return `${at.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} (${rel})`;
}

export function ReportsPage() {
  const [movieId, setMovieId] = useState('');

  const report = useQuery({
    queryKey: ['report', movieId],
    enabled: !!movieId,
    queryFn: async () => (await api.get<MovieReport>(`/reports/movies/${movieId}`)).data,
  });

  return (
    <div>
      <PageHeader title="Reports" subtitle="Per-movie seat economy and attendance" />

      <div className="mb-6">
        <h2 className="mb-2.5 text-sm font-medium text-fg">Select a movie to view its report</h2>
        <MoviePicker value={movieId} onChange={setMovieId} />
      </div>

      <Modal
        open={!!movieId}
        onClose={() => setMovieId('')}
        title={report.data ? report.data.movie.title : 'Report'}
      >
        {report.isLoading && <LoadingState />}
        {/* A show that hasn't finished isn't an error — the report simply doesn't exist yet. */}
        {report.isError &&
          (() => {
            const at = notYetAvailableUntil(report.error);
            if (at === false) return <ErrorState message={apiErrorMessage(report.error)} />;
            return (
              <EmptyState
                title={at ? `Report available ${whenLabel(at)}` : 'Report available once the show has ended'}
                hint="Attendance can only be counted once the show has ended and the last chance to check in has passed."
              />
            );
          })()}
        {report.data && (
          <div className="space-y-5">
            <div className="flex justify-end">
              <Button size="sm" variant="secondary" onClick={() => downloadMovieReportPdf(report.data!)}>
                <Download className="h-3.5 w-3.5" /> Download PDF
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-3">
            <Card>
              <div className="text-2xl font-semibold">{report.data.movie.totalSeats}</div>
              <div className="text-xs text-muted">Total seats</div>
            </Card>
            <Card>
              <div className="text-2xl font-semibold">{report.data.movie.seatsBooked}</div>
              <div className="text-xs text-muted">Booked</div>
            </Card>
            <Card>
              <div className="text-2xl font-semibold">{report.data.movie.poolSeats}</div>
              <div className="text-xs text-muted">Common pool</div>
            </Card>
            <Card>
              <div className="text-2xl font-semibold">{report.data.movie.availableSeats}</div>
              <div className="text-xs text-muted">Available</div>
            </Card>
          </div>

          <div>
            <h2 className="mb-3 text-sm font-medium text-muted">Attendance</h2>
            <div className="grid grid-cols-2 gap-3">
              <Card>
                <div className="text-2xl font-semibold">{report.data.attendance.checkedIn}</div>
                <div className="text-xs text-muted">Checked in</div>
              </Card>
              <Card>
                <div className="text-2xl font-semibold">{report.data.attendance.booked}</div>
                <div className="text-xs text-muted">Booked (awaiting)</div>
              </Card>
              <Card>
                <div className="text-2xl font-semibold">{report.data.attendance.expired}</div>
                <div className="text-xs text-muted">Not checked in</div>
              </Card>
              <Card>
                <div className="text-2xl font-semibold">{report.data.attendance.cancelled}</div>
                <div className="text-xs text-muted">Cancelled</div>
              </Card>
              <Card>
                <div className="text-2xl font-semibold">{report.data.attendance.released}</div>
                <div className="text-xs text-muted">Released mid-show</div>
              </Card>
            </div>
          </div>

          {report.data.unitBookings.length > 0 && (
            <div>
              <h2 className="mb-3 text-sm font-medium text-muted">Bookings by unit</h2>
              <Table
                head={
                  <tr>
                    <Th>Unit</Th>
                    <Th>Allocated</Th>
                    <Th>Booked</Th>
                    <Th>Checked in</Th>
                    <Th>Utilisation</Th>
                  </tr>
                }
              >
                {report.data.unitBookings.map((u, i) => {
                  const util =
                    u.allocated && u.allocated > 0
                      ? Math.round((u.booked / u.allocated) * 100)
                      : null;
                  return (
                    <tr key={i}>
                      <Td className="font-medium">{u.unit}</Td>
                      <Td>{u.allocated ?? '—'}</Td>
                      <Td>{u.booked}</Td>
                      <Td>{u.checkedIn}</Td>
                      <Td>
                        {util !== null ? (
                          <span
                            className={util >= 100 ? 'font-semibold text-warning' : util >= 80 ? 'text-success' : undefined}
                          >
                            {util}%
                          </span>
                        ) : '—'}
                      </Td>
                    </tr>
                  );
                })}
              </Table>
            </div>
          )}
          </div>
        )}
      </Modal>
    </div>
  );
}
