import { useState, useMemo } from 'react';
import { useAuth } from '@/tasks/contexts/AuthAdapter';
import { useData } from '@/tasks/contexts/DataContext';
import { useLanguage } from '@/tasks/contexts/LanguageContext';
import { StatusBadge, PriorityBadge } from '@/tasks/components/StatusBadge';
import { Search, Download, FileText, MessageSquare } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { TaskTypeIcon } from '@/tasks/components/TaskBoard';
import TasksHeaderActions from '@/tasks/components/TasksHeader';
import { Input } from '@/components/ui/input';

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
    <div className="mx-auto max-w-[1600px] space-y-4">
      <PageHeader
        title={t('archive.title')}
        subtitle={String(archived.length)}
        actions={(
          <>
            <TasksHeaderActions />
            <button type="button" onClick={exportCSV} className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground hover:bg-secondary transition-colors">
              <Download className="h-4 w-4" aria-hidden="true" /> CSV
            </button>
          </>
        )}
      />

      <div className="relative max-w-xl">
        <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('archive.search')} className="ps-10" />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {archived.map(task => {
          const creator = getUserById(task.created_by);
          const assignee = getUserById(task.assigned_to);
          return (
            <div key={task.id} className="rounded-xl border border-border bg-card p-4 shadow-sm">
              <div className="flex items-start gap-3 mb-2">
                <TaskTypeIcon type={task.type} />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-foreground truncate">{task.client_name}</p>
                  <p className="text-xs text-muted-foreground">{task.address}</p>
                </div>
                <StatusBadge status={task.status} label={t(`status.${task.status}`)} />
              </div>
              <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                <PriorityBadge priority={task.priority} />
                {task.invoice_number && <span className="flex items-center gap-1"><FileText className="h-3 w-3" aria-hidden="true" />{task.invoice_number}</span>}
                {creator?.first_name && <span>{t('archive.createdBy')} {creator.first_name}</span>}
                {assignee?.first_name && <span>· {t('archive.assignedToShort')} {assignee.first_name}</span>}
                <span>· {new Date(task.updated_at).toLocaleDateString(dateLocale)}</span>
              </div>
              {task.comment && <p className="mt-2 flex items-center gap-1.5 text-xs text-destructive"><MessageSquare className="h-3 w-3" aria-hidden="true" />{task.comment}</p>}
            </div>
          );
        })}
      </div>

      {archived.length === 0 && (
        <p className="rounded-xl border border-dashed border-border px-4 py-12 text-center text-sm text-muted-foreground">{t('archive.noResults')}</p>
      )}
    </div>
  );
}
