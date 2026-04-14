// @ts-nocheck
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Building2, Plus, Edit, Trash2, X, Check, Loader, Search,
  ChevronLeft, ChevronRight, Upload, Image, Save, ArrowLeft,
  Phone, Mail, Globe, Hash, FileText, Eye, Palette, MessageCircle, Send, Stamp
} from 'lucide-react';
import { SupabaseCompaniesService } from '../utils/supabaseCompanies';
import {
  CompanySettingsService, CompanySettings, QuoteVisibleFields, QuoteStyle, DEFAULT_SHARE_TEMPLATES
} from '../utils/companySettings';
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

const FIELD_LABELS: Record<keyof QuoteVisibleFields, string> = {
  showLogo: "Logo de l'entreprise",
  showCompanyAddress: "Adresse de l'entreprise",
  showCompanyPhone: "Téléphone de l'entreprise",
  showCompanyEmail: "Email de l'entreprise",
  showCompanyWebsite: "Site web de l'entreprise",
  showCompanyICE: "ICE de l'entreprise",
  showClientICE: 'ICE du client',
  showTVA: 'Afficher TVA (détail HT/TVA/TTC)',
  showNotes: 'Notes / Remarques',
  showPaymentTerms: 'Conditions de paiement',
  showValidityDate: 'Date de validité du devis',
};

