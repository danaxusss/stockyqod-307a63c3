// @ts-nocheck
import React, { useState, useEffect, useCallback } from 'react';
import { Building2, Plus, Edit, Trash2, X, Check, Loader, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { SupabaseCompaniesService } from '../utils/supabaseCompanies';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { Company } from '../types';

const COMPANIES_PER_PAGE = 15;

type CompanyFormData = {
  name: string;
  address: string;
  phone: string;
  phone2: string;
  email: string;
  website: string;
  ice: string;
  rc: string;
  if_number: string;
  payment_terms: string;
};

const emptyForm: CompanyFormData = {
  name: '', address: '', phone: '', phone2: '', email: '',
  website: '', ice: '', rc: '', if_number: '', payment_terms: ''
};

export default function CompaniesPage() {
  const { isSuperAdmin, authReady } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [companies, setCompanies] = useState<Company[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  const [showModal, setShowModal] = useState(false);
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [formData, setFormData] = useState<CompanyFormData>(emptyForm);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (authReady && !isSuperAdmin) { navigate('/'); }
  }, [authReady, isSuperAdmin, navigate]);

  const loadCompanies = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await SupabaseCompaniesService.getAllCompanies();
      setCompanies(data);
    } catch {
      showToast({ type: 'error', message: 'Erreur lors du chargement des sociétés' });
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  useEffect(() => { loadCompanies(); }, [loadCompanies]);

  const filtered = React.useMemo(() => {
    if (!searchQuery.trim()) return companies;
    const q = searchQuery.toLowerCase();
    return companies.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.email.toLowerCase().includes(q) ||
      c.phone.includes(q)
    );
  }, [companies, searchQuery]);

  const totalPages = Math.ceil(filtered.length / COMPANIES_PER_PAGE);
  const startIdx = (currentPage - 1) * COMPANIES_PER_PAGE;
  const currentCompanies = filtered.slice(startIdx, startIdx + COMPANIES_PER_PAGE);

  const openCreateModal = () => {
    setEditingCompany(null);
    setFormData(emptyForm);
    setShowModal(true);
  };

  const openEditModal = (company: Company) => {
    setEditingCompany(company);
    setFormData({
      name: company.name,
      address: company.address,
      phone: company.phone,
      phone2: company.phone2,
      email: company.email,
      website: company.website,
      ice: company.ice,
      rc: company.rc,
      if_number: company.if_number,
      payment_terms: company.payment_terms,
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      showToast({ type: 'error', message: 'Le nom de la société est requis' });
      return;
    }
    setIsSaving(true);
    try {
      if (editingCompany) {
        await SupabaseCompaniesService.updateCompany(editingCompany.id, formData as any);
        showToast({ type: 'success', message: 'Société mise à jour' });
      } else {
        await SupabaseCompaniesService.createCompany(formData as any);
        showToast({ type: 'success', message: 'Société créée' });
      }
      setShowModal(false);
      await loadCompanies();
    } catch (err: any) {
      showToast({ type: 'error', message: err?.message || 'Erreur lors de la sauvegarde' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (company: Company) => {
    if (!window.confirm(`Supprimer la société ${company.name} ?`)) return;
    try {
      await SupabaseCompaniesService.deleteCompany(company.id);
      showToast({ type: 'success', message: 'Société supprimée' });
      await loadCompanies();
    } catch (err: any) {
      console.error('Delete company error:', err);
      showToast({ type: 'error', message: err?.message || 'Erreur lors de la suppression' });
    }
  };

  const fields: { key: keyof CompanyFormData; label: string; placeholder: string }[] = [
    { key: 'name', label: 'Nom *', placeholder: 'Nom de la société' },
    { key: 'address', label: 'Adresse', placeholder: 'Adresse' },
    { key: 'phone', label: 'Téléphone', placeholder: '05...' },
    { key: 'phone2', label: 'Téléphone 2', placeholder: '06...' },
    { key: 'email', label: 'Email', placeholder: 'email@example.com' },
    { key: 'website', label: 'Site web', placeholder: 'https://...' },
    { key: 'ice', label: 'ICE', placeholder: 'Numéro ICE' },
    { key: 'rc', label: 'RC', placeholder: 'Registre du commerce' },
    { key: 'if_number', label: 'IF', placeholder: 'Identifiant Fiscal' },
    { key: 'payment_terms', label: 'Conditions de paiement', placeholder: '30 jours' },
  ];

  return (
    <div className="max-w-7xl mx-auto space-y-4">
      {/* Header */}
      <div className="glass rounded-xl shadow-lg p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-primary rounded-lg" style={{ boxShadow: 'var(--shadow-glow)' }}>
              <Building2 className="h-4 w-4 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground">Gestion des Sociétés</h1>
              <p className="text-xs text-muted-foreground">{companies.length} société{companies.length !== 1 ? 's' : ''} · Superadmin</p>
            </div>
          </div>
          <button onClick={openCreateModal} className="flex items-center space-x-1.5 px-3 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg transition-colors text-sm">
            <Plus className="h-3.5 w-3.5" /><span>Nouvelle</span>
          </button>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input type="text" value={searchQuery} onChange={e => { setSearchQuery(e.target.value); setCurrentPage(1); }}
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-input rounded-lg focus:ring-2 focus:ring-ring bg-background text-foreground"
            placeholder="Rechercher par nom, email, téléphone..." />
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
            <Building2 className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <h3 className="text-base font-medium text-foreground mb-1">Aucune société</h3>
            <p className="text-muted-foreground text-sm mb-3">
              {searchQuery ? 'Aucun résultat' : 'Créez votre première société'}
            </p>
            {!searchQuery && (
              <button onClick={openCreateModal} className="px-3 py-1.5 text-sm bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg">
                Ajouter une société
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-secondary">
                  <tr>
                    <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Nom</th>
                    <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Téléphone</th>
                    <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Email</th>
                    <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider">ICE</th>
                    <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {currentCompanies.map(company => (
                    <tr key={company.id} className="hover:bg-accent/50">
                      <td className="px-3 py-2.5 text-xs font-medium text-foreground">{company.name}</td>
                      <td className="px-3 py-2.5 text-xs text-foreground">{company.phone || '-'}</td>
                      <td className="px-3 py-2.5 text-xs text-foreground">{company.email || '-'}</td>
                      <td className="px-3 py-2.5 text-xs text-foreground">{company.ice || '-'}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center space-x-1">
                          <button onClick={() => openEditModal(company)} className="p-1 text-primary hover:bg-primary/10 rounded transition-colors" title="Modifier">
                            <Edit className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => handleDelete(company)} className="p-1 text-destructive hover:bg-destructive/10 rounded transition-colors" title="Supprimer">
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
                  {startIdx + 1}-{Math.min(startIdx + COMPANIES_PER_PAGE, filtered.length)} sur {filtered.length}
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
          <div className="glass rounded-xl shadow-2xl w-full max-w-lg p-5 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-foreground">
                {editingCompany ? 'Modifier la Société' : 'Nouvelle Société'}
              </h2>
              <button onClick={() => setShowModal(false)} className="p-1 hover:bg-accent rounded-lg"><X className="h-4 w-4" /></button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {fields.map(({ key, label, placeholder }) => (
                <div key={key} className={key === 'name' || key === 'address' ? 'sm:col-span-2' : ''}>
                  <label className="block text-xs font-medium text-foreground mb-1">{label}</label>
                  <input
                    type="text"
                    value={formData[key]}
                    onChange={e => setFormData(prev => ({ ...prev, [key]: e.target.value }))}
                    className="w-full px-3 py-1.5 text-sm border border-input rounded-lg focus:ring-2 focus:ring-ring bg-background text-foreground"
                    placeholder={placeholder}
                  />
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
                <span>{editingCompany ? 'Modifier' : 'Créer'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
