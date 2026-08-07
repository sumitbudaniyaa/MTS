import { useEffect, useRef, useState } from 'react';
import { api, apiErrorMessage } from '@/lib/api';
import { QrScanner } from './QrScanner';
import { useOnline } from './useOnline';

interface VerifyResult {
  code: string;
  status: 'CHECKED_IN';
  checkedInAt: string;
  movie: { id: string; title: string; startTime: string };
  holderMobile: string;
}

type Outcome =
  | { kind: 'ok'; result: VerifyResult }
  | { kind: 'fail'; label: string; message: string };

/** Map backend conflict messages to a short status label for the result bar. */
function labelFor(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('already')) return 'Already used';
  if (m.includes('released')) return 'Seat released';
  if (m.includes('expired')) return 'Expired';
  if (m.includes('cancel')) return 'Cancelled';
  if (m.includes('not found')) return 'Invalid';
  return 'Rejected';
}

/**
 * Door check-in from the admin console. Same verification endpoint the scanner app uses — an
 * operational admin running a show can work the door themselves without a separate account.
 * The server records the check-in against their Admin id, so it stays attributable.
 */
export function ScanPage() {
  const online = useOnline();
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [manual, setManual] = useState('');
  const [camError, setCamError] = useState<string | null>(null);

  // Auto-dismiss the result after 3s, resetting whenever a new one arrives.
  useEffect(() => {
    if (!outcome) return;
    const t = setTimeout(() => setOutcome(null), 3000);
    return () => clearTimeout(t);
  }, [outcome]);

  const busyRef = useRef(false);
  const lastRef = useRef<{ code: string; at: number }>({ code: '', at: 0 });

  async function verify(code: string) {
    const now = Date.now();
    // Dedupe repeat reads of the same QR while it sits in frame.
    if (busyRef.current) return;
    if (code === lastRef.current.code && now - lastRef.current.at < 3000) return;
    lastRef.current = { code, at: now };
    busyRef.current = true;
    try {
      const res = await api.post<{ ticket: VerifyResult }>('/attendance/verify', { code });
      setOutcome({ kind: 'ok', result: res.data.ticket });
      setManual('');
    } catch (err) {
      const message = apiErrorMessage(err, 'Verification failed');
      setOutcome({ kind: 'fail', label: labelFor(message), message });
    } finally {
      busyRef.current = false;
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-fg">Scan tickets</h1>
          <p className="text-xs text-muted">Point the camera at a ticket QR</p>
        </div>
        <span className={`text-xs ${online ? 'text-success' : 'text-warning'}`}>
          {online ? 'Online' : 'Offline'}
        </span>
      </div>

      {!online ? (
        <div className="flex h-64 items-center justify-center rounded-2xl border border-border text-sm text-muted">
          Reconnect to scan
        </div>
      ) : camError ? (
        <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-2xl border border-border px-6 text-center">
          <p className="text-sm text-warning">{camError}</p>
          <p className="text-xs text-muted">You can still verify by entering the code below.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-black">
          <QrScanner active onScan={verify} onError={setCamError} />
        </div>
      )}

      <div className="mt-4">
        <label className="label">Enter code manually</label>
        <div className="flex gap-2">
          <input
            className="input"
            placeholder="TKT-XXXX"
            value={manual}
            onChange={(e) => setManual(e.target.value.toUpperCase())}
          />
          <button
            type="button"
            className="shrink-0 rounded-xl bg-fg px-4 text-sm font-medium text-bg disabled:opacity-40"
            disabled={manual.trim().length < 4 || !online}
            onClick={() => void verify(manual.trim())}
          >
            Verify
          </button>
        </div>
      </div>

      {/* Result — sticky at the bottom of the viewport so it is readable at arm's length. */}
      {outcome && (
        <div
          className={`sticky bottom-4 mt-5 rounded-2xl border px-4 py-3 shadow-soft ${
            outcome.kind === 'ok'
              ? 'border-success/30 bg-success/10'
              : 'border-danger/30 bg-danger/10'
          }`}
        >
          {outcome.kind === 'ok' ? (
            <>
              <div className="text-lg font-bold text-success">✓ Verified</div>
              <div className="mt-0.5 text-sm text-fg">{outcome.result.movie.title}</div>
              <div className="text-xs text-muted">Holder: {outcome.result.holderMobile}</div>
            </>
          ) : (
            <>
              <div className="text-lg font-bold text-danger">✕ {outcome.label}</div>
              <div className="mt-0.5 text-xs text-muted">{outcome.message}</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