export default function CompaniesPage() {
  const { isSuperAdmin, authReady } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  // List state
  const [companies, setCompanies] = useState<Company[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  // Create modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createFormData, setCreateFormData] = useState<CompanyFormData>(emptyForm);
  const [isCreating, setIsCreating] = useState(false);

  // Edit (full settings panel) state
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [editSettings, setEditSettings] = useState<CompanySettings | null>(null);
  const [editLogoFile, setEditLogoFile] = useState<File | null>(null);
  const [editLogoPreview, setEditLogoPreview] = useState<string | null>(null);
  const [editStampFile, setEditStampFile] = useState<File | null>(null);
  const [editStampPreview, setEditStampPreview] = useState<string | null>(null);
  const [isEditLoading, setIsEditLoading] = useState(false);
  const [isEditSaving, setIsEditSaving] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const stampInputRef = useRef<HTMLInputElement>(null);

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
      (c.email || '').toLowerCase().includes(q) ||
      (c.phone || '').includes(q)
    );
  }, [companies, searchQuery]);

  const totalPages = Math.ceil(filtered.length / COMPANIES_PER_PAGE);
  const startIdx = (currentPage - 1) * COMPANIES_PER_PAGE;
  const currentCompanies = filtered.slice(startIdx, startIdx + COMPANIES_PER_PAGE);

  // ---- CREATE ----
  const handleCreate = async () => {
    if (!createFormData.name.trim()) {
      showToast({ type: 'error', message: 'Le nom de la société est requis' });
      return;
    }
    setIsCreating(true);
    try {
      await SupabaseCompaniesService.createCompany(createFormData as any);
      showToast({ type: 'success', message: 'Société créée' });
      setShowCreateModal(false);
      setCreateFormData(emptyForm);
      await loadCompanies();
    } catch (err: any) {
      showToast({ type: 'error', message: err?.message || 'Erreur lors de la création' });
    } finally {
      setIsCreating(false);
    }
  };

  // ---- EDIT ----
  const openEdit = async (company: Company) => {
    setEditingCompany(company);
    setEditLogoFile(null);
    setEditLogoPreview(null);
    setEditStampFile(null);
    setEditStampPreview(null);
    setIsEditLoading(true);
    try {
      const settings = await CompanySettingsService.getSettings(company.id);
      setEditSettings(settings);
    } catch {
      showToast({ type: 'error', message: 'Erreur lors du chargement des paramètres' });
    } finally {
      setIsEditLoading(false);
    }
  };

  const handleEditLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setEditLogoFile(file);
    const reader = new FileReader();
    reader.onload = ev => setEditLogoPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleEditRemoveLogo = () => {
    setEditLogoFile(null);
    setEditLogoPreview(null);
    if (editSettings) setEditSettings({ ...editSettings, logo_url: null });
    if (logoInputRef.current) logoInputRef.current.value = '';
  };

  const handleEditStampChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setEditStampFile(file);
    const reader = new FileReader();
    reader.onload = ev => setEditStampPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleEditRemoveStamp = () => {
    setEditStampFile(null);
    setEditStampPreview(null);
    if (editSettings) setEditSettings({ ...editSettings, stamp_url: null });
    if (stampInputRef.current) stampInputRef.current.value = '';
  };

  const handleEditSave = async () => {
    if (!editingCompany || !editSettings) return;
    setIsEditSaving(true);
    try {
      let logoUrl = editSettings.logo_url;
      if (editLogoFile) {
        logoUrl = await CompanySettingsService.uploadLogo(editLogoFile, editingCompany.id);
        setEditLogoFile(null);
      }
      let stampUrl = editSettings.stamp_url;
      if (editStampFile) {
        stampUrl = await CompanySettingsService.uploadStamp(editStampFile, editingCompany.id);
        setEditStampFile(null);
      }
      await CompanySettingsService.updateCompanySettings(editingCompany.id, {
        ...editSettings,
        logo_url: logoUrl,
        stamp_url: stampUrl,
      });
      showToast({ type: 'success', message: 'Paramètres sauvegardés' });
      await loadCompanies();
    } catch (err: any) {
      showToast({ type: 'error', message: err?.message || 'Erreur lors de la sauvegarde' });
    } finally {
      setIsEditSaving(false);
    }
  };

  // ---- DELETE ----
  const handleDelete = async (company: Company) => {
    if (!window.confirm(`Supprimer la société "${company.name}" ?`)) return;
    try {
      await SupabaseCompaniesService.deleteCompany(company.id);
      showToast({ type: 'success', message: 'Société supprimée' });
      await loadCompanies();
    } catch (err: any) {
      showToast({ type: 'error', message: err?.message || 'Erreur lors de la suppression' });
    }
  };

  const createFields: { key: keyof CompanyFormData; label: string; placeholder: string }[] = [
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

  // ---- FULL SETTINGS PANEL ----
  if (editingCompany) {
    const s = editSettings;
    const setS = (patch: Partial<CompanySettings>) =>
      setEditSettings(prev => prev ? { ...prev, ...patch } : prev);
    const setStyle = (patch: Partial<QuoteStyle>) =>
      setS({ quote_style: { ...(s?.quote_style || {} as QuoteStyle), ...patch } });
    const setFields = (patch: Partial<QuoteVisibleFields>) =>
      setS({ quote_visible_fields: { ...(s?.quote_visible_fields || {} as QuoteVisibleFields), ...patch } });
    const setTemplates = (patch: Partial<typeof DEFAULT_SHARE_TEMPLATES>) =>
      setS({ share_templates: { ...(s?.share_templates || DEFAULT_SHARE_TEMPLATES), ...patch } });

    return (
      <div className="max-w-4xl mx-auto space-y-4">
        {/* Top bar */}
        <div className="glass rounded-xl shadow-lg p-4 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <button onClick={() => setEditingCompany(null)} className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground">
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="p-2 bg-primary rounded-lg" style={{ boxShadow: 'var(--shadow-glow)' }}>
              <Building2 className="h-4 w-4 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground">{editingCompany.name}</h1>
              <p className="text-xs text-muted-foreground">Paramètres de la société</p>
            </div>
          </div>
          <button onClick={handleEditSave} disabled={isEditSaving || isEditLoading}
            className="flex items-center space-x-1.5 px-4 py-2 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground rounded-lg text-sm transition-colors">
            {isEditSaving ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            <span>Sauvegarder</span>
          </button>
        </div>

        {isEditLoading || !s ? (
          <div className="glass rounded-xl shadow-lg p-12 text-center">
            <Loader className="h-6 w-6 animate-spin text-primary mx-auto" />
            <p className="text-sm text-muted-foreground mt-3">Chargement...</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Logo */}
            <div className="glass rounded-xl shadow-lg p-4 space-y-3">
              <h2 className="text-sm font-semibold text-foreground flex items-center space-x-2">
                <Image className="h-4 w-4 text-primary" /><span>Logo</span>
              </h2>
              <div className="flex items-start space-x-4">
                <div className="flex-1">
                  <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={handleEditLogoChange} />
                  <button onClick={() => logoInputRef.current?.click()}
                    className="flex items-center space-x-2 px-3 py-1.5 text-sm border border-dashed border-input rounded-lg hover:bg-accent transition-colors">
                    <Upload className="h-3.5 w-3.5" /><span>Choisir un logo</span>
                  </button>
                </div>
                {(editLogoPreview || s.logo_url) && (
                  <div className="flex items-center space-x-2">
                    <img src={editLogoPreview || s.logo_url!} alt="Logo" className="h-12 object-contain rounded border border-border" />
                    <button onClick={handleEditRemoveLogo} className="p-1 text-destructive hover:bg-destructive/10 rounded">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">Taille du logo</label>
                <select value={s.logo_size} onChange={e => setS({ logo_size: e.target.value as any })}
                  className="px-2 py-1 text-sm border border-input rounded-lg bg-background text-foreground">
                  <option value="small">Petit</option>
                  <option value="medium">Moyen</option>
                  <option value="large">Grand</option>
                </select>
              </div>
            </div>

            {/* Stamp */}
            <div className="glass rounded-xl shadow-lg p-4 space-y-3">
              <h2 className="text-sm font-semibold text-foreground flex items-center space-x-2">
                <Stamp className="h-4 w-4 text-primary" /><span>Tampon (PNG transparent)</span>
              </h2>
              <div className="flex items-start space-x-4">
                <div className="flex-1">
                  <input ref={stampInputRef} type="file" accept="image/png" className="hidden" onChange={handleEditStampChange} />
                  <button onClick={() => stampInputRef.current?.click()}
                    className="flex items-center space-x-2 px-3 py-1.5 text-sm border border-dashed border-input rounded-lg hover:bg-accent transition-colors">
                    <Upload className="h-3.5 w-3.5" /><span>Choisir un tampon PNG</span>
                  </button>
                </div>
                {(editStampPreview || s.stamp_url) && (
                  <div className="flex items-center space-x-2">
                    <img src={editStampPreview || s.stamp_url!} alt="Tampon" className="h-12 object-contain rounded border border-border bg-[url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAABmJLR0QA/wD/AP+gvaeTAAAADUlEQVQI12NgYGD4DwABBAEAdkIWlAAAAABJRU5ErkJggg==')] bg-repeat" />
                    <button onClick={handleEditRemoveStamp} className="p-1 text-destructive hover:bg-destructive/10 rounded">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">Taille du tampon</label>
                <select value={s.stamp_size || 'medium'} onChange={e => setS({ stamp_size: e.target.value as any })}
                  className="px-2 py-1 text-sm border border-input rounded-lg bg-background text-foreground">
                  <option value="small">Petit</option>
                  <option value="medium">Moyen</option>
                  <option value="large">Grand</option>
                </select>
              </div>
            </div>

            {/* Infos société */}
            <div className="glass rounded-xl shadow-lg p-4 space-y-3">
              <h2 className="text-sm font-semibold text-foreground flex items-center space-x-2">
                <Building2 className="h-4 w-4 text-primary" /><span>Infos société</span>
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  { key: 'company_name', label: 'Nom', icon: <Building2 className="h-3.5 w-3.5" />, placeholder: 'Nom de la société' },
                  { key: 'address', label: 'Adresse', icon: <FileText className="h-3.5 w-3.5" />, placeholder: 'Adresse' },
                  { key: 'phone', label: 'Téléphone', icon: <Phone className="h-3.5 w-3.5" />, placeholder: '05...' },
                  { key: 'phone2', label: 'Téléphone 2', icon: <Phone className="h-3.5 w-3.5" />, placeholder: '06...' },
                  { key: 'email', label: 'Email', icon: <Mail className="h-3.5 w-3.5" />, placeholder: 'email@example.com' },
                  { key: 'website', label: 'Site web', icon: <Globe className="h-3.5 w-3.5" />, placeholder: 'https://...' },
                  { key: 'ice', label: 'ICE', icon: <Hash className="h-3.5 w-3.5" />, placeholder: 'Numéro ICE' },
                  { key: 'rc', label: 'RC', icon: <Hash className="h-3.5 w-3.5" />, placeholder: 'Registre du commerce' },
                  { key: 'if_number', label: 'IF', icon: <Hash className="h-3.5 w-3.5" />, placeholder: 'Identifiant Fiscal' },
                  { key: 'cnss', label: 'CNSS', icon: <Hash className="h-3.5 w-3.5" />, placeholder: 'CNSS' },
                  { key: 'patente', label: 'Patente', icon: <Hash className="h-3.5 w-3.5" />, placeholder: 'Patente' },
                ].map(({ key, label, icon, placeholder }) => (
                  <div key={key} className={key === 'address' ? 'sm:col-span-2' : ''}>
                    <label className="block text-xs font-medium text-foreground mb-1 flex items-center space-x-1">
                      {icon}<span>{label}</span>
                    </label>
                    <input type="text" value={(s as any)[key] || ''}
                      onChange={e => setS({ [key]: e.target.value } as any)}
                      className="w-full px-3 py-1.5 text-sm border border-input rounded-lg bg-background text-foreground focus:ring-2 focus:ring-ring"
                      placeholder={placeholder} />
                  </div>
                ))}
              </div>
            </div>

            {/* Paramètres du devis */}
            <div className="glass rounded-xl shadow-lg p-4 space-y-3">
              <h2 className="text-sm font-semibold text-foreground flex items-center space-x-2">
                <FileText className="h-4 w-4 text-primary" /><span>Paramètres du devis</span>
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">TVA (%)</label>
                  <input type="number" min="0" max="100" value={s.tva_rate}
                    onChange={e => setS({ tva_rate: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-1.5 text-sm border border-input rounded-lg bg-background text-foreground focus:ring-2 focus:ring-ring" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">Validité (jours)</label>
                  <input type="number" min="1" value={s.quote_validity_days}
                    onChange={e => setS({ quote_validity_days: parseInt(e.target.value) || 30 })}
                    className="w-full px-3 py-1.5 text-sm border border-input rounded-lg bg-background text-foreground focus:ring-2 focus:ring-ring" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">Conditions de paiement</label>
                  <input type="text" value={s.payment_terms || ''}
                    onChange={e => setS({ payment_terms: e.target.value })}
                    className="w-full px-3 py-1.5 text-sm border border-input rounded-lg bg-background text-foreground focus:ring-2 focus:ring-ring"
                    placeholder="30 jours" />
                </div>
              </div>
            </div>

            {/* Style du devis */}
            <div className="glass rounded-xl shadow-lg p-4 space-y-3">
              <h2 className="text-sm font-semibold text-foreground flex items-center space-x-2">
                <Palette className="h-4 w-4 text-primary" /><span>Style du devis</span>
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">Couleur accentuée</label>
                  <div className="flex items-center space-x-2">
                    <input type="color" value={s.quote_style?.accentColor || '#3B82F6'}
                      onChange={e => setStyle({ accentColor: e.target.value })}
                      className="h-8 w-10 rounded border border-input cursor-pointer" />
                    <input type="text" value={s.quote_style?.accentColor || '#3B82F6'}
                      onChange={e => setStyle({ accentColor: e.target.value })}
                      className="flex-1 px-3 py-1.5 text-sm border border-input rounded-lg bg-background text-foreground focus:ring-2 focus:ring-ring"
                      placeholder="#3B82F6" />
                  </div>
                  <div className="mt-2 h-2 rounded-full" style={{ backgroundColor: s.quote_style?.accentColor || '#3B82F6' }} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">Police</label>
                  <select value={s.quote_style?.fontFamily || 'helvetica'}
                    onChange={e => setStyle({ fontFamily: e.target.value as any })}
                    className="w-full px-2 py-1.5 text-sm border border-input rounded-lg bg-background text-foreground">
                    <option value="helvetica">Helvetica</option>
                    <option value="times">Times New Roman</option>
                    <option value="courier">Courier</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">Taille en-tête</label>
                  <select value={s.quote_style?.headerSize || 'large'}
                    onChange={e => setStyle({ headerSize: e.target.value as any })}
                    className="w-full px-2 py-1.5 text-sm border border-input rounded-lg bg-background text-foreground">
                    <option value="small">Petit</option>
                    <option value="medium">Moyen</option>
                    <option value="large">Grand</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">Style des totaux</label>
                  <select value={s.quote_style?.totalsStyle || 'highlighted'}
                    onChange={e => setStyle({ totalsStyle: e.target.value as any })}
                    className="w-full px-2 py-1.5 text-sm border border-input rounded-lg bg-background text-foreground">
                    <option value="highlighted">Surligné</option>
                    <option value="simple">Simple</option>
                    <option value="boxed">Encadré</option>
                  </select>
                </div>
              </div>
              <label className="flex items-center space-x-2 cursor-pointer">
                <input type="checkbox" checked={s.quote_style?.showBorders ?? true}
                  onChange={e => setStyle({ showBorders: e.target.checked })}
                  className="rounded" />
                <span className="text-xs text-foreground">Afficher les bordures</span>
              </label>
            </div>

            {/* Champs visibles */}
            <div className="glass rounded-xl shadow-lg p-4 space-y-3">
              <h2 className="text-sm font-semibold text-foreground flex items-center space-x-2">
                <Eye className="h-4 w-4 text-primary" /><span>Champs visibles sur le devis</span>
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {(Object.keys(FIELD_LABELS) as (keyof QuoteVisibleFields)[]).map(field => (
                  <label key={field} className="flex items-center space-x-2 cursor-pointer">
                    <input type="checkbox"
                      checked={s.quote_visible_fields?.[field] ?? true}
                      onChange={e => setFields({ [field]: e.target.checked })}
                      className="rounded" />
                    <span className="text-xs text-foreground">{FIELD_LABELS[field]}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Templates de partage */}
            <div className="glass rounded-xl shadow-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-foreground flex items-center space-x-2">
                  <MessageCircle className="h-4 w-4 text-primary" /><span>Templates de partage</span>
                </h2>
                <button onClick={() => setTemplates(DEFAULT_SHARE_TEMPLATES)}
                  className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-accent transition-colors">
                  Réinitialiser
                </button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1 flex items-center space-x-1">
                    <MessageCircle className="h-3.5 w-3.5 text-green-500" /><span>WhatsApp</span>
                  </label>
                  <textarea rows={10} value={s.share_templates?.whatsapp || ''}
                    onChange={e => setTemplates({ whatsapp: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-input rounded-lg bg-background text-foreground focus:ring-2 focus:ring-ring font-mono resize-y" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1 flex items-center space-x-1">
                    <Send className="h-3.5 w-3.5 text-blue-500" /><span>Objet Email</span>
                  </label>
                  <input type="text" value={s.share_templates?.email_subject || ''}
                    onChange={e => setTemplates({ email_subject: e.target.value })}
                    className="w-full px-3 py-1.5 text-sm border border-input rounded-lg bg-background text-foreground focus:ring-2 focus:ring-ring" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1 flex items-center space-x-1">
                    <Send className="h-3.5 w-3.5 text-blue-500" /><span>Corps Email</span>
                  </label>
                  <textarea rows={14} value={s.share_templates?.email_body || ''}
                    onChange={e => setTemplates({ email_body: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-input rounded-lg bg-background text-foreground focus:ring-2 focus:ring-ring font-mono resize-y" />
                </div>
              </div>
            </div>

            {/* Bottom save */}
            <div className="flex justify-end pb-4">
              <button onClick={handleEditSave} disabled={isEditSaving}
                className="flex items-center space-x-2 px-6 py-2.5 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground rounded-lg transition-colors text-sm">
                {isEditSaving ? <Loader className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                <span>Sauvegarder les paramètres</span>
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ---- LIST VIEW ----
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
          <button onClick={() => { setCreateFormData(emptyForm); setShowCreateModal(true); }}
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg transition-colors text-sm">
            <Plus className="h-3.5 w-3.5" /><span>Nouvelle</span>
          </button>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input type="text" value={searchQuery}
            onChange={e => { setSearchQuery(e.target.value); setCurrentPage(1); }}
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
              <button onClick={() => { setCreateFormData(emptyForm); setShowCreateModal(true); }}
                className="px-3 py-1.5 text-sm bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg">
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
                    {['Nom', 'Téléphone', 'Email', 'ICE', 'Actions'].map(h => (
                      <th key={h} className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{h}</th>
                    ))}
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
                          <button onClick={() => openEdit(company)}
                            className="p-1 text-primary hover:bg-primary/10 rounded transition-colors" title="Modifier">
                            <Edit className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => handleDelete(company)}
                            className="p-1 text-destructive hover:bg-destructive/10 rounded transition-colors" title="Supprimer">
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
                  {startIdx + 1}–{Math.min(startIdx + COMPANIES_PER_PAGE, filtered.length)} sur {filtered.length}
                </div>
                <div className="flex items-center space-x-1.5">
                  <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}
                    className="p-1 border border-border rounded hover:bg-accent disabled:opacity-50">
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                  <span className="px-2 text-xs text-muted-foreground">{currentPage}/{totalPages}</span>
                  <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}
                    className="p-1 border border-border rounded hover:bg-accent disabled:opacity-50">
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="glass rounded-xl shadow-2xl w-full max-w-lg p-5 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-foreground">Nouvelle Société</h2>
              <button onClick={() => setShowCreateModal(false)} className="p-1 hover:bg-accent rounded-lg">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {createFields.map(({ key, label, placeholder }) => (
                <div key={key} className={key === 'name' || key === 'address' ? 'sm:col-span-2' : ''}>
                  <label className="block text-xs font-medium text-foreground mb-1">{label}</label>
                  <input type="text" value={createFormData[key]}
                    onChange={e => setCreateFormData(prev => ({ ...prev, [key]: e.target.value }))}
                    className="w-full px-3 py-1.5 text-sm border border-input rounded-lg focus:ring-2 focus:ring-ring bg-background text-foreground"
                    placeholder={placeholder} />
                </div>
              ))}
            </div>
            <div className="flex space-x-2">
              <button onClick={() => setShowCreateModal(false)}
                className="flex-1 px-3 py-1.5 text-sm border border-input rounded-lg hover:bg-accent text-foreground">
                Annuler
              </button>
              <button onClick={handleCreate} disabled={isCreating}
                className="flex-1 flex items-center justify-center space-x-1.5 px-3 py-1.5 text-sm bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg disabled:opacity-50">
                {isCreating ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                <span>Créer</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
