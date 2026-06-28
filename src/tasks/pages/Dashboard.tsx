import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/tasks/contexts/AuthAdapter';
import { useData } from '@/tasks/contexts/DataContext';
import { useLanguage } from '@/tasks/contexts/LanguageContext';
import { ROLE_CONFIG, STATUS_CONFIG, TaskStatus, Priority, Task, TaskType } from '@/tasks/types';
import { motion, AnimatePresence } from 'framer-motion';
import { StatusBadge, PriorityBadge } from '@/tasks/components/StatusBadge';
import {
  ClipboardList, Wrench, Truck, CheckCircle, Clock3, UserPlus,
  Users, Plus, Edit, MapPin, Phone, ChevronDown, AlertTriangle, BarChart3,
} from 'lucide-react';
import LiveTrackingMap from '@/tasks/components/LiveTrackingMap';
import FieldAppShare from '@/tasks/components/FieldAppShare';
import CreateTaskDialog from '@/tasks/components/CreateTaskDialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { isOverdue, isToday, todayStr } from '@/tasks/lib/taskUtils';

type Period = 'today' | '7d' | 'all';
const blankForm = {
  client_name: '', client_phone: '', address: '', priority: 'medium' as Priority,
  problem_details: '', invoice_number: '', payment_details: '', due_date: '', assigned_to: '', status: 'pending' as TaskStatus,
};

