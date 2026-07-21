// @ts-nocheck
import React, { useRef, useEffect, useState, useCallback } from 'react';
import { X, Flashlight, FlashlightOff, RotateCcw } from 'lucide-react';
import {
  MultiFormatReader, BarcodeFormat, DecodeHintType,
  BinaryBitmap, HybridBinarizer, HTMLCanvasElementLuminanceSource,
} from '@zxing/library';

interface BarcodeScannerProps {
  onScan: (barcode: string) => void;
  onClose: () => void;
  isOpen: boolean;
}

// Formats for the native BarcodeDetector API (lowercase string identifiers)
const NATIVE_FORMATS = ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'itf', 'codabar', 'qr_code'];
// How often to attempt a decode (ms) — 150ms ≈ 6–7 fps, fast enough without draining the CPU
const SCAN_INTERVAL_MS = 150;

export function BarcodeScanner({ onScan, onClose, isOpen }: BarcodeScannerProps) {
  const videoRef  = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);   // used only for ZXing fallback
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef    = useRef<number>(0);
  const lastRef   = useRef(0);
  const doneRef   = useRef(false);                     // prevent double-fire after first scan
  const nativeRef = useRef<any>(null);                 // BarcodeDetector instance
  const nativeReadyRef = useRef<boolean | null>(null); // null = unknown, false = unusable
  const zxingRef  = useRef<MultiFormatReader | null>(null);

  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [camId,   setCamId]   = useState('');
  const [torch,   setTorch]   = useState(false);
  const [torchOk, setTorchOk] = useState(false);
  const [err,     setErr]     = useState<string | null>(null);

  // Use the native BarcodeDetector API when the browser supports it (Chrome Android,
  // Safari 17+). Fall back to ZXing canvas decode for older Safari.
  const hasNative = typeof window !== 'undefined' && 'BarcodeDetector' in window;

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }, []);

  const beep = () => {
    try {
      const ac = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.connect(gain);
      gain.connect(ac.destination);
      osc.frequency.value = 880;
      gain.gain.value = 0.25;
      osc.start();
      osc.stop(ac.currentTime + 0.12);
    } catch {}
  };

  const onDetect = useCallback((raw: string) => {
    if (doneRef.current || !raw || raw.length < 3) return;
    doneRef.current = true;
    if ('vibrate' in navigator) navigator.vibrate([100, 50, 100]);
    beep();
    onScan(raw);
  }, [onScan]);

  const startLoop = useCallback(() => {
    const tick = async () => {
      if (doneRef.current) return;
      const v = videoRef.current;
      if (!v || v.readyState < 2) { rafRef.current = requestAnimationFrame(tick); return; }

      const now = Date.now();
      if (now - lastRef.current >= SCAN_INTERVAL_MS) {
        lastRef.current = now;

        // ── Native BarcodeDetector path (Chrome/Android) ──────────────────
        if (hasNative && nativeReadyRef.current !== false) {
          try {
            if (!nativeRef.current) {
              // Only request formats the browser actually supports, and make
              // sure QR is among them — otherwise fall back to ZXing.
              const supported: string[] = await (window as any).BarcodeDetector.getSupportedFormats();
              const formats = NATIVE_FORMATS.filter(f => supported.includes(f));
              if (!formats.includes('qr_code') && !formats.length) {
                nativeReadyRef.current = false; // unusable → ZXing
              } else {
                nativeRef.current = new (window as any).BarcodeDetector({ formats });
                nativeReadyRef.current = true;
              }
            }
            if (nativeRef.current) {
              const results = await nativeRef.current.detect(v);
              if (results.length > 0) { onDetect(results[0].rawValue); return; }
              rafRef.current = requestAnimationFrame(tick);
              return;
            }
          } catch {
            // Native unusable on this device → permanently switch to ZXing
            nativeReadyRef.current = false;
          }
        }

        // ── ZXing canvas fallback (iOS Safari, older browsers) ────────────
        try {
          const c = canvasRef.current;
          if (c && v.videoWidth) {
            c.width  = v.videoWidth;
            c.height = v.videoHeight;
            const ctx = c.getContext('2d', { willReadFrequently: true });
            if (ctx) {
              ctx.drawImage(v, 0, 0);
              if (!zxingRef.current) {
                const hints = new Map();
                hints.set(DecodeHintType.POSSIBLE_FORMATS, [
                  BarcodeFormat.QR_CODE,
                  BarcodeFormat.CODE_128, BarcodeFormat.EAN_13, BarcodeFormat.EAN_8,
                  BarcodeFormat.CODE_39,  BarcodeFormat.UPC_A,  BarcodeFormat.UPC_E,
                  BarcodeFormat.ITF,      BarcodeFormat.CODABAR, BarcodeFormat.DATA_MATRIX,
                ]);
                hints.set(DecodeHintType.TRY_HARDER, true);
                const reader = new MultiFormatReader();
                reader.setHints(hints);
                zxingRef.current = reader;
              }
              const source = new HTMLCanvasElementLuminanceSource(c);
              const bitmap = new BinaryBitmap(new HybridBinarizer(source));
              const result = zxingRef.current.decodeWithState
                ? zxingRef.current.decodeWithState(bitmap)
                : zxingRef.current.decode(bitmap);
              if (result) { onDetect(result.getText()); return; }
            }
          }
        } catch {
          // NotFoundException on most frames is normal — reset reader state and retry
          zxingRef.current?.reset?.();
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [hasNative, onDetect]);

  const startCamera = useCallback(async (deviceId?: string) => {
    stop();
    setErr(null);
    doneRef.current = false;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'environment' }),
          width:     { ideal: 1920 },
          height:    { ideal: 1080 },
          frameRate: { ideal: 30 },
        },
      });
      streamRef.current = stream;

      const track = stream.getVideoTracks()[0];
      setTorchOk(!!(track.getCapabilities?.() as any)?.torch);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      // Enumerate cameras after we have permission (labels only appear post-permission)
      const all  = await navigator.mediaDevices.enumerateDevices();
      const cams = all.filter(d => d.kind === 'videoinput');
      setCameras(cams);
      setCamId(track.getSettings().deviceId || '');
      startLoop();
    } catch (e: any) {
      setErr('Accès caméra refusé — ' + (e.message || 'permission requise'));
    }
  }, [stop, startLoop]);

  useEffect(() => {
    if (isOpen) startCamera();
    else stop();
    return stop;
  }, [isOpen]);

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      await (track as any).applyConstraints({ advanced: [{ torch: !torch }] });
      setTorch(v => !v);
    } catch {}
  };

  const switchCamera = () => {
    const idx  = cameras.findIndex(c => c.deviceId === camId);
    const next = cameras[(idx + 1) % cameras.length];
    if (next) startCamera(next.deviceId);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black">
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-cover"
        playsInline muted autoPlay
      />
      {/* Hidden canvas — always present for the ZXing fallback path */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Aim frame */}
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <div className="w-64 h-64 relative">
          {/* Dim surround */}
          <div className="absolute inset-0 border-2 border-white/15 rounded" />
          {/* Corner brackets */}
          <div className="absolute top-0 left-0  w-7 h-7 border-t-[3px] border-l-[3px] border-primary rounded-tl-sm" />
          <div className="absolute top-0 right-0 w-7 h-7 border-t-[3px] border-r-[3px] border-primary rounded-tr-sm" />
          <div className="absolute bottom-0 left-0  w-7 h-7 border-b-[3px] border-l-[3px] border-primary rounded-bl-sm" />
          <div className="absolute bottom-0 right-0 w-7 h-7 border-b-[3px] border-r-[3px] border-primary rounded-br-sm" />
          {/* Scan line */}
          <div className="absolute inset-x-3 top-1/2 -translate-y-px h-0.5 bg-primary/60 animate-pulse" />
        </div>
        <p className="mt-5 text-white/50 text-sm tracking-wide select-none">
          Pointez vers un code-barre ou QR
        </p>
      </div>

      {err && (
        <div className="absolute bottom-24 inset-x-6 bg-destructive/90 backdrop-blur text-white rounded-xl px-4 py-3 text-sm text-center">
          {err}
        </div>
      )}

      {/* Controls — top-right column */}
      <div className="absolute top-4 right-4 flex flex-col gap-3">
        <button
          onClick={onClose}
          className="p-3 bg-black/60 backdrop-blur rounded-full text-white active:scale-95 transition-transform"
          aria-label="Fermer"
        >
          <X className="h-5 w-5" />
        </button>

        {torchOk && (
          <button
            onClick={toggleTorch}
            className={`p-3 backdrop-blur rounded-full text-white active:scale-95 transition-transform ${torch ? 'bg-yellow-400/80' : 'bg-black/60'}`}
            aria-label="Lampe torche"
          >
            {torch ? <FlashlightOff className="h-5 w-5" /> : <Flashlight className="h-5 w-5" />}
          </button>
        )}

        {cameras.length > 1 && (
          <button
            onClick={switchCamera}
            className="p-3 bg-black/60 backdrop-blur rounded-full text-white active:scale-95 transition-transform"
            aria-label="Changer de caméra"
          >
            <RotateCcw className="h-5 w-5" />
          </button>
        )}
      </div>
    </div>
  );
}
