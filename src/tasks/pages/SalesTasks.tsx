import { useState } from 'react';
import { useAuth } from '@/tasks/contexts/AuthAdapter';
import { useData } from '@/tasks/contexts/DataContext';
import { useLanguage } from '@/tasks/contexts/LanguageContext';
import { Task as TaskT } from '@/tasks/types';
import { Priority } from '@/tasks/types';
import { Plus, Wrench, Truck, Phone, Trash2, Edit } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { TaskBoard, TaskCard } from '@/tasks/components/TaskBoard';
import TasksHeaderActions from '@/tasks/components/TasksHeader';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import CreateTaskDialog from '@/tasks/components/CreateTaskDialog';

export default function SalesTasks() {
  const { user } = useAuth();
  const { tasks, addTask, deleteTask, updateTask, users, getUserById } = useData();
  const { t, language } = useLanguage();
  const [activeTab, setActiveTab] = useState<'all' | 'interventions' | 'deliveries'>('all');
  const [showCreate, setShowCreate] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [editTask, setEditTask] = useState<TaskT | null>(null);
  const [editData, setEditData] = useState({ client_name: '', client_phone: '', address: '', priority: 'medium' as Priority, problem_details: '', invoice_number: '', payment_details: '', due_date: '', assigned_to: '' });
  const [expandedTask, setExpandedTask] = useState<string | null>(null);

  const dateLocale = language === 'ar' ? 'ar-MA' : 'fr-FR';
  const isSuperAdmin = user?.role === 'super_admin';
  const myTasks = isSuperAdmin ? tasks : tasks.filter(t => t.created_by === user?.id);
  // The board keeps finished and refused tasks for a week; older ones are in the archive.
  const weekAgo = Date.now() - 7 * 864e5;
  const boardTasks = myTasks.filter(task =>
    (task.status !== 'done' && task.status !== 'refused') || new Date(task.updated_at || task.created_at).getTime() >= weekAgo);
  const interventions = boardTasks.filter(t => t.type === 'technical_intervention');
  const deliveries = boardTasks.filter(t => t.type === 'delivery');
  const displayed = activeTab === 'interventions' ? interventions : activeTab === 'deliveries' ? deliveries : boardTasks;

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

  const typeTabs = [
    { id: 'all' as const, label: t('board.all'), count: boardTasks.length },
    { id: 'interventions' as const, label: t('salesTasks.interventions'), count: interventions.length },
    { id: 'deliveries' as const, label: t('salesTasks.deliveries'), count: deliveries.length },
  ];

  return (
    <div className="mx-auto max-w-[1600px]">
      <PageHeader
        title={isSuperAdmin ? t('salesTasks.allTasks') : t('nav.myTasks')}
        subtitle={t(`role.${user?.role || 'sales'}`)}
        actions={(
          <>
            <TasksHeaderActions />
            <Button onClick={() => setShowCreate(true)} className="h-9 gap-1.5">
              <Plus className="h-4 w-4" aria-hidden="true" />{t('dashboard.newTask')}
            </Button>
          </>
        )}
      >
        <div role="tablist" aria-label={t('salesTasks.type')} className="inline-flex max-w-full overflow-x-auto rounded-lg bg-secondary p-1">
          {typeTabs.map(tab => (
            <button key={tab.id} type="button" role="tab" aria-selected={activeTab === tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex h-9 shrink-0 items-center gap-1.5 rounded-md px-3.5 text-sm font-medium transition-colors ${activeTab === tab.id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
              {tab.id === 'interventions' && <Wrench className="h-4 w-4" aria-hidden="true" />}
              {tab.id === 'deliveries' && <Truck className="h-4 w-4" aria-hidden="true" />}
              {tab.label} <span className="tabular-nums opacity-70">{tab.count}</span>
            </button>
          ))}
        </div>
      </PageHeader>

      <TaskBoard
        tasks={displayed}
        emptyLabel={t('salesTasks.emptyState')}
        renderTask={task => {
          const canEdit = task.created_by === user?.id || isSuperAdmin;
          const open = expandedTask === task.id;
          return (
            <TaskCard
              task={task}
              assignee={getUserById(task.assigned_to)}
              onOpen={canEdit ? () => openEdit(task) : undefined}
              actions={(
                <>
                  <button type="button" onClick={() => setExpandedTask(open ? null : task.id)} aria-expanded={open}
                    className="h-8 rounded-md px-2 text-xs font-semibold text-primary hover:bg-primary/10">
                    {open ? t('myTasks.collapse') : t('myTasks.details')}
                  </button>
                  {canEdit && (
                    <button type="button" onClick={() => openEdit(task)} aria-label={t('dashboard.editTask')} title={t('dashboard.editTask')}
                      className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary">
                      <Edit className="h-4 w-4" />
                    </button>
                  )}
                  <button type="button" onClick={() => setDeleteConfirm(task.id)} aria-label={t('salesTasks.delete')} title={t('salesTasks.delete')}
                    className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </>
              )}
            >
              {open && (
                <>
                  {task.problem_details && <p className="text-muted-foreground">{task.problem_details}</p>}
                  {task.payment_details && <p className="text-muted-foreground">{t('form.paymentDetails')} : {task.payment_details}</p>}
                  {task.comment && <p className="text-destructive">{task.comment}</p>}
                  {task.client_phone && (
                    <a href={`tel:${task.client_phone}`} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-status-done-light px-3 text-sm font-medium text-status-done">
                      <Phone className="h-4 w-4" aria-hidden="true" />{task.client_phone}
                    </a>
                  )}
                  <p className="text-xs text-muted-foreground">{new Date(task.created_at).toLocaleDateString(dateLocale, { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                </>
              )}
            </TaskCard>
          );
        }}
      />

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
