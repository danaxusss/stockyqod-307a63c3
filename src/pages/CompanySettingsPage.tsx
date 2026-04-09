// @ts-nocheck
import React, { useState, useEffect } from 'react';
import { Settings, Upload, Trash2, Save, Loader, Image, Building, Phone, Mail, Globe, Hash, FileText, Eye, Palette } from 'lucide-react';
import { CompanySettingsService, CompanySettings, QuoteVisibleFields, QuoteStyle } from '../utils/companySettings';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../context/ToastContext';
import { useNavigate } from 'react-router-dom';

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

export default function CompanySettingsPage() {
  const { isAdmin } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [settings, setSettings] = useState<CompanySettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) {
      navigate('/');
      return;
    }
    loadSettings();
  }, [isAdmin, navigate]);

  const loadSettings = async () => {
    setIsLoading(true);
    try {
      const data = await CompanySettingsService.getSettings();
      setSettings(data);
      if (data?.logo_url) setLogoPreview(data.logo_url);
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
      await CompanySettingsService.deleteLogo();
      await CompanySettingsService.updateSettings({ logo_url: null });
      setLogoFile(null);
      setLogoPreview(null);
      setSettings(prev => prev ? { ...prev, logo_url: null } : prev);
      showToast({ type: 'success', message: 'Logo supprimé' });
    } catch {
      showToast({ type: 'error', message: 'Erreur lors de la suppression du logo' });
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
      // Upload logo if new file selected
      let logoUrl = settings.logo_url;
      if (logoFile) {
        logoUrl = await CompanySettingsService.uploadLogo(logoFile);
        setLogoFile(null);
      }

      await CompanySettingsService.updateSettings({
        company_name: settings.company_name,
        address: settings.address,
        phone: settings.phone,
        email: settings.email,
        website: settings.website,
        ice: settings.ice,
        logo_url: logoUrl,
        quote_visible_fields: settings.quote_visible_fields,
        quote_style: settings.quote_style,
        payment_terms: settings.payment_terms,
        tva_rate: settings.tva_rate,
        quote_validity_days: settings.quote_validity_days,
      });

      showToast({ type: 'success', message: 'Paramètres sauvegardés avec succès' });
    } catch (error) {
      showToast({ type: 'error', message: 'Erreur lors de la sauvegarde' });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto p-6 flex items-center justify-center min-h-[50vh]">
        <Loader className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="max-w-4xl mx-auto p-6 text-center text-muted-foreground">
        Impossible de charger les paramètres.
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="glass rounded-2xl shadow-xl p-6">
        <div className="flex items-center space-x-3">
          <div className="p-3 bg-primary rounded-xl" style={{ boxShadow: 'var(--shadow-glow)' }}>
            <Settings className="h-6 w-6 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Paramètres de l'Entreprise</h1>
            <p className="text-muted-foreground">Configurez les informations affichées sur les devis</p>
          </div>
        </div>
      </div>

      {/* Company Info */}
      <div className="glass rounded-2xl shadow-xl p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center space-x-2">
          <Building className="h-5 w-5" />
          <span>Informations de l'Entreprise</span>
        </h2>

        {/* Logo */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-foreground mb-2">Logo</label>
          <div className="flex items-center space-x-4">
            {logoPreview ? (
              <div className="relative">
                <img src={logoPreview} alt="Logo" className="h-16 w-auto rounded-lg border border-border" />
                <button
                  onClick={handleRemoveLogo}
                  className="absolute -top-2 -right-2 p-1 bg-destructive text-destructive-foreground rounded-full"
                >
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
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Nom de l'entreprise</label>
            <input
              type="text"
              value={settings.company_name}
              onChange={e => setSettings({ ...settings, company_name: e.target.value })}
              className="w-full px-4 py-2 border border-input rounded-lg bg-secondary text-foreground focus:ring-2 focus:ring-ring"
              placeholder="Mon Entreprise"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">ICE / Identifiant Fiscal</label>
            <input
              type="text"
              value={settings.ice}
              onChange={e => setSettings({ ...settings, ice: e.target.value })}
              className="w-full px-4 py-2 border border-input rounded-lg bg-secondary text-foreground focus:ring-2 focus:ring-ring"
              placeholder="Numéro ICE"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-foreground mb-1">Adresse</label>
            <input
              type="text"
              value={settings.address}
              onChange={e => setSettings({ ...settings, address: e.target.value })}
              className="w-full px-4 py-2 border border-input rounded-lg bg-secondary text-foreground focus:ring-2 focus:ring-ring"
              placeholder="Adresse complète"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Téléphone</label>
            <input
              type="text"
              value={settings.phone}
              onChange={e => setSettings({ ...settings, phone: e.target.value })}
              className="w-full px-4 py-2 border border-input rounded-lg bg-secondary text-foreground focus:ring-2 focus:ring-ring"
              placeholder="06 12 34 56 78"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Email</label>
            <input
              type="text"
              value={settings.email}
              onChange={e => setSettings({ ...settings, email: e.target.value })}
              className="w-full px-4 py-2 border border-input rounded-lg bg-secondary text-foreground focus:ring-2 focus:ring-ring"
              placeholder="contact@entreprise.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Site web</label>
            <input
              type="text"
              value={settings.website}
              onChange={e => setSettings({ ...settings, website: e.target.value })}
              className="w-full px-4 py-2 border border-input rounded-lg bg-secondary text-foreground focus:ring-2 focus:ring-ring"
              placeholder="www.entreprise.com"
            />
          </div>
        </div>
      </div>

      {/* Quote Settings */}
      <div className="glass rounded-2xl shadow-xl p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center space-x-2">
          <FileText className="h-5 w-5" />
          <span>Paramètres du Devis</span>
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Taux TVA (%)</label>
            <input
              type="number"
              value={settings.tva_rate}
              onChange={e => setSettings({ ...settings, tva_rate: parseFloat(e.target.value) || 0 })}
              className="w-full px-4 py-2 border border-input rounded-lg bg-secondary text-foreground focus:ring-2 focus:ring-ring"
              min="0"
              max="100"
              step="0.5"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Conditions de paiement</label>
            <input
              type="text"
              value={settings.payment_terms}
              onChange={e => setSettings({ ...settings, payment_terms: e.target.value })}
              className="w-full px-4 py-2 border border-input rounded-lg bg-secondary text-foreground focus:ring-2 focus:ring-ring"
              placeholder="30 jours"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Validité du devis (jours)</label>
            <input
              type="number"
              value={settings.quote_validity_days}
              onChange={e => setSettings({ ...settings, quote_validity_days: parseInt(e.target.value) || 30 })}
              className="w-full px-4 py-2 border border-input rounded-lg bg-secondary text-foreground focus:ring-2 focus:ring-ring"
              min="1"
            />
          </div>
        </div>
      </div>

      {/* Visible Fields */}
      <div className="glass rounded-2xl shadow-xl p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center space-x-2">
          <Eye className="h-5 w-5" />
          <span>Éléments Visibles sur le Devis</span>
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {(Object.keys(FIELD_LABELS) as Array<keyof QuoteVisibleFields>).map(field => (
            <label
              key={field}
              className="flex items-center space-x-3 p-3 bg-secondary rounded-lg cursor-pointer hover:bg-accent transition-colors"
            >
              <input
                type="checkbox"
                checked={settings.quote_visible_fields[field]}
                onChange={() => handleFieldToggle(field)}
                className="h-4 w-4 rounded border-primary text-primary focus:ring-ring"
              />
              <span className="text-sm text-foreground">{FIELD_LABELS[field]}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Save Button */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="flex items-center space-x-2 px-6 py-3 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground rounded-lg transition-colors"
        >
          {isSaving ? (
            <>
              <Loader className="h-4 w-4 animate-spin" />
              <span>Sauvegarde...</span>
            </>
          ) : (
            <>
              <Save className="h-4 w-4" />
              <span>Sauvegarder les Paramètres</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
