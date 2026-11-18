import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useLanguage } from '@/tasks/contexts/LanguageContext';
import { loadTracking, pollTracking, setTrackingDestination, trackingAddress, type PublicTrackingSession } from '@/utils/publicPages';
import { Truck, MapPin, Clock, AlertTriangle, Phone, Navigation } from 'lucide-react';
import { Button } from '@/components/ui/button';

// What the public-tracking function returns: the customer has no login, so
// the page never reads the database itself.
type TrackingSession = PublicTrackingSession;

/** The driver sends a position every 15 s. */
const POLL_MS = 15000;

interface DriverLocation {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  created_at: string;
}

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default function TrackDelivery() {
  const { token } = useParams<{ token: string }>();
  const { t, language } = useLanguage();
  const [session, setSession] = useState<TrackingSession | null>(null);
  const [location, setLocation] = useState<DriverLocation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [driverPhone, setDriverPhone] = useState<string | null>(null);
  const [gpsPromptState, setGpsPromptState] = useState<'show' | 'dismissed' | 'done'>('show');
  const [addressFallback, setAddressFallback] = useState(false);
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const destMarkerRef = useRef<any>(null);
  const routeLineRef = useRef<any>(null);
  const dateLocale = language === 'ar' ? 'ar-MA' : 'fr-FR';

  // Load session
  useEffect(() => {
    if (!token) return;

    async function loadSession() {
      const data = await loadTracking(token!).catch(() => null);

      if (!data || data.status === 'missing' || !data.session) {
        setError(data?.status === 'expired' ? t('track.expiredLink') : t('track.invalidLink'));
        setLoading(false);
        return;
      }

      if (data.status === 'expired') {
        setError(t('track.expiredLink'));
        setLoading(false);
        return;
      }

      const sessionData = data.session;
      setSession(sessionData);

      if (sessionData.destination_latitude && sessionData.destination_longitude) {
        setGpsPromptState('done');
        if (sessionData.destination_source === 'address') {
          setAddressFallback(true);
        }
      }

      // Only the phone of this delivery's driver.
      if (data.driver_phone) setDriverPhone(data.driver_phone);
      if (data.location) setLocation(data.location as DriverLocation);
      setLoading(false);
    }

    loadSession();
  }, [token, t]);

  const handleAcceptGPS = useCallback(async () => {
    if (!session || !token) return;
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        await setTrackingDestination(token, pos.coords.latitude, pos.coords.longitude, 'gps').catch(() => undefined);

        setSession((prev) =>
          prev ? { ...prev, destination_latitude: pos.coords.latitude, destination_longitude: pos.coords.longitude, destination_source: 'gps' } : prev
        );
        setAddressFallback(false);
        setGpsPromptState('done');
      },
      () => { handleGPSRefused(); },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, [session, token]);

  const handleGPSRefused = useCallback(async () => {
    if (!session || !token) { setGpsPromptState('dismissed'); return; }
    if (session.destination_latitude && session.destination_longitude) {
      setGpsPromptState('done');
      setAddressFallback(true);
      return;
    }
    try {
      const address = await trackingAddress(token);
      if (address) {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`);
        const results = await res.json();
        if (results?.length > 0) {
          const lat = parseFloat(results[0].lat);
          const lon = parseFloat(results[0].lon);
          await setTrackingDestination(token, lat, lon, 'address');
          setSession(prev => prev ? { ...prev, destination_latitude: lat, destination_longitude: lon, destination_source: 'address' } : prev);
          setAddressFallback(true);
          setGpsPromptState('done');
          return;
        }
      }
    } catch (e) { console.warn('[Track] Address geocoding failed:', e); }
    setGpsPromptState('dismissed');
  }, [session, token]);

  const eta = (() => {
    if (!location || !session?.destination_latitude || !session?.destination_longitude) return null;
    const distKm = haversineDistance(location.latitude, location.longitude, session.destination_latitude, session.destination_longitude);
    if (distKm < 0.2) return { arrived: true, minutes: 0, distKm };
    const minutes = Math.round((distKm / 30) * 60);
    return { arrived: false, minutes: Math.max(1, minutes), distKm };
  })();

  // Follow the driver: ask for the last position while the page is open
  // (the customer has no login, so no realtime subscription).
  const live = !!session;
  useEffect(() => {
    if (!live || !token) return;
    let cancelled = false;
    const refresh = async () => {
      if (document.hidden) return;
      const data = await pollTracking(token).catch(() => null);
      if (cancelled || !data) return;
      if (data.status !== 'ok') { setError(data.status === 'expired' ? t('track.expiredLink') : t('track.invalidLink')); return; }
      if (data.location) {
        const next = data.location as DriverLocation;
        setLocation(prev => (prev && prev.created_at === next.created_at ? prev : next));
      }
    };
    const id = setInterval(refresh, POLL_MS);
    document.addEventListener('visibilitychange', refresh);
    return () => { cancelled = true; clearInterval(id); document.removeEventListener('visibilitychange', refresh); };
  }, [live, token, t]);

  useEffect(() => {
    if (!location || !mapRef.current) return;
    if (!(window as any).L) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.onload = () => initMap();
      document.head.appendChild(script);
    } else { initMap(); }

    function initMap() {
      const L = (window as any).L;
      if (!L || !mapRef.current) return;
      const driverLatLng = L.latLng(location!.latitude, location!.longitude);
      if (!mapInstanceRef.current) {
        mapInstanceRef.current = L.map(mapRef.current).setView([location!.latitude, location!.longitude], 15);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(mapInstanceRef.current);
        const truckIcon = L.divIcon({ html: '<div style="font-size:28px;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.3))">🚚</div>', iconSize: [36, 36], iconAnchor: [18, 18], className: '' });
        markerRef.current = L.marker([location!.latitude, location!.longitude], { icon: truckIcon }).addTo(mapInstanceRef.current);
      } else { markerRef.current.setLatLng(driverLatLng); }

      const destLat = session?.destination_latitude;
      const destLng = session?.destination_longitude;
      if (destLat && destLng) {
        const destLatLng = L.latLng(destLat, destLng);
        if (!destMarkerRef.current) {
          const destIcon = L.divIcon({ html: '<div style="font-size:28px;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.3))">📍</div>', iconSize: [36, 36], iconAnchor: [18, 36], className: '' });
          destMarkerRef.current = L.marker(destLatLng, { icon: destIcon }).addTo(mapInstanceRef.current);
        }
        if (routeLineRef.current) { mapInstanceRef.current.removeLayer(routeLineRef.current); routeLineRef.current = null; }
        const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${location!.longitude},${location!.latitude};${destLng},${destLat}?overview=full&geometries=geojson`;
        fetch(osrmUrl).then(res => res.json()).then(data => {
          if (data.routes?.[0]?.geometry?.coordinates && mapInstanceRef.current) {
            const coords = data.routes[0].geometry.coordinates.map((c: [number, number]) => L.latLng(c[1], c[0]));
            routeLineRef.current = L.polyline(coords, { color: '#3b82f6', weight: 4, opacity: 0.8 }).addTo(mapInstanceRef.current);
            mapInstanceRef.current.fitBounds(routeLineRef.current.getBounds(), { padding: [60, 60], maxZoom: 16 });
          }
        }).catch(() => {
          routeLineRef.current = L.polyline([driverLatLng, destLatLng], { color: '#3b82f6', weight: 3, dashArray: '8, 8', opacity: 0.7 }).addTo(mapInstanceRef.current);
          mapInstanceRef.current.fitBounds(L.latLngBounds([driverLatLng, destLatLng]), { padding: [60, 60], maxZoom: 16 });
        });
      } else { mapInstanceRef.current.panTo(driverLatLng); }
    }
  }, [location, session?.destination_latitude, session?.destination_longitude]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-blue-100">
        <div className="text-center space-y-4">
          <Truck className="w-12 h-12 mx-auto text-blue-500 animate-bounce" />
          <p className="text-lg font-medium text-blue-900">{t('track.loading')}</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-red-50 to-orange-50">
        <div className="text-center space-y-4 p-8">
          <AlertTriangle className="w-12 h-12 mx-auto text-red-500" />
          <h1 className="text-xl font-bold text-red-900">{error}</h1>
          <p className="text-red-600 text-sm">{t('track.contactDriver')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-blue-100 flex flex-col">
      {/* Header */}
      <div className="bg-white/90 backdrop-blur-sm border-b border-blue-100 px-4 py-3 flex items-center gap-3 shadow-sm">
        <div className="w-10 h-10 rounded-full bg-blue-500 flex items-center justify-center">
          <Truck className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1">
          <h1 className="text-sm font-bold text-blue-900">{t('track.title')}</h1>
          <p className="text-xs text-blue-600">{session?.client_name}</p>
        </div>
        <div className="flex items-center gap-1 text-xs text-green-600 bg-green-50 px-2 py-1 rounded-full">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          {t('track.live')}
        </div>
      </div>

      {gpsPromptState === 'show' && (
        <div className="bg-blue-50 border-b border-blue-200 px-4 py-3 flex items-center gap-3">
          <Navigation className="w-5 h-5 text-blue-500 shrink-0" />
          <p className="text-xs text-blue-800 flex-1">{t('track.gpsPrompt')}</p>
          <div className="flex gap-2 shrink-0">
            <Button size="sm" variant="outline" className="text-xs h-7" onClick={handleGPSRefused}>{t('track.noThanks')}</Button>
            <Button size="sm" className="text-xs h-7" onClick={handleAcceptGPS}>{t('track.accept')}</Button>
          </div>
        </div>
      )}

      {addressFallback && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center gap-2">
          <MapPin className="w-4 h-4 text-amber-500 shrink-0" />
          <p className="text-xs text-amber-700">{t('track.addressBased')}</p>
        </div>
      )}

      <div className="flex-1 relative">
        {location ? (
          <div ref={mapRef} className="absolute inset-0" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center space-y-3 p-8">
              <MapPin className="w-10 h-10 mx-auto text-blue-400 animate-pulse" />
              <p className="text-blue-700 font-medium">{t('track.waitingDriver')}</p>
              <p className="text-blue-500 text-sm">{t('track.mapWillShow')}</p>
            </div>
          </div>
        )}
      </div>

      <div className="bg-white/90 backdrop-blur-sm border-t border-blue-100 px-4 py-3 space-y-2">
        {eta && (
          <div className={`flex items-center justify-center gap-2 py-2 rounded-xl text-sm font-semibold ${
            eta.arrived ? 'bg-green-50 text-green-700' : 'bg-blue-50 text-blue-700'
          }`}>
            {eta.arrived ? (
              <>{t('track.arrived')}</>
            ) : (
              <>
                <Clock className="w-4 h-4" />
                {t('track.eta', { minutes: String(eta.minutes) })}
                <span className="text-xs font-normal opacity-70">({eta.distKm.toFixed(1)} km)</span>
              </>
            )}
          </div>
        )}

        {driverPhone && (
          <a
            href={`tel:${driverPhone}`}
            className="flex items-center justify-center gap-2 w-full py-3 bg-green-500 hover:bg-green-600 text-white font-semibold rounded-xl transition-colors shadow-md active:scale-95"
          >
            <Phone className="w-5 h-5" />
            {t('track.callDriver')}
          </a>
        )}
        <div className="flex items-center justify-between text-xs text-blue-600">
          <div className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {location ? (
              <span>{t('track.lastUpdate')} {new Date(location.created_at).toLocaleTimeString(dateLocale)}</span>
            ) : (
              <span>{t('track.waiting')}</span>
            )}
          </div>
          <span className="font-medium">CuisiTask</span>
        </div>
      </div>
    </div>
  );
}
