// @ts-nocheck
import React, { useState, useEffect } from 'react';
import { Settings, Upload, Trash2, Save, Loader, Image, Building, Phone, Mail, Globe, Hash, FileText, Eye, Palette, Users, Package, Edit3, Check, X, MessageCircle, Send, Stamp, Bot, Zap, ToggleLeft, ToggleRight } from 'lucide-react';
import { CompanySettingsService, CompanySettings, QuoteVisibleFields, QuoteStyle, DEFAULT_SHARE_TEMPLATES } from '../utils/companySettings';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../context/ToastContext';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import UserManagementPage from './UserManagementPage';
import { supabase } from '@/integrations/supabase/client';

const FIELD_LABELS: Record<keyof QuoteVisibleFields, string> = {
  showLogo: 'Logo de l\'entreprise',
  showCompanyAddress: 'Adresse de l\'entreprise',
  showCompanyPhone: 'Téléphone de l\'entreprise',
  showCompanyEmail: 'Email de l\'entreprise',
  showCompanyWebsite: 'Site web de l\'entreprise',
  showCompanyICE: 'ICE de l\'entreprise',
  showClientICE: 'ICE du client',
  showTVA: 'Afficher TVA (détail HT/TVA/TTC)',
  showNotes: 'Notes sur le devis',
  showPaymentTerms: 'Modalités de paiement',
  showValidityDate: 'Date de validité',
};

