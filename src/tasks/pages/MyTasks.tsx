import { useState, useRef, useEffect, useCallback } from 'react';
import { useAuth } from '@/tasks/contexts/AuthAdapter';
import { useData } from '@/tasks/contexts/DataContext';
import { useLanguage } from '@/tasks/contexts/LanguageContext';
import { TaskStatus, ROLE_CONFIG, STATUS_CONFIG } from '@/tasks/types';
import { StatusBadge, PriorityBadge } from '@/tasks/components/StatusBadge';
import { motion, AnimatePresence } from 'framer-motion';
import { Phone, MapPin, MessageCircle, Navigation, MessageSquare, LayoutGrid, List, Truck, Radio, Clock, CheckCircle2, Crosshair } from 'lucide-react';
import { toast } from 'sonner';
import confetti from 'canvas-confetti';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { useDriverTracking, isWithinWorkingHours, hasGPSGranted, setGPSGranted } from '@/tasks/hooks/useDriverTracking';
import { buildWhatsAppShareUrl, openWhatsAppShare } from '@/utils/whatsappShare';
import { GPSPermissionDialog } from '@/tasks/components/GPSPermissionDialog';
import { supabase } from '@/integrations/supabase/client';

const container = { hidden: {}, show: { transition: { staggerChildren: 0.05 } } };
const item = { hidden: { opacity: 0, y: 20 }, show: { opacity: 1, y: 0 } };

const STATUSES: TaskStatus[] = ['pending', 'doing', 'done', 'refused'];

