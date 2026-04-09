// @ts-nocheck
import React, { useRef, useEffect, useState, useCallback } from 'react';
import { X, Camera, Flashlight, FlashlightOff, RotateCcw, AlertCircle, Smartphone, Target, Zap, Focus, Maximize } from 'lucide-react';
import { BrowserMultiFormatReader, NotFoundException, ChecksumException, FormatException, BarcodeFormat } from '@zxing/library';

interface BarcodeScannerProps {
  onScan: (barcode: string) => void;
  onClose: () => void;
  isOpen: boolean;
}

export function BarcodeScanner({ onScan, onClose, isOpen }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [currentDeviceId, setCurrentDeviceId] = useState<string>('');
  const [flashlightOn, setFlashlightOn] = useState(false);
  const [isFlashlightSupported, setIsFlashlightSupported] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait');
  const [scanningActive, setScanningActive] = useState(false);
  const [lastScanAttempt, setLastScanAttempt] = useState<number>(0);
  const [scanningRegions, setScanningRegions] = useState<Array<{x: number, y: number, width: number, height: number}>>([]);
  const [currentRegionIndex, setCurrentRegionIndex] = useState(0);
  const [scanAttempts, setScanAttempts] = useState(0);
  const [detectionConfidence, setDetectionConfidence] = useState(0);
  
  const codeReader = useRef<BrowserMultiFormatReader | null>(null);
  const scanningIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const frameCountRef = useRef(0);

  // Detect orientation changes
  useEffect(() => {
    const handleOrientationChange = () => {
      setOrientation(window.innerHeight > window.innerWidth ? 'portrait' : 'landscape');
    };

    window.addEventListener('resize', handleOrientationChange);
    window.addEventListener('orientationchange', handleOrientationChange);
    
    return () => {
      window.removeEventListener('resize', handleOrientationChange);
      window.removeEventListener('orientationchange', handleOrientationChange);
    };
  }, []);

  // Initialize scanner
  useEffect(() => {
    if (isOpen) {
      initializeScanner();
    } else {
      cleanup();
    }

    return cleanup;
  }, [isOpen]);

  // Enhanced camera selection with iPhone 14 Pro optimization
  const selectBestCamera = (cameras: MediaDeviceInfo[]): string => {
    if (cameras.length === 0) return '';
    
    console.log('Available cameras:', cameras.map(cam => ({ label: cam.label, id: cam.deviceId })));
    
    // Enhanced priority order specifically for iPhone 14 Pro and similar devices
    const priorities = [
      // iPhone 14 Pro specific - Ultra Wide is best for close-up barcode scanning
      /ultra.*wide.*back/i,
      /back.*ultra.*wide/i,
      /ultra.*wide/i,
      // Main wide camera (good balance)
      /wide.*back/i,
      /back.*wide/i,
      /main.*back/i,
      /back.*main/i,
      // Telephoto (less ideal for close scanning but still good)
      /telephoto.*back/i,
      /back.*telephoto/i,
      // Generic patterns
      /back.*camera.*0/i, // Often the main camera
      /environment/i,
      /back/i,
      /rear/i,
      // Fallback patterns
      /camera.*2/i, // Sometimes ultra-wide
      /camera.*1/i, // Sometimes wide
      /camera.*0/i  // Usually main
    ];

    // Try each priority pattern
    for (const pattern of priorities) {
      const camera = cameras.find(cam => pattern.test(cam.label.toLowerCase()));
      if (camera) {
        console.log(`Selected camera: ${camera.label} (${camera.deviceId})`);
        return camera.deviceId;
      }
    }

    // If no pattern matches, prefer cameras with higher index (often better cameras)
    const sortedCameras = [...cameras].sort((a, b) => {
      // Extract numbers from device IDs or labels
      const aNum = parseInt(a.deviceId.match(/\d+/)?.[0] || '0');
      const bNum = parseInt(b.deviceId.match(/\d+/)?.[0] || '0');
      return bNum - aNum; // Descending order
    });

    console.log(`Fallback to highest indexed camera: ${sortedCameras[0].label}`);
    return sortedCameras[0].deviceId;
  };

  const initializeScanner = async () => {
    try {
      setError(null);
      
      // Check if we're on a mobile device
      const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      
      if (!isMobile) {
        setError('Le scanner de codes-barres n\'est disponible que sur les appareils mobiles');
        return;
      }

      // Request camera permission with enhanced error handling
      try {
        const permission = await navigator.permissions.query({ name: 'camera' as PermissionName });
        setHasPermission(permission.state === 'granted');

        if (permission.state === 'denied') {
          setError('Permission d\'accès à la caméra refusée. Veuillez l\'autoriser dans les paramètres de votre navigateur.');
          return;
        }
      } catch (permError) {
        console.warn('Permission API not available, proceeding with getUserMedia');
      }

      // Get available cameras with enhanced enumeration
      let cameras: MediaDeviceInfo[] = [];
      try {
        // First request basic access to enumerate devices properly
        const tempStream = await navigator.mediaDevices.getUserMedia({ video: true });
        tempStream.getTracks().forEach(track => track.stop());
        
        // Now enumerate devices with proper labels
        const videoDevices = await navigator.mediaDevices.enumerateDevices();
        cameras = videoDevices.filter(device => device.kind === 'videoinput');
      } catch (enumError) {
        console.error('Failed to enumerate cameras:', enumError);
        setError('Impossible d\'accéder aux caméras. Vérifiez les permissions.');
        return;
      }
      
      console.log('Available cameras:', cameras.map(cam => ({ label: cam.label, id: cam.deviceId })));
      setDevices(cameras);

      if (cameras.length === 0) {
        setError('Aucune caméra détectée sur cet appareil');
        return;
      }

      // Select the best camera for barcode scanning
      const selectedDeviceId = selectBestCamera(cameras);
      setCurrentDeviceId(selectedDeviceId);

      await startScanning(selectedDeviceId);
    } catch (err) {
      console.error('Failed to initialize scanner:', err);
      setError('Impossible d\'initialiser le scanner. Vérifiez que votre navigateur supporte l\'accès à la caméra.');
    }
  };

  const startScanning = async (deviceId: string) => {
    try {
      setIsScanning(true);
      setError(null);
      setScanningActive(false);
      setScanAttempts(0);
      setDetectionConfidence(0);

      // Stop any existing stream
      cleanup();

      // Enhanced camera constraints optimized for barcode scanning
      const constraints: MediaStreamConstraints = {
        video: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          facingMode: deviceId ? undefined : { ideal: 'environment' },
          // Optimized resolution for barcode scanning - higher resolution for better detection
          width: { ideal: 1920, min: 1280, max: 4096 },
          height: { ideal: 1080, min: 720, max: 2160 },
          frameRate: { ideal: 30, min: 20, max: 60 },
          // Enhanced camera settings for barcode scanning
          focusMode: 'continuous',
          exposureMode: 'continuous',
          whiteBalanceMode: 'continuous',
          // Additional constraints for better image quality
          aspectRatio: { ideal: 16/9 },
          resizeMode: 'crop-and-scale'
        }
      };

      const mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      setStream(mediaStream);

      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        
        // Enhanced video setup
        videoRef.current.setAttribute('playsinline', 'true');
        videoRef.current.setAttribute('webkit-playsinline', 'true');
        videoRef.current.muted = true;
        
        // Wait for video to be ready with timeout
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Video load timeout')), 10000);
          
          if (videoRef.current) {
            videoRef.current.onloadedmetadata = () => {
              clearTimeout(timeout);
              videoRef.current?.play().then(() => {
                console.log('Video started successfully');
                resolve();
              }).catch(reject);
            };
            videoRef.current.onerror = () => {
              clearTimeout(timeout);
              reject(new Error('Video load error'));
            };
          }
        });

        // Calculate multiple scanning regions for better coverage
        const video = videoRef.current;
        const videoWidth = video.videoWidth;
        const videoHeight = video.videoHeight;
        
        console.log(`Video dimensions: ${videoWidth}x${videoHeight}`);
        
        // Define multiple scanning regions with different sizes and positions
        const regions = [
          // Center region (primary)
          {
            x: videoWidth * 0.2,
            y: videoHeight * 0.3,
            width: videoWidth * 0.6,
            height: videoHeight * 0.4
          },
          // Wider center region
          {
            x: videoWidth * 0.1,
            y: videoHeight * 0.25,
            width: videoWidth * 0.8,
            height: videoHeight * 0.5
          },
          // Upper region
          {
            x: videoWidth * 0.15,
            y: videoHeight * 0.15,
            width: videoWidth * 0.7,
            height: videoHeight * 0.4
          },
          // Lower region
          {
            x: videoWidth * 0.15,
            y: videoHeight * 0.45,
            width: videoWidth * 0.7,
            height: videoHeight * 0.4
          }
        ];
        
        setScanningRegions(regions);
        console.log('Scanning regions configured:', regions);
      }

      // Enhanced camera track setup
      const track = mediaStream.getVideoTracks()[0];
      trackRef.current = track;
      
      console.log('Camera track capabilities:', track.getCapabilities());
      
      // Check for flashlight support
      const capabilities = track.getCapabilities();
      setIsFlashlightSupported('torch' in capabilities);

      // Apply enhanced camera settings for barcode scanning
      try {
        const settings = track.getSettings();
        console.log('Current camera settings:', settings);
        
        await track.applyConstraints({
          focusMode: 'continuous',
          exposureMode: 'continuous',
          whiteBalanceMode: 'continuous',
          // Try to enable advanced features if available
          ...(capabilities.focusDistance && { focusDistance: capabilities.focusDistance.max }),
          ...(capabilities.iso && { iso: capabilities.iso.min }), // Lower ISO for less noise
          ...(capabilities.brightness && { brightness: capabilities.brightness.max * 0.8 })
        } as any);
        
        console.log('Enhanced camera settings applied');
      } catch (settingsError) {
        console.warn('Could not apply all camera settings:', settingsError);
      }

      // Initialize enhanced ZXing code reader
      if (!codeReader.current) {
        codeReader.current = new BrowserMultiFormatReader();
        
        // Configure enhanced hints for better barcode detection
        const hints = new Map();
        hints.set(2, true); // PURE_BARCODE
        hints.set(3, true); // TRY_HARDER
        hints.set(4, true); // CHARACTER_SET_ECI
        
        // Enable specific barcode formats for better performance
        const formats = [
          BarcodeFormat.CODE_128,
          BarcodeFormat.CODE_39,
          BarcodeFormat.EAN_13,
          BarcodeFormat.EAN_8,
          BarcodeFormat.UPC_A,
          BarcodeFormat.UPC_E,
          BarcodeFormat.ITF,
          BarcodeFormat.CODABAR
        ];
        
        codeReader.current.setHints(hints);
        console.log('ZXing reader initialized with enhanced settings');
      }

      // Start enhanced scanning with multiple strategies
      startEnhancedScanning();

    } catch (err) {
      console.error('Failed to start scanning:', err);
      setError('Impossible de démarrer la caméra. Vérifiez les permissions et réessayez.');
      setIsScanning(false);
    }
  };

  // Enhanced scanning with multiple strategies and image preprocessing
  const startEnhancedScanning = () => {
    setScanningActive(true);
    setCurrentRegionIndex(0);
    frameCountRef.current = 0;
    
    const scanFrame = () => {
      if (!videoRef.current || !canvasRef.current || !overlayCanvasRef.current || !codeReader.current || !scanningActive) {
        return;
      }

      const video = videoRef.current;
      const canvas = canvasRef.current;
      const overlayCanvas = overlayCanvasRef.current;
      const ctx = canvas.getContext('2d');
      const overlayCtx = overlayCanvas.getContext('2d');
      
      if (!ctx || !overlayCtx || video.readyState !== video.HAVE_ENOUGH_DATA) {
        if (scanningActive) {
          requestAnimationFrame(scanFrame);
        }
        return;
      }

      frameCountRef.current++;

      // Throttle scanning attempts but allow faster processing
      const now = Date.now();
      if (now - lastScanAttempt < 150) { // Increased to ~6.7 scans per second
        if (scanningActive) {
          requestAnimationFrame(scanFrame);
        }
        return;
      }
      setLastScanAttempt(now);

      // Update overlay canvas to match video
      overlayCanvas.width = video.videoWidth;
      overlayCanvas.height = video.videoHeight;
      overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

      // Cycle through different scanning regions
      const regionIndex = Math.floor(frameCountRef.current / 10) % scanningRegions.length;
      setCurrentRegionIndex(regionIndex);
      
      if (scanningRegions.length === 0) {
        if (scanningActive) {
          requestAnimationFrame(scanFrame);
        }
        return;
      }

      const region = scanningRegions[regionIndex];
      
      // Draw current scanning region on overlay
      overlayCtx.strokeStyle = '#3B82F6';
      overlayCtx.lineWidth = 3;
      overlayCtx.strokeRect(region.x, region.y, region.width, region.height);
      
      // Set canvas size to match current region
      canvas.width = region.width;
      canvas.height = region.height;

      // Extract and preprocess the image region
      ctx.drawImage(
        video,
        region.x, region.y, region.width, region.height,
        0, 0, region.width, region.height
      );

      // Apply multiple image preprocessing techniques
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      
      // Try scanning with different preprocessing methods
      const preprocessingMethods = [
        (data: ImageData) => data, // Original
        (data: ImageData) => enhanceContrast(data, 1.5), // Enhanced contrast
        (data: ImageData) => adjustBrightness(data, 20), // Brighter
        (data: ImageData) => adjustBrightness(data, -20), // Darker
        (data: ImageData) => sharpenImage(data), // Sharpened
        (data: ImageData) => enhanceContrast(adjustBrightness(data, 10), 1.3) // Combined
      ];

      // Try each preprocessing method
      for (let i = 0; i < preprocessingMethods.length; i++) {
        try {
          const processedImageData = preprocessingMethods[i](cloneImageData(imageData));
          const result = codeReader.current.decodeFromImageData(processedImageData);
          
          if (result) {
            const scannedText = result.getText();
            console.log(`Barcode detected with method ${i}:`, scannedText);
            
            // Validate barcode (basic validation)
            if (scannedText && scannedText.length >= 3) {
              // Stop scanning immediately
              setScanningActive(false);
              
              // Enhanced feedback
              setDetectionConfidence(100);
              
              // Trigger enhanced haptic feedback
              if ('vibrate' in navigator) {
                navigator.vibrate([200, 100, 200]);
              }
              
              // Enhanced visual feedback
              if (videoRef.current) {
                videoRef.current.style.filter = 'brightness(2) saturate(0)';
                setTimeout(() => {
                  if (videoRef.current) {
                    videoRef.current.style.filter = 'none';
                  }
                }, 300);
              }
              
              // Success sound (if audio context is available)
              try {
                const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
                const oscillator = audioContext.createOscillator();
                const gainNode = audioContext.createGain();
                
                oscillator.connect(gainNode);
                gainNode.connect(audioContext.destination);
                
                oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
                gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
                
                oscillator.start(audioContext.currentTime);
                oscillator.stop(audioContext.currentTime + 0.2);
              } catch (audioError) {
                // Audio feedback not available, continue silently
              }
              
              onScan(scannedText);
              onClose();
              return;
            }
          }
        } catch (error) {
          // Continue to next preprocessing method
          if (!(error instanceof NotFoundException)) {
            console.warn(`Scan error with method ${i}:`, error);
          }
        }
      }

      // Update scan attempts and confidence
      setScanAttempts(prev => prev + 1);
      
      // Calculate confidence based on scan attempts and region coverage
      const confidence = Math.min((scanAttempts / 50) * 100, 95);
      setDetectionConfidence(confidence);

      // Continue scanning
      if (scanningActive) {
        requestAnimationFrame(scanFrame);
      }
    };

    // Start the enhanced scanning loop
    requestAnimationFrame(scanFrame);
  };

  // Image preprocessing functions
  const cloneImageData = (imageData: ImageData): ImageData => {
    const clonedData = new Uint8ClampedArray(imageData.data);
    return new ImageData(clonedData, imageData.width, imageData.height);
  };

  const enhanceContrast = (imageData: ImageData, factor: number): ImageData => {
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = Math.min(255, Math.max(0, (data[i] - 128) * factor + 128));     // Red
      data[i + 1] = Math.min(255, Math.max(0, (data[i + 1] - 128) * factor + 128)); // Green
      data[i + 2] = Math.min(255, Math.max(0, (data[i + 2] - 128) * factor + 128)); // Blue
    }
    return imageData;
  };

  const adjustBrightness = (imageData: ImageData, adjustment: number): ImageData => {
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = Math.min(255, Math.max(0, data[i] + adjustment));     // Red
      data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + adjustment)); // Green
      data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + adjustment)); // Blue
    }
    return imageData;
  };

  const sharpenImage = (imageData: ImageData): ImageData => {
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;
    const output = new Uint8ClampedArray(data);
    
    // Simple sharpening kernel
    const kernel = [
      0, -1, 0,
      -1, 5, -1,
      0, -1, 0
    ];
    
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        for (let c = 0; c < 3; c++) { // RGB channels only
          let sum = 0;
          for (let ky = -1; ky <= 1; ky++) {
            for (let kx = -1; kx <= 1; kx++) {
              const idx = ((y + ky) * width + (x + kx)) * 4 + c;
              sum += data[idx] * kernel[(ky + 1) * 3 + (kx + 1)];
            }
          }
          const idx = (y * width + x) * 4 + c;
          output[idx] = Math.min(255, Math.max(0, sum));
        }
      }
    }
    
    return new ImageData(output, width, height);
  };

  const toggleFlashlight = async () => {
    if (!trackRef.current || !isFlashlightSupported) return;

    try {
      await trackRef.current.applyConstraints({
        advanced: [{ torch: !flashlightOn } as any]
      });
      setFlashlightOn(!flashlightOn);
      showToast(flashlightOn ? 'Lampe éteinte' : 'Lampe allumée');
    } catch (err) {
      console.error('Failed to toggle flashlight:', err);
      setError('Impossible de contrôler la lampe torche');
    }
  };

  const switchCamera = async () => {
    if (devices.length <= 1) return;

    const currentIndex = devices.findIndex(device => device.deviceId === currentDeviceId);
    const nextIndex = (currentIndex + 1) % devices.length;
    const nextDevice = devices[nextIndex];
    
    console.log(`Switching from ${devices[currentIndex]?.label} to ${nextDevice.label}`);
    showToast(`Caméra: ${nextDevice.label.split('(')[0].trim()}`);
    setCurrentDeviceId(nextDevice.deviceId);
    await startScanning(nextDevice.deviceId);
  };

  const cleanup = useCallback(() => {
    setScanningActive(false);
    
    if (scanningIntervalRef.current) {
      clearInterval(scanningIntervalRef.current);
      scanningIntervalRef.current = null;
    }
    
    if (stream) {
      stream.getTracks().forEach(track => {
        track.stop();
        console.log('Stopped camera track:', track.label);
      });
      setStream(null);
    }
    
    if (codeReader.current) {
      try {
        codeReader.current.reset();
      } catch (error) {
        console.warn('Error resetting code reader:', error);
      }
    }
    
    trackRef.current = null;
    setIsScanning(false);
    setFlashlightOn(false);
    setScanAttempts(0);
    setDetectionConfidence(0);
    frameCountRef.current = 0;
  }, [stream]);

  const handleManualInput = () => {
    const barcode = prompt('Entrez le code-barres manuellement:');
    if (barcode && barcode.trim()) {
      onScan(barcode.trim());
      onClose();
    }
  };

  // Enhanced focus with multiple focus strategies
  const enhanceFocus = async () => {
    if (!trackRef.current) return;

    try {
      const capabilities = trackRef.current.getCapabilities();
      
      // Try different focus strategies
      const focusStrategies = [
        { focusMode: 'single-shot' },
        { focusMode: 'manual', focusDistance: capabilities.focusDistance?.max },
        { focusMode: 'manual', focusDistance: capabilities.focusDistance?.min },
        { focusMode: 'continuous' }
      ];

      for (const strategy of focusStrategies) {
        try {
          await trackRef.current.applyConstraints(strategy as any);
          await new Promise(resolve => setTimeout(resolve, 500)); // Wait for focus
          showToast('Focus ajusté');
          break;
        } catch (error) {
          console.warn('Focus strategy failed:', strategy, error);
        }
      }
    } catch (error) {
      console.warn('Could not enhance focus:', error);
    }
  };

  // Zoom enhancement for better barcode detection
  const enhanceZoom = async () => {
    if (!trackRef.current) return;

    try {
      const capabilities = trackRef.current.getCapabilities();
      if (capabilities.zoom) {
        const currentSettings = trackRef.current.getSettings();
        const currentZoom = (currentSettings as any).zoom || capabilities.zoom.min;
        const maxZoom = capabilities.zoom.max;
        const newZoom = Math.min(maxZoom, currentZoom * 1.5);
        
        await trackRef.current.applyConstraints({
          advanced: [{ zoom: newZoom } as any]
        });
        
        showToast(`Zoom: ${newZoom.toFixed(1)}x`);
      }
    } catch (error) {
      console.warn('Could not adjust zoom:', error);
    }
  };

  // Show toast helper
  const showToast = (message: string) => {
    const toast = document.createElement('div');
    toast.className = 'fixed top-20 left-1/2 transform -translate-x-1/2 bg-black/90 text-white px-4 py-2 rounded-lg text-sm z-50 backdrop-blur-sm border border-white/20';
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => {
      if (document.body.contains(toast)) {
        document.body.removeChild(toast);
      }
    }, 2000);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col">
      {/* Enhanced Header with Real-time Info */}
      <div className="flex items-center justify-between p-4 bg-gradient-to-r from-slate-900 to-slate-800 text-white shadow-lg">
        <div>
          <h2 className="text-lg font-bold tracking-wide">Scanner Code-Barres</h2>
          <div className="flex items-center space-x-4 text-xs text-gray-300 mt-1">
            {devices.length > 0 && currentDeviceId && (
              <span>
                📷 {devices.find(d => d.deviceId === currentDeviceId)?.label?.split('(')[0].trim() || 'Caméra active'}
              </span>
            )}
            {scanningActive && (
              <>
                <span>🎯 Région {currentRegionIndex + 1}/{scanningRegions.length}</span>
                <span>📊 {detectionConfidence.toFixed(0)}%</span>
              </>
            )}
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-2 hover:bg-white/20 rounded-xl transition-all duration-200 transform hover:scale-105"
        >
          <X className="h-6 w-6" />
        </button>
      </div>

      {/* Scanner Area */}
      <div className="flex-1 relative overflow-hidden">
        {error ? (
          <div className="flex flex-col items-center justify-center h-full p-6 text-center bg-gradient-to-b from-slate-900 to-black">
            <div className="bg-red-500/20 p-6 rounded-2xl mb-6 border border-red-500/30">
              <AlertCircle className="h-16 w-16 text-red-400 mx-auto" />
            </div>
            <h3 className="text-2xl font-bold text-white mb-3">Erreur du Scanner</h3>
            <p className="text-gray-300 mb-8 max-w-md leading-relaxed">{error}</p>
            <div className="space-y-4 w-full max-w-sm">
              <button
                onClick={initializeScanner}
                className="w-full px-6 py-4 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white rounded-xl transition-all duration-200 transform hover:scale-105 font-medium shadow-lg"
              >
                Réessayer
              </button>
              <button
                onClick={handleManualInput}
                className="w-full px-6 py-4 bg-gradient-to-r from-gray-600 to-gray-700 hover:from-gray-700 hover:to-gray-800 text-white rounded-xl transition-all duration-200 transform hover:scale-105 font-medium shadow-lg"
              >
                Saisie Manuelle
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Video Element */}
            <video
              ref={videoRef}
              className="w-full h-full object-cover"
              playsInline
              muted
              autoPlay
              style={{ filter: scanningActive ? 'contrast(1.1) brightness(1.05)' : 'none' }}
            />

            {/* Hidden canvas for image processing */}
            <canvas
              ref={canvasRef}
              className="hidden"
            />

            {/* Overlay canvas for region visualization */}
            <canvas
              ref={overlayCanvasRef}
              className="absolute inset-0 w-full h-full object-cover pointer-events-none opacity-60"
            />

            {/* Enhanced Scanning Overlay with Dynamic Guidance */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="flex flex-col items-center space-y-6">
                {/* Enhanced Scanning Frame with Adaptive Sizing */}
                <div className={`relative ${orientation === 'portrait' ? 'w-80 h-48' : 'w-96 h-32'} border-4 border-blue-400 rounded-2xl shadow-2xl bg-black/20 backdrop-blur-sm`}>
                  {/* Animated scanning indicator */}
                  <div className="absolute inset-0 border-4 border-blue-400 rounded-2xl animate-pulse opacity-50"></div>
                  
                  {/* Enhanced corner indicators with glow */}
                  <div className="absolute -top-3 -left-3 w-10 h-10 border-t-4 border-l-4 border-white rounded-tl-2xl shadow-lg glow-effect"></div>
                  <div className="absolute -top-3 -right-3 w-10 h-10 border-t-4 border-r-4 border-white rounded-tr-2xl shadow-lg glow-effect"></div>
                  <div className="absolute -bottom-3 -left-3 w-10 h-10 border-b-4 border-l-4 border-white rounded-bl-2xl shadow-lg glow-effect"></div>
                  <div className="absolute -bottom-3 -right-3 w-10 h-10 border-b-4 border-r-4 border-white rounded-br-2xl shadow-lg glow-effect"></div>
                  
                  {/* Center crosshair with pulsing animation */}
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Target className={`h-8 w-8 text-white/80 ${scanningActive ? 'animate-pulse' : ''}`} />
                  </div>
                  
                  {/* Enhanced Scanning Line Animation */}
                  {scanningActive && (
                    <div className="absolute inset-x-2 top-2 h-1 bg-gradient-to-r from-transparent via-green-400 to-transparent scan-line"></div>
                  )}
                  
                  {/* Confidence indicator */}
                  <div className="absolute bottom-2 left-2 right-2">
                    <div className="h-1 bg-gray-600 rounded-full overflow-hidden">
                      <div 
                        className={`h-full transition-all duration-300 ${
                          detectionConfidence > 70 ? 'bg-green-400' : 
                          detectionConfidence > 40 ? 'bg-yellow-400' : 'bg-red-400'
                        }`}
                        style={{ width: `${detectionConfidence}%` }}
                      ></div>
                    </div>
                  </div>
                </div>
                
                {/* Enhanced Instructions with Real-time Tips */}
                <div className="text-center space-y-3">
                  <div className="inline-block bg-black/90 backdrop-blur-sm px-6 py-3 rounded-2xl border border-white/20">
                    <p className="text-white text-sm font-medium">
                      {scanAttempts < 20 ? 'Centrez le code-barres dans le cadre' :
                       scanAttempts < 50 ? 'Essayez de vous rapprocher ou vous éloigner' :
                       'Utilisez la lampe ou changez de caméra'}
                    </p>
                  </div>
                  
                  <div className="inline-block bg-black/70 backdrop-blur-sm px-4 py-2 rounded-xl border border-white/10">
                    <p className="text-gray-300 text-xs">
                      💡 Distance optimale: 10-25cm • Maintenez stable • Bon éclairage
                    </p>
                  </div>

                  {/* Real-time scanning feedback */}
                  {scanningActive && (
                    <div className="inline-block bg-blue-500/20 backdrop-blur-sm px-4 py-2 rounded-xl border border-blue-400/30">
                      <p className="text-blue-200 text-xs">
                        🔍 Analyse en cours... {scanAttempts} tentatives • Région {currentRegionIndex + 1}/{scanningRegions.length}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Enhanced Controls with More Options */}
      {!error && (
        <div className="bg-gradient-to-t from-black to-slate-900 p-4 border-t border-white/10">
          <div className="flex items-center justify-center space-x-4 mb-4">
            {/* Enhanced Flashlight Toggle */}
            {isFlashlightSupported && (
              <button
                onClick={toggleFlashlight}
                className={`p-4 rounded-2xl transition-all duration-200 transform hover:scale-110 shadow-lg ${
                  flashlightOn 
                    ? 'bg-gradient-to-r from-yellow-400 to-yellow-500 text-black shadow-yellow-400/30' 
                    : 'bg-white/20 text-white hover:bg-white/30 backdrop-blur-sm'
                }`}
                title={flashlightOn ? 'Éteindre la lampe' : 'Allumer la lampe'}
              >
                {flashlightOn ? (
                  <FlashlightOff className="h-6 w-6" />
                ) : (
                  <Flashlight className="h-6 w-6" />
                )}
              </button>
            )}

            {/* Enhanced Camera Switch */}
            {devices.length > 1 && (
              <button
                onClick={switchCamera}
                className="relative p-4 bg-white/20 text-white hover:bg-white/30 rounded-2xl transition-all duration-200 transform hover:scale-110 backdrop-blur-sm shadow-lg"
                title="Changer de caméra"
              >
                <RotateCcw className="h-6 w-6" />
                <div className="absolute -top-1 -right-1 w-6 h-6 bg-blue-500 text-white text-xs rounded-full flex items-center justify-center font-bold">
                  {devices.findIndex(d => d.deviceId === currentDeviceId) + 1}
                </div>
              </button>
            )}

            {/* Enhanced Focus Button */}
            <button
              onClick={enhanceFocus}
              className="p-4 bg-white/20 text-white hover:bg-white/30 rounded-2xl transition-all duration-200 transform hover:scale-110 backdrop-blur-sm shadow-lg"
              title="Améliorer la mise au point"
            >
              <Focus className="h-6 w-6" />
            </button>

            {/* Zoom Enhancement Button */}
            <button
              onClick={enhanceZoom}
              className="p-4 bg-white/20 text-white hover:bg-white/30 rounded-2xl transition-all duration-200 transform hover:scale-110 backdrop-blur-sm shadow-lg"
              title="Ajuster le zoom"
            >
              <Maximize className="h-6 w-6" />
            </button>

            {/* Enhanced Manual Input */}
            <button
              onClick={handleManualInput}
              className="p-4 bg-white/20 text-white hover:bg-white/30 rounded-2xl transition-all duration-200 transform hover:scale-110 backdrop-blur-sm shadow-lg"
              title="Saisie manuelle"
            >
              <Smartphone className="h-6 w-6" />
            </button>
          </div>

          {/* Enhanced Status and Real-time Feedback */}
          <div className="text-center space-y-2">
            <div className="inline-block bg-black/60 backdrop-blur-sm px-4 py-2 rounded-xl border border-white/10">
              <p className="text-gray-300 text-xs flex items-center justify-center space-x-2">
                <div className={`w-2 h-2 rounded-full ${scanningActive ? 'bg-green-400 animate-pulse' : 'bg-gray-400'}`}></div>
                <span>{scanningActive ? 'Scan actif' : 'En attente'}</span>
                {devices.length > 1 && (
                  <>
                    <span>•</span>
                    <span>{devices.length} caméras</span>
                  </>
                )}
                {scanningActive && (
                  <>
                    <span>•</span>
                    <span>{scanAttempts} tentatives</span>
                  </>
                )}
              </p>
            </div>
            
            <div className="inline-block bg-black/40 backdrop-blur-sm px-3 py-1 rounded-lg border border-white/5">
              <p className="text-gray-400 text-xs">
                {scanAttempts < 10 ? 'Maintenez stable à 15-25cm du code' :
                 scanAttempts < 30 ? 'Essayez différents angles et distances' :
                 'Utilisez la lampe ou changez de caméra si nécessaire'}
              </p>
            </div>

            {/* Detection confidence bar */}
            {scanningActive && (
              <div className="inline-block bg-black/50 backdrop-blur-sm px-4 py-2 rounded-lg border border-white/10">
                <div className="flex items-center space-x-2">
                  <span className="text-xs text-gray-300">Détection:</span>
                  <div className="w-20 h-2 bg-gray-600 rounded-full overflow-hidden">
                    <div 
                      className={`h-full transition-all duration-300 ${
                        detectionConfidence > 70 ? 'bg-green-400' : 
                        detectionConfidence > 40 ? 'bg-yellow-400' : 'bg-red-400'
                      }`}
                      style={{ width: `${detectionConfidence}%` }}
                    ></div>
                  </div>
                  <span className="text-xs text-gray-300">{detectionConfidence.toFixed(0)}%</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}