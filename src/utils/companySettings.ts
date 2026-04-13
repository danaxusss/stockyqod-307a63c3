import { settingsApi } from '@/lib/apiClient';

export interface QuoteVisibleFields {
  showLogo: boolean;
  showCompanyAddress: boolean;
  showCompanyPhone: boolean;
  showCompanyEmail: boolean;
  showCompanyWebsite: boolean;
  showCompanyICE: boolean;
  showClientICE: boolean;
  showTVA: boolean;
  showNotes: boolean;
  showPaymentTerms: boolean;
  showValidityDate: boolean;
}

export interface QuoteStyle {
  accentColor: string;
  fontFamily: 'helvetica' | 'times' | 'courier';
  showBorders: boolean;
  borderRadius: number;
  headerSize: 'small' | 'medium' | 'large';
  totalsStyle: 'highlighted' | 'simple' | 'boxed';
}

const DEFAULT_QUOTE_STYLE: QuoteStyle = {
  accentColor: '#3B82F6',
  fontFamily: 'helvetica',
  showBorders: true,
  borderRadius: 1,
  headerSize: 'large',
  totalsStyle: 'highlighted',
};

export interface ShareTemplates {
  whatsapp: string;
  email_subject: string;
  email_body: string;
}

export const DEFAULT_SHARE_TEMPLATES: ShareTemplates = {
  whatsapp: `Bonjour {client},\n\nVoici le récapitulatif de votre devis {entreprise}.\n\n📋 Devis N° : {numero}\n💰 Montant HT : {montant_ht} Dh\n💰 Montant TTC : {montant_ttc} Dh\n📦 Articles : {nb_articles}\n\nN'hésitez pas à nous contacter pour plus d'informations.\n\nCordialement,\n{entreprise}\n📞 {telephone}\n✉️ {email}`,
  email_subject: `Devis {entreprise} - {numero}`,
  email_body: `Bonjour {client},\n\nVeuillez trouver ci-dessous le récapitulatif de votre devis {entreprise}.`,
};

const DEFAULT_VISIBLE_FIELDS: QuoteVisibleFields = {
  showLogo: true,
  showCompanyAddress: true,
  showCompanyPhone: true,
  showCompanyEmail: true,
  showCompanyWebsite: false,
  showCompanyICE: true,
  showClientICE: true,
  showTVA: true,
  showNotes: true,
  showPaymentTerms: true,
  showValidityDate: true,
};

export interface CompanySettings {
  id: string;
  company_name: string;
  address: string;
  phone: string;
  phone2: string;
  phone_dir: string;
  phone_gsm: string;
  email: string;
  website: string;
  ice: string;
  rc: string;
  if_number: string;
  cnss: string;
  patente: string;
  logo_url: string | null;
  logo_size: 'small' | 'medium' | 'large';
  quote_visible_fields: QuoteVisibleFields;
  quote_style: QuoteStyle;
  share_templates: ShareTemplates;
  payment_terms: string;
  tva_rate: number;
  quote_validity_days: number;
  updated_at: string;
}

function mapSettings(data: Record<string, unknown>): CompanySettings {
  const rawStyle = (data.quote_style as Record<string, unknown>) ?? {};
  const { share_templates: rawShareTemplates, ...styleOnly } = rawStyle as any;
  return {
    ...data,
    logo_size: (data.logo_size as CompanySettings['logo_size']) ?? 'medium',
    rc: (data.rc as string) ?? '',
    if_number: (data.if_number as string) ?? '',
    cnss: (data.cnss as string) ?? '',
    patente: (data.patente as string) ?? '',
    phone2: (data.phone2 as string) ?? '',
    phone_dir: (data.phone_dir as string) ?? '',
    phone_gsm: (data.phone_gsm as string) ?? '',
    quote_visible_fields: { ...DEFAULT_VISIBLE_FIELDS, ...((data.quote_visible_fields as Record<string, boolean>) ?? {}) },
    quote_style: { ...DEFAULT_QUOTE_STYLE, ...styleOnly },
    share_templates: { ...DEFAULT_SHARE_TEMPLATES, ...(rawShareTemplates ?? {}) },
    tva_rate: Number(data.tva_rate ?? 20),
  } as CompanySettings;
}

export class CompanySettingsService {
  static async getSettings(): Promise<CompanySettings | null> {
    try {
      const { settings } = await settingsApi.get();
      if (!settings) return null;
      return mapSettings(settings as Record<string, unknown>);
    } catch {
      return null;
    }
  }

  static async updateSettings(settings: Partial<CompanySettings>): Promise<void> {
    const payload: Record<string, unknown> = { ...settings };
    // Merge quote_style and share_templates into the quote_style JSON column
    if (settings.quote_style || settings.share_templates) {
      payload.quote_style = { ...(settings.quote_style ?? {}), share_templates: settings.share_templates };
      delete payload.share_templates;
    }
    await settingsApi.update(payload);
  }

  static async uploadLogo(file: File): Promise<string> {
    return settingsApi.uploadLogo(file);
  }

  static async deleteLogo(): Promise<void> {
    await settingsApi.update({ logo_url: null });
  }
}
