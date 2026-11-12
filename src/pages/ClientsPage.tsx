// @ts-nocheck
import React, { useState, useEffect, useCallback } from 'react';
import { Users, Search, Plus, Edit, Trash2, X, Check, Loader, Phone, Mail, MapPin, Building, SortAsc, SortDesc, ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { SupabaseClientsService, Client, CreateClientRequest } from '../utils/supabaseClients';
import { exportToCSV } from '../utils/csvExport';
import { SupabaseDocumentsService } from '../utils/supabaseDocuments';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../hooks/useAuth';
import { useIsMobile } from '../hooks/use-mobile';
import { PageHeader } from '../components/PageHeader';
import { RowMenu } from '../components/lists/RowMenu';

const CLIENTS_PER_PAGE = 15;
type SortField = 'full_name' | 'phone_number' | 'city' | 'created_at';
type SortOrder = 'asc' | 'desc';

function exportClientsCSV(clients: Client[]) {
  exportToCSV(clients.map(c => ({
    Code: c.client_code || '',
    Nom: c.full_name,
    Téléphone: c.phone_number,
    Email: c.email || '',
    Adresse: c.address || '',
    Ville: c.city || '',
    ICE: c.ice || '',
    Date: new Date(c.created_at).toLocaleDateString('fr-FR'),
  })), `clients_${new Date().toISOString().slice(0, 10)}.csv`);
}

export default function ClientsPage() {
  const { showToast } = useToast();
  const { isAdmin } = useAuth();
  const [clients, setClients] = useState<Client[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  // Phones get cards instead of the wide table.
  const isMobile = useIsMobile();

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [formData, setFormData] = useState<CreateClientRequest>({
    full_name: '', phone_number: '', address: '', city: '', ice: '', email: ''
  });
  const [isSaving, setIsSaving] = useState(false);

  const loadClients = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await SupabaseClientsService.getAllClients();
      setClients(data);
    } catch {
      showToast({ type: 'error', message: 'Erreur lors du chargement des clients' });
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  useEffect(() => { loadClients(); }, [loadClients]);

  // Filter & sort
  const filtered = React.useMemo(() => {
    let list = [...clients];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(c =>
        c.full_name.toLowerCase().includes(q) ||
        c.phone_number.includes(q) ||
        c.city.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        (c.client_code || '').toLowerCase().includes(q)
      );
    }
    list.sort((a, b) => {
      const aV = a[sortField] || '';
      const bV = b[sortField] || '';
      if (aV < bV) return sortOrder === 'asc' ? -1 : 1;
      if (aV > bV) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });
    return list;
  }, [clients, searchQuery, sortField, sortOrder]);

  const totalPages = Math.ceil(filtered.length / CLIENTS_PER_PAGE);
  const startIdx = (currentPage - 1) * CLIENTS_PER_PAGE;
  const currentClients = filtered.slice(startIdx, startIdx + CLIENTS_PER_PAGE);

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortOrder(o => o === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortOrder('asc'); }
  };

  const openCreateModal = () => {
    setEditingClient(null);
    setFormData({ full_name: '', phone_number: '', address: '', city: '', ice: '', email: '' });
    setShowModal(true);
  };

  const openEditModal = (client: Client) => {
    setEditingClient(client);
    setFormData({
      full_name: client.full_name,
      phone_number: client.phone_number,
      address: client.address,
      city: client.city,
      ice: client.ice,
      email: client.email,
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!formData.full_name.trim() || !formData.phone_number.trim()) {
      showToast({ type: 'error', message: 'Le nom et le téléphone sont requis' });
      return;
    }
    setIsSaving(true);
    try {
      if (editingClient) {
        await SupabaseClientsService.updateClient(editingClient.id, formData);
        showToast({ type: 'success', message: 'Client mis à jour' });
      } else {
        await SupabaseClientsService.createClient(formData);
        showToast({ type: 'success', message: 'Client créé' });
      }
      setShowModal(false);
      await loadClients();
    } catch (err: any) {
      showToast({ type: 'error', message: err?.message?.includes('duplicate') ? 'Ce numéro de téléphone existe déjà' : 'Erreur lors de la sauvegarde' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (client: Client) => {
    const phone = client.phone_number?.trim();
    let counts = { invoiceCount: 0, blCount: 0, proformaCount: 0, quoteCount: 0, avoirCount: 0 };
    try {
      counts = await SupabaseDocumentsService.getClientDocumentCounts(phone);
    } catch { /* non-fatal — proceed with caution */ }

    const hardLinked = counts.invoiceCount + counts.blCount + counts.proformaCount + counts.avoirCount;

    if (hardLinked > 0) {
      const parts = [
        counts.invoiceCount > 0 && `${counts.invoiceCount} facture(s)`,
        counts.blCount > 0 && `${counts.blCount} BL(s)`,
        counts.proformaCount > 0 && `${counts.proformaCount} proforma(s)`,
        counts.avoirCount > 0 && `${counts.avoirCount} avoir(s)`,
      ].filter(Boolean).join(', ');
      showToast({ type: 'error', title: 'Suppression impossible', message: `Ce client a ${parts}. Supprimez ces documents d'abord.` });
      return;
    }

    if (counts.quoteCount > 0) {
      if (!window.confirm(`Ce client a ${counts.quoteCount} devis. Supprimer le client et tous ses devis ?`)) return;
      try {
        await SupabaseDocumentsService.deleteClientQuotesByPhone(phone);
      } catch (err: any) {
        showToast({ type: 'error', message: `Erreur suppression devis: ${err?.message}` });
        return;
      }
    } else {
      if (!window.confirm(`Supprimer le client ${client.full_name} ?`)) return;
    }

    try {
      await SupabaseClientsService.deleteClient(client.id);
      showToast({ type: 'success', message: 'Client supprimé' });
      await loadClients();
    } catch (err: any) {
      showToast({ type: 'error', message: err?.message || 'Erreur lors de la suppression' });
    }
  };

  const getSortIcon = (field: SortField) => {
    if (sortField !== field) return null;
    return sortOrder === 'asc' ? <SortAsc className="h-3.5 w-3.5" /> : <SortDesc className="h-3.5 w-3.5" />;
  };

  const menuItems = (client: Client) => [
    { label: 'Modifier', icon: <Edit className="h-4 w-4 text-primary" />, onSelect: () => openEditModal(client) },
    { label: 'Supprimer', icon: <Trash2 className="h-4 w-4" />, onSelect: () => handleDelete(client), danger: true, separated: true },
  ];
  const th = 'px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground';

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <PageHeader
        title="Clients"
        subtitle={`${clients.length} client${clients.length !== 1 ? 's' : ''}`}
        actions={<>
          {isAdmin && (
            <button onClick={() => exportClientsCSV(filtered)} className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary">
              <Download className="h-4 w-4" />CSV
            </button>
          )}
          <button onClick={openCreateModal} className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
            <Plus className="h-4 w-4" />Nouveau client
          </button>
        </>}
      >
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input type="text" value={searchQuery} onChange={e => { setSearchQuery(e.target.value); setCurrentPage(1); }} aria-label="Rechercher un client"
              className="w-full rounded-lg border border-input bg-background py-2 pl-9 pr-3 text-sm text-foreground focus:ring-2 focus:ring-ring"
              placeholder="Nom, téléphone, ville, code…" />
          </div>
        </div>
      </PageHeader>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        {isLoading ? (
          <div className="p-8 text-center">
            <div className="mx-auto h-6 w-6 animate-spin rounded-full border-b-2 border-primary" />
            <p className="mt-3 text-sm text-muted-foreground">Chargement…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center">
            <Users className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
            <h3 className="mb-1 text-base font-medium text-foreground">Aucun client</h3>
            <p className="mb-3 text-sm text-muted-foreground">
              {searchQuery ? 'Aucun résultat' : 'Ajoutez votre premier client'}
            </p>
            {!searchQuery && (
              <button onClick={openCreateModal} className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
                Ajouter un client
              </button>
            )}
          </div>
        ) : (
          <>
            {isMobile ? (
              <ul className="divide-y divide-border">
                {currentClients.map(client => (
                  <li key={client.id} className="flex items-start gap-1">
                    <button type="button" onClick={() => openEditModal(client)} className="min-w-0 flex-1 px-4 py-3 text-left active:bg-secondary">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium text-foreground">{client.full_name}</span>
                        {client.client_code && <span className="shrink-0 font-mono text-xs text-muted-foreground">{client.client_code}</span>}
                      </div>
                      <p className="mt-0.5 truncate text-sm text-muted-foreground">{[client.phone_number, client.city].filter(Boolean).join(' · ')}</p>
                      {(client.email || client.ice) && <p className="truncate text-xs text-muted-foreground">{[client.email, client.ice && `ICE ${client.ice}`].filter(Boolean).join(' · ')}</p>}
                    </button>
                    <div className="flex items-center gap-0.5 pr-2 pt-2">
                      {client.phone_number && (
                        <a href={`tel:${client.phone_number}`} aria-label={`Appeler ${client.full_name}`} className="flex h-9 w-9 items-center justify-center rounded-lg text-primary hover:bg-primary/10">
                          <Phone className="h-4 w-4" />
                        </a>
                      )}
                      <RowMenu label={`Actions pour ${client.full_name}`} items={menuItems(client)} />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-secondary/40">
                  <tr>
                    {([
                      ['full_name', 'Client'],
                      ['phone_number', 'Téléphone'],
                      ['city', 'Ville'],
                    ] as [SortField, string][]).map(([field, label]) => (
                      <th key={field} onClick={() => handleSort(field)} aria-sort={sortField === field ? (sortOrder === 'asc' ? 'ascending' : 'descending') : undefined}
                        className={`${th} cursor-pointer hover:text-foreground`}>
                        <span className="inline-flex items-center gap-1">{label}{getSortIcon(field)}</span>
                      </th>
                    ))}
                    <th className={th}>E-mail</th>
                    <th className={th}>ICE</th>
                    <th onClick={() => handleSort('created_at')} aria-sort={sortField === 'created_at' ? (sortOrder === 'asc' ? 'ascending' : 'descending') : undefined}
                      className={`${th} cursor-pointer hover:text-foreground`}>
                      <span className="inline-flex items-center gap-1">Ajouté le{getSortIcon('created_at')}</span>
                    </th>
                    <th className={th}><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {currentClients.map(client => (
                    <tr key={client.id} className="cursor-pointer hover:bg-secondary/60"
                      onClick={event => { if (!(event.target as HTMLElement).closest('a,button,[role="menu"]')) openEditModal(client); }}>
                      <td className="px-3 py-2.5">
                        <div className="font-medium text-foreground">{client.full_name}</div>
                        {client.client_code && <div className="font-mono text-xs text-muted-foreground">{client.client_code}</div>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-foreground">{client.phone_number}</td>
                      <td className="px-3 py-2.5 text-foreground">{client.city || '—'}</td>
                      <td className="max-w-[14rem] truncate px-3 py-2.5 text-muted-foreground">{client.email || '—'}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-muted-foreground">{client.ice || '—'}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">{new Date(client.created_at).toLocaleDateString('fr-FR')}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => openEditModal(client)} title="Modifier" aria-label={`Modifier ${client.full_name}`}
                            className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground">
                            <Edit className="h-4 w-4" />
                          </button>
                          <RowMenu label={`Actions pour ${client.full_name}`} items={menuItems(client).slice(1)} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            )}
            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-border px-4 py-2.5">
                <div className="text-xs text-muted-foreground">
                  {startIdx + 1}-{Math.min(startIdx + CLIENTS_PER_PAGE, filtered.length)} sur {filtered.length}
                </div>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} aria-label="Page précédente"
                    className="rounded-lg border border-border p-1.5 hover:bg-secondary disabled:opacity-50"><ChevronLeft className="h-4 w-4" /></button>
                  <span className="px-2 text-xs text-muted-foreground">{currentPage}/{totalPages}</span>
                  <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} aria-label="Page suivante"
                    className="rounded-lg border border-border p-1.5 hover:bg-secondary disabled:opacity-50"><ChevronRight className="h-4 w-4" /></button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="glass rounded-xl shadow-2xl w-full max-w-md p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-foreground">
                {editingClient ? 'Modifier le Client' : 'Nouveau Client'}
              </h2>
              <button onClick={() => setShowModal(false)} className="p-1 hover:bg-secondary rounded-lg"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-3">
              {([
                { key: 'full_name', label: 'Nom Complet *', icon: Users, placeholder: 'Nom complet' },
                { key: 'phone_number', label: 'Téléphone *', icon: Phone, placeholder: '06...' },
                { key: 'email', label: 'Email', icon: Mail, placeholder: 'email@example.com' },
                { key: 'address', label: 'Adresse', icon: MapPin, placeholder: 'Adresse' },
                { key: 'city', label: 'Ville', icon: Building, placeholder: 'Ville' },
                { key: 'ice', label: 'ICE', icon: Building, placeholder: 'Numéro ICE' },
              ] as const).map(({ key, label, icon: Icon, placeholder }) => (
                <div key={key}>
                  <label className="block text-xs font-medium text-foreground mb-1">{label}</label>
                  <div className="relative">
                    <Icon className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <input type="text" value={(formData as any)[key] || ''}
                      onChange={e => setFormData(prev => ({ ...prev, [key]: e.target.value }))}
                      className="w-full pl-8 pr-3 py-1.5 text-sm border border-input rounded-lg focus:ring-2 focus:ring-ring bg-background text-foreground"
                      placeholder={placeholder} />
                  </div>
                </div>
              ))}
            </div>
            <div className="flex space-x-2">
              <button onClick={() => setShowModal(false)} className="flex-1 px-3 py-1.5 text-sm border border-input rounded-lg hover:bg-secondary text-foreground">
                Annuler
              </button>
              <button onClick={handleSave} disabled={isSaving}
                className="flex-1 flex items-center justify-center space-x-1.5 px-3 py-1.5 text-sm bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg disabled:opacity-50">
                {isSaving ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                <span>{editingClient ? 'Modifier' : 'Créer'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
