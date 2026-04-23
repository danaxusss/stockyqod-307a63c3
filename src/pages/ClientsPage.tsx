// @ts-nocheck
import React, { useState, useEffect, useCallback } from 'react';
import { Users, Search, Plus, Edit, Trash2, X, Check, Loader, Phone, Mail, MapPin, Building, SortAsc, SortDesc, ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { SupabaseClientsService, Client, CreateClientRequest } from '../utils/supabaseClients';
import { SupabaseDocumentsService } from '../utils/supabaseDocuments';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../hooks/useAuth';

const CLIENTS_PER_PAGE = 15;
type SortField = 'full_name' | 'phone_number' | 'city' | 'created_at';
type SortOrder = 'asc' | 'desc';

function exportClientsCSV(clients: Client[]) {
  const headers = ['Code', 'Nom', 'Téléphone', 'Email', 'Adresse', 'Ville', 'ICE', 'Date'];
  const rows = clients.map(c => [
    c.client_code || '',
    c.full_name,
    c.phone_number,
    c.email || '',
    c.address || '',
    c.city || '',
    c.ice || '',
    new Date(c.created_at).toLocaleDateString('fr-FR'),
  ]);
  const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `clients_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
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

  return (
    <div className="max-w-7xl mx-auto space-y-4">
      {/* Header */}
      <div className="glass rounded-xl shadow-lg p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-primary rounded-lg" style={{ boxShadow: 'var(--shadow-glow)' }}>
              <Users className="h-4 w-4 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground">Gestion des Clients</h1>
              <p className="text-xs text-muted-foreground">{clients.length} client{clients.length !== 1 ? 's' : ''}</p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            {isAdmin && (
              <button onClick={() => exportClientsCSV(filtered)} className="flex items-center space-x-1.5 px-3 py-1.5 bg-secondary hover:bg-accent text-foreground rounded-lg transition-colors text-sm border border-border">
                <Download className="h-3.5 w-3.5" /><span>CSV</span>
              </button>
            )}
            <button onClick={openCreateModal} className="flex items-center space-x-1.5 px-3 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg transition-colors text-sm">
              <Plus className="h-3.5 w-3.5" /><span>Nouveau</span>
            </button>
          </div>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 transform -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input type="text" value={searchQuery} onChange={e => { setSearchQuery(e.target.value); setCurrentPage(1); }}
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-input rounded-lg focus:ring-2 focus:ring-ring bg-background text-foreground"
            placeholder="Rechercher par nom, téléphone, ville..." />
        </div>
      </div>

      {/* Table */}
      <div className="glass rounded-xl shadow-lg overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary mx-auto" />
            <p className="text-muted-foreground mt-3 text-sm">Chargement...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center">
            <Users className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <h3 className="text-base font-medium text-foreground mb-1">Aucun client</h3>
            <p className="text-muted-foreground text-sm mb-3">
              {searchQuery ? 'Aucun résultat' : 'Ajoutez votre premier client'}
            </p>
            {!searchQuery && (
              <button onClick={openCreateModal} className="px-3 py-1.5 text-sm bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg">
                Ajouter un client
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-secondary">
                  <tr>
                    <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Code</th>
                    {([
                      ['full_name', 'Nom'],
                      ['phone_number', 'Téléphone'],
                      ['city', 'Ville'],
                      ['created_at', 'Date'],
                    ] as [SortField, string][]).map(([field, label]) => (
                      <th key={field} onClick={() => handleSort(field)}
                        className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider cursor-pointer hover:bg-accent">
                        <div className="flex items-center space-x-1"><span>{label}</span>{getSortIcon(field)}</div>
                      </th>
                    ))}
                    <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Email</th>
                    <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider">ICE</th>
                    <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {currentClients.map(client => (
                    <tr key={client.id} className="hover:bg-accent/50">
                      <td className="px-3 py-2.5 text-xs">
                        {client.client_code ? (
                          <span className="px-1.5 py-0.5 bg-primary/10 text-primary rounded text-[10px] font-mono">{client.client_code}</span>
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-xs font-medium text-foreground">{client.full_name}</td>
                      <td className="px-3 py-2.5 text-xs text-foreground">{client.phone_number}</td>
                      <td className="px-3 py-2.5 text-xs text-foreground">{client.city || '-'}</td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground">
                        {new Date(client.created_at).toLocaleDateString('fr-FR')}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-foreground">{client.email || '-'}</td>
                      <td className="px-3 py-2.5 text-xs text-foreground">{client.ice || '-'}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center space-x-1">
                          <button onClick={() => openEditModal(client)} className="p-1 text-primary hover:bg-primary/10 rounded transition-colors" title="Modifier">
                            <Edit className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => handleDelete(client)} className="p-1 text-destructive hover:bg-destructive/10 rounded transition-colors" title="Supprimer">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="px-4 py-2.5 border-t border-border flex items-center justify-between">
                <div className="text-xs text-muted-foreground">
                  {startIdx + 1}-{Math.min(startIdx + CLIENTS_PER_PAGE, filtered.length)} sur {filtered.length}
                </div>
                <div className="flex items-center space-x-1.5">
                  <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}
                    className="p-1 border border-border rounded hover:bg-accent disabled:opacity-50"><ChevronLeft className="h-3.5 w-3.5" /></button>
                  <span className="px-2 text-xs text-muted-foreground">{currentPage}/{totalPages}</span>
                  <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}
                    className="p-1 border border-border rounded hover:bg-accent disabled:opacity-50"><ChevronRight className="h-3.5 w-3.5" /></button>
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
              <button onClick={() => setShowModal(false)} className="p-1 hover:bg-accent rounded-lg"><X className="h-4 w-4" /></button>
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
              <button onClick={() => setShowModal(false)} className="flex-1 px-3 py-1.5 text-sm border border-input rounded-lg hover:bg-accent text-foreground">
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
