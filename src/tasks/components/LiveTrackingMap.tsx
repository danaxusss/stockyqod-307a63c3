import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/tasks/contexts/LanguageContext';
import { Truck, MapPin, Clock, Eye, User, Crosshair } from 'lucide-react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';

interface TrackingSession {
  id: string;
  token: string;
  task_id: string;
  driver_id: string;
  client_name: string;
  client_phone: string | null;
  is_active: boolean;
  expires_at: string;
  created_at: string;
  destination_latitude: number | null;
  destination_longitude: number | null;
  destination_source: string | null;
}

interface DriverLocation {
  id: string;
  driver_id: string;
  session_id: string | null;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  created_at: string;
}

interface DriverMapData {
  session: TrackingSession;
  driverName: string;
  location: DriverLocation | null;
}

interface IdleDriverData {
  driverId: string;
  driverName: string;
  location: DriverLocation | null;
}

interface AllDriverInfo {
  id: string;
  name: string;
  hasActiveDelivery: boolean;
  hasLocation: boolean;
  lastSeen: string | null;
}

interface Props {
  drivers: { id: string; first_name: string; last_name: string }[];
}

const DRIVER_COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];
const IDLE_COLOR = '#6b7280';

export default function LiveTrackingMap({ drivers }: Props) {
  const { t } = useLanguage();
  const [driverData, setDriverData] = useState<DriverMapData[]>([]);
  const [idleDrivers, setIdleDrivers] = useState<IdleDriverData[]>([]);
  const [allDrivers, setAllDrivers] = useState<AllDriverInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const markersRef = useRef<Map<string, any>>(new Map());
  const destMarkersRef = useRef<Map<string, any>>(new Map());
  const routeLinesRef = useRef<Map<string, any>>(new Map());
  const idleMarkersRef = useRef<Map<string, any>>(new Map());
  const sessionIdsRef = useRef<string[]>([]);

  // Full reload function for periodic refresh
  const loadData = useCallback(async () => {
    // Wait until drivers are loaded to avoid "Inconnu" names
    if (drivers.length === 0) return;

    // 1. Fetch active tracking sessions
    const { data: sessionsRaw } = await supabase
      .from('tracking_sessions')
      .select('*')
      .eq('is_active', true)
      .gte('expires_at', new Date().toISOString());

    const sessions = (sessionsRaw || []) as unknown as TrackingSession[];

    // 2. Get task IDs and filter by status = 'doing'
    const taskIds = sessions.map(s => s.task_id);
    let doingTaskIds: Set<string> = new Set();
    const doneOrInactiveSessionIds: string[] = [];

    if (taskIds.length > 0) {
      const { data: tasksData } = await supabase
        .from('tasks')
        .select('id, status')
        .in('id', taskIds);

      if (tasksData) {
        doingTaskIds = new Set(tasksData.filter(t => t.status === 'doing').map(t => t.id));
        const inactiveTaskIds = tasksData.filter(t => t.status === 'done' || t.status === 'refused').map(t => t.id);
        for (const s of sessions) {
          if (inactiveTaskIds.includes(s.task_id)) {
            doneOrInactiveSessionIds.push(s.id);
          }
        }
      }
    }

    if (doneOrInactiveSessionIds.length > 0) {
      supabase
        .from('tracking_sessions')
        .update({ is_active: false })
        .in('id', doneOrInactiveSessionIds)
        .then(() => console.log('[Map] Deactivated done sessions:', doneOrInactiveSessionIds.length));
    }

    const activeSessions = sessions.filter(s => doingTaskIds.has(s.task_id));
    
    // Deduplicate sessions by driver_id (keep most recent)
    const uniqueByDriver = new Map<string, typeof activeSessions[0]>();
    for (const s of activeSessions) {
      const existing = uniqueByDriver.get(s.driver_id);
      if (!existing || new Date(s.created_at) > new Date(existing.created_at)) {
        uniqueByDriver.set(s.driver_id, s);
      }
    }
    const dedupedSessions = Array.from(uniqueByDriver.values());
    sessionIdsRef.current = dedupedSessions.map(s => s.id);

    const driverMap: DriverMapData[] = [];
    for (const session of dedupedSessions) {
      const driver = drivers.find(d => d.id === session.driver_id);
      const { data: locData } = await supabase
        .from('driver_locations')
        .select('*')
        .eq('session_id', session.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      driverMap.push({
        session,
        driverName: driver ? `${driver.first_name} ${driver.last_name}` : t('map.unknown'),
        location: locData as DriverLocation | null,
      });
    }
    setDriverData(driverMap);

    const activeDriverIds = new Set(dedupedSessions.map(s => s.driver_id));
    const idleDriversList: IdleDriverData[] = [];
    const allDriverInfoList: AllDriverInfo[] = [];

    for (const driver of drivers) {
      const isActive = activeDriverIds.has(driver.id);
      
      if (!isActive) {
        const { data: bgLoc } = await supabase
          .from('driver_locations')
          .select('*')
          .eq('driver_id', driver.id)
          .is('session_id', null)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        const loc = bgLoc as DriverLocation | null;
        const hasRecentLoc = loc && (Date.now() - new Date(loc.created_at).getTime() < 60 * 60 * 1000);
        
        idleDriversList.push({
          driverId: driver.id,
          driverName: `${driver.first_name} ${driver.last_name}`,
          location: hasRecentLoc ? loc : null,
        });

        allDriverInfoList.push({
          id: driver.id,
          name: `${driver.first_name} ${driver.last_name}`,
          hasActiveDelivery: false,
          hasLocation: !!hasRecentLoc,
          lastSeen: loc?.created_at || null,
        });
      } else {
        const activeData = driverMap.find(d => d.session.driver_id === driver.id);
        allDriverInfoList.push({
          id: driver.id,
          name: `${driver.first_name} ${driver.last_name}`,
          hasActiveDelivery: true,
          hasLocation: !!activeData?.location,
          lastSeen: activeData?.location?.created_at || null,
        });
      }
    }
    setIdleDrivers(idleDriversList);
    setAllDrivers(allDriverInfoList);
    setLoading(false);
  }, [drivers, t]);

  // Initial load + periodic refresh every 30s
  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, [loadData]);

  // Subscribe to realtime location updates
  useEffect(() => {
    const channel = supabase
      .channel('admin-tracking')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'driver_locations' },
        (payload) => {
          const newLoc = payload.new as DriverLocation;
          if (newLoc.session_id) {
            setDriverData(prev =>
              prev.map(d =>
                d.session.id === newLoc.session_id
                  ? { ...d, location: newLoc }
                  : d
              )
            );
          } else {
            setIdleDrivers(prev => {
              const existing = prev.findIndex(d => d.driverId === newLoc.driver_id);
              const driver = drivers.find(d => d.id === newLoc.driver_id);
              const name = driver ? `${driver.first_name} ${driver.last_name}` : t('map.unknown');
              if (existing >= 0) {
                const updated = [...prev];
                updated[existing] = { ...updated[existing], location: newLoc };
                return updated;
              }
              return [...prev, { driverId: newLoc.driver_id, driverName: name, location: newLoc }];
            });
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [drivers, t]);

  // Also subscribe to task status changes to auto-refresh map
  useEffect(() => {
    const channel = supabase
      .channel('admin-task-updates')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'tasks' },
        () => {
          // Reload map data when any task status changes
          loadData();
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [loadData]);

  // Zoom to driver location
  const zoomToDriver = useCallback((driverId: string) => {
    if (!mapInstanceRef.current) return;
    
    // Check active delivery drivers
    const activeDriver = driverData.find(d => d.session.driver_id === driverId);
    if (activeDriver?.location) {
      mapInstanceRef.current.setView([activeDriver.location.latitude, activeDriver.location.longitude], 16, { animate: true });
      const marker = markersRef.current.get(activeDriver.session.id);
      if (marker) marker.openPopup();
      return;
    }
    
    // Check idle drivers
    const idle = idleDrivers.find(d => d.driverId === driverId);
    if (idle?.location) {
      mapInstanceRef.current.setView([idle.location.latitude, idle.location.longitude], 16, { animate: true });
      const marker = idleMarkersRef.current.get(`idle-${driverId}`);
      if (marker) marker.openPopup();
      return;
    }
    
    toast.error(t('map.unknownPosition'));
  }, [driverData, idleDrivers, t]);

  // Init/update map
  useEffect(() => {
    if (!mapRef.current) return;
    const locationsWithData = driverData.filter(d => d.location);
    const idleWithLoc = idleDrivers.filter(d => d.location);

    if (!(window as any).L) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);

      const script = document.createElement('script');
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.onload = () => initMap(locationsWithData, idleWithLoc);
      document.head.appendChild(script);
    } else {
      initMap(locationsWithData, idleWithLoc);
    }
  }, [driverData, idleDrivers]);

  function initMap(locationsWithData: DriverMapData[], idleWithLoc: IdleDriverData[]) {
    const L = (window as any).L;
    if (!L || !mapRef.current) return;

    if (!mapInstanceRef.current) {
      const firstLoc = locationsWithData[0]?.location || idleWithLoc[0]?.location;
      mapInstanceRef.current = L.map(mapRef.current).setView(
        firstLoc ? [firstLoc.latitude, firstLoc.longitude] : [33.57, -7.59],
        12
      );
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
      }).addTo(mapInstanceRef.current);
    }

    const allBoundsPoints: [number, number][] = [];

    // Active delivery markers
    locationsWithData.forEach((d, index) => {
      if (!d.location) return;
      const key = d.session.id;
      const color = DRIVER_COLORS[index % DRIVER_COLORS.length];
      const driverLatLng = L.latLng(d.location.latitude, d.location.longitude);
      allBoundsPoints.push([d.location.latitude, d.location.longitude]);

      if (markersRef.current.has(key)) {
        markersRef.current.get(key).setLatLng(driverLatLng);
      } else {
        const icon = L.divIcon({
          html: `<div style="font-size:24px;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.3));text-align:center">🚚<div style="font-size:10px;font-weight:600;background:${color};color:white;border-radius:4px;padding:1px 4px;margin-top:2px;white-space:nowrap">${d.driverName}</div></div>`,
          iconSize: [80, 50],
          iconAnchor: [40, 25],
          className: '',
        });
        const marker = L.marker(driverLatLng, { icon })
          .addTo(mapInstanceRef.current)
          .bindPopup(`<b>${d.driverName}</b><br/>📦 ${d.session.client_name}<br/>🕐 ${new Date(d.location.created_at).toLocaleTimeString('fr-FR')}`);
        markersRef.current.set(key, marker);
      }

      const destLat = d.session.destination_latitude;
      const destLng = d.session.destination_longitude;

      if (destLat && destLng) {
        allBoundsPoints.push([destLat, destLng]);
        const destLatLng = L.latLng(destLat, destLng);

        if (!destMarkersRef.current.has(key)) {
          const destIcon = L.divIcon({
            html: `<div style="font-size:22px;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.3));text-align:center">📍<div style="font-size:9px;font-weight:600;background:${color};color:white;border-radius:4px;padding:1px 3px;margin-top:1px;white-space:nowrap;opacity:0.9">${d.session.client_name.split(' ')[0]}</div></div>`,
            iconSize: [70, 45],
            iconAnchor: [35, 40],
            className: '',
          });
          const destMarker = L.marker(destLatLng, { icon: destIcon })
            .addTo(mapInstanceRef.current)
            .bindPopup(`<b>📦 ${d.session.client_name}</b><br/>Client de ${d.driverName}`);
          destMarkersRef.current.set(key, destMarker);
        }

        if (routeLinesRef.current.has(key)) {
          mapInstanceRef.current.removeLayer(routeLinesRef.current.get(key));
          routeLinesRef.current.delete(key);
        }

        const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${d.location.longitude},${d.location.latitude};${destLng},${destLat}?overview=full&geometries=geojson`;
        fetch(osrmUrl)
          .then(res => res.json())
          .then(data => {
            if (data.routes?.[0]?.geometry?.coordinates && mapInstanceRef.current) {
              const coords = data.routes[0].geometry.coordinates.map(
                (c: [number, number]) => L.latLng(c[1], c[0])
              );
              const line = L.polyline(coords, { color, weight: 4, opacity: 0.75 }).addTo(mapInstanceRef.current);
              routeLinesRef.current.set(key, line);
            }
          })
          .catch(() => {
            const line = L.polyline([driverLatLng, destLatLng], {
              color, weight: 3, dashArray: '8, 8', opacity: 0.6,
            }).addTo(mapInstanceRef.current);
            routeLinesRef.current.set(key, line);
          });
      }
    });

    // Idle driver markers
    idleWithLoc.forEach(idle => {
      if (!idle.location) return;
      const key = `idle-${idle.driverId}`;
      const latLng = L.latLng(idle.location.latitude, idle.location.longitude);
      allBoundsPoints.push([idle.location.latitude, idle.location.longitude]);

      if (idleMarkersRef.current.has(key)) {
        idleMarkersRef.current.get(key).setLatLng(latLng);
      } else {
        const icon = L.divIcon({
          html: `<div style="font-size:20px;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.2));text-align:center;opacity:0.8">👤<div style="font-size:9px;font-weight:600;background:${IDLE_COLOR};color:white;border-radius:4px;padding:1px 4px;margin-top:2px;white-space:nowrap">${idle.driverName}</div></div>`,
          iconSize: [80, 45],
          iconAnchor: [40, 22],
          className: '',
        });
        const marker = L.marker(latLng, { icon })
          .addTo(mapInstanceRef.current)
          .bindPopup(`<b>${idle.driverName}</b><br/>🟢 Disponible<br/>🕐 ${new Date(idle.location.created_at).toLocaleTimeString('fr-FR')}`);
        idleMarkersRef.current.set(key, marker);
      }
    });

    if (allBoundsPoints.length > 1) {
      const bounds = L.latLngBounds(allBoundsPoints);
      mapInstanceRef.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
    }
  }

  if (loading) {
    return (
      <div className="bg-card rounded-xl border border-border shadow-sm p-6">
        <div className="flex items-center gap-2 mb-4">
          <MapPin className="h-5 w-5 text-primary animate-pulse" />
          <h2 className="font-semibold text-foreground">{t('map.liveTracking')}</h2>
        </div>
        <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
          {t('map.loading')}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="p-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MapPin className="h-5 w-5 text-primary" />
          <h2 className="font-semibold text-foreground">{t('map.liveTracking')}</h2>
        </div>
        <div className="flex items-center gap-2">
          {driverData.filter(d => d.location).length > 0 && (
            <span className="flex items-center gap-1 text-xs bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400 px-2 py-1 rounded-full">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              {driverData.filter(d => d.location).length} {t('map.inDelivery')}
            </span>
          )}
          <span className="flex items-center gap-1 text-xs bg-accent text-muted-foreground px-2 py-1 rounded-full">
            <User className="h-3 w-3" />
            {allDrivers.length} {t('map.driversCount')}
          </span>
        </div>
      </div>

      {/* Always show the map */}
      <div ref={mapRef} className="h-96 w-full" />
      
      <div className="p-3 border-t border-border">
        {/* Active deliveries */}
        {driverData.length > 0 && (
          <div className="mb-2">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">{t('map.activeDeliveries')}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {driverData.map((d, index) => (
                <motion.div
                  key={d.session.id}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center gap-2 p-2 rounded-lg bg-accent/50 text-sm cursor-pointer hover:bg-accent/80 transition-colors"
                  onClick={() => zoomToDriver(d.session.driver_id)}
                >
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white"
                    style={{ backgroundColor: DRIVER_COLORS[index % DRIVER_COLORS.length] }}
                  >
                    🚚
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground text-xs truncate">{d.driverName}</p>
                    <p className="text-[10px] text-muted-foreground truncate">📦 {d.session.client_name}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    {d.location ? (
                      <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                        <Clock className="h-3 w-3" />
                        {new Date(d.location.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    ) : (
                      <span className="text-[10px] text-muted-foreground">{t('map.waiting')}</span>
                    )}
                    <a
                      href={`/track/${d.session.token}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1 rounded hover:bg-primary/10 text-primary"
                      title={t('map.viewPublicPage')}
                      onClick={e => e.stopPropagation()}
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </a>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        )}

        {/* All drivers list */}
        <div>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">{t('map.allDrivers')}</p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {allDrivers.filter(d => !d.hasActiveDelivery).map(driver => {
              const idleData = idleDrivers.find(i => i.driverId === driver.id);
              return (
                <motion.div
                  key={driver.id}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex items-center gap-2 p-2 rounded-lg bg-muted/50 text-sm ${driver.hasLocation ? 'cursor-pointer hover:bg-muted/80' : ''} transition-colors`}
                  onClick={() => driver.hasLocation && zoomToDriver(driver.id)}
                >
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white bg-muted-foreground/60">
                    👤
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground text-xs truncate">{driver.name}</p>
                  {driver.hasLocation ? (
                      <p className="text-[10px] text-green-600">{t('map.available')}</p>
                    ) : (
                      <p className="text-[10px] text-muted-foreground">{t('map.unknownPosition')}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {driver.lastSeen && (
                      <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                        <Clock className="h-3 w-3" />
                        {new Date(driver.lastSeen).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        await supabase.from('notifications').insert({
                          user_id: driver.id,
                          type: 'location_request',
                          title: t('map.locationRequestTitle'),
                          message: t('map.locationRequestMsg'),
                        });
                        toast.success(t('map.positionRequested'));
                      }}
                      className="p-1 rounded hover:bg-primary/10 text-primary"
                      title={t('map.requestPosition')}
                    >
                      <Crosshair className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
