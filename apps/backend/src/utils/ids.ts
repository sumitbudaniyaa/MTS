import { customAlphabet } from 'nanoid';

// Unambiguous uppercase alphabet (no 0/O/1/I) for human-readable, scan-friendly codes.
const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const nano = customAlphabet(alphabet, 14);

/** Generate an opaque, globally-unique ticket/QR code, e.g. `TKT-7F3K9QABCD2MNP`. */
export function generateTicketCode(): string {
  return `TKT-${nano()}`;
}

/**
 * One-off password for an account whose holder cannot be handed the shared default — currently
 * scanner operators, who have no self-service change screen and so must be given a credential
 * that is theirs alone.
 *
 * Uses the same unambiguous alphabet as ticket codes (no 0/O, no 1/I) because this gets read
 * aloud or written on paper. 10 characters of a 32-symbol alphabet is ~50 bits, which is ample
 * for a credential that must be replaced within the grace window anyway.
 */
export function generateTempPassword(): string {
  return `Scn-${nano().slice(0, 10)}`;
}