export default function MyTasks() {
  const { user } = useAuth();
  const { tasks, updateTaskStatus } = useData();
  const { t, language } = useLanguage();
  const [view, setView] = useState<'kanban' | 'list'>('kanban');
  const [refuseTaskId, setRefuseTaskId] = useState<string | null>(null);
  const [refuseComment, setRefuseComment] = useState('');
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  const [gpsDialogOpen, setGpsDialogOpen] = useState(false);
  const [forcedGpsDialog, setForcedGpsDialog] = useState(false);
  const [pendingTrackingTask, setPendingTrackingTask] = useState<typeof tasks[0] | null>(null);
  const { createTrackingSession, isTracking, activeTaskId, startBackgroundTracking, isBackgroundTracking, stopBackgroundTracking } = useDriverTracking({ driverId: user?.id });

  const myTasks = tasks.filter(t => t.assigned_to === user?.id);
  const isDriverRole = user?.role === 'driver' || user?.role === 'technician';
  const dateLocale = language === 'ar' ? 'ar-MA' : 'fr-FR';

  // Check-in state
  const todayStr = new Date().toISOString().slice(0, 10);
  const [checkedIn, setCheckedIn] = useState(() => {
    const stored = localStorage.getItem('checkin_date');
    return stored === todayStr;
  });
  const [checkinTime, setCheckinTime] = useState<string | null>(() => {
    return localStorage.getItem('checkin_time');
  });

  const handleCheckin = () => {
    const now = new Date();
    const timeStr = now.toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' });
    localStorage.setItem('checkin_date', todayStr);
    localStorage.setItem('checkin_time', timeStr);
    setCheckedIn(true);
    setCheckinTime(timeStr);
    toast.success(t('myTasks.checkinSuccess'));
  };

  const [locationRequestDialog, setLocationRequestDialog] = useState(false);
  const [locationRequestNotifId, setLocationRequestNotifId] = useState<string | null>(null);
  const [sendingManualLocation, setSendingManualLocation] = useState(false);

  const showCheckinBanner = isDriverRole && isWithinWorkingHours() && !checkedIn;

  // Manual GPS location update
  const sendManualLocation = useCallback(async () => {
    if (!user) return;
    setSendingManualLocation(true);
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15000 })
      );
      await supabase.from('driver_locations').insert({
        driver_id: user.id,
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        session_id: null,
      });
      toast.success(t('myTasks.positionUpdated'));
    } catch (err: any) {
      toast.error(t('myTasks.positionError'));
    } finally {
      setSendingManualLocation(false);
    }
  }, [user, t]);

  // Listen for location_request notifications in realtime
  useEffect(() => {
    if (!user || !isDriverRole) return;
    const channel = supabase
      .channel('location-requests')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'task_notifications', filter: `user_id=eq.${user.id}` },
        (payload) => {
          const notif = payload.new as any;
          if (notif.type === 'location_request' && !notif.is_read) {
            setLocationRequestNotifId(notif.id);
            setLocationRequestDialog(true);
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, isDriverRole]);

  const handleLocationRequestResponse = async () => {
    await sendManualLocation();
    if (locationRequestNotifId) {
      await supabase.from('task_notifications').update({ is_read: true }).eq('id', locationRequestNotifId);
    }
    setLocationRequestDialog(false);
    setLocationRequestNotifId(null);
  };

  // Mandatory GPS gate during working hours
  useEffect(() => {
    if (!user || !isDriverRole) return;
    
    const checkAndEnforceGPS = () => {
      const withinHours = isWithinWorkingHours();
      
      if (!withinHours) {
        if (isBackgroundTracking) {
          stopBackgroundTracking();
          toast.info(t('myTasks.workHoursEnd'));
        }
        setForcedGpsDialog(false);
        return;
      }
      
      if (hasGPSGranted()) {
        if (!isTracking && !isBackgroundTracking) {
          startBackgroundTracking();
        }
        setForcedGpsDialog(false);
      } else {
        setForcedGpsDialog(true);
        setGpsDialogOpen(true);
      }
    };

    checkAndEnforceGPS();
    const keepalive = setInterval(checkAndEnforceGPS, 60000);
    return () => clearInterval(keepalive);
  }, [user, isDriverRole, isTracking, isBackgroundTracking, startBackgroundTracking, stopBackgroundTracking, t]);

  const roleConfig = ROLE_CONFIG[user?.role || 'technician'];

  const handleShareTracking = async (task: typeof myTasks[0]) => {
    if (hasGPSGranted()) {
      await startTrackingForTask(task);
      return;
    }
    setPendingTrackingTask(task);
    setForcedGpsDialog(false);
    setGpsDialogOpen(true);
  };

  const startTrackingForTask = async (task: typeof myTasks[0]) => {
    const result = await createTrackingSession(task.id, task.client_name, task.client_phone, task.address);
    if (!result) {
      toast.error(t('myTasks.trackingError'));
      return;
    }
    if (task.client_phone) {
      // Open WhatsApp pre-filled with the tracking link to send to the client.
      const shareUrl = buildWhatsAppShareUrl(
        task.client_phone,
        `Bonjour ${task.client_name}, suivez votre livraison en temps réel ici: ${result.url}`
      );
      openWhatsAppShare(shareUrl);
      toast.success(t('myTasks.trackingLinkSent'));
    } else {
      navigator.clipboard.writeText(result.url);
      toast.success(t('myTasks.linkCopied'));
    }
  };

  const handleGPSPermissionGranted = async () => {
    setGpsDialogOpen(false);
    setForcedGpsDialog(false);
    setGPSGranted(true);

    if (isWithinWorkingHours() && !isTracking && !isBackgroundTracking) {
      startBackgroundTracking();
    }

    if (!pendingTrackingTask) return;
    const task = pendingTrackingTask;
    setPendingTrackingTask(null);
    await startTrackingForTask(task);
  };

  const handleStatusChange = (taskId: string, newStatus: TaskStatus) => {
    if (newStatus === 'refused') {
      setRefuseTaskId(taskId);
      return;
    }
    updateTaskStatus(taskId, newStatus);
    if (newStatus === 'doing') toast.success(t('myTasks.startedToast'));
    if (newStatus === 'done') {
      confetti({ particleCount: 80, spread: 60, origin: { y: 0.7 } });
      toast.success(t('myTasks.finishedToast'));
    }
  };

  const handleRefuse = () => {
    if (!refuseTaskId) return;
    updateTaskStatus(refuseTaskId, 'refused', refuseComment);
    setRefuseTaskId(null);
    setRefuseComment('');
    toast(t('myTasks.refusedToast'));
  };

  const openWhatsApp = (phone: string, clientName: string) => {
    const msg = encodeURIComponent(`Bonjour, je suis ${user?.first_name}. Concernant votre ${user?.role === 'technician' ? 'intervention' : 'livraison'}...`);
    window.open(`https://wa.me/${phone.replace(/^0/, '212')}?text=${msg}`, '_blank');
  };

  const openMaps = (address: string) => {
    window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`, '_blank');
  };

  const TrackingIndicator = ({ taskId }: { taskId: string }) => {
    if (!isTracking || activeTaskId !== taskId) return null;
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-primary/10 text-primary border border-primary/20">
        <Radio className="h-3 w-3 animate-pulse" />
        {t('myTasks.gpsActive')}
      </span>
    );
  };

  const isBlocked = forcedGpsDialog && gpsDialogOpen;

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <div className={isBlocked ? 'blur-sm pointer-events-none select-none' : ''}>
        {/* Check-in banner */}
        {isDriverRole && isWithinWorkingHours() && (
          <AnimatePresence>
            {!checkedIn ? (
              <motion.div
                key="checkin-banner"
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="bg-primary/10 border border-primary/20 rounded-xl p-4 flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3">
                  <Clock className="h-6 w-6 text-primary" />
                  <div>
                    <p className="font-semibold text-foreground text-sm">{t('myTasks.checkinGreeting', { name: user?.first_name || '' })}</p>
                    <p className="text-xs text-muted-foreground">{t('myTasks.checkinPrompt')}</p>
                  </div>
                </div>
                <Button onClick={handleCheckin} size="sm" className="shrink-0">
                  <CheckCircle2 className="h-4 w-4 me-1" /> {t('myTasks.checkinButton')}
                </Button>
              </motion.div>
            ) : (
              <motion.div
                key="checkin-done"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex items-center gap-2 px-3 py-1.5 bg-status-done-light rounded-lg w-fit"
              >
                <CheckCircle2 className="h-4 w-4 text-status-done" />
                <span className="text-xs font-medium text-status-done">{t('myTasks.checkedAt', { time: checkinTime || '' })}</span>
              </motion.div>
            )}
          </AnimatePresence>
        )}

        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-foreground">{t('myTasks.title')}</h1>
            <p className="text-sm text-muted-foreground">{roleConfig.emoji} {t(`role.${user?.role}`)}</p>
          </div>
          <div className="flex items-center gap-2">
            {isDriverRole && (
              <Button
                variant="outline"
                size="sm"
                onClick={sendManualLocation}
                disabled={sendingManualLocation}
                className="text-xs"
              >
                <Crosshair className="h-3.5 w-3.5 me-1" />
                {sendingManualLocation ? t('myTasks.sending') : t('myTasks.myPosition')}
              </Button>
            )}
            <div className="flex gap-1 bg-accent rounded-lg p-1">
              <button onClick={() => setView('kanban')} className={`p-2 rounded-md ${view === 'kanban' ? 'bg-card shadow-sm' : ''}`}>
                <LayoutGrid className="h-4 w-4" />
              </button>
              <button onClick={() => setView('list')} className={`p-2 rounded-md ${view === 'list' ? 'bg-card shadow-sm' : ''}`}>
                <List className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {view === 'kanban' ? (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-4">
            {STATUSES.map(status => {
              const statusTasks = myTasks.filter(t => t.status === status);
              const config = STATUS_CONFIG[status];
              return (
                <div key={status} className="space-y-3">
                  <div className="flex items-center gap-2 px-1">
                    <span className="text-sm font-semibold text-foreground">{config.emoji} {t(`status.${status}`)}</span>
                    <span className="text-xs bg-accent rounded-full px-2 py-0.5 text-muted-foreground">{statusTasks.length}</span>
                  </div>
                  <motion.div variants={container} initial="hidden" animate="show" className="space-y-3">
                    {statusTasks.map(task => (
                      <motion.div
                        key={task.id}
                        variants={item}
                        layout
                        className="bg-card rounded-xl border border-border p-3 shadow-sm"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <p className="font-medium text-sm text-foreground">{task.client_name}</p>
                          <TrackingIndicator taskId={task.id} />
                        </div>
                        <p className="text-xs text-muted-foreground flex items-center gap-1 mb-2">
                          <MapPin className="h-3 w-3" />{task.address.slice(0, 35)}...
                        </p>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <PriorityBadge priority={task.priority} />
                          {task.edited && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-accent text-muted-foreground border border-border">
                              ✏️ {t('common.modified')}
                            </span>
                          )}
                        </div>

                        {expandedTask === task.id && (
                          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} className="mt-3 pt-3 border-t border-border/50 space-y-2">
                            {task.problem_details && <p className="text-xs text-muted-foreground">{task.problem_details}</p>}
                            {task.invoice_number && <p className="text-xs text-muted-foreground">📄 {task.invoice_number}</p>}
                            {task.payment_details && <p className="text-xs text-muted-foreground">💳 {task.payment_details}</p>}
                            {task.comment && <p className="text-xs text-destructive">💬 {task.comment}</p>}

                            <div className="flex gap-1.5 flex-wrap">
                              <button onClick={() => window.open(`tel:${task.client_phone}`)} className="flex items-center gap-1 px-2 py-1 bg-status-done-light text-status-done rounded-lg text-xs font-medium">
                                <Phone className="h-3 w-3" /> {t('myTasks.call')}
                              </button>
                              <button onClick={() => openWhatsApp(task.client_phone, task.client_name)} className="flex items-center gap-1 px-2 py-1 bg-status-done-light text-status-done rounded-lg text-xs font-medium">
                                <MessageCircle className="h-3 w-3" /> WhatsApp
                              </button>
                              <button onClick={() => openMaps(task.address)} className="flex items-center gap-1 px-2 py-1 bg-status-doing-light text-status-doing rounded-lg text-xs font-medium">
                                <Navigation className="h-3 w-3" /> {t('myTasks.route')}
                              </button>
                              {user?.role === 'driver' && task.type === 'delivery' && task.status === 'doing' && !isTracking && (
                                <button onClick={() => handleShareTracking(task)} className="flex items-center gap-1 px-2 py-1 bg-primary/10 text-primary rounded-lg text-xs font-medium">
                                  <Truck className="h-3 w-3" /> {t('myTasks.tracking')}
                                </button>
                              )}
                            </div>
                          </motion.div>
                        )}

                        <div className="flex items-center justify-between mt-3 pt-2 border-t border-border/50">
                          <button onClick={() => setExpandedTask(expandedTask === task.id ? null : task.id)} className="text-xs text-primary font-medium">
                            {expandedTask === task.id ? t('myTasks.collapse') : t('myTasks.details')}
                          </button>
                          {status !== 'done' && status !== 'refused' && (
                            <div className="flex gap-1">
                              {status === 'pending' && (
                                <button onClick={() => handleStatusChange(task.id, 'doing')} className="text-xs px-2 py-1 bg-status-doing-light text-status-doing rounded-lg font-medium">
                                  {t('myTasks.start')}
                                </button>
                              )}
                              {status === 'doing' && (
                                <>
                                  <button onClick={() => handleStatusChange(task.id, 'done')} className="text-xs px-2 py-1 bg-status-done-light text-status-done rounded-lg font-medium">
                                    {t('myTasks.finish')}
                                  </button>
                                  <button onClick={() => handleStatusChange(task.id, 'refused')} className="text-xs px-2 py-1 bg-status-refused-light text-status-refused rounded-lg font-medium">
                                    {t('myTasks.refuse')}
                                  </button>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      </motion.div>
                    ))}
                    {statusTasks.length === 0 && (
                      <div className="text-center py-6 text-muted-foreground text-xs">
                        {t('myTasks.noTasks')}
                      </div>
                    )}
                  </motion.div>
                </div>
              );
            })}
          </div>
        ) : (
          <motion.div variants={container} initial="hidden" animate="show" className="space-y-3 mt-4">
            {myTasks.map(task => (
              <motion.div key={task.id} variants={item} className="bg-card rounded-xl border border-border p-4 shadow-sm">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold text-foreground">{task.client_name}</p>
                    <p className="text-xs text-muted-foreground mt-1">{task.address}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <TrackingIndicator taskId={task.id} />
                    <StatusBadge status={task.status} />
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-3">
                  <PriorityBadge priority={task.priority} />
                  {task.edited && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-accent text-muted-foreground border border-border">
                      ✏️ {t('common.modified')}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {new Date(task.created_at).toLocaleDateString(dateLocale)}
                  </span>
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}

        {myTasks.length === 0 && (
          <div className="text-center py-16 text-muted-foreground">
            <p className="text-4xl mb-2">🏖️</p>
            <p>{t('myTasks.emptyState')}</p>
          </div>
        )}
      </div>

      {/* Refuse Dialog */}
      <Dialog open={!!refuseTaskId} onOpenChange={() => setRefuseTaskId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('myTasks.refuseTitle')}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t('myTasks.refusePrompt')}</p>
          <Textarea value={refuseComment} onChange={e => setRefuseComment(e.target.value)} placeholder={t('myTasks.refuseReason')} />
          <div className="flex gap-2 mt-2">
            <Button variant="outline" onClick={() => setRefuseTaskId(null)} className="flex-1">{t('form.cancel')}</Button>
            <Button variant="destructive" onClick={handleRefuse} disabled={!refuseComment} className="flex-1">{t('myTasks.confirmRefuse')}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Location Request Dialog */}
      <Dialog open={locationRequestDialog} onOpenChange={setLocationRequestDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('myTasks.locationRequest')}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t('myTasks.locationRequestMsg')}</p>
          <div className="flex gap-2 mt-2">
            <Button variant="outline" onClick={() => { setLocationRequestDialog(false); setLocationRequestNotifId(null); }} className="flex-1">{t('myTasks.later')}</Button>
            <Button onClick={handleLocationRequestResponse} disabled={sendingManualLocation} className="flex-1">
              <Crosshair className="h-4 w-4 me-1" /> {sendingManualLocation ? t('myTasks.sending') : t('myTasks.sendPosition')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* GPS Permission Dialog */}
      <GPSPermissionDialog
        open={gpsDialogOpen}
        onClose={() => { if (!forcedGpsDialog) { setGpsDialogOpen(false); setPendingTrackingTask(null); } }}
        onPermissionGranted={handleGPSPermissionGranted}
        forced={forcedGpsDialog}
      />
    </div>
  );
}
