import { useState } from 'react';
import { useAuth } from '@/tasks/contexts/AuthAdapter';
import { useData } from '@/tasks/contexts/DataContext';
import { useLanguage } from '@/tasks/contexts/LanguageContext';
import { Task as TaskT } from '@/tasks/types';
import { Task, TaskType, Priority, ROLE_CONFIG } from '@/tasks/types';
import { StatusBadge, PriorityBadge } from '@/tasks/components/StatusBadge';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Wrench, Truck, Phone, MapPin, Trash2, Edit, X, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import confetti from 'canvas-confetti';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { isOverdue } from '@/tasks/lib/taskUtils';
import CreateTaskDialog from '@/tasks/components/CreateTaskDialog';

const container = { hidden: {}, show: { transition: { staggerChildren: 0.05 } } };
const item = { hidden: { opacity: 0, y: 20 }, show: { opacity: 1, y: 0 } };

export default function SalesTasks() {
  const { user } = useAuth();
  const { tasks, addTask, deleteTask, updateTask, users, getUserById } = useData();
  const { t, language } = useLanguage();
  const [activeTab, setActiveTab] = useState<'interventions' | 'deliveries'>('interventions');
  const [showCreate, setShowCreate] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [editTask, setEditTask] = useState<TaskT | null>(null);
  const [editData, setEditData] = useState({ client_name: '', client_phone: '', address: '', priority: 'medium' as Priority, problem_details: '', invoice_number: '', payment_details: '', due_date: '', assigned_to: '' });
  const [expandedTask, setExpandedTask] = useState<string | null>(null);

  const dateLocale = language === 'ar' ? 'ar-MA' : 'fr-FR';
  const isSuperAdmin = user?.role === 'super_admin';
  const myTasks = isSuperAdmin ? tasks : tasks.filter(t => t.created_by === user?.id);
  const interventions = myTasks.filter(t => t.type === 'technical_intervention' && t.status !== 'done');
  const deliveries = myTasks.filter(t => t.type === 'delivery' && t.status !== 'done');
  const displayed = activeTab === 'interventions' ? interventions : deliveries;

  const technicians = users.filter(u => u.role === 'technician' && u.is_active);
  const drivers = users.filter(u => u.role === 'driver' && u.is_active);

  const handleDelete = (id: string) => {
    deleteTask(id);
    setDeleteConfirm(null);
    toast.success(t('salesTasks.taskDeleted'));
  };

  const openEdit = (task: TaskT) => {
    setEditTask(task);
    setEditData({
      client_name: task.client_name, client_phone: task.client_phone, address: task.address,
      priority: task.priority, problem_details: task.problem_details || '',
      invoice_number: task.invoice_number || '', payment_details: task.payment_details || '',
      due_date: task.due_date || '', assigned_to: task.assigned_to,
    });
  };

  const handleEdit = () => {
    if (!editTask) return;
    updateTask(editTask.id, { ...editData, edited: true });
    setEditTask(null);
    toast.success(t('salesTasks.taskEdited'));
  };

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground">
            {isSuperAdmin ? t('salesTasks.allTasks') : t('nav.myTasks')}
          </h1>
          <p className="text-sm text-muted-foreground flex items-center gap-1">
            {ROLE_CONFIG[user?.role || 'sales'].emoji} {t(`role.${user?.role || 'sales'}`)}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex bg-secondary rounded-lg p-1">
        <button
          onClick={() => setActiveTab('interventions')}
          className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
            activeTab === 'interventions' ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground'
          }`}
        >
          {t('salesTasks.interventions')} ({interventions.length})
        </button>
        <button
          onClick={() => setActiveTab('deliveries')}
          className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
            activeTab === 'deliveries' ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground'
          }`}
        >
          {t('salesTasks.deliveries')} ({deliveries.length})
        </button>
      </div>

      {/* Task Cards */}
      <motion.div variants={container} initial="hidden" animate="show" className="space-y-3">
        <AnimatePresence>
          {displayed.map(task => {
            const assignee = getUserById(task.assigned_to);
            return (
              <motion.div
                key={task.id}
                variants={item}
                layout
                exit={{ opacity: 0, x: -100 }}
                className="glass rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-foreground">{task.client_name}</p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                      <MapPin className="h-3 w-3" />
                      {task.address}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 ms-2">
                    {(task.created_by === user?.id || isSuperAdmin) && (
                      <button
                        onClick={() => openEdit(task)}
                        className="p-1.5 rounded-lg hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"
                      >
                        <Edit className="h-4 w-4" />
                      </button>
                    )}
                    <button
                      onClick={() => setDeleteConfirm(task.id)}
                      className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <StatusBadge status={task.status} />
                  <PriorityBadge priority={task.priority} />
                  {isOverdue(task) && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-status-refused-light text-status-refused">
                      ⏰ {t('dashboard.overdue')}
                    </span>
                  )}
                  {task.edited && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-secondary text-muted-foreground border border-border">
                      ✏️ {t('common.modified')}
                    </span>
                  )}
                  {task.invoice_number && (
                    <span className="text-xs bg-secondary px-2 py-0.5 rounded-full text-muted-foreground">
                      {task.invoice_number}
                    </span>
                  )}
                </div>

                {expandedTask === task.id && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} className="mt-3 pt-3 border-t border-border/50 space-y-2">
                    {task.problem_details && <p className="text-xs text-muted-foreground">🔧 {task.problem_details}</p>}
                    {task.invoice_number && <p className="text-xs text-muted-foreground">📄 {task.invoice_number}</p>}
                    {task.payment_details && <p className="text-xs text-muted-foreground">💳 {task.payment_details}</p>}
                    {task.due_date && <p className="text-xs text-muted-foreground">📅 {new Date(task.due_date).toLocaleDateString(dateLocale)}</p>}
                    {task.comment && <p className="text-xs text-destructive">💬 {task.comment}</p>}
                    <div className="flex gap-1.5 flex-wrap">
                      <button onClick={() => window.open(`tel:${task.client_phone}`)} className="flex items-center gap-1 px-2 py-1 bg-status-done-light text-status-done rounded-lg text-xs font-medium">
                        <Phone className="h-3 w-3" /> {task.client_phone}
                      </button>
                    </div>
                  </motion.div>
                )}

                <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/50">
                  <div className="flex items-center gap-2">
                    <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                      {assignee?.first_name[0]}{assignee?.last_name[0]}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {assignee?.first_name} {assignee?.last_name}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setExpandedTask(expandedTask === task.id ? null : task.id)} className="text-xs text-primary font-medium">
                      {expandedTask === task.id ? t('myTasks.collapse') : t('myTasks.details')}
                    </button>
                    <span className="text-xs text-muted-foreground">
                      {new Date(task.created_at).toLocaleDateString(dateLocale, { day: 'numeric', month: 'short' })}
                    </span>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>

        {displayed.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <p className="text-4xl mb-2">🏖️</p>
            <p>{t('salesTasks.emptyState')}</p>
          </div>
        )}
      </motion.div>

      {/* FAB */}
      <motion.button
        onClick={() => setShowCreate(true)}
        className="fixed bottom-24 md:bottom-8 end-4 md:end-8 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center z-20"
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
        animate={{ boxShadow: ['0 0 0 0 hsl(var(--primary) / 0.4)', '0 0 0 12px hsl(var(--primary) / 0)', '0 0 0 0 hsl(var(--primary) / 0)'] }}
        transition={{ duration: 2, repeat: Infinity }}
      >
        <Plus className="h-6 w-6" />
      </motion.button>

      {/* Create Dialog */}
      <CreateTaskDialog open={showCreate} onOpenChange={setShowCreate} />

      {/* Delete Confirm Dialog */}
      <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-destructive">{t('salesTasks.deleteTitle')}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t('salesTasks.deleteConfirm')}
          </p>
          <div className="flex gap-2 mt-4">
            <Button variant="outline" onClick={() => setDeleteConfirm(null)} className="flex-1">{t('form.cancel')}</Button>
            <Button variant="destructive" onClick={() => deleteConfirm && handleDelete(deleteConfirm)} className="flex-1">{t('salesTasks.delete')}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editTask} onOpenChange={v => { if (!v) setEditTask(null); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('dashboard.editTask')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
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
