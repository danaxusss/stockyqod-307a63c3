// @ts-nocheck
import React, { useRef, useEffect, useState, useCallback } from 'react';
import { X, Flashlight, FlashlightOff, RotateCcw } from 'lucide-react';
import { BrowserMultiFormatReader, BarcodeFormat, DecodeHintType } from '@zxing/library';

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
  const zxingRef  = useRef<BrowserMultiFormatReader | null>(null);

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
        try {
          if (hasNative) {
            // Native path — the browser decodes directly from the video frame
            if (!nativeRef.current) {
              nativeRef.current = new (window as any).BarcodeDetector({ formats: NATIVE_FORMATS });
            }
            const results = await nativeRef.current.detect(v);
            if (results.length > 0) { onDetect(results[0].rawValue); return; }
          } else {
            // ZXing canvas fallback — grab a frame and let ZXing decode it
            const c = canvasRef.current;
            if (!c) { rafRef.current = requestAnimationFrame(tick); return; }
            c.width  = v.videoWidth;
            c.height = v.videoHeight;
            const ctx = c.getContext('2d', { willReadFrequently: true });
            if (!ctx) { rafRef.current = requestAnimationFrame(tick); return; }
            ctx.drawImage(v, 0, 0);

            if (!zxingRef.current) {
              const hints = new Map();
              hints.set(DecodeHintType.POSSIBLE_FORMATS, [
                BarcodeFormat.CODE_128, BarcodeFormat.EAN_13, BarcodeFormat.EAN_8,
                BarcodeFormat.CODE_39,  BarcodeFormat.UPC_A,  BarcodeFormat.UPC_E,
                BarcodeFormat.ITF,      BarcodeFormat.CODABAR,
              ]);
              hints.set(DecodeHintType.TRY_HARDER, true);
              zxingRef.current = new BrowserMultiFormatReader(hints);
            }
            const imgData = ctx.getImageData(0, 0, c.width, c.height);
            const result  = zxingRef.current.decodeFromImageData(imgData);
            onDetect(result.getText());
            return;
          }
        } catch {
          // NotFoundException / ChecksumException are normal on most frames — ignore
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
      {/* ZXing needs a hidden canvas to capture frames */}
      {!hasNative && <canvas ref={canvasRef} className="hidden" />}

      {/* Aim frame */}
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <div className="w-72 h-36 relative">
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
          Pointez vers un code-barre
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
