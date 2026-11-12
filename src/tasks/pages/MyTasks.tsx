import { useState, useRef, useEffect, useCallback } from 'react';
import { useAuth } from '@/tasks/contexts/AuthAdapter';
import { useData } from '@/tasks/contexts/DataContext';
import { useLanguage } from '@/tasks/contexts/LanguageContext';
import { TaskStatus } from '@/tasks/types';
import { StatusBadge, PriorityBadge } from '@/tasks/components/StatusBadge';
import { motion, AnimatePresence } from 'framer-motion';
import { Phone, MapPin, MessageCircle, Navigation, LayoutGrid, List, Truck, Radio, Clock, Clock3, CheckCircle2, Crosshair, ChevronDown, Play, Check, Ban, FileText, Wallet, MessageSquare } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { TaskBoard, TaskCard, TaskTypeIcon } from '@/tasks/components/TaskBoard';
import TasksHeaderActions from '@/tasks/components/TasksHeader';
import { toast } from 'sonner';
import confetti from 'canvas-confetti';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { useDriverTracking, isWithinWorkingHours, hasGPSGranted, setGPSGranted } from '@/tasks/hooks/useDriverTracking';
import { buildWhatsAppShareUrl, openWhatsAppShare } from '@/utils/whatsappShare';
import { GPSPermissionDialog } from '@/tasks/components/GPSPermissionDialog';
import { isOverdue } from '@/tasks/lib/taskUtils';
import SignaturePad, { SignaturePadHandle } from '@/tasks/components/SignaturePad';
import { Camera, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

export default function MyTasks() {
  const { user } = useAuth();
  const { tasks, updateTaskStatus } = useData();
  const { t, language } = useLanguage();
  // Columns by status on wide screens, the one-tap list on phones.
  const [view, setView] = useState<'kanban' | 'list'>(() =>
    typeof window !== 'undefined' && window.matchMedia?.('(min-width: 1024px)').matches ? 'kanban' : 'list');
  const [showDone, setShowDone] = useState(false);
  const [refuseTaskId, setRefuseTaskId] = useState<string | null>(null);
  const [refuseComment, setRefuseComment] = useState('');
  const [proofTaskId, setProofTaskId] = useState<string | null>(null);
  const [proofPhoto, setProofPhoto] = useState<File | null>(null);
  const [uploadingProof, setUploadingProof] = useState(false);
  const sigRef = useRef<SignaturePadHandle>(null);
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  const [gpsDialogOpen, setGpsDialogOpen] = useState(false);
  const [forcedGpsDialog, setForcedGpsDialog] = useState(false);
  const [pendingTrackingTask, setPendingTrackingTask] = useState<typeof tasks[0] | null>(null);
  const { createTrackingSession, isTracking, activeTaskId, startBackgroundTracking, isBackgroundTracking, stopBackgroundTracking, endTaskTracking } = useDriverTracking({ driverId: user?.id });

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
    // Persist to DB so the admin attendance board sees it (best-effort).
    if (user) {
      supabase.from('task_checkins')
        .upsert({ user_id: user.id, checkin_date: todayStr, checked_in_at: now.toISOString() }, { onConflict: 'user_id,checkin_date' })
        .then(({ error }) => { if (error) console.warn('checkin persist failed:', error.message); });
    }
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
    if (newStatus === 'done') {
      // Open the proof dialog instead of completing directly.
      setProofTaskId(taskId);
      setProofPhoto(null);
      sigRef.current?.clear();
      return;
    }
    updateTaskStatus(taskId, newStatus);
    if (newStatus === 'doing') toast.success(t('myTasks.startedToast'));
  };

  const completeWithProof = async () => {
    if (!proofTaskId) return;
    setUploadingProof(true);
    try {
      const extra: Record<string, string> = { completed_at: new Date().toISOString() };
      const base = `${proofTaskId}/${Date.now()}`;
      if (proofPhoto) {
        const path = `${base}-photo.jpg`;
        const { error } = await supabase.storage.from('task-proofs').upload(path, proofPhoto, { upsert: true, contentType: proofPhoto.type || 'image/jpeg' });
        if (!error) extra.proof_photo_url = supabase.storage.from('task-proofs').getPublicUrl(path).data.publicUrl;
      }
      const sigBlob = await sigRef.current?.toBlob();
      if (sigBlob) {
        const path = `${base}-signature.png`;
        const { error } = await supabase.storage.from('task-proofs').upload(path, sigBlob, { upsert: true, contentType: 'image/png' });
        if (!error) extra.proof_signature_url = supabase.storage.from('task-proofs').getPublicUrl(path).data.publicUrl;
      }
      updateTaskStatus(proofTaskId, 'done', undefined, extra);
      void endTaskTracking(proofTaskId);
      confetti({ particleCount: 80, spread: 60, origin: { y: 0.7 } });
      toast.success(t('myTasks.finishedToast'));
    } catch (e: any) {
      toast.error(String(e?.message || e));
    } finally {
      setUploadingProof(false);
      setProofTaskId(null);
      setProofPhoto(null);
    }
  };

  const handleRefuse = () => {
    if (!refuseTaskId) return;
    updateTaskStatus(refuseTaskId, 'refused', refuseComment);
    void endTaskTracking(refuseTaskId);
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

  // One-tap card for an actionable task (pending/doing). Big touch targets,
  // always-visible call/route/whatsapp, single primary next-step button.
  const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
  const activeTasks = myTasks
    .filter(t => t.status === 'pending' || t.status === 'doing')
    .sort((a, b) =>
      (a.status === b.status ? 0 : a.status === 'doing' ? -1 : 1) ||
      (PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]));
  const doneTasks = myTasks.filter(t => t.status === 'done' || t.status === 'refused');

  const quickBtn = 'flex flex-col items-center justify-center gap-1 h-14 rounded-xl bg-secondary/60 hover:bg-secondary active:scale-95 transition text-[11px] font-medium text-foreground';

  const ActiveCard = ({ task }: { task: typeof myTasks[0] }) => (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <TaskTypeIcon type={task.type} />
            <div className="min-w-0">
              <p className="font-bold text-base text-foreground truncate">{task.client_name}</p>
              <p className="text-xs text-muted-foreground">{t(`status.${task.status}`)}</p>
            </div>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {isOverdue(task) && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-status-refused-light text-status-refused">
              <Clock3 className="h-3 w-3" aria-hidden="true" />{t('myTasks.overdue')}
            </span>
          )}
          <PriorityBadge priority={task.priority} />
          <TrackingIndicator taskId={task.id} />
        </div>
      </div>

      {/* Address — tap to navigate */}
      <button
        onClick={() => openMaps(task.address)}
        className="w-full flex items-center gap-2 text-start p-2.5 rounded-xl bg-secondary/50 hover:bg-secondary active:scale-[0.99] transition"
      >
        <MapPin className="h-4 w-4 text-primary shrink-0" />
        <span className="text-sm text-foreground flex-1 leading-snug">{task.address}</span>
        <Navigation className="h-4 w-4 text-primary shrink-0" />
      </button>

      {/* Key info, surfaced inline (no expand) */}
      {(task.problem_details || task.invoice_number || task.payment_details || task.comment) && (
        <div className="text-xs space-y-1 px-0.5">
          {task.problem_details && <p className="text-muted-foreground">{task.problem_details}</p>}
          {task.invoice_number && <p className="flex items-center gap-1.5 text-muted-foreground"><FileText className="h-3.5 w-3.5" aria-hidden="true" />{task.invoice_number}</p>}
          {task.payment_details && <p className="flex items-center gap-1.5 text-foreground font-medium"><Wallet className="h-3.5 w-3.5" aria-hidden="true" />{task.payment_details}</p>}
          {task.comment && <p className="flex items-center gap-1.5 text-status-refused"><MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />{task.comment}</p>}
        </div>
      )}

      {/* Quick actions — always visible */}
      <div className="grid grid-cols-3 gap-2">
        <button onClick={() => window.open(`tel:${task.client_phone}`)} className={quickBtn}>
          <Phone className="h-4 w-4 text-status-done" /> {t('myTasks.call')}
        </button>
        <button onClick={() => openMaps(task.address)} className={quickBtn}>
          <Navigation className="h-4 w-4 text-status-doing" /> {t('myTasks.navigate')}
        </button>
        <button onClick={() => openWhatsApp(task.client_phone, task.client_name)} className={quickBtn}>
          <MessageCircle className="h-4 w-4 text-status-done" /> WhatsApp
        </button>
      </div>

      {/* Driver: share live tracking link */}
      {user?.role === 'driver' && task.type === 'delivery' && task.status === 'doing' && !isTracking && (
        <button
          onClick={() => handleShareTracking(task)}
          className="w-full h-11 rounded-xl bg-primary/10 text-primary font-medium flex items-center justify-center gap-2 active:scale-[0.99] transition"
        >
          <Truck className="h-4 w-4" /> {t('myTasks.shareTracking')}
        </button>
      )}

      {/* PRIMARY next-step action — one giant button */}
      {task.status === 'pending' ? (
        <button
          onClick={() => handleStatusChange(task.id, 'doing')}
          className="w-full h-[52px] rounded-xl bg-status-doing text-white text-base font-semibold flex items-center justify-center gap-2 active:scale-[0.99] transition shadow-sm"
        >
          <Play className="h-5 w-5" aria-hidden="true" />{t('myTasks.start')}
        </button>
      ) : (
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <button
            onClick={() => handleStatusChange(task.id, 'done')}
            className="h-[52px] rounded-xl bg-status-done text-white text-base font-semibold flex items-center justify-center gap-2 active:scale-[0.99] transition shadow-sm"
          >
            <Check className="h-5 w-5" aria-hidden="true" />{t('myTasks.finish')}
          </button>
          <button
            onClick={() => handleStatusChange(task.id, 'refused')}
            className="h-[52px] px-4 rounded-xl bg-status-refused-light text-status-refused font-medium active:scale-95 transition flex items-center gap-1.5"
          >
            <Ban className="h-4 w-4" aria-hidden="true" />{t('myTasks.refuse')}
          </button>
        </div>
      )}
    </div>
  );

  const header = (
    <PageHeader
      title={t('myTasks.title')}
      subtitle={t(`role.${user?.role}`)}
      actions={(
        <>
          <TasksHeaderActions />
          {isDriverRole && (
            <Button variant="outline" onClick={sendManualLocation} disabled={sendingManualLocation} className="h-9 gap-1.5">
              <Crosshair className="h-4 w-4" aria-hidden="true" />
              {sendingManualLocation ? t('myTasks.sending') : t('myTasks.myPosition')}
            </Button>
          )}
          <div className="flex gap-1 rounded-lg bg-secondary p-1" role="group" aria-label="Affichage">
            <button type="button" onClick={() => setView('kanban')} aria-pressed={view === 'kanban'} aria-label="Colonnes par statut" title="Colonnes par statut"
              className={`flex h-8 w-8 items-center justify-center rounded-md ${view === 'kanban' ? 'bg-card shadow-sm' : 'text-muted-foreground'}`}>
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => setView('list')} aria-pressed={view === 'list'} aria-label="Liste" title="Liste"
              className={`flex h-8 w-8 items-center justify-center rounded-md ${view === 'list' ? 'bg-card shadow-sm' : 'text-muted-foreground'}`}>
              <List className="h-4 w-4" />
            </button>
          </div>
        </>
      )}
    />
  );

  return (
    <div className="mx-auto max-w-[1600px] space-y-4">
      <div className={isBlocked ? 'blur-sm pointer-events-none select-none' : ''}>
        {header}
        {/* Check-in banner */}
        {isDriverRole && isWithinWorkingHours() && (
          <AnimatePresence>
            {!checkedIn ? (
              <motion.div
                key="checkin-banner"
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="mb-4 bg-primary/10 border border-primary/20 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3"
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
                className="mb-4 flex items-center gap-2 px-3 py-1.5 bg-status-done-light rounded-lg w-fit"
              >
                <CheckCircle2 className="h-4 w-4 text-status-done" />
                <span className="text-xs font-medium text-status-done">{t('myTasks.checkedAt', { time: checkinTime || '' })}</span>
              </motion.div>
            )}
          </AnimatePresence>
        )}

        {view === 'kanban' ? (
          <TaskBoard
            tasks={myTasks}
            emptyLabel={t('myTasks.emptyState')}
            renderTask={task => {
              const open = expandedTask === task.id;
              return (
                <TaskCard
                  task={task}
                  showAssignee={false}
                  actions={(
                    <>
                      <button type="button" onClick={() => setExpandedTask(open ? null : task.id)} aria-expanded={open}
                        className="h-8 rounded-md px-2 text-xs font-semibold text-primary hover:bg-primary/10">
                        {open ? t('myTasks.collapse') : t('myTasks.details')}
                      </button>
                      {task.status === 'pending' && (
                        <button type="button" onClick={() => handleStatusChange(task.id, 'doing')} className="h-8 rounded-md bg-status-doing-light px-2.5 text-xs font-semibold text-status-doing">
                          {t('myTasks.start')}
                        </button>
                      )}
                      {task.status === 'doing' && (
                        <>
                          <button type="button" onClick={() => handleStatusChange(task.id, 'done')} className="h-8 rounded-md bg-status-done-light px-2.5 text-xs font-semibold text-status-done">
                            {t('myTasks.finish')}
                          </button>
                          <button type="button" onClick={() => handleStatusChange(task.id, 'refused')} className="h-8 rounded-md bg-status-refused-light px-2.5 text-xs font-semibold text-status-refused">
                            {t('myTasks.refuse')}
                          </button>
                        </>
                      )}
                    </>
                  )}
                >
                  <TrackingIndicator taskId={task.id} />
                  {open && (
                    <>
                      {task.problem_details && <p className="text-muted-foreground">{task.problem_details}</p>}
                      {task.payment_details && <p className="flex items-center gap-1.5 text-muted-foreground"><Wallet className="h-3.5 w-3.5" aria-hidden="true" />{task.payment_details}</p>}
                      {task.comment && <p className="flex items-center gap-1.5 text-destructive"><MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />{task.comment}</p>}
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        <button type="button" onClick={() => window.open(`tel:${task.client_phone}`)} className="flex h-9 items-center gap-1.5 rounded-lg bg-status-done-light px-3 text-xs font-medium text-status-done">
                          <Phone className="h-3.5 w-3.5" aria-hidden="true" /> {t('myTasks.call')}
                        </button>
                        <button type="button" onClick={() => openWhatsApp(task.client_phone, task.client_name)} className="flex h-9 items-center gap-1.5 rounded-lg bg-status-done-light px-3 text-xs font-medium text-status-done">
                          <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" /> WhatsApp
                        </button>
                        <button type="button" onClick={() => openMaps(task.address)} className="flex h-9 items-center gap-1.5 rounded-lg bg-status-doing-light px-3 text-xs font-medium text-status-doing">
                          <Navigation className="h-3.5 w-3.5" aria-hidden="true" /> {t('myTasks.route')}
                        </button>
                        {user?.role === 'driver' && task.type === 'delivery' && task.status === 'doing' && !isTracking && (
                          <button type="button" onClick={() => handleShareTracking(task)} className="flex h-9 items-center gap-1.5 rounded-lg bg-primary/10 px-3 text-xs font-medium text-primary">
                            <Truck className="h-3.5 w-3.5" aria-hidden="true" /> {t('myTasks.tracking')}
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </TaskCard>
              );
            }}
          />
        ) : (
          /* Simplified one-tap list (default on phones) */
          <div className="mx-auto max-w-3xl space-y-4">
            {activeTasks.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 px-1">
                  <span className="text-sm font-semibold text-foreground">{t('myTasks.todo')}</span>
                  <span className="text-xs bg-primary/10 text-primary rounded-full px-2 py-0.5 font-medium">{activeTasks.length}</span>
                </div>
                {activeTasks.map(task => <ActiveCard key={task.id} task={task} />)}
              </div>
            )}

            {doneTasks.length > 0 && (
              <div>
                <button
                  onClick={() => setShowDone(v => !v)}
                  className="w-full flex items-center justify-between px-1 py-2 text-sm font-semibold text-muted-foreground"
                >
                  <span>{t('myTasks.doneSection')} ({doneTasks.length})</span>
                  <ChevronDown className={`h-4 w-4 transition-transform ${showDone ? '' : '-rotate-90'}`} aria-hidden="true" />
                </button>
                {showDone && (
                  <div className="space-y-2">
                    {doneTasks.map(task => (
                      <div key={task.id} className="rounded-xl border border-border bg-card p-3 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{task.client_name}</p>
                          <p className="text-xs text-muted-foreground truncate">{task.address}</p>
                        </div>
                        <StatusBadge status={task.status} label={t(`status.${task.status}`)} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTasks.length === 0 && (
              <p className="rounded-xl border border-dashed border-border px-4 py-12 text-center text-sm text-muted-foreground">{t('myTasks.emptyState')}</p>
            )}
          </div>
        )}

      </div>

      {/* Proof of completion Dialog */}
      <Dialog open={!!proofTaskId} onOpenChange={v => { if (!v && !uploadingProof) setProofTaskId(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('myTasks.proofTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">{t('myTasks.proofPrompt')}</p>

            {/* Photo */}
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">{t('myTasks.proofPhoto')}</label>
              {proofPhoto ? (
                <div className="relative">
                  <img src={URL.createObjectURL(proofPhoto)} alt="preuve" className="w-full h-40 object-cover rounded-lg border border-border" />
                  <button onClick={() => setProofPhoto(null)} className="absolute top-1 end-1 p-1 rounded-full bg-black/60 text-white">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <label className="flex items-center justify-center gap-2 h-20 rounded-lg border border-dashed border-input bg-secondary/40 cursor-pointer text-sm text-muted-foreground">
                  <Camera className="h-5 w-5" /> {t('myTasks.proofTakePhoto')}
                  <input type="file" accept="image/*" capture="environment" className="hidden"
                    onChange={e => setProofPhoto(e.target.files?.[0] || null)} />
                </label>
              )}
            </div>

            {/* Signature */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-medium text-foreground">{t('myTasks.proofSignature')}</label>
                <button onClick={() => sigRef.current?.clear()} className="text-[11px] text-muted-foreground hover:text-foreground">{t('myTasks.proofClear')}</button>
              </div>
              <SignaturePad ref={sigRef} />
            </div>

            <div className="flex gap-2 pt-1">
              <Button variant="outline" onClick={() => setProofTaskId(null)} disabled={uploadingProof} className="flex-1">{t('form.cancel')}</Button>
              <Button onClick={completeWithProof} disabled={uploadingProof} className="flex-1">
                {uploadingProof ? t('myTasks.sending') : t('myTasks.finish')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

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