export default function Dashboard() {
  const { user } = useAuth();
  const { tasks, users, getUserById, updateTask, addTask } = useData();
  const { t, language } = useLanguage();
  const dateLocale = language === 'ar' ? 'ar-MA' : 'fr-FR';

  const [period, setPeriod] = useState<Period>('today');
  const [segment, setSegment] = useState<'toAssign' | 'overdue' | 'inProgress' | 'interventions' | 'deliveries'>('toAssign');
  const [showPerf, setShowPerf] = useState(false);

  // Create / edit dialog
  const [dialogMode, setDialogMode] = useState<'create' | 'edit' | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [formType, setFormType] = useState<TaskType>('technical_intervention');
  const [form, setForm] = useState(blankForm);

  const technicians = users.filter(u => u.role === 'technician');
  const drivers = users.filter(u => u.role === 'driver');
  const field = users.filter(u => u.role === 'technician' || u.role === 'driver');
  const activeUserIds = new Set(users.map(u => u.id));

  // Today's check-ins (C-3): user_id -> "HH:MM"
  const [checkins, setCheckins] = useState<Record<string, string>>({});
  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase
        .from('task_checkins')
        .select('user_id, checked_in_at')
        .eq('checkin_date', todayStr());
      if (!active || !data) return;
      const map: Record<string, string> = {};
      data.forEach((r: any) => {
        map[r.user_id] = new Date(r.checked_in_at).toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' });
      });
      setCheckins(map);
    })();
    return () => { active = false; };
  }, [dateLocale]);
  const checkedInCount = field.filter(u => checkins[u.id]).length;

  // ---- derived task sets ----
  const active = tasks.filter(t => t.status !== 'done' && t.status !== 'refused');
  const doing = active.filter(t => t.status === 'doing');
  const overdue = active.filter(isOverdue);
  const unassigned = active.filter(t => !t.assigned_to || !activeUserIds.has(t.assigned_to));

  const inPeriod = (t: Task) => period === 'all' ? true
    : period === 'today' ? isToday(t.archived_at || t.updated_at || t.created_at)
    : (Date.now() - new Date(t.archived_at || t.updated_at || t.created_at).getTime()) < 7 * 864e5;
  const doneInPeriod = tasks.filter(t => t.status === 'done' && inPeriod(t));

  const periodLabel = period === 'today' ? t('dashboard.periodToday') : period === '7d' ? t('dashboard.period7d') : t('dashboard.periodAll');

  const kpis = [
    { label: t('dashboard.activeTasks'), value: active.length, icon: ClipboardList, color: 'primary' },
    { label: t('dashboard.inProgress'), value: doing.length, icon: Wrench, color: 'status-doing' },
    { label: t('dashboard.overdue'), value: overdue.length, icon: Clock3, color: 'status-refused' },
    { label: t('dashboard.unassigned'), value: unassigned.length, icon: UserPlus, color: 'priority-high' },
    { label: `${t('dashboard.completed')} · ${periodLabel}`, value: doneInPeriod.length, icon: CheckCircle, color: 'status-done' },
    { label: t('dashboard.teamActive'), value: `${checkedInCount}/${field.length}`, icon: Users, color: 'role-driver' },
  ];

  const segments: { id: typeof segment; label: string; count: number; list: Task[] }[] = [
    { id: 'toAssign', label: t('dashboard.toAssign'), count: unassigned.length, list: unassigned },
    { id: 'overdue', label: t('dashboard.overdue'), count: overdue.length, list: overdue },
    { id: 'inProgress', label: t('dashboard.inProgress'), count: doing.length, list: doing },
    { id: 'interventions', label: t('dashboard.interventions'), count: active.filter(t => t.type === 'technical_intervention').length, list: active.filter(t => t.type === 'technical_intervention') },
    { id: 'deliveries', label: t('dashboard.deliveries'), count: active.filter(t => t.type === 'delivery').length, list: active.filter(t => t.type === 'delivery') },
  ];
  const segList = segments.find(s => s.id === segment)?.list ?? [];

  // alerts: urgent + overdue active tasks, deduped
  const alerts = active.filter(t => t.priority === 'urgent' || isOverdue(t))
    .sort((a, b) => (isOverdue(b) ? 1 : 0) - (isOverdue(a) ? 1 : 0)).slice(0, 8);

  // ---- per-agent performance ----
  const perf = field.map(u => {
    const mine = tasks.filter(t => t.assigned_to === u.id);
    const done = mine.filter(t => t.status === 'done');
    const withDur = done.filter(t => t.archived_at);
    const avgH = withDur.length
      ? withDur.reduce((s, t) => s + (new Date(t.archived_at!).getTime() - new Date(t.created_at).getTime()), 0) / withDur.length / 36e5
      : 0;
    return {
      u, assigned: mine.length, done: done.length,
      refused: mine.filter(t => t.status === 'refused').length, avgH,
    };
  }).sort((a, b) => b.done - a.done);

  // ---- create / edit ----
  const openCreate = () => { setDialogMode('create'); setEditId(null); setFormType('technical_intervention'); setForm(blankForm); };
  const openEdit = (task: Task) => {
    setDialogMode('edit'); setEditId(task.id); setFormType(task.type);
    setForm({
      client_name: task.client_name, client_phone: task.client_phone, address: task.address,
      priority: task.priority, problem_details: task.problem_details || '', invoice_number: task.invoice_number || '',
      payment_details: task.payment_details || '', due_date: task.due_date || '', assigned_to: task.assigned_to, status: task.status,
    });
  };
  const closeDialog = () => { setDialogMode(null); setEditId(null); };
  const saveDialog = () => {
    if (dialogMode === 'create') {
      const now = new Date().toISOString();
      addTask({
        id: crypto.randomUUID(), type: formType, status: form.status, client_name: form.client_name.trim(),
        client_phone: form.client_phone.trim(), address: form.address.trim(), problem_details: form.problem_details || undefined,
        invoice_number: form.invoice_number || undefined, payment_details: form.payment_details || undefined,
        priority: form.priority, created_by: user?.id || '', assigned_to: form.assigned_to,
        due_date: form.due_date || undefined, created_at: now, updated_at: now,
      } as Task);
    } else if (editId) {
      updateTask(editId, { ...form, edited: true } as Partial<Task>);
    }
    closeDialog();
  };

  const assigneeOptions = formType === 'technical_intervention' ? technicians : drivers;
  const editingTask = editId ? tasks.find(t => t.id === editId) : null;

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-5">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground">{t('dashboard.opsCenter')}</h1>
          <p className="text-xs text-muted-foreground">{new Date().toLocaleDateString(dateLocale, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-secondary rounded-lg p-0.5">
            {(['today', '7d', 'all'] as Period[]).map(p => (
              <button key={p} onClick={() => setPeriod(p)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition ${period === p ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground'}`}>
                {p === 'today' ? t('dashboard.periodToday') : p === '7d' ? t('dashboard.period7d') : t('dashboard.periodAll')}
              </button>
            ))}
          </div>
          <button onClick={openCreate} className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/90">
            <Plus className="h-4 w-4" /> {t('dashboard.newTask')}
          </button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        {kpis.map(k => (
          <div key={k.label} className="glass rounded-xl p-3">
            <div className="flex items-center justify-between">
              <p className="text-2xl font-bold text-foreground">{k.value}</p>
              <k.icon className="h-4 w-4" style={{ color: `hsl(var(--${k.color}))` }} />
            </div>
            <p className="text-[11px] text-muted-foreground mt-1 leading-tight">{k.label}</p>
          </div>
        ))}
      </div>

      {/* Map + side panels */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <LiveTrackingMap drivers={drivers as any} />
        </div>
        <div className="space-y-4">
          {/* Team */}
          <div className="glass rounded-xl p-4">
            <h2 className="font-semibold text-foreground text-sm mb-3 flex items-center gap-2"><Users className="h-4 w-4 text-primary" />{t('dashboard.team')}</h2>
            <div className="space-y-2">
              {field.map(u => {
                const rc = ROLE_CONFIG[u.role];
                const open = active.filter(t => t.assigned_to === u.id).length;
                const busy = doing.some(t => t.assigned_to === u.id);
                const inAt = checkins[u.id];
                return (
                  <div key={u.id} className="flex items-center gap-2.5">
                    <span className={`h-2 w-2 rounded-full ${busy ? 'bg-status-doing animate-pulse' : inAt ? 'bg-status-done' : 'bg-muted-foreground/40'}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground truncate">{rc.emoji} {u.first_name} {u.last_name}</p>
                      {inAt && <p className="text-[10px] text-status-done">✓ {inAt}</p>}
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">{open}</span>
                  </div>
                );
              })}
              {field.length === 0 && <p className="text-xs text-muted-foreground">—</p>}
            </div>
          </div>

          {/* Alerts */}
          <div className="glass rounded-xl p-4">
            <h2 className="font-semibold text-foreground text-sm mb-3 flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-status-refused" />{t('dashboard.alerts')}</h2>
            <div className="space-y-2">
              {alerts.map(task => (
                <button key={task.id} onClick={() => openEdit(task)} className="w-full text-start p-2 rounded-lg hover:bg-secondary transition flex items-center gap-2">
                  {isOverdue(task)
                    ? <Clock3 className="h-3.5 w-3.5 text-status-refused shrink-0" />
                    : <span className="text-status-refused shrink-0">🔥</span>}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">{task.client_name}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{task.address}</p>
                  </div>
                </button>
              ))}
              {alerts.length === 0 && <p className="text-xs text-muted-foreground">{t('dashboard.noAlerts')}</p>}
            </div>
          </div>
        </div>
      </div>

      {/* Actionable segmented lists */}
      <div className="glass rounded-xl overflow-hidden">
        <div className="flex border-b border-border overflow-x-auto">
          {segments.map(s => (
            <button key={s.id} onClick={() => setSegment(s.id)}
              className={`px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors ${segment === s.id ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}>
              {s.label} <span className="text-xs opacity-70">{s.count}</span>
            </button>
          ))}
        </div>
        <div className="divide-y divide-border/60">
          {segList.map(task => {
            const assignee = getUserById(task.assigned_to);
            return (
              <div key={task.id} className="flex items-center gap-3 p-3 hover:bg-secondary/50 transition cursor-pointer" onClick={() => openEdit(task)}>
                <StatusBadge status={task.status} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{task.client_name}</p>
                  <p className="text-xs text-muted-foreground truncate flex items-center gap-1"><MapPin className="h-3 w-3" />{task.address}</p>
                </div>
                {isOverdue(task) && <span className="text-[10px] font-semibold text-status-refused shrink-0">⏰ {t('dashboard.overdue')}</span>}
                <span className="text-xs text-muted-foreground shrink-0 hidden sm:block">{assignee ? `${assignee.first_name}` : '—'}</span>
                <PriorityBadge priority={task.priority} />
                <button onClick={(e) => { e.stopPropagation(); openEdit(task); }} className="p-1.5 rounded-lg hover:bg-primary/10 text-muted-foreground hover:text-primary shrink-0">
                  <Edit className="h-4 w-4" />
                </button>
              </div>
            );
          })}
          {segList.length === 0 && <div className="p-8 text-center text-muted-foreground text-sm">{t('dashboard.emptyState')}</div>}
        </div>
      </div>

      {/* Team performance (collapsible) */}
      <div className="glass rounded-xl overflow-hidden">
        <button onClick={() => setShowPerf(v => !v)} className="w-full flex items-center gap-2 p-4 text-start">
          <BarChart3 className="h-4 w-4 text-primary" />
          <span className="flex-1 text-sm font-semibold text-foreground">{t('dashboard.performance')}</span>
          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${showPerf ? 'rotate-180' : ''}`} />
        </button>
        {showPerf && (
          <div className="px-4 pb-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground text-xs">
                  <th className="text-start p-2 font-medium">{t('dashboard.team')}</th>
                  <th className="text-center p-2 font-medium">{t('dashboard.assignedTo')}</th>
                  <th className="text-center p-2 font-medium">{t('status.done')}</th>
                  <th className="text-center p-2 font-medium">{t('status.refused')}</th>
                  <th className="text-center p-2 font-medium">{t('dashboard.avgDuration')}</th>
                </tr>
              </thead>
              <tbody>
                {perf.map(p => (
                  <tr key={p.u.id} className="border-t border-border/60">
                    <td className="p-2 text-foreground">{ROLE_CONFIG[p.u.role].emoji} {p.u.first_name} {p.u.last_name}</td>
                    <td className="p-2 text-center text-foreground">{p.assigned}</td>
                    <td className="p-2 text-center text-status-done font-medium">{p.done}</td>
                    <td className="p-2 text-center text-status-refused">{p.refused}</td>
                    <td className="p-2 text-center text-muted-foreground">{p.avgH ? `${p.avgH.toFixed(1)}h` : '—'}</td>
                  </tr>
                ))}
                {perf.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-muted-foreground text-xs">—</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Field-app onboarding */}
      <FieldAppShare />

      {/* Create / Edit dialog */}
      {/* Create uses the shared wizard (identical to the Tasks list). */}
      <CreateTaskDialog open={dialogMode === 'create'} onOpenChange={v => { if (!v) closeDialog(); }} />

      {/* Edit dialog (status, reassign, proof) */}
      <Dialog open={dialogMode === 'edit'} onOpenChange={v => { if (!v) closeDialog(); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('dashboard.editTask')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {dialogMode === 'edit' && (editingTask?.proof_photo_url || editingTask?.proof_signature_url) && (
              <div className="rounded-lg border border-border p-3 bg-secondary/30">
                <p className="text-xs font-semibold text-foreground mb-2">📎 {t('myTasks.proofTitle')}</p>
                <div className="flex gap-2">
                  {editingTask.proof_photo_url && (
                    <a href={editingTask.proof_photo_url} target="_blank" rel="noreferrer" className="block w-1/2">
                      <img src={editingTask.proof_photo_url} alt="photo" className="w-full h-24 object-cover rounded border border-border" />
                    </a>
                  )}
                  {editingTask.proof_signature_url && (
                    <a href={editingTask.proof_signature_url} target="_blank" rel="noreferrer" className="block w-1/2">
                      <img src={editingTask.proof_signature_url} alt="signature" className="w-full h-24 object-contain rounded border border-border bg-white" />
                    </a>
                  )}
                </div>
              </div>
            )}
            {dialogMode === 'create' && (
              <div>
                <label className="text-sm font-medium text-foreground">{t('dashboard.status')}</label>
                <div className="flex gap-2 mt-1">
                  {(['technical_intervention', 'delivery'] as TaskType[]).map(ty => (
                    <button key={ty} onClick={() => setFormType(ty)}
                      className={`flex-1 py-2 text-xs font-medium rounded-lg border transition-all ${formType === ty ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'}`}>
                      {ty === 'technical_intervention' ? `🔧 ${t('dashboard.interventions')}` : `🚚 ${t('dashboard.deliveries')}`}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {dialogMode === 'edit' && (
              <div>
                <label className="text-sm font-medium text-foreground">{t('form.status')}</label>
                <Select value={form.status} onValueChange={v => setForm(p => ({ ...p, status: v as TaskStatus }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(['pending', 'doing', 'done', 'refused'] as TaskStatus[]).map(s => (
                      <SelectItem key={s} value={s}>{STATUS_CONFIG[s].emoji} {t(`status.${s}`)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <label className="text-sm font-medium text-foreground">{t('form.assignedTo')}</label>
              <Select value={form.assigned_to} onValueChange={v => setForm(p => ({ ...p, assigned_to: v }))}>
                <SelectTrigger><SelectValue placeholder={t('form.select')} /></SelectTrigger>
                <SelectContent>
                  {assigneeOptions.map(u => <SelectItem key={u.id} value={u.id}>{u.first_name} {u.last_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">{t('form.clientName')}</label>
              <Input value={form.client_name} onChange={e => setForm(p => ({ ...p, client_name: e.target.value }))} />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">{t('form.clientPhone')}</label>
              <Input value={form.client_phone} onChange={e => setForm(p => ({ ...p, client_phone: e.target.value }))} />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">{t('form.address')}</label>
              <Input value={form.address} onChange={e => setForm(p => ({ ...p, address: e.target.value }))} />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">{t('form.priority')}</label>
              <div className="flex gap-2 mt-1">
                {(['low', 'medium', 'high', 'urgent'] as Priority[]).map(p => (
                  <button key={p} onClick={() => setForm(prev => ({ ...prev, priority: p }))}
                    className={`flex-1 py-2 text-xs font-medium rounded-lg border transition-all ${form.priority === p ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'}`}>
                    {t(`priority.${p}`)}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">{t('form.dueDate')}</label>
              <Input type="date" value={form.due_date} onChange={e => setForm(p => ({ ...p, due_date: e.target.value }))} />
            </div>
            {formType === 'technical_intervention' ? (
              <div>
                <label className="text-sm font-medium text-foreground">{t('form.problemDetails')}</label>
                <Textarea value={form.problem_details} onChange={e => setForm(p => ({ ...p, problem_details: e.target.value }))} />
              </div>
            ) : (
              <>
                <div>
                  <label className="text-sm font-medium text-foreground">{t('form.invoiceNumber')}</label>
                  <Input value={form.invoice_number} onChange={e => setForm(p => ({ ...p, invoice_number: e.target.value }))} />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground">{t('form.paymentDetails')}</label>
                  <Textarea value={form.payment_details} onChange={e => setForm(p => ({ ...p, payment_details: e.target.value }))} />
                </div>
              </>
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={closeDialog} className="flex-1">{t('form.cancel')}</Button>
              <Button onClick={saveDialog} disabled={!form.client_name || !form.address} className="flex-1">{t('form.save')}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
