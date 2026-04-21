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
  showTVABreakdown: boolean;
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
  stamp_url: string | null;
  stamp_size: 'small' | 'medium' | 'large';
  use_stamp: boolean;
  ai_enabled: boolean;
  ai_model: string;
  ai_system_prompt: string;
  doc_prefix: string;
  qr_code_url: string;
  bl_show_prices: boolean;
  special_pin: string;
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
  showTVABreakdown: true,
  showNotes: true,
  showPaymentTerms: true,
  showValidityDate: true,
};

export class CompanySettingsService {
  /**
   * Load settings for a specific company (from `companies` table).
   * Falls back to the global `company_settings` row if companyId is not provided.
   */
  static async getSettings(companyId?: string): Promise<CompanySettings | null> {
    if (companyId) {
      const { data, error } = await supabase
        .from('companies')
        .select('*')
        .eq('id', companyId)
        .maybeSingle();
      if (!error && data) {
        return this.mapCompanyRow(data as any);
      }
    }
    // Fall back to legacy global company_settings
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

  private static mapCompanyRow(data: Record<string, any>): CompanySettings {
    const rawStyle = (data.quote_style as Record<string, unknown>) || {};
    const rawShareTemplates = (data.share_templates as Record<string, string>) || {};
    return {
      id: data.id,
      company_name: data.name || '',
      address: data.address || '',
      phone: data.phone || '',
      phone2: data.phone2 || '',
      phone_dir: '',
      phone_gsm: '',
      email: data.email || '',
      website: data.website || '',
      ice: data.ice || '',
      rc: data.rc || '',
      if_number: data.if_number || '',
      cnss: data.cnss || '',
      patente: data.patente || '',
      logo_url: data.logo_url || null,
      logo_size: (data.logo_size as 'small' | 'medium' | 'large') || 'medium',
      stamp_url: data.stamp_url || null,
      stamp_size: (data.stamp_size as 'small' | 'medium' | 'large') || 'medium',
      use_stamp: data.use_stamp ?? false,
      ai_enabled: data.ai_enabled ?? true,
      ai_model: data.ai_model || 'deepseek/deepseek-chat-v3-0324:free',
      ai_system_prompt: data.ai_system_prompt || '',
      doc_prefix: data.doc_prefix || '',
      qr_code_url: data.qr_code_url || '',
      bl_show_prices: data.bl_show_prices ?? true,
      special_pin: data.special_pin || '',
      tva_rate: data.tva_rate ?? 20,
      quote_validity_days: data.quote_validity_days ?? 30,
      payment_terms: data.payment_terms || '',
      updated_at: data.updated_at || '',
      quote_visible_fields: {
        ...DEFAULT_VISIBLE_FIELDS,
        ...(data.quote_visible_fields as Record<string, boolean>),
      },
      quote_style: {
        ...DEFAULT_QUOTE_STYLE,
        ...rawStyle,
        accentColor: data.accent_color || DEFAULT_QUOTE_STYLE.accentColor,
        fontFamily: (data.font_family as any) || DEFAULT_QUOTE_STYLE.fontFamily,
      },
      share_templates: {
        ...DEFAULT_SHARE_TEMPLATES,
        ...rawShareTemplates,
      },
    } as CompanySettings;
  }

  static async updateCompanySettings(companyId: string, settings: Partial<CompanySettings>): Promise<void> {
    const updateData: Record<string, unknown> = {
      name: settings.company_name,
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
      logo_url: settings.logo_url,
      logo_size: settings.logo_size,
      stamp_url: settings.stamp_url,
      stamp_size: settings.stamp_size,
      use_stamp: settings.use_stamp,
      ai_enabled: settings.ai_enabled,
      ai_model: settings.ai_model,
      ai_system_prompt: settings.ai_system_prompt,
      doc_prefix: settings.doc_prefix,
      qr_code_url: settings.qr_code_url,
      bl_show_prices: settings.bl_show_prices,
      special_pin: settings.special_pin,
      tva_rate: settings.tva_rate,
      quote_validity_days: settings.quote_validity_days,
      payment_terms: settings.payment_terms,
      updated_at: new Date().toISOString(),
    };
    if (settings.quote_visible_fields) updateData.quote_visible_fields = settings.quote_visible_fields;
    if (settings.quote_style) {
      updateData.quote_style = settings.quote_style;
      if (settings.quote_style.accentColor) updateData.accent_color = settings.quote_style.accentColor;
      if (settings.quote_style.fontFamily) updateData.font_family = settings.quote_style.fontFamily;
    }
    if (settings.share_templates) updateData.share_templates = settings.share_templates;
    // Remove undefined keys
    Object.keys(updateData).forEach(k => updateData[k] === undefined && delete updateData[k]);
    const { error } = await supabase.from('companies').update(updateData as any).eq('id', companyId);
    if (error) throw error;
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

  static async uploadLogo(file: File, companyId: string): Promise<string> {
    const ext = file.name.split('.').pop();
    const path = `companies/${companyId}/logo.${ext}`;

    await supabase.storage.from('company-assets').remove([path]);

    const { error } = await supabase.storage
      .from('company-assets')
      .upload(path, file, { upsert: true });

    if (error) throw error;

    const { data } = supabase.storage
      .from('company-assets')
      .getPublicUrl(path);

    return `${data.publicUrl}?t=${Date.now()}`;
  }

  static async deleteLogo(companyId: string): Promise<void> {
    const exts = ['png', 'jpg', 'jpeg', 'webp', 'svg'];
    const paths = exts.map(ext => `companies/${companyId}/logo.${ext}`);
    await supabase.storage.from('company-assets').remove(paths);
  }

  static async uploadStamp(file: File, companyId: string): Promise<string> {
    const ext = file.name.split('.').pop();
    const path = `companies/${companyId}/stamp.${ext}`;

    await supabase.storage.from('company-assets').remove([path]);

    const { error } = await supabase.storage
      .from('company-assets')
      .upload(path, file, { upsert: true });

    if (error) throw error;

    const { data } = supabase.storage
      .from('company-assets')
      .getPublicUrl(path);

    return `${data.publicUrl}?t=${Date.now()}`;
  }

  static async deleteStamp(companyId: string): Promise<void> {
    const exts = ['png', 'jpg', 'jpeg', 'webp'];
    const paths = exts.map(ext => `companies/${companyId}/stamp.${ext}`);
    await supabase.storage.from('company-assets').remove(paths);
  }
}
