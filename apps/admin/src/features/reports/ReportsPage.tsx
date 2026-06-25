import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, apiErrorMessage } from '@/lib/api';
import { Download } from 'lucide-react';
import { PageHeader, Card, LoadingState, ErrorState } from '@/components/ui/Misc';
import { Button } from '@/components/ui/Button';
import { Table, Th, Td } from '@/components/ui/Table';
import { Modal } from '@/components/ui/Modal';
import { MoviePicker } from '@/components/MoviePicker';
import { downloadMovieReportPdf } from '@/lib/reportPdf';

interface UnitBooking {
  unit: string;
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
  attendance: { booked: number; checkedIn: number; expired: number; cancelled: number };
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
        {report.isError && <ErrorState message={apiErrorMessage(report.error)} />}
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
                <div className="text-xs text-muted">No-shows</div>
              </Card>
              <Card>
                <div className="text-2xl font-semibold">{report.data.attendance.cancelled}</div>
                <div className="text-xs text-muted">Cancelled</div>
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
                    <Th>Booked</Th>
                    <Th>Checked in</Th>
                  </tr>
                }
              >
                {report.data.unitBookings.map((u, i) => (
                  <tr key={i}>
                    <Td className="font-medium">{u.unit}</Td>
                    <Td>{u.booked}</Td>
                    <Td>{u.checkedIn}</Td>
                  </tr>
                ))}
              </Table>
            </div>
          )}
          </div>
        )}
      </Modal>
    </div>
  );
}
