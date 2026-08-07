import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, apiErrorMessage } from '@/lib/api';
import type { VerifyResult } from '@/types';
import { QrScanner } from './QrScanner';
import { useOnline } from './useOnline';

type Outcome =
  | { kind: 'ok'; result: VerifyResult }
  | { kind: 'fail'; label: string; message: string };

// Map backend conflict messages to a short status label shown in the result bar.
function labelFor(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('already')) return 'Already used';
  if (m.includes('released')) return 'Seat released';
  if (m.includes('expired')) return 'Expired';
  if (m.includes('cancel')) return 'Cancelled';
  if (m.includes('not found')) return 'Invalid';
  return 'Rejected';
}

export function ScanPage() {
  const navigate = useNavigate();
  const online = useOnline();
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [manual, setManual] = useState('');
  const [camError, setCamError] = useState<string | null>(null);

  // Auto-dismiss the result bar after 3s (resets whenever a new result arrives).
  useEffect(() => {
    if (!outcome) return;
    const t = setTimeout(() => setOutcome(null), 3000);
    return () => clearTimeout(t);
  }, [outcome]);
  const busyRef = useRef(false);
  const lastRef = useRef<{ code: string; at: number }>({ code: '', at: 0 });

  async function verify(code: string) {
    const now = Date.now();
    // Dedupe rapid repeat reads of the same QR while it sits in frame.
    if (busyRef.current || outcome) return;
    if (code === lastRef.current.code && now - lastRef.current.at < 3000) return;
    lastRef.current = { code, at: now };
    busyRef.current = true;
    try {
      const res = await api.post<{ ticket: VerifyResult }>('/attendance/verify', { code });
      setOutcome({ kind: 'ok', result: res.data.ticket });
    } catch (err) {
      const message = apiErrorMessage(err, 'Verification failed');
      setOutcome({ kind: 'fail', label: labelFor(message), message });
    } finally {
      busyRef.current = false;
    }
  }

  return (
    <div className="mx-auto flex h-full max-w-md flex-col">
      <header className="flex h-14 items-center justify-between border-b border-border px-4">
        <button onClick={() => navigate('/')} className="text-sm text-muted">
          ‹ Back
        </button>
        <span className="text-sm font-medium">Scanning</span>
        <span className={`text-xs ${online ? 'text-success' : 'text-warning'}`}>
          {online ? 'Online' : 'Offline'}
        </span>
      </header>

      <div className="flex-1 overflow-auto p-4">
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
          <div className="relative overflow-hidden rounded-2xl border border-border bg-black min-h-[260px]">
            <QrScanner active onScan={verify} onError={setCamError} />
            {outcome && (
              <div
                className={`absolute inset-0 flex flex-col justify-center p-6 text-center text-white ${
                  outcome.kind === 'ok' ? 'bg-success' : 'bg-danger'
                }`}
              >
                {outcome.kind === 'ok' ? (
                  <div>
                    <div className="text-3xl font-extrabold">✓ Verified</div>
                    <div className="mt-2 text-lg font-semibold">{outcome.result.movie.title}</div>
                    <div className="mt-1 text-sm opacity-90">Holder: {outcome.result.holderMobile}</div>
                  </div>
                ) : (
                  <div>
                    <div className="text-3xl font-extrabold">✕ {outcome.label}</div>
                    <div className="mt-2 text-sm opacity-95">{outcome.message}</div>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setOutcome(null)}
                  className="mt-6 mx-auto rounded-xl bg-white px-4 py-2 text-xs font-bold text-fg uppercase tracking-wider shadow hover:bg-white/90 active:scale-95 transition"
                >
                  Scan next
                </button>
              </div>
            )}
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
              className="rounded-lg bg-fg px-3 text-sm font-medium text-bg disabled:opacity-40"
              disabled={manual.length < 4 || !online}
              onClick={() => verify(manual.trim())}
            >
              Verify
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