function CompanySettingsTab() {
  const { showToast } = useToast();
  const { companyId } = useAuth();
  const [settings, setSettings] = useState<CompanySettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [stampFile, setStampFile] = useState<File | null>(null);
  const [stampPreview, setStampPreview] = useState<string | null>(null);

  useEffect(() => {
    loadSettings();
  }, [companyId]);

  const loadSettings = async () => {
    setIsLoading(true);
    try {
      const data = await CompanySettingsService.getSettings(companyId ?? undefined);
      setSettings(data);
      if (data?.logo_url) setLogoPreview(data.logo_url);
      if (data?.stamp_url) setStampPreview(data.stamp_url);
    } catch (error) {
      showToast({ type: 'error', message: 'Erreur lors du chargement des paramètres' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoFile(file);
    setLogoPreview(URL.createObjectURL(file));
  };

  const handleRemoveLogo = async () => {
    try {
      if (companyId) {
        await CompanySettingsService.deleteLogo(companyId);
        await CompanySettingsService.updateCompanySettings(companyId, { logo_url: null });
      } else {
        await CompanySettingsService.updateSettings({ logo_url: null });
      }
      setLogoFile(null);
      setLogoPreview(null);
      setSettings(prev => prev ? { ...prev, logo_url: null } : prev);
      showToast({ type: 'success', message: 'Logo supprimé' });
    } catch {
      showToast({ type: 'error', message: 'Erreur lors de la suppression du logo' });
    }
  };

  const handleStampChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setStampFile(file);
    setStampPreview(URL.createObjectURL(file));
  };

  const handleRemoveStamp = async () => {
    try {
      if (companyId) {
        await CompanySettingsService.deleteStamp(companyId);
        await CompanySettingsService.updateCompanySettings(companyId, { stamp_url: null });
      }
      setStampFile(null);
      setStampPreview(null);
      setSettings(prev => prev ? { ...prev, stamp_url: null } : prev);
      showToast({ type: 'success', message: 'Tampon supprimé' });
    } catch {
      showToast({ type: 'error', message: 'Erreur lors de la suppression du tampon' });
    }
  };

  const handleFieldToggle = (field: keyof QuoteVisibleFields) => {
    if (!settings) return;
    setSettings({
      ...settings,
      quote_visible_fields: {
        ...settings.quote_visible_fields,
        [field]: !settings.quote_visible_fields[field],
      },
    });
  };

  const handleSave = async () => {
    if (!settings) return;
    setIsSaving(true);
    try {
      let logoUrl = settings.logo_url;
      if (logoFile && companyId) {
        logoUrl = await CompanySettingsService.uploadLogo(logoFile, companyId);
        setLogoFile(null);
      }

      let stampUrl = settings.stamp_url;
      if (stampFile && companyId) {
        stampUrl = await CompanySettingsService.uploadStamp(stampFile, companyId);
        setStampFile(null);
      }

      const payload = {
        company_name: settings.company_name,
        address: settings.address,
        phone: settings.phone,
        phone2: settings.phone2,
        email: settings.email,
        website: settings.website,
        ice: settings.ice,
        rc: settings.rc,
        if_number: settings.if_number,
        cnss: settings.cnss,
        patente: settings.patente,
        logo_url: logoUrl,
        logo_size: settings.logo_size,
        stamp_url: stampUrl,
        stamp_size: settings.stamp_size,
        use_stamp: settings.use_stamp,
        quote_visible_fields: settings.quote_visible_fields,
        quote_style: settings.quote_style,
        share_templates: settings.share_templates,
        payment_terms: settings.payment_terms,
        tva_rate: settings.tva_rate,
        quote_validity_days: settings.quote_validity_days,
      };

      if (companyId) {
        await CompanySettingsService.updateCompanySettings(companyId, payload);
      } else {
        await CompanySettingsService.updateSettings(payload);
      }

      showToast({ type: 'success', message: 'Paramètres sauvegardés avec succès' });
    } catch (error) {
      showToast({ type: 'error', message: 'Erreur lors de la sauvegarde' });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[30vh]">
        <Loader className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="text-center text-muted-foreground py-8">
        Impossible de charger les paramètres.
      </div>
    );
  }

  const inputClass = "w-full px-3 py-1.5 text-sm border border-input rounded-lg bg-secondary text-foreground focus:ring-2 focus:ring-ring";

  return (
    <div className="space-y-4">
      {/* Company Info */}
      <div className="glass rounded-xl shadow-lg p-4">
        <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center space-x-1.5">
          <Building className="h-4 w-4" /><span>Informations Entreprise</span>
        </h2>

        {/* Logo */}
        <div className="mb-4">
          <label className="block text-xs font-medium text-foreground mb-1">Logo</label>
          <div className="flex items-center space-x-4">
            {logoPreview ? (
              <div className="relative">
                <img src={logoPreview} alt="Logo" className="h-16 w-auto rounded-lg border border-border" />
                <button onClick={handleRemoveLogo} className="absolute -top-2 -right-2 p-1 bg-destructive text-destructive-foreground rounded-full">
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <div className="h-16 w-16 rounded-lg border-2 border-dashed border-border flex items-center justify-center">
                <Image className="h-6 w-6 text-muted-foreground" />
              </div>
            )}
            <label className="cursor-pointer flex items-center space-x-2 px-4 py-2 bg-secondary hover:bg-accent text-foreground rounded-lg transition-colors">
              <Upload className="h-4 w-4" />
              <span>Choisir un logo</span>
              <input type="file" accept="image/*" onChange={handleLogoChange} className="hidden" />
            </label>
          </div>
          {(logoPreview || settings.logo_url) && (
            <div className="mt-2">
              <label className="block text-xs font-medium text-foreground mb-1">Taille logo dans devis</label>
              <select
                value={settings.logo_size || 'medium'}
                onChange={e => setSettings({ ...settings, logo_size: e.target.value as 'small' | 'medium' | 'large' })}
                className={inputClass + " max-w-xs"}
              >
                <option value="small">Petit</option>
                <option value="medium">Moyen</option>
                <option value="large">Grand</option>
              </select>
            </div>
          )}
        </div>

        {/* Stamp */}
        <div className="mb-4">
          <label className="block text-xs font-medium text-foreground mb-1 flex items-center space-x-1.5"><Stamp className="h-3.5 w-3.5" /><span>Tampon (PNG transparent)</span></label>
          <div className="flex items-center space-x-4">
            {stampPreview ? (
              <div className="relative">
                <img src={stampPreview} alt="Tampon" className="h-16 w-auto rounded-lg border border-border bg-[url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAABmJLR0QA/wD/AP+gvaeTAAAADUlEQVQI12NgYGD4DwABBAEAdkIWlAAAAABJRU5ErkJggg==')] bg-repeat" />
                <button onClick={handleRemoveStamp} className="absolute -top-2 -right-2 p-1 bg-destructive text-destructive-foreground rounded-full">
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <div className="h-16 w-16 rounded-lg border-2 border-dashed border-border flex items-center justify-center">
                <Stamp className="h-6 w-6 text-muted-foreground" />
              </div>
            )}
            <label className="cursor-pointer flex items-center space-x-2 px-4 py-2 bg-secondary hover:bg-accent text-foreground rounded-lg transition-colors">
              <Upload className="h-4 w-4" />
              <span>Choisir un tampon</span>
              <input type="file" accept="image/png" onChange={handleStampChange} className="hidden" />
            </label>
          </div>
          {(stampPreview || settings.stamp_url) && (
            <div className="mt-2 flex items-center gap-4">
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">Taille tampon dans devis</label>
                <select
                  value={settings.stamp_size || 'medium'}
                  onChange={e => setSettings({ ...settings, stamp_size: e.target.value as 'small' | 'medium' | 'large' })}
                  className={inputClass + " max-w-xs"}
                >
                  <option value="small">Petit</option>
                  <option value="medium">Moyen</option>
                  <option value="large">Grand</option>
                </select>
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">Nom de l'entreprise</label>
            <input type="text" value={settings.company_name} onChange={e => setSettings({ ...settings, company_name: e.target.value })} className={inputClass} placeholder="CUISIMAT Equipements s.a.r.l" />
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-foreground mb-1">Adresse</label>
            <input type="text" value={settings.address} onChange={e => setSettings({ ...settings, address: e.target.value })} className={inputClass} placeholder="BD BRAHIM ROUDANI RES PERLA MAARIF CASABLANCA" />
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">ICE</label>
            <input type="text" value={settings.ice} onChange={e => setSettings({ ...settings, ice: e.target.value })} className={inputClass} placeholder="000061298000065" />
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">RC (Registre de Commerce)</label>
            <input type="text" value={settings.rc} onChange={e => setSettings({ ...settings, rc: e.target.value })} className={inputClass} placeholder="299179" />
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">IF (Identifiant Fiscal)</label>
            <input type="text" value={settings.if_number} onChange={e => setSettings({ ...settings, if_number: e.target.value })} className={inputClass} placeholder="40445099" />
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">CNSS</label>
            <input type="text" value={settings.cnss} onChange={e => setSettings({ ...settings, cnss: e.target.value })} className={inputClass} placeholder="8955504" />
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">Patente</label>
            <input type="text" value={settings.patente} onChange={e => setSettings({ ...settings, patente: e.target.value })} className={inputClass} placeholder="35874257" />
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">Téléphone 1</label>
            <input type="text" value={settings.phone} onChange={e => setSettings({ ...settings, phone: e.target.value })} className={inputClass} placeholder="05 20 18 06 45" />
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">Téléphone 2</label>
            <input type="text" value={settings.phone2} onChange={e => setSettings({ ...settings, phone2: e.target.value })} className={inputClass} placeholder="05 22 99 60 84" />
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">Email</label>
            <input type="text" value={settings.email} onChange={e => setSettings({ ...settings, email: e.target.value })} className={inputClass} placeholder="nourdharchi@gmail.com" />
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">Site web</label>
            <input type="text" value={settings.website} onChange={e => setSettings({ ...settings, website: e.target.value })} className={inputClass} placeholder="www.cuisimat-groupe.ma" />
          </div>
        </div>
      </div>

      {/* Quote Settings */}
      <div className="glass rounded-xl shadow-lg p-4">
        <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center space-x-2">
          <FileText className="h-5 w-5" /><span>Paramètres du Devis</span>
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">Taux TVA (%)</label>
            <input type="number" value={settings.tva_rate} onChange={e => setSettings({ ...settings, tva_rate: parseFloat(e.target.value) || 0 })} className={inputClass} min="0" max="100" step="0.5" />
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">Conditions de paiement</label>
            <input type="text" value={settings.payment_terms} onChange={e => setSettings({ ...settings, payment_terms: e.target.value })} className={inputClass} placeholder="30 jours" />
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">Validité du devis (jours)</label>
            <input type="number" value={settings.quote_validity_days} onChange={e => setSettings({ ...settings, quote_validity_days: parseInt(e.target.value) || 30 })} className={inputClass} min="1" />
          </div>
        </div>
      </div>

      {/* Quote Styling */}
      <div className="glass rounded-xl shadow-lg p-4">
        <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center space-x-2">
          <Palette className="h-5 w-5" /><span>Style du Devis</span>
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">Couleur d'accent</label>
            <div className="flex items-center space-x-3">
              <input type="color" value={settings.quote_style?.accentColor || '#3B82F6'} onChange={e => setSettings({ ...settings, quote_style: { ...settings.quote_style, accentColor: e.target.value } })} className="h-10 w-14 rounded-lg border border-input cursor-pointer" />
              <input type="text" value={settings.quote_style?.accentColor || '#3B82F6'} onChange={e => setSettings({ ...settings, quote_style: { ...settings.quote_style, accentColor: e.target.value } })} className="flex-1 px-4 py-2 border border-input rounded-lg bg-secondary text-foreground focus:ring-2 focus:ring-ring" placeholder="#3B82F6" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">Police</label>
            <select value={settings.quote_style?.fontFamily || 'helvetica'} onChange={e => setSettings({ ...settings, quote_style: { ...settings.quote_style, fontFamily: e.target.value as QuoteStyle['fontFamily'] } })} className={inputClass}>
              <option value="helvetica">Helvetica (Moderne)</option>
              <option value="times">Times (Classique)</option>
              <option value="courier">Courier (Monospace)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">Taille de l'en-tête</label>
            <select value={settings.quote_style?.headerSize || 'large'} onChange={e => setSettings({ ...settings, quote_style: { ...settings.quote_style, headerSize: e.target.value as QuoteStyle['headerSize'] } })} className={inputClass}>
              <option value="small">Petit</option>
              <option value="medium">Moyen</option>
              <option value="large">Grand</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">Style des totaux</label>
            <select value={settings.quote_style?.totalsStyle || 'highlighted'} onChange={e => setSettings({ ...settings, quote_style: { ...settings.quote_style, totalsStyle: e.target.value as QuoteStyle['totalsStyle'] } })} className={inputClass}>
              <option value="highlighted">Surligné (couleur)</option>
              <option value="boxed">Encadré</option>
              <option value="simple">Simple</option>
            </select>
          </div>
          <div className="flex items-center space-x-3">
            <label className="flex items-center space-x-3 p-3 bg-secondary rounded-lg cursor-pointer hover:bg-accent transition-colors flex-1">
              <input type="checkbox" checked={settings.quote_style?.showBorders !== false} onChange={e => setSettings({ ...settings, quote_style: { ...settings.quote_style, showBorders: e.target.checked } })} className="h-4 w-4 rounded border-primary text-primary focus:ring-ring" />
              <span className="text-sm text-foreground">Afficher les bordures du tableau</span>
            </label>
          </div>
        </div>
        <div className="mt-4 flex items-center space-x-3">
          <span className="text-sm text-muted-foreground">Aperçu :</span>
          <div className="h-8 w-8 rounded-md" style={{ backgroundColor: settings.quote_style?.accentColor || '#3B82F6' }} />
          <div className="h-6 px-3 rounded text-white text-xs flex items-center font-bold" style={{ backgroundColor: settings.quote_style?.accentColor || '#3B82F6' }}>TOTAL TTC</div>
          <div className="h-6 px-3 rounded text-xs flex items-center font-bold" style={{ color: settings.quote_style?.accentColor || '#3B82F6' }}>DEVIS</div>
        </div>
      </div>

      {/* Visible Fields */}
      <div className="glass rounded-xl shadow-lg p-4">
        <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center space-x-2">
          <Eye className="h-5 w-5" /><span>Éléments Visibles sur le Devis</span>
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {(Object.keys(FIELD_LABELS) as Array<keyof QuoteVisibleFields>).map(field => (
            <label key={field} className="flex items-center space-x-3 p-3 bg-secondary rounded-lg cursor-pointer hover:bg-accent transition-colors">
              <input type="checkbox" checked={settings.quote_visible_fields[field]} onChange={() => handleFieldToggle(field)} className="h-4 w-4 rounded border-primary text-primary focus:ring-ring" />
              <span className="text-sm text-foreground">{FIELD_LABELS[field]}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Share Templates */}
      <div className="glass rounded-xl shadow-lg p-4">
        <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center space-x-2">
          <Send className="h-5 w-5" /><span>Templates de Partage</span>
        </h2>
        <p className="text-[11px] text-muted-foreground mb-3">
          Variables disponibles : <code className="bg-secondary px-1 rounded">{'{client}'}</code> <code className="bg-secondary px-1 rounded">{'{entreprise}'}</code> <code className="bg-secondary px-1 rounded">{'{numero}'}</code> <code className="bg-secondary px-1 rounded">{'{montant_ht}'}</code> <code className="bg-secondary px-1 rounded">{'{montant_ttc}'}</code> <code className="bg-secondary px-1 rounded">{'{montant_tva}'}</code> <code className="bg-secondary px-1 rounded">{'{tva}'}</code> <code className="bg-secondary px-1 rounded">{'{nb_articles}'}</code> <code className="bg-secondary px-1 rounded">{'{date}'}</code> <code className="bg-secondary px-1 rounded">{'{telephone}'}</code> <code className="bg-secondary px-1 rounded">{'{email}'}</code> <code className="bg-secondary px-1 rounded">{'{adresse}'}</code>
        </p>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-foreground mb-1 flex items-center space-x-1.5">
              <MessageCircle className="h-3.5 w-3.5 text-emerald-500" /><span>Message WhatsApp</span>
            </label>
            <textarea
              value={settings.share_templates?.whatsapp || DEFAULT_SHARE_TEMPLATES.whatsapp}
              onChange={e => setSettings({ ...settings, share_templates: { ...settings.share_templates, whatsapp: e.target.value } })}
              className={inputClass}
              rows={8}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground mb-1 flex items-center space-x-1.5">
              <Mail className="h-3.5 w-3.5 text-blue-500" /><span>Objet Email</span>
            </label>
            <input
              type="text"
              value={settings.share_templates?.email_subject || DEFAULT_SHARE_TEMPLATES.email_subject}
              onChange={e => setSettings({ ...settings, share_templates: { ...settings.share_templates, email_subject: e.target.value } })}
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground mb-1 flex items-center space-x-1.5">
              <Mail className="h-3.5 w-3.5 text-blue-500" /><span>Corps Email</span>
            </label>
            <textarea
              value={settings.share_templates?.email_body || DEFAULT_SHARE_TEMPLATES.email_body}
              onChange={e => setSettings({ ...settings, share_templates: { ...settings.share_templates, email_body: e.target.value } })}
              className={inputClass}
              rows={12}
            />
          </div>
          <button
            onClick={() => setSettings({ ...settings, share_templates: { ...DEFAULT_SHARE_TEMPLATES } })}
            className="text-xs text-primary hover:underline"
          >
            Réinitialiser les templates par défaut
          </button>
        </div>
      </div>

      {/* Save Button */}
      <div className="flex justify-end">
        <button onClick={handleSave} disabled={isSaving} className="flex items-center space-x-2 px-6 py-3 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground rounded-lg transition-colors">
          {isSaving ? (<><Loader className="h-4 w-4 animate-spin" /><span>Sauvegarde...</span></>) : (<><Save className="h-4 w-4" /><span>Sauvegarder les Paramètres</span></>)}
        </button>
      </div>
    </div>
  );
}

export default function CompanySettingsPage() {
  const { isSuperAdmin, authReady } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const defaultTab = searchParams.get('tab') || 'company';

  useEffect(() => {
    if (authReady && !isSuperAdmin) {
      navigate('/');
    }
  }, [authReady, isSuperAdmin, navigate]);

  if (!authReady) return null;
  if (!isSuperAdmin) return null;

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      {/* Header */}
      <div className="glass rounded-xl shadow-lg p-4">
        <div className="flex items-center space-x-2.5">
          <div className="p-2 bg-primary rounded-lg" style={{ boxShadow: 'var(--shadow-glow)' }}>
            <Settings className="h-4 w-4 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-foreground">Paramètres</h1>
            <p className="text-xs text-muted-foreground">Entreprise & Utilisateurs</p>
          </div>
        </div>
      </div>

      <Tabs defaultValue={defaultTab} onValueChange={(v) => setSearchParams({ tab: v })} className="w-full">
        <TabsList className="w-full">
          <TabsTrigger value="company" className="flex-1">
            <Building className="h-3.5 w-3.5 mr-1.5" />Entreprise
          </TabsTrigger>
          <TabsTrigger value="users" className="flex-1">
            <Users className="h-3.5 w-3.5 mr-1.5" />Utilisateurs
          </TabsTrigger>
          <TabsTrigger value="products" className="flex-1">
            <Package className="h-3.5 w-3.5 mr-1.5" />Produits
          </TabsTrigger>
          <TabsTrigger value="ai" className="flex-1">
            <Bot className="h-3.5 w-3.5 mr-1.5" />IA
          </TabsTrigger>
        </TabsList>

        <TabsContent value="company">
          <CompanySettingsTab />
        </TabsContent>

        <TabsContent value="users">
          <UserManagementPage />
        </TabsContent>

        <TabsContent value="products">
          <ProductSettingsTab />
        </TabsContent>

        <TabsContent value="ai">
          <AISettingsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ProductSettingsTab() {
  const { showToast } = useToast();
  const [brands, setBrands] = useState<string[]>([]);
  const [providers, setProviders] = useState<string[]>([]);
  const [overrides, setOverrides] = useState<{ id: string; type: string; original_name: string; custom_name: string }[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editingItem, setEditingItem] = useState<{ type: string; name: string } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [activeSection, setActiveSection] = useState<'brands' | 'providers'>('brands');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    try {
      // Load unique brands and providers from products
      const { data: products } = await supabase.from('products').select('brand, provider');
      if (products) {
        setBrands([...new Set(products.map(p => p.brand).filter(Boolean))].sort());
        setProviders([...new Set(products.map(p => p.provider).filter(Boolean))].sort());
      }
      // Load existing overrides
      const { data: ov } = await supabase.from('product_name_overrides').select('*');
      if (ov) setOverrides(ov);
    } catch { /* ignore */ }
    setIsLoading(false);
  };

  const getOverrideForCurrent = (type: string, currentName: string) => {
    return overrides.find(o => o.type === type && o.custom_name === currentName);
  };

  const getOriginalName = (type: string, currentName: string) => {
    const override = getOverrideForCurrent(type, currentName);
    return override?.original_name || null;
  };

  const hasOverride = (type: string, currentName: string) => {
    return overrides.some(o => o.type === type && o.custom_name === currentName);
  };

  const startEdit = (type: string, name: string) => {
    setEditingItem({ type, name });
    setEditValue(name);
  };

  const cancelEdit = () => {
    setEditingItem(null);
    setEditValue('');
  };

  const saveEdit = async () => {
    if (!editingItem || !editValue.trim()) return;
    setSaving(true);
    try {
      const { type, name: currentName } = editingItem;
      const newName = editValue.trim();
      const existingOverride = getOverrideForCurrent(type, currentName);
      const originalName = existingOverride?.original_name || currentName;

      if (newName === originalName) {
        // Reverting to original — remove override
        if (existingOverride) {
          await supabase.from('product_name_overrides').delete().eq('id', existingOverride.id);
        }
        const field = type === 'brand' ? 'brand' : 'provider';
        await supabase.from('products').update({ [field]: originalName }).eq(field, currentName);
      } else if (newName !== currentName) {
        // Upsert override with original → new mapping
        await (supabase.from('product_name_overrides') as any).upsert({
          type,
          original_name: originalName,
          custom_name: newName,
        }, { onConflict: 'type,original_name' });
        const field = type === 'brand' ? 'brand' : 'provider';
        await supabase.from('products').update({ [field]: newName }).eq(field, currentName);
      }

      showToast({ type: 'success', message: 'Nom mis à jour' });
      await loadData();
      cancelEdit();
    } catch (err) {
      showToast({ type: 'error', message: 'Erreur lors de la mise à jour' });
    }
    setSaving(false);
  };

  const removeOverride = async (type: string, currentName: string) => {
    const existing = getOverrideForCurrent(type, currentName);
    if (!existing) return;
    try {
      const field = type === 'brand' ? 'brand' : 'provider';
      await supabase.from('products').update({ [field]: existing.original_name }).eq(field, currentName);
      await supabase.from('product_name_overrides').delete().eq('id', existing.id);
      showToast({ type: 'success', message: 'Nom restauré' });
      await loadData();
    } catch {
      showToast({ type: 'error', message: 'Erreur' });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const items = activeSection === 'brands' ? brands : providers;
  const type = activeSection === 'brands' ? 'brand' : 'provider';

  return (
    <div className="glass rounded-xl shadow-lg p-4 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground mb-1">Gestion des noms</h2>
        <p className="text-xs text-muted-foreground">
          Renommez les marques et fournisseurs. Les noms modifiés seront préservés lors des imports futurs.
        </p>
      </div>

      <div className="flex space-x-2">
        <button onClick={() => setActiveSection('brands')}
          className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${activeSection === 'brands' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-foreground hover:bg-accent'}`}>
          Marques ({brands.length})
        </button>
        <button onClick={() => setActiveSection('providers')}
          className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${activeSection === 'providers' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-foreground hover:bg-accent'}`}>
          Fournisseurs ({providers.length})
        </button>
      </div>

      <div className="space-y-1 max-h-[500px] overflow-y-auto">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Aucun élément</p>
        ) : items.map(name => {
          const isEditing = editingItem?.type === type && editingItem?.name === name;
          const overridden = hasOverride(type, name);
          const originalName = getOriginalName(type, name);
          return (
            <div key={name} className={`flex items-center justify-between p-2 rounded-lg border ${overridden ? 'border-primary/30 bg-primary/5' : 'border-border'}`}>
              {isEditing ? (
                <div className="flex items-center gap-2 flex-1">
                  <input type="text" value={editValue} onChange={e => setEditValue(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit(); }}
                    className="flex-1 px-2 py-1 text-sm border border-input rounded bg-background text-foreground"
                    autoFocus />
                  <button onClick={saveEdit} disabled={saving} className="p-1 text-emerald-500 hover:bg-emerald-500/10 rounded">
                    {saving ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  </button>
                  <button onClick={cancelEdit} className="p-1 text-muted-foreground hover:bg-accent rounded">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-foreground">{name}</span>
                    {originalName && (
                      <span className="ml-2 text-[10px] text-muted-foreground">(ex: {originalName})</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => startEdit(type, name)}
                      className="p-1 text-primary hover:bg-primary/10 rounded" title="Renommer">
                      <Edit3 className="h-3.5 w-3.5" />
                    </button>
                    {overridden && (
                      <button onClick={() => removeOverride(type, name)}
                        className="p-1 text-destructive hover:bg-destructive/10 rounded" title="Restaurer le nom original">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      {overrides.length > 0 && (
        <div className="pt-2 border-t border-border">
          <p className="text-xs text-muted-foreground">{overrides.length} nom(s) personnalisé(s)</p>
        </div>
      )}
    </div>
  );
}

const AI_MODELS = [
  // ── Gratuits (stables sur OpenRouter) ─────────────────────
  { value: 'deepseek/deepseek-chat-v3-0324:free',           label: '★ DeepSeek V3 (gratuit) — recommandé' },
  { value: 'deepseek/deepseek-r1:free',                     label: '★ DeepSeek R1 raisonnement (gratuit)' },
  { value: 'meta-llama/llama-3.3-70b-instruct:free',        label: '★ Llama 3.3 70B (gratuit)' },
  { value: 'meta-llama/llama-4-scout:free',                 label: '★ Llama 4 Scout (gratuit)' },
  { value: 'mistralai/mistral-small-3.1-24b-instruct:free', label: '★ Mistral Small 3.1 24B (gratuit)' },
  { value: 'qwen/qwen3-8b:free',                            label: '★ Qwen3 8B (gratuit)' },
  { value: 'qwen/qwen3-30b-a3b:free',                       label: '★ Qwen3 30B (gratuit)' },
  { value: 'qwen/qwen3-235b-a22b:free',                     label: '★ Qwen3 235B (gratuit)' },
  { value: 'nvidia/llama-3.1-nemotron-70b-instruct:free',   label: '★ NVIDIA Nemotron 70B (gratuit)' },
  { value: 'microsoft/phi-4:free',                          label: '★ Microsoft Phi-4 (gratuit)' },
  { value: 'nvidia/nemotron-3-super-120b-a12b:free',        label: '★ NVIDIA Nemotron Super 120B (gratuit)' },
  // ── Payants ───────────────────────────────────────────────
  { value: 'google/gemini-2.5-flash-preview',               label: 'Gemini 2.5 Flash Preview' },
  { value: 'google/gemini-flash-1.5',                       label: 'Gemini 1.5 Flash' },
  { value: 'anthropic/claude-haiku-4-5-20251001',           label: 'Claude Haiku 4.5' },
  { value: 'anthropic/claude-sonnet-4-5',                   label: 'Claude Sonnet 4.5' },
  { value: 'openai/gpt-4o-mini',                            label: 'GPT-4o Mini' },
  { value: 'openai/gpt-4o',                                 label: 'GPT-4o' },
  { value: '__custom__',                                     label: 'Modèle personnalisé…' },
];

function AISettingsTab() {
  const { showToast } = useToast();
  const { companyId } = useAuth();
  const [settings, setSettings] = useState<import('../utils/companySettings').CompanySettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [customModel, setCustomModel] = useState('');

  useEffect(() => {
    loadSettings();
  }, [companyId]);

  const loadSettings = async () => {
    setIsLoading(true);
    try {
      const data = await CompanySettingsService.getSettings(companyId ?? undefined);
      setSettings(data);
      if (data?.ai_model && !AI_MODELS.find(m => m.value === data.ai_model)) {
        setCustomModel(data.ai_model);
      }
    } catch {
      showToast({ type: 'error', message: 'Erreur lors du chargement' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    if (!settings || !companyId) return;
    setIsSaving(true);
    try {
      const modelToSave = settings.ai_model === '__custom__' ? customModel.trim() : settings.ai_model;
      await CompanySettingsService.updateCompanySettings(companyId, {
        ai_enabled: settings.ai_enabled,
        ai_model: modelToSave || 'google/gemini-2.0-flash-exp:free',
        ai_system_prompt: settings.ai_system_prompt,
      });
      showToast({ type: 'success', message: 'Paramètres IA sauvegardés' });
    } catch {
      showToast({ type: 'error', message: 'Erreur lors de la sauvegarde' });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) return (
    <div className="flex items-center justify-center py-12">
      <Loader className="h-6 w-6 animate-spin text-primary" />
    </div>
  );

  if (!settings) return (
    <div className="text-center text-muted-foreground py-8 text-sm">Impossible de charger les paramètres IA.</div>
  );

  const selectedModel = AI_MODELS.find(m => m.value === settings.ai_model) ? settings.ai_model : '__custom__';
  const inputClass = "w-full px-3 py-1.5 text-sm border border-input rounded-lg bg-secondary text-foreground focus:ring-2 focus:ring-ring";

  return (
    <div className="space-y-4">
      {/* Enable / disable */}
      <div className="glass rounded-xl shadow-lg p-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-foreground flex items-center space-x-1.5">
              <Bot className="h-4 w-4" /><span>Assistant IA</span>
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">Active ou désactive le widget chat pour les utilisateurs</p>
          </div>
          <button
            onClick={() => setSettings({ ...settings, ai_enabled: !settings.ai_enabled })}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${settings.ai_enabled ? 'bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25' : 'bg-secondary text-muted-foreground hover:bg-accent'}`}
          >
            {settings.ai_enabled ? <ToggleRight className="h-4 w-4" /> : <ToggleLeft className="h-4 w-4" />}
            {settings.ai_enabled ? 'Activé' : 'Désactivé'}
          </button>
        </div>
      </div>

      {/* Model selector */}
      <div className="glass rounded-xl shadow-lg p-4 space-y-3">
        <h2 className="text-sm font-semibold text-foreground flex items-center space-x-1.5">
          <Zap className="h-4 w-4" /><span>Modèle IA (via OpenRouter)</span>
        </h2>
        <div>
          <label className="block text-xs font-medium text-foreground mb-1">Modèle</label>
          <select
            value={selectedModel}
            onChange={e => setSettings({ ...settings, ai_model: e.target.value })}
            className={inputClass}
          >
            {AI_MODELS.map(m => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>
        {(settings.ai_model === '__custom__' || selectedModel === '__custom__') && (
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">ID du modèle personnalisé</label>
            <input
              type="text"
              value={customModel}
              onChange={e => setCustomModel(e.target.value)}
              placeholder="ex: mistralai/mistral-7b-instruct"
              className={inputClass}
            />
            <p className="text-[11px] text-muted-foreground mt-1">Voir les modèles disponibles sur openrouter.ai/models</p>
          </div>
        )}
      </div>

      {/* System prompt */}
      <div className="glass rounded-xl shadow-lg p-4 space-y-3">
        <h2 className="text-sm font-semibold text-foreground flex items-center space-x-1.5">
          <FileText className="h-4 w-4" /><span>Instructions supplémentaires (prompt système)</span>
        </h2>
        <p className="text-xs text-muted-foreground">
          Ces instructions s'ajoutent au comportement par défaut de l'assistant. Utilisez-les pour personnaliser le ton,
          ajouter des règles métier, ou préciser des produits prioritaires.
          L'assistant reste limité au catalogue de la base de données — il ne cherche jamais sur Internet.
        </p>
        <textarea
          value={settings.ai_system_prompt || ''}
          onChange={e => setSettings({ ...settings, ai_system_prompt: e.target.value })}
          placeholder={`Ex:\n- Toujours proposer la garantie étendue sur les appareils électroménagers\n- Prioriser les produits de la marque SAMSUNG\n- Ne pas mentionner les prix revendeurs aux clients particuliers`}
          className={inputClass + ' font-mono resize-y'}
          rows={10}
        />
        <p className="text-[11px] text-muted-foreground">
          Variables disponibles dans les réponses : aucune variable spéciale requise. L'IA a accès aux noms, prix, stocks et barcodes du catalogue.
        </p>
      </div>

      {/* Save */}
      <div className="flex justify-end pb-2">
        <button onClick={handleSave} disabled={isSaving}
          className="flex items-center space-x-2 px-5 py-2 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground rounded-lg text-sm transition-colors">
          {isSaving ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          <span>Sauvegarder</span>
        </button>
      </div>
    </div>
  );
}
