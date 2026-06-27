import { useState, useMemo } from 'react';
import { useAuth } from '@/tasks/contexts/AuthAdapter';
import { useData } from '@/tasks/contexts/DataContext';
import { useLanguage } from '@/tasks/contexts/LanguageContext';
import { StatusBadge, PriorityBadge } from '@/tasks/components/StatusBadge';
import { motion } from 'framer-motion';
import { Search, Archive as ArchiveIcon, Download } from 'lucide-react';
import { Input } from '@/components/ui/input';

const container = { hidden: {}, show: { transition: { staggerChildren: 0.03 } } };
const item = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } };

export default function ArchivePage() {
  const { user } = useAuth();
  const { tasks, getUserById } = useData();
  const { t, language } = useLanguage();
  const [search, setSearch] = useState('');

  const dateLocale = language === 'ar' ? 'ar-MA' : 'fr-FR';

  const archived = useMemo(() => {
    let list = tasks.filter(t => t.status === 'done' || t.status === 'refused');
    if (user?.role === 'sales') list = list.filter(t => t.created_by === user.id);
    if (user?.role === 'technician' || user?.role === 'driver') list = list.filter(t => t.assigned_to === user.id);
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(t => t.client_name.toLowerCase().includes(s) || t.invoice_number?.toLowerCase().includes(s));
    }
    return list.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  }, [tasks, user, search]);

  const exportCSV = () => {
    const headers = 'Client,Type,Statut,Priorité,Adresse,Facture,Date\n';
    const rows = archived.map(t =>
      `"${t.client_name}","${t.type}","${t.status}","${t.priority}","${t.address}","${t.invoice_number || ''}","${t.updated_at}"`
    ).join('\n');
    const blob = new Blob([headers + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'archive_taskflow.csv'; a.click();
  };

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl md:text-2xl font-bold text-foreground flex items-center gap-2">
          <ArchiveIcon className="h-6 w-6 text-primary" /> {t('archive.title')}
        </h1>
        <button onClick={exportCSV} className="flex items-center gap-1.5 px-3 py-2 bg-accent rounded-lg text-sm font-medium text-foreground hover:bg-accent/80 transition-colors">
          <Download className="h-4 w-4" /> CSV
        </button>
      </div>

      <div className="relative">
        <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('archive.search')} className="ps-10" />
      </div>

      <motion.div variants={container} initial="hidden" animate="show" className="space-y-3">
        {archived.map(task => {
          const creator = getUserById(task.created_by);
          const assignee = getUserById(task.assigned_to);
          return (
            <motion.div key={task.id} variants={item} className="bg-card rounded-xl border border-border p-4 shadow-sm">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <p className="font-semibold text-foreground">{task.client_name}</p>
                  <p className="text-xs text-muted-foreground">{task.address}</p>
                </div>
                <StatusBadge status={task.status} />
              </div>
              <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                <PriorityBadge priority={task.priority} />
                <span>{task.type === 'technical_intervention' ? '🔧' : '🚚'}</span>
                {task.invoice_number && <span>📄 {task.invoice_number}</span>}
                <span>{t('archive.createdBy')} {creator?.first_name}</span>
                <span>• {t('archive.assignedToShort')} {assignee?.first_name}</span>
                <span>• {new Date(task.updated_at).toLocaleDateString(dateLocale)}</span>
              </div>
              {task.comment && <p className="text-xs text-destructive mt-2">💬 {task.comment}</p>}
            </motion.div>
          );
        })}
      </motion.div>

      {archived.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <p className="text-4xl mb-2">🔍</p>
          <p>{t('archive.noResults')}</p>
        </div>
      )}
    </div>
  );
}
