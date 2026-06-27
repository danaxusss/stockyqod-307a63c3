import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface UseDriverTrackingOptions {
  driverId: string | undefined;
  enabled?: boolean;
}

const GPS_GRANTED_KEY = 'gps_permission_granted';

export function isWithinWorkingHours(): boolean {
  const now = new Date();
  const hour = now.getHours();
  return hour >= 9 && hour < 19;
}

export function hasGPSGranted(): boolean {
  return localStorage.getItem(GPS_GRANTED_KEY) === 'true';
}

export function setGPSGranted(value: boolean): void {
  if (value) {
    localStorage.setItem(GPS_GRANTED_KEY, 'true');
  } else {
    localStorage.removeItem(GPS_GRANTED_KEY);
  }
}

export function useDriverTracking({ driverId, enabled = true }: UseDriverTrackingOptions) {
  const [isTracking, setIsTracking] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [isBackgroundTracking, setIsBackgroundTracking] = useState(false);
  const watchIdRef = useRef<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const bgIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const failCountRef = useRef(0);

  const startTracking = useCallback(
    (sessionId: string, taskId?: string) => {
      if (!driverId || !navigator.geolocation) return;

      setActiveSessionId(sessionId);
      setActiveTaskId(taskId || null);
      setIsTracking(true);
      failCountRef.current = 0;

      console.log('[GPS] Starting tracking for session:', sessionId);

      const sendCurrentPosition = () => {
        navigator.geolocation.getCurrentPosition(
          async (pos) => {
            if (!driverId) return;
            
            const { error } = await supabase.from('driver_locations').insert({
              driver_id: driverId,
              session_id: sessionId,
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              accuracy: pos.coords.accuracy,
            });

            if (error) {
              failCountRef.current++;
              console.error('[GPS] Failed to send location:', error);
              if (failCountRef.current >= 3) {
                toast.error('Erreur GPS: impossible d\'envoyer la position');
              }
            } else {
              failCountRef.current = 0;
              console.log('[GPS] Location sent:', pos.coords.latitude, pos.coords.longitude);
            }
          },
          (err) => {
            console.warn('[GPS] Geolocation error:', err.message);
            if (err.code === err.PERMISSION_DENIED) {
              setGPSGranted(false);
            }
          },
          { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
        );
      };

      sendCurrentPosition();

      intervalRef.current = setInterval(() => {
        if (!isWithinWorkingHours()) {
          stopTracking();
          return;
        }
        sendCurrentPosition();
      }, 15000);
    },
    [driverId]
  );

  const stopTracking = useCallback(() => {
    console.log('[GPS] Stopping tracking');
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setIsTracking(false);
    setActiveSessionId(null);
    setActiveTaskId(null);
    failCountRef.current = 0;
  }, []);

  // Background tracking: sends location with session_id = null
  const startBackgroundTracking = useCallback(() => {
    if (!driverId || !navigator.geolocation || isBackgroundTracking) return;

    console.log('[GPS] Starting background tracking for driver:', driverId);
    setIsBackgroundTracking(true);

    const sendBgPosition = () => {
      if (!isWithinWorkingHours()) {
        console.log('[GPS-BG] Outside working hours, stopping background tracking');
        stopBackgroundTracking();
        toast.info('Fin des heures de travail — suivi GPS arrêté');
        return;
      }
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const { error } = await supabase.from('driver_locations').insert({
            driver_id: driverId,
            session_id: null,
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          });
          if (error) {
            console.warn('[GPS-BG] Failed to send bg location:', error);
          } else {
            console.log('[GPS-BG] Background location sent');
          }
        },
        (err) => {
          console.warn('[GPS-BG] error:', err.message);
          if (err.code === err.PERMISSION_DENIED) {
            setGPSGranted(false);
            stopBackgroundTracking();
          }
        },
        { enableHighAccuracy: false, timeout: 20000, maximumAge: 30000 }
      );
    };

    sendBgPosition();
    bgIntervalRef.current = setInterval(sendBgPosition, 30000);
  }, [driverId, isBackgroundTracking]);

  const stopBackgroundTracking = useCallback(() => {
    if (bgIntervalRef.current) {
      clearInterval(bgIntervalRef.current);
      bgIntervalRef.current = null;
    }
    setIsBackgroundTracking(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopTracking();
      stopBackgroundTracking();
    };
  }, [stopTracking, stopBackgroundTracking]);

  // Create a tracking session and generate a link
  const createTrackingSession = useCallback(
    async (taskId: string, clientName: string, clientPhone?: string, address?: string) => {
      if (!driverId) return null;

      const { data, error } = await supabase
        .from('tracking_sessions')
        .insert({
          task_id: taskId,
          driver_id: driverId,
          client_name: clientName,
          client_phone: clientPhone || null,
        })
        .select()
        .single();

      if (error || !data) {
        console.error('[GPS] Failed to create tracking session:', error);
        toast.error('Erreur lors de la création de la session de suivi');
        return null;
      }

      console.log('[GPS] Tracking session created:', data.id);

      // Geocode address as fallback destination
      if (address) {
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`
          );
          const results = await res.json();
          if (results?.length > 0) {
            await supabase
              .from('tracking_sessions')
              .update({
                destination_latitude: parseFloat(results[0].lat),
                destination_longitude: parseFloat(results[0].lon),
                destination_source: 'address',
              } as any)
              .eq('id', data.id);
          }
        } catch (e) {
          console.warn('[GPS] Geocoding failed:', e);
        }
      }

      // Stop background tracking when starting a delivery session
      stopBackgroundTracking();
      // Start GPS tracking for this session
      startTracking(data.id, taskId);

      const trackingUrl = `${window.location.origin}/track/${data.token}`;
      return { sessionId: data.id, token: data.token, url: trackingUrl };
    },
    [driverId, startTracking, stopBackgroundTracking]
  );

  return {
    isTracking,
    isBackgroundTracking,
    activeSessionId,
    activeTaskId,
    startTracking,
    stopTracking,
    startBackgroundTracking,
    stopBackgroundTracking,
    createTrackingSession,
  };
}
