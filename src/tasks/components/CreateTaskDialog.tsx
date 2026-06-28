import { useState } from 'react';
import { useAuth } from '@/tasks/contexts/AuthAdapter';
import { useData } from '@/tasks/contexts/DataContext';
import { useLanguage } from '@/tasks/contexts/LanguageContext';
import { Task, TaskType, Priority } from '@/tasks/types';
import { PriorityBadge } from '@/tasks/components/StatusBadge';
import { motion, AnimatePresence } from 'framer-motion';
import { Wrench, Truck, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import confetti from 'canvas-confetti';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

const BLANK = {
  client_name: '', client_phone: '', address: '', priority: 'medium' as Priority,
  problem_details: '', invoice_number: '', payment_details: '', assigned_to: '', due_date: '',
};

// Shared "Nouvelle tâche" wizard used by both the Tasks list and the dashboard.
export default function CreateTaskDialog({ open, onOpenChange }: Props) {
  const { user } = useAuth();
  const { addTask, getUserById, users } = useData();
  const { t } = useLanguage();

  const [step, setStep] = useState(0);
  const [type, setType] = useState<TaskType | null>(null);
  const [form, setForm] = useState(BLANK);

  const technicians = users.filter(u => u.role === 'technician' && u.is_active);
  const drivers = users.filter(u => u.role === 'driver' && u.is_active);

  const reset = () => { setStep(0); setType(null); setForm(BLANK); };
  const close = () => { onOpenChange(false); reset(); };

  const handleCreate = () => {
    if (!type || !user) return;
    const now = new Date().toISOString();
    const newTask: Task = {
      id: crypto.randomUUID(),
      type,
      status: 'pending',
      client_name: form.client_name,
      client_phone: form.client_phone,
      address: form.address,
      priority: form.priority,
      problem_details: type === 'technical_intervention' ? form.problem_details : undefined,
      invoice_number: type === 'delivery' ? form.invoice_number : undefined,
      payment_details: type === 'delivery' ? form.payment_details : undefined,
      created_by: user.id,
      assigned_to: form.assigned_to,
      due_date: form.due_date || undefined,
      created_at: now,
      updated_at: now,
    };
    addTask(newTask);
    confetti({ particleCount: 70, spread: 60, origin: { y: 0.7 } });
    toast.success(t('salesTasks.taskCreated'));
    close();
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) close(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {step === 0 && t('salesTasks.newTask')}
            {step === 1 && (type === 'technical_intervention' ? t('salesTasks.intervention') : t('salesTasks.delivery'))}
            {step === 2 && t('salesTasks.assignTask')}
            {step === 3 && t('salesTasks.summary')}
          </DialogTitle>
        </DialogHeader>

        <AnimatePresence mode="wait">
          {step === 0 && (
            <motion.div key="step0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="grid grid-cols-2 gap-3 py-4">
              <button
                onClick={() => { setType('technical_intervention'); setStep(1); }}
                className="flex flex-col items-center gap-3 p-6 rounded-xl border-2 border-border hover:border-role-technician hover:bg-role-technician-light transition-all"
              >
                <Wrench className="h-10 w-10 text-role-technician" />
                <span className="font-medium text-sm text-foreground">{t('salesTasks.intervention')}</span>
              </button>
              <button
                onClick={() => { setType('delivery'); setStep(1); }}
                className="flex flex-col items-center gap-3 p-6 rounded-xl border-2 border-border hover:border-role-driver hover:bg-role-driver-light transition-all"
              >
                <Truck className="h-10 w-10 text-role-driver" />
                <span className="font-medium text-sm text-foreground">{t('salesTasks.delivery')}</span>
              </button>
            </motion.div>
          )}

          {step === 1 && (
            <motion.div key="step1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4 py-4">
              <div>
                <label className="text-sm font-medium text-foreground">{t('form.clientName')}</label>
                <Input value={form.client_name} onChange={e => setForm(p => ({ ...p, client_name: e.target.value }))} placeholder="Ex: Mohammed Ait Brahim" />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground">{t('form.clientPhone')}</label>
                <Input value={form.client_phone} onChange={e => setForm(p => ({ ...p, client_phone: e.target.value }))} placeholder="0612345678" />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground">{t('form.address')}</label>
                <Input value={form.address} onChange={e => setForm(p => ({ ...p, address: e.target.value }))} placeholder="45 Rue Ibn Batouta, Casablanca" />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground">{t('form.priority')}</label>
                <div className="flex gap-2 mt-1">
                  {(['low', 'medium', 'high', 'urgent'] as Priority[]).map(p => (
                    <button
                      key={p}
                      onClick={() => setForm(prev => ({ ...prev, priority: p }))}
                      className={`flex-1 py-2 text-xs font-medium rounded-lg border transition-all ${
                        form.priority === p ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'
                      }`}
                    >
                      {t(`priority.${p}`)}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-foreground">{t('form.dueDate')}</label>
                <Input type="date" value={form.due_date} onChange={e => setForm(p => ({ ...p, due_date: e.target.value }))} />
              </div>
              {type === 'technical_intervention' && (
                <div>
                  <label className="text-sm font-medium text-foreground">{t('form.problemDetails')}</label>
                  <Textarea value={form.problem_details} onChange={e => setForm(p => ({ ...p, problem_details: e.target.value }))} placeholder={t('salesTasks.describeProblem')} />
                </div>
              )}
              {type === 'delivery' && (
                <>
                  <div>
                    <label className="text-sm font-medium text-foreground">{t('form.invoiceNumber')}</label>
                    <Input value={form.invoice_number} onChange={e => setForm(p => ({ ...p, invoice_number: e.target.value }))} placeholder="FAC-2024-XXXX" />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-foreground">{t('form.paymentDetails')}</label>
                    <Textarea value={form.payment_details} onChange={e => setForm(p => ({ ...p, payment_details: e.target.value }))} placeholder={t('salesTasks.paymentMode')} />
                  </div>
                </>
              )}
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setStep(0)} className="flex-1">{t('salesTasks.back')}</Button>
                <Button onClick={() => setStep(2)} disabled={!form.client_name || !form.address} className="flex-1">
                  {t('salesTasks.next')} <ChevronRight className="h-4 w-4 ms-1" />
                </Button>
              </div>
            </motion.div>
          )}

          {step === 2 && (
            <motion.div key="step2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-3 py-4">
              <p className="text-sm text-muted-foreground mb-2">
                {t('salesTasks.selectWorker', { role: type === 'technical_intervention' ? t('salesTasks.technician') : t('salesTasks.driver') })}
              </p>
              {(type === 'technical_intervention' ? technicians : drivers).map(u => (
                <button
                  key={u.id}
                  onClick={() => setForm(p => ({ ...p, assigned_to: u.id }))}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 transition-all ${
                    form.assigned_to === u.id ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/30'
                  }`}
                >
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">
                    {u.first_name[0]}{u.last_name[0]}
                  </div>
                  <div className="text-start">
                    <p className="font-medium text-sm text-foreground">{u.first_name} {u.last_name}</p>
                    <p className="text-xs text-muted-foreground">{u.phone}</p>
                  </div>
                </button>
              ))}
              {(type === 'technical_intervention' ? technicians : drivers).length === 0 && (
                <p className="text-center text-sm text-muted-foreground py-4">{t('salesTasks.noWorker')}</p>
              )}
              <div className="flex gap-2 mt-4">
                <Button variant="outline" onClick={() => setStep(1)} className="flex-1">{t('salesTasks.back')}</Button>
                <Button onClick={() => setStep(3)} disabled={!form.assigned_to} className="flex-1">
                  {t('salesTasks.next')} <ChevronRight className="h-4 w-4 ms-1" />
                </Button>
              </div>
            </motion.div>
          )}

          {step === 3 && (
            <motion.div key="step3" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="py-4">
              <div className="bg-secondary rounded-xl p-4 space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">{t('salesTasks.type')}</span><span className="font-medium text-foreground">{type === 'technical_intervention' ? t('salesTasks.intervention') : t('salesTasks.delivery')}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">{t('dashboard.client')}</span><span className="font-medium text-foreground">{form.client_name}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">{t('form.address')}</span><span className="font-medium text-foreground text-end max-w-[200px]">{form.address}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">{t('form.priority')}</span><PriorityBadge priority={form.priority} /></div>
                <div className="flex justify-between"><span className="text-muted-foreground">{t('form.assignedTo')}</span><span className="font-medium text-foreground">{getUserById(form.assigned_to)?.first_name} {getUserById(form.assigned_to)?.last_name}</span></div>
              </div>
              <div className="flex gap-2 mt-4">
                <Button variant="outline" onClick={() => setStep(2)} className="flex-1">{t('salesTasks.back')}</Button>
                <Button onClick={handleCreate} className="flex-1">{t('salesTasks.createTask')}</Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}
