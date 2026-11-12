import { useState } from 'react';
import { useAuth } from '@/tasks/contexts/AuthAdapter';
import { useData } from '@/tasks/contexts/DataContext';
import { useLanguage } from '@/tasks/contexts/LanguageContext';
import { Contact } from '@/tasks/types';
import { PageHeader } from '@/components/PageHeader';
import TasksHeaderActions from '@/tasks/components/TasksHeader';
import { Search, Plus, Phone, MessageCircle, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';

const ROLE_LABEL_KEYS = [
  { key: 'contactLabel.client', value: 'Client' },
  { key: 'contactLabel.clientVip', value: 'Client VIP' },
  { key: 'contactLabel.supplier', value: 'Fournisseur' },
  { key: 'contactLabel.partner', value: 'Partenaire' },
  { key: 'contactLabel.externalDriver', value: 'Livreur externe' },
];

export default function ContactsPage() {
  const { user } = useAuth();
  const { contacts, addContact, deleteContact } = useData();
  const { t } = useLanguage();
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', role_label: 'Client' });
  const [filter, setFilter] = useState('');

  const filtered = contacts.filter(c => {
    const s = search.toLowerCase();
    const matchSearch = !search || c.name.toLowerCase().includes(s) || c.phone.includes(s);
    const matchFilter = !filter || c.role_label === filter;
    return matchSearch && matchFilter;
  }).sort((a, b) => a.name.localeCompare(b.name));

  const uniqueLabels = [...new Set(contacts.map(c => c.role_label))];

  const handleAdd = () => {
    if (!form.name || !form.phone || !user) return;
    const newContact: Contact = {
      id: `c${Date.now()}`,
      name: form.name,
      phone: form.phone,
      role_label: form.role_label,
      created_by: user.id,
      created_at: new Date().toISOString(),
    };
    addContact(newContact);
    setShowAdd(false);
    setForm({ name: '', phone: '', role_label: 'Client' });
    toast.success(t('contacts.added'));
  };

  return (
    <div className="mx-auto max-w-[1600px] space-y-4">
      <PageHeader
        title={t('contacts.title')}
        subtitle={`${filtered.length} / ${contacts.length}`}
        actions={(
          <>
            <TasksHeaderActions />
            <Button onClick={() => setShowAdd(true)} className="h-9 gap-1.5">
              <Plus className="h-4 w-4" aria-hidden="true" /> {t('contacts.add')}
            </Button>
          </>
        )}
      />

      <div className="relative max-w-xl">
        <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('contacts.search')} className="ps-10" />
      </div>

      <div className="flex gap-2 flex-wrap">
        <button onClick={() => setFilter('')} aria-pressed={!filter} className={`h-9 px-3.5 text-sm rounded-full font-medium transition-colors ${!filter ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}>{t('contacts.all')}</button>
        {uniqueLabels.map(label => (
          <button key={label} onClick={() => setFilter(filter === label ? '' : label)} aria-pressed={filter === label} className={`h-9 px-3.5 text-sm rounded-full font-medium transition-colors ${filter === label ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}>{label}</button>
        ))}
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {filtered.map(contact => (
          <div key={contact.id} className="rounded-xl border border-border bg-card p-3.5 shadow-sm flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary flex-shrink-0">
              {contact.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-foreground text-sm">{contact.name}</p>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <p className="text-xs text-muted-foreground">{contact.phone}</p>
                <span className="text-xs bg-secondary px-2 py-0.5 rounded-full text-muted-foreground">{contact.role_label}</span>
              </div>
            </div>
            <div className="flex gap-1">
              <button type="button" onClick={() => window.open(`tel:${contact.phone}`)} aria-label={`${t('myTasks.call')} ${contact.name}`} className="flex h-10 w-10 items-center justify-center rounded-lg hover:bg-status-done-light text-status-done transition-colors">
                <Phone className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => window.open(`https://wa.me/${contact.phone.replace(/^0/, '212')}`, '_blank')} aria-label={`WhatsApp ${contact.name}`} className="flex h-10 w-10 items-center justify-center rounded-lg hover:bg-status-done-light text-status-done transition-colors">
                <MessageCircle className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => { deleteContact(contact.id); toast(t('contacts.deleted')); }} aria-label={`${t('salesTasks.delete')} ${contact.name}`} className="flex h-10 w-10 items-center justify-center rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {filtered.length === 0 && (
        <p className="rounded-xl border border-dashed border-border px-4 py-12 text-center text-sm text-muted-foreground">{t('contacts.noResults')}</p>
      )}

      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{t('contacts.addTitle')}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-foreground">{t('contacts.name')}</label>
              <Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder={t('contacts.fullName')} />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">{t('contacts.phone')}</label>
              <Input value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} placeholder="0612345678" />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">{t('contacts.category')}</label>
              <div className="flex gap-2 flex-wrap mt-1">
                {ROLE_LABEL_KEYS.map(({ key, value }) => (
                  <button key={value} onClick={() => setForm(p => ({ ...p, role_label: value }))} className={`px-3 py-1.5 text-xs rounded-lg border transition-all ${form.role_label === value ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'}`}>{t(key)}</button>
                ))}
              </div>
            </div>
            <Button onClick={handleAdd} disabled={!form.name || !form.phone} className="w-full">{t('contacts.addButton')}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
