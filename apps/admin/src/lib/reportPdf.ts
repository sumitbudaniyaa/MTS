import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

interface UnitBookingRow {
  unit: string;
  booked: number;
  checkedIn: number;
}
export interface MovieReportData {
  movie: {
    title: string;
    status: string;
    totalSeats: number;
    seatsBooked: number;
    poolSeats: number;
    availableSeats: number;
  };
  unitBookings: UnitBookingRow[];
  attendance: { booked: number; checkedIn: number; expired: number; cancelled: number };
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

  doc.setFontSize(16);
  doc.text(m.title, 14, 18);
  doc.setFontSize(10);
  doc.setTextColor(120);
  doc.text(`Auditorium booking report · generated ${new Date().toLocaleString()}`, 14, 25);
  doc.text(`Status: ${m.status}`, 14, 31);
  doc.setTextColor(0);

  autoTable(doc, {
    startY: 38,
    head: [['Seats', 'Count']],
    body: [
      ['Total', String(m.totalSeats)],
      ['Booked', String(m.seatsBooked)],
      ['Common pool', String(m.poolSeats)],
      ['Available', String(m.availableSeats)],
    ],
    theme: 'grid',
    headStyles: { fillColor: [24, 24, 27] },
  });

  autoTable(doc, {
    startY: nextY(doc, 80),
    head: [['Attendance', 'Count']],
    body: [
      ['Checked in', String(a.checkedIn)],
      ['Booked (awaiting)', String(a.booked)],
      ['No-shows', String(a.expired)],
      ['Cancelled', String(a.cancelled)],
    ],
    theme: 'grid',
    headStyles: { fillColor: [24, 24, 27] },
  });

  if (report.unitBookings.length > 0) {
    autoTable(doc, {
      startY: nextY(doc, 120),
      head: [['Unit', 'Booked', 'Checked in']],
      body: report.unitBookings.map((r) => [r.unit, String(r.booked), String(r.checkedIn)]),
      theme: 'grid',
      headStyles: { fillColor: [24, 24, 27] },
    });
  }

  const safe = m.title.replace(/[^\w-]+/g, '_').slice(0, 40) || 'report';
  doc.save(`report-${safe}.pdf`);
}
