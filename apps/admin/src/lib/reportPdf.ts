import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

interface UnitBookingRow {
  unit: string;
  allocated: number | null;
  booked: number;
  checkedIn: number;
}

interface ScannerActivityRow {
  name: string;
  type: string;
  count: number;
}

export interface MovieReportData {
  movie: {
    title: string;
    status: string;
    totalSeats: number;
    seatsBooked: number;
    poolSeats: number;
    unsoldSeats?: number;
    availableSeats: number;
  };
  rates?: {
    turnoutRate: number;
    occupancyRate: number;
  };
  unitBookings: UnitBookingRow[];
  attendance: {
    checkedIn: number;
    expired: number;
    released: number;
    cancelled: number;
  };
  scannerActivity?: ScannerActivityRow[];
}

function nextY(doc: jsPDF, fallback: number): number {
  const last = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable;
  return last ? last.finalY + 8 : fallback;
}

/** Build and download a PDF of a per-movie report. */
export function downloadMovieReportPdf(report: MovieReportData): void {
  const doc = new jsPDF();
  const m = report.movie;
  const a = report.attendance;
  const r = report.rates;

  doc.setFontSize(16);
  doc.text(m.title, 14, 18);
  doc.setFontSize(10);
  doc.setTextColor(120);
  doc.text(`Auditorium booking report · generated ${new Date().toLocaleString()}`, 14, 25);
  doc.text(
    `Status: ${m.status}${r ? `  |  Turnout: ${r.turnoutRate}%  |  Occupancy: ${r.occupancyRate}%` : ''}`,
    14,
    31,
  );
  doc.setTextColor(0);

  autoTable(doc, {
    startY: 38,
    head: [['Seats Economy', 'Count']],
    body: [
      ['Total capacity', String(m.totalSeats)],
      ['Booked', String(m.seatsBooked)],
      ['Common pool', String(m.poolSeats)],
      ['Unsold / Empty seats', String(m.unsoldSeats ?? m.availableSeats)],
    ],
    theme: 'grid',
    headStyles: { fillColor: [24, 24, 27] },
  });

  autoTable(doc, {
    startY: nextY(doc, 80),
    head: [['Attendance', 'Count']],
    body: [
      ['Checked in', String(a.checkedIn)],
      ['Not checked in', String(a.expired)],
      ['Released mid-show', String(a.released)],
      ['Cancelled', String(a.cancelled)],
    ],
    theme: 'grid',
    headStyles: { fillColor: [24, 24, 27] },
  });

  if (report.unitBookings.length > 0) {
    autoTable(doc, {
      startY: nextY(doc, 120),
      head: [['Unit', 'Allocated', 'Booked', 'Checked in', 'Utilisation']],
      body: report.unitBookings.map((r) => {
        const util =
          r.allocated && r.allocated > 0
            ? `${Math.round((r.booked / r.allocated) * 100)}%`
            : '—';
        return [r.unit, r.allocated != null ? String(r.allocated) : '—', String(r.booked), String(r.checkedIn), util];
      }),
      theme: 'grid',
      headStyles: { fillColor: [24, 24, 27] },
    });
  }

  if (report.scannerActivity && report.scannerActivity.length > 0) {
    autoTable(doc, {
      startY: nextY(doc, 160),
      head: [['Door / Staff Name', 'Role', 'Scans Processed']],
      body: report.scannerActivity.map((s) => [s.name, s.type, String(s.count)]),
      theme: 'grid',
      headStyles: { fillColor: [24, 24, 27] },
    });
  }

  const safe = m.title.replace(/[^\w-]+/g, '_').slice(0, 40) || 'report';
  doc.save(`report-${safe}.pdf`);
}
