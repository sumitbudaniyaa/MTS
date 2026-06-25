import { customAlphabet } from 'nanoid';

// Unambiguous uppercase alphabet (no 0/O/1/I) for human-readable, scan-friendly codes.
const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const nano = customAlphabet(alphabet, 14);

/** Generate an opaque, globally-unique ticket/QR code, e.g. `TKT-7F3K9QABCD2MNP`. */
export function generateTicketCode(): string {
  return `TKT-${nano()}`;
}
