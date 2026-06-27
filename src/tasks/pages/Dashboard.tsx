import React from 'react';
import { useAuth } from '@/tasks/contexts/AuthAdapter';
import { useData } from '@/tasks/contexts/DataContext';
import { useLanguage } from '@/tasks/contexts/LanguageContext';
import { ROLE_CONFIG, STATUS_CONFIG, TaskStatus, Priority, Task } from '@/tasks/types';
import { motion, AnimatePresence } from 'framer-motion';
import { StatusBadge, PriorityBadge } from '@/tasks/components/StatusBadge';
import {
  ClipboardList, Wrench, Truck, CheckCircle, XCircle,
  Users, Activity, TrendingUp, ChevronDown, ChevronUp, Edit, MapPin, Phone
} from 'lucide-react';
import LiveTrackingMap from '@/tasks/components/LiveTrackingMap';
import FieldAppShare from '@/tasks/components/FieldAppShare';
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';

const container = { hidden: {}, show: { transition: { staggerChildren: 0.05 } } };
const item = { hidden: { opacity: 0, y: 20 }, show: { opacity: 1, y: 0 } };

export default function Dashboard() {
  const { user } = useAuth();
  const { tasks, users, getUserById, updateTask } = useData();
  const { t, language } = useLanguage();
  const [activeTab, setActiveTab] = useState<'interventions' | 'deliveries'>('interventions');
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [editData, setEditData] = useState({
    client_name: '', client_phone: '', address: '', priority: 'medium' as Priority,
    problem_details: '', invoice_number: '', payment_details: '', due_date: '', assigned_to: '', status: 'pending' as TaskStatus,
  });

  const activeTasks = tasks.filter(t => t.status !== 'done');
  const interventions = tasks.filter(t => t.type === 'technical_intervention');
  const deliveries = tasks.filter(t => t.type === 'delivery');
  const doingInterventions = interventions.filter(t => t.status === 'doing');
  const doingDeliveries = deliveries.filter(t => t.status === 'doing');
  const doneTodayCount = tasks.filter(t => t.status === 'done').length;
  const refusedCount = tasks.filter(t => t.status === 'refused').length;

  const technicians = users.filter(u => u.role === 'technician' && u.is_active);
  const drivers = users.filter(u => u.role === 'driver' && u.is_active);

  const dateLocale = language === 'ar' ? 'ar-MA' : 'fr-FR';

  const stats = [
    { label: t('dashboard.activeTasks'), value: activeTasks.length, icon: ClipboardList, emoji: '📋', color: 'primary' },
    { label: t('dashboard.ongoingInterventions'), value: doingInterventions.length, icon: Wrench, emoji: '🔧', color: 'role-technician' },
    { label: t('dashboard.ongoingDeliveries'), value: doingDeliveries.length, icon: Truck, emoji: '🚚', color: 'role-driver' },
    { label: t('dashboard.completed'), value: doneTodayCount, icon: CheckCircle, emoji: '✅', color: 'status-done' },
    { label: t('dashboard.refused'), value: refusedCount, icon: XCircle, emoji: '⚠️', color: 'status-refused' },
  ];

  const displayedTasks = activeTab === 'interventions'
    ? interventions.filter(t => t.status !== 'done')
    : deliveries.filter(t => t.status !== 'done');

  const openEdit = (task: Task) => {
    setEditTask(task);
    setEditData({
      client_name: task.client_name, client_phone: task.client_phone, address: task.address,
      priority: task.priority, problem_details: task.problem_details || '',
      invoice_number: task.invoice_number || '', payment_details: task.payment_details || '',
      due_date: task.due_date || '', assigned_to: task.assigned_to, status: task.status,
    });
  };

  const handleEdit = () => {
    if (!editTask) return;
    updateTask(editTask.id, { ...editData, edited: true });
    setEditTask(null);
    toast.success(t('salesTasks.taskEdited'));
  };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl md:text-3xl font-bold text-foreground">
          {t('dashboard.greeting', { name: user?.first_name || '' })}
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          {new Date().toLocaleDateString(dateLocale, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
      </motion.div>

      {/* Field-app onboarding: shareable link + QR */}
      <FieldAppShare />

      {/* Stats */}
      <motion.div variants={container} initial="hidden" animate="show" className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {stats.map((stat) => (
          <motion.div
            key={stat.label}
            variants={item}
            className="glass rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow"
          >
            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg">{stat.emoji}</span>
              <stat.icon className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="text-2xl font-bold text-foreground">{stat.value}</p>
            <p className="text-xs text-muted-foreground mt-1">{stat.label}</p>
          </motion.div>
        ))}
      </motion.div>

      {/* Live Tracking Map — Admin only */}
      {user?.role === 'super_admin' && <LiveTrackingMap drivers={drivers} />}

      {/* Task tabs */}
      <div className="glass rounded-xl">
        <div className="flex border-b border-border">
          <button
            onClick={() => setActiveTab('interventions')}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              activeTab === 'interventions'
                ? 'text-primary border-b-2 border-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t('dashboard.interventions')}
          </button>
          <button
            onClick={() => setActiveTab('deliveries')}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              activeTab === 'deliveries'
                ? 'text-primary border-b-2 border-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t('dashboard.deliveries')}
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-start p-3 text-muted-foreground font-medium">{t('dashboard.status')}</th>
                <th className="text-start p-3 text-muted-foreground font-medium">{t('dashboard.client')}</th>
                <th className="text-start p-3 text-muted-foreground font-medium hidden md:table-cell">{t('dashboard.createdBy')}</th>
                <th className="text-start p-3 text-muted-foreground font-medium hidden md:table-cell">{t('dashboard.assignedTo')}</th>
                <th className="text-start p-3 text-muted-foreground font-medium">{t('dashboard.priority')}</th>
                <th className="text-start p-3 text-muted-foreground font-medium w-20">{t('dashboard.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {displayedTasks.map(task => {
                const creator = getUserById(task.created_by);
                const assignee = getUserById(task.assigned_to);
                const isExpanded = expandedTask === task.id;
                return (
                  <React.Fragment key={task.id}>
                    <motion.tr
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="border-b border-border/50 hover:bg-accent/50 transition-colors cursor-pointer"
                      onClick={() => setExpandedTask(isExpanded ? null : task.id)}
                    >
                      <td className="p-3"><StatusBadge status={task.status} /></td>
                      <td className="p-3">
                        <p className="font-medium text-foreground">{task.client_name}</p>
                        <p className="text-xs text-muted-foreground">{task.address.slice(0, 30)}...</p>
                      </td>
                      <td className="p-3 hidden md:table-cell text-muted-foreground">
                        {creator?.first_name} {creator?.last_name}
                      </td>
                      <td className="p-3 hidden md:table-cell text-muted-foreground">
                        {assignee?.first_name} {assignee?.last_name}
                      </td>
                      <td className="p-3"><PriorityBadge priority={task.priority} /></td>
                      <td className="p-3">
                        <div className="flex items-center gap-1">
                          <button onClick={(e) => { e.stopPropagation(); openEdit(task); }} className="p-1.5 rounded-lg hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors">
                            <Edit className="h-4 w-4" />
                          </button>
                          {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                        </div>
                      </td>
                    </motion.tr>
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.tr key={`${task.id}-details`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                          <td colSpan={6} className="p-4 bg-accent/30">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                              <div className="space-y-2">
                                <p className="flex items-center gap-1.5 text-muted-foreground"><Phone className="h-3.5 w-3.5" /> {task.client_phone}</p>
                                <p className="flex items-center gap-1.5 text-muted-foreground"><MapPin className="h-3.5 w-3.5" /> {task.address}</p>
                                {task.problem_details && <p className="text-muted-foreground">🔧 {task.problem_details}</p>}
                                {task.invoice_number && <p className="text-muted-foreground">📄 {task.invoice_number}</p>}
                                {task.payment_details && <p className="text-muted-foreground">💳 {task.payment_details}</p>}
                              </div>
                              <div className="space-y-2">
                                {task.due_date && <p className="text-muted-foreground">📅 {new Date(task.due_date).toLocaleDateString(dateLocale)}</p>}
                                {task.comment && <p className="text-destructive">💬 {task.comment}</p>}
                                <p className="text-muted-foreground text-xs">{t('dashboard.createdOn')} {new Date(task.created_at).toLocaleDateString(dateLocale, { day: 'numeric', month: 'long', year: 'numeric' })}</p>
                                {task.edited && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-accent text-muted-foreground border border-border">✏️ {t('common.modified')}</span>}
                              </div>
                            </div>
                            <div className="mt-3">
                              <Button size="sm" variant="outline" onClick={() => openEdit(task)}>
                                <Edit className="h-3.5 w-3.5 me-1" /> {t('dashboard.edit')}
                              </Button>
                            </div>
                          </td>
                        </motion.tr>
                      )}
                    </AnimatePresence>
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
          {displayedTasks.length === 0 && (
            <div className="p-8 text-center text-muted-foreground">
              {t('dashboard.emptyState')}
            </div>
          )}
        </div>
      </div>

      {/* Users section */}
      <div className="glass rounded-xl p-4">
        <h2 className="font-semibold text-foreground mb-3 flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" />
          {t('dashboard.users')}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {users.filter(u => u.is_active).map(u => {
            const rc = ROLE_CONFIG[u.role];
            return (
              <div key={u.id} className="flex items-center gap-3 p-3 rounded-lg bg-accent/50">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">
                  {u.first_name[0]}{u.last_name[0]}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-foreground text-sm">{u.first_name} {u.last_name}</p>
                  <span className="text-xs" style={{ color: `hsl(var(--${rc.color}))` }}>
                    {rc.emoji} {t(`role.${u.role}`)}
                  </span>
                </div>
                <div className={`h-2.5 w-2.5 rounded-full ${u.is_active ? 'bg-status-done' : 'bg-muted-foreground'}`} />
              </div>
            );
          })}
        </div>
      </div>

      {/* Edit Task Dialog */}
      <Dialog open={!!editTask} onOpenChange={v => { if (!v) setEditTask(null); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('dashboard.editTask')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium text-foreground">{t('form.status')}</label>
              <Select value={editData.status} onValueChange={v => setEditData(p => ({ ...p, status: v as TaskStatus }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(['pending', 'doing', 'done', 'refused'] as TaskStatus[]).map(s => (
                    <SelectItem key={s} value={s}>{STATUS_CONFIG[s].emoji} {t(`status.${s}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">{t('form.assignedTo')}</label>
              <Select value={editData.assigned_to} onValueChange={v => setEditData(p => ({ ...p, assigned_to: v }))}>
                <SelectTrigger><SelectValue placeholder={t('form.select')} /></SelectTrigger>
                <SelectContent>
                  {(editTask?.type === 'technical_intervention' ? technicians : drivers).map(u => (
                    <SelectItem key={u.id} value={u.id}>{u.first_name} {u.last_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">{t('form.clientName')}</label>
              <Input value={editData.client_name} onChange={e => setEditData(p => ({ ...p, client_name: e.target.value }))} />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">{t('form.clientPhone')}</label>
              <Input value={editData.client_phone} onChange={e => setEditData(p => ({ ...p, client_phone: e.target.value }))} />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">{t('form.address')}</label>
              <Input value={editData.address} onChange={e => setEditData(p => ({ ...p, address: e.target.value }))} />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">{t('form.priority')}</label>
              <div className="flex gap-2 mt-1">
                {(['low', 'medium', 'high', 'urgent'] as Priority[]).map(p => (
                  <button
                    key={p}
                    onClick={() => setEditData(prev => ({ ...prev, priority: p }))}
                    className={`flex-1 py-2 text-xs font-medium rounded-lg border transition-all ${
                      editData.priority === p ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'
                    }`}
                  >
                    {t(`priority.${p}`)}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">{t('form.dueDate')}</label>
              <Input type="date" value={editData.due_date} onChange={e => setEditData(p => ({ ...p, due_date: e.target.value }))} />
            </div>
            {editTask?.type === 'technical_intervention' && (
              <div>
                <label className="text-sm font-medium text-foreground">{t('form.problemDetails')}</label>
                <Textarea value={editData.problem_details} onChange={e => setEditData(p => ({ ...p, problem_details: e.target.value }))} />
              </div>
            )}
            {editTask?.type === 'delivery' && (
              <>
                <div>
                  <label className="text-sm font-medium text-foreground">{t('form.invoiceNumber')}</label>
                  <Input value={editData.invoice_number} onChange={e => setEditData(p => ({ ...p, invoice_number: e.target.value }))} />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground">{t('form.paymentDetails')}</label>
                  <Textarea value={editData.payment_details} onChange={e => setEditData(p => ({ ...p, payment_details: e.target.value }))} />
                </div>
              </>
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setEditTask(null)} className="flex-1">{t('form.cancel')}</Button>
              <Button onClick={handleEdit} disabled={!editData.client_name || !editData.address} className="flex-1">{t('form.save')}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
