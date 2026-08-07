import { useEffect, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

const REGION_ID = 'qr-reader-region';

/**
 * Camera QR scanner. Tries the rear camera, then falls back to any available camera
 * (e.g. a laptop's front camera). Surfaces failures via `onError` so the user never just
 * sees a black box. Cleanup waits for start to finish so StrictMode double-mounts don't
 * leave the camera in a stuck state.
 */
export function QrScanner({
  active,
  onScan,
  onError,
}: {
  active: boolean;
  onScan: (code: string) => void;
  onError?: (message: string) => void;
}) {
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    if (!active) return;

    const scanner = new Html5Qrcode(REGION_ID, { verbose: false });
    const config = { fps: 10, qrbox: { width: 240, height: 240 }, aspectRatio: 1 };
    const onDecode = (decoded: string) => onScanRef.current(decoded);
    const onFrameError = () => {
      /* per-frame decode noise — ignore */
    };

    let started = false;

    const startPromise = (async () => {
      try {
        // Prefer the rear camera.
        await scanner.start({ facingMode: 'environment' }, config, onDecode, onFrameError);
        started = true;
      } catch {
        // Fallback: pick an explicit camera (laptops often have only a front camera).
        try {
          const cameras = await Html5Qrcode.getCameras();
          if (!cameras || cameras.length === 0) {
            onErrorRef.current?.('No camera found on this device.');
            return;
          }
          const rear = cameras.find((c) => /back|rear|environment/i.test(c.label));
          const chosen = rear ?? cameras[cameras.length - 1]!;
          await scanner.start(chosen.id, config, onDecode, onFrameError);
          started = true;
        } catch {
          onErrorRef.current?.('Cannot access the camera. Allow camera permission and retry.');
        }
      }
    })();

    return () => {
      // Wait for start to settle before stopping, so we never stop a not-yet-started scanner.
      void startPromise.finally(() => {
        if (started) {
          scanner
            .stop()
            .then(() => scanner.clear())
            .catch(() => undefined);
        } else {
          try {
            scanner.clear();
          } catch {
            /* nothing to clear */
          }
        }
      });
    };
  }, [active]);

  return <div id={REGION_ID} className="min-h-[260px] w-full" />;
}
