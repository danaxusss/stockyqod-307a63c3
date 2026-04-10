import { supabase } from '@/integrations/supabase/client';

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
  whatsapp: `Bonjour {client},

Voici le récapitulatif de votre devis {entreprise}.

📋 Devis N° : {numero}
💰 Montant HT : {montant_ht} Dh
💰 Montant TTC : {montant_ttc} Dh
📦 Articles : {nb_articles}

N'hésitez pas à nous contacter pour plus d'informations.

Cordialement,
{entreprise}
📞 {telephone}
✉️ {email}`,
  email_subject: `Devis {entreprise} - {numero}`,
  email_body: `Bonjour {client},

Veuillez trouver ci-dessous le récapitulatif de votre devis {entreprise}.

━━━━━━━━━━━━━━━━━━━━━━━━━━
  DEVIS N° {numero}
━━━━━━━━━━━━━━━━━━━━━━━━━━

  Montant HT :    {montant_ht} Dh
  TVA ({tva}%) :     {montant_tva} Dh
  ────────────────────────
  TOTAL TTC :     {montant_ttc} Dh

  Articles :      {nb_articles}
  Date :          {date}

━━━━━━━━━━━━━━━━━━━━━━━━━━

N'hésitez pas à nous contacter si vous avez des questions.

Cordialement,
{entreprise}
Tél : {telephone}
Email : {email}
{adresse}`,
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

export class CompanySettingsService {
  static async getSettings(): Promise<CompanySettings | null> {
    const { data, error } = await supabase
      .from('company_settings')
      .select('*')
      .limit(1)
      .single();

    if (error || !data) return null;

    const rawStyle = data.quote_style as Record<string, unknown> || {};
    const { share_templates: rawShareTemplates, ...styleOnly } = rawStyle as any;

    return {
      ...data,
      logo_size: (data as any).logo_size || 'medium',
      rc: (data as any).rc || '',
      if_number: (data as any).if_number || '',
      cnss: (data as any).cnss || '',
      patente: (data as any).patente || '',
      phone2: (data as any).phone2 || '',
      phone_dir: (data as any).phone_dir || '',
      phone_gsm: (data as any).phone_gsm || '',
      quote_visible_fields: {
        ...DEFAULT_VISIBLE_FIELDS,
        ...(data.quote_visible_fields as Record<string, boolean>),
      },
      quote_style: {
        ...DEFAULT_QUOTE_STYLE,
        ...styleOnly,
      },
      share_templates: {
        ...DEFAULT_SHARE_TEMPLATES,
        ...(rawShareTemplates || {}),
      },
    } as CompanySettings;
  }

  static async updateSettings(settings: Partial<CompanySettings>): Promise<void> {
    const current = await this.getSettings();
    if (!current) throw new Error('No settings found');

    const updateData: Record<string, unknown> = {
      ...settings,
      updated_at: new Date().toISOString(),
    };
    if (settings.quote_visible_fields) {
      updateData.quote_visible_fields = settings.quote_visible_fields as unknown as Record<string, boolean>;
    }
    if (settings.quote_style || settings.share_templates) {
      const mergedStyle: Record<string, unknown> = {
        ...(settings.quote_style || {}),
        share_templates: settings.share_templates || undefined,
      };
      updateData.quote_style = mergedStyle;
      delete updateData.share_templates;
    }

    const { error } = await supabase
      .from('company_settings')
      .update(updateData as any)
      .eq('id', current.id);

    if (error) throw error;
  }

  static async uploadLogo(file: File): Promise<string> {
    const ext = file.name.split('.').pop();
    const path = `logo.${ext}`;

    await supabase.storage.from('company-assets').remove([path]);

    const { error } = await supabase.storage
      .from('company-assets')
      .upload(path, file, { upsert: true });

    if (error) throw error;

    const { data } = supabase.storage
      .from('company-assets')
      .getPublicUrl(path);

    // Add cache-busting timestamp to prevent browser from serving stale cached logo
    return `${data.publicUrl}?t=${Date.now()}`;
  }

  static async deleteLogo(): Promise<void> {
    await supabase.storage
      .from('company-assets')
      .remove(['logo.png', 'logo.jpg', 'logo.jpeg', 'logo.webp', 'logo.svg']);
  }
}
