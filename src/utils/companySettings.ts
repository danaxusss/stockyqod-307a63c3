import { SupabaseCompaniesService, invalidateCompaniesCache } from './supabaseCompanies';
import { supabase } from '@/integrations/supabase/client';
import { getCompanyContext } from './supabaseCompanyFilter';
import { writeTolerant } from './schemaFallback';
import { DEFAULT_PAYMENT_DAYS } from './documentLines';

// Settings columns added by 20261125120000_billing_compliance.sql: saving
// still works on a database that does not have them yet.
const NEW_SETTINGS_COLUMNS = ['payment_terms_days', 'vat_exemption_text'];
// Added by 20261126130000_customer_payments.sql. Dropped first and on their
// own, so a database with the billing columns but not these still saves those.
const PAYMENT_SETTINGS_COLUMNS = ['tax_attestation_date', 'cash_stamp_duty'];
// Added by 20261127120000_vat_return.sql (VAT return settings).
export const VAT_SETTINGS_COLUMNS = ['vat_regime', 'vat_periodicity', 'vat_prorata', 'vat_opening_credit', 'vat_start_date'];

/** Save with every column set tolerated, the most recent one dropped first. */
const saveTolerant = (payload: Record<string, unknown>, run: (p: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>) =>
  writeTolerant(payload, VAT_SETTINGS_COLUMNS, p0 => writeTolerant(p0, PAYMENT_SETTINGS_COLUMNS, p => writeTolerant(p, NEW_SETTINGS_COLUMNS, run)));

const dayOrEmpty = (v: unknown) => (v ? String(v).slice(0, 10) : '');

/** The two payment settings of a settings row, and whether the row has them at all. */
const paymentSettingsOf = (row: Record<string, unknown>) => ({
  tax_attestation_date: dayOrEmpty(row.tax_attestation_date),
  cash_stamp_duty: row.cash_stamp_duty === true,
  payment_settings_available: 'cash_stamp_duty' in row,
});

/**
 * The VAT return settings of a settings row (defaults when the migration was
 * not run): regime "encaissement" (CGI art. 95), periodicity '' until chosen,
 * prorata 100 %, no opening credit.
 */
export const vatSettingsOf = (row: Record<string, unknown>) => {
  const prorata = Number(row.vat_prorata);
  return {
    vat_regime: (row.vat_regime === 'debit' ? 'debit' : 'encaissement') as 'debit' | 'encaissement',
    vat_periodicity: (row.vat_periodicity === 'M' || row.vat_periodicity === 'T' ? row.vat_periodicity : '') as 'M' | 'T' | '',
    vat_prorata: row.vat_prorata != null && Number.isFinite(prorata) && prorata > 0 ? prorata : 100,
    vat_opening_credit: Number(row.vat_opening_credit) || 0,
    vat_start_date: dayOrEmpty(row.vat_start_date),
    vat_settings_available: 'vat_regime' in row,
  };
};

export interface PrintColumns {
  showImage: boolean;
  showBrand: boolean;
  showBarcode: boolean;
  showUnitPrice: boolean;
  showDiscount: boolean;
}

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
  printColumns: PrintColumns;
}

export interface QuoteStyle {
  accentColor: string;
  fontFamily: 'helvetica' | 'times' | 'courier';
  showBorders: boolean;
  borderRadius: number;
  headerSize: 'small' | 'medium' | 'large';
  totalsStyle: 'highlighted' | 'simple' | 'boxed';
  template: 'classic' | 'modern' | 'executive' | 'minimal' | 'sidebar' | 'banner' | 'bold' | 'split';
}

const DEFAULT_PRINT_COLUMNS: PrintColumns = {
  showImage: false,
  showBrand: true,
  showBarcode: true,
  showUnitPrice: true,
  showDiscount: true,
};

const DEFAULT_QUOTE_STYLE: QuoteStyle = {
  accentColor: '#3B82F6',
  fontFamily: 'helvetica',
  showBorders: true,
  borderRadius: 1,
  headerSize: 'large',
  totalsStyle: 'highlighted',
  template: 'classic',
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
  /** Invoice due date = invoice date + this many days (loi 69-21: 60 by default, 120 at most). */
  payment_terms_days: number;
  tva_rate: number;
  /** Printed after "Exonéré de TVA" on documents at 0 % (e.g. the CGI article). */
  vat_exemption_text: string;
  /**
   * Issue date (YYYY-MM-DD, '' when unknown) of the company's attestation de
   * régularité fiscale: under 6 months old, its VAT-registered clients do not
   * withhold the VAT of its invoices (CGI art. 117-IV).
   */
  tax_attestation_date: string;
  /** Collect the 0.25 % stamp duty on cash settlements (CGI art. 252-I-B). Off by default. */
  cash_stamp_duty: boolean;
  /** Whether the database has the two settings above (migration 20261126130000 run). */
  payment_settings_available: boolean;
  /** VAT return: 'encaissement' (default, CGI art. 95) or 'debit' (option). */
  vat_regime: 'encaissement' | 'debit';
  /** VAT return: monthly or quarterly (art. 108); '' until chosen. */
  vat_periodicity: 'M' | 'T' | '';
  /** Deduction prorata in % (art. 104), 100 by default. */
  vat_prorata: number;
  /** VAT credit carried into the first period declared with Stocky. */
  vat_opening_credit: number;
  /** First day of the first period declared with Stocky (YYYY-MM-DD), '' when not set. */
  vat_start_date: string;
  /** Whether the database has the VAT settings (migration 20261127120000 run). */
  vat_settings_available: boolean;
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
  printColumns: DEFAULT_PRINT_COLUMNS,
};

/** The VAT columns of a settings save ('' stored as null); keys absent from `settings` stay undefined. */
export function vatSettingsPayload(settings: Partial<CompanySettings>): Record<string, unknown> {
  return {
    vat_regime: settings.vat_regime,
    vat_periodicity: settings.vat_periodicity === undefined ? undefined : (settings.vat_periodicity || null),
    vat_prorata: settings.vat_prorata,
    vat_opening_credit: settings.vat_opening_credit,
    vat_start_date: settings.vat_start_date === undefined ? undefined : (settings.vat_start_date || null),
  };
}

export class CompanySettingsService {
  /**
   * Load settings for a specific company (from `companies` table).
   * Falls back to the global `company_settings` row if companyId is not provided.
   */
  static async getSettings(companyId?: string): Promise<CompanySettings | null> {
    if (companyId) {
      // Same shared, short-lived cache as the rest of the app's company reads.
      const data = await SupabaseCompaniesService.getCompanyById(companyId).catch(() => null);
      if (data) {
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
      payment_terms_days: (data as any).payment_terms_days ?? DEFAULT_PAYMENT_DAYS,
      vat_exemption_text: (data as any).vat_exemption_text || '',
      ...paymentSettingsOf(data as Record<string, unknown>),
      ...vatSettingsOf(data as Record<string, unknown>),
      quote_visible_fields: {
        ...DEFAULT_VISIBLE_FIELDS,
        ...(data.quote_visible_fields as Record<string, unknown>),
        printColumns: {
          ...DEFAULT_PRINT_COLUMNS,
          ...((data.quote_visible_fields as any)?.printColumns || {}),
        },
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
      payment_terms_days: data.payment_terms_days ?? DEFAULT_PAYMENT_DAYS,
      vat_exemption_text: data.vat_exemption_text || '',
      ...paymentSettingsOf(data),
      ...vatSettingsOf(data),
      updated_at: data.updated_at || '',
      quote_visible_fields: {
        ...DEFAULT_VISIBLE_FIELDS,
        ...(data.quote_visible_fields as Record<string, unknown>),
        printColumns: {
          ...DEFAULT_PRINT_COLUMNS,
          ...((data.quote_visible_fields as any)?.printColumns || {}),
        },
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

  /**
   * The special PIN that unlocks a document: its own company's PIN. Only a
   * document with no company (old data) falls back to the user's company.
   * Another company's PIN never unlocks it.
   */
  static async resolveSpecialPin(docCompanyId?: string | null): Promise<string | null> {
    const companyId = docCompanyId || getCompanyContext().companyId;
    if (!companyId) return null;
    const s = await this.getSettings(companyId).catch(() => null);
    return s?.special_pin || null;
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
      payment_terms_days: settings.payment_terms_days,
      vat_exemption_text: settings.vat_exemption_text,
      tax_attestation_date: settings.tax_attestation_date === undefined ? undefined : (settings.tax_attestation_date || null),
      cash_stamp_duty: settings.cash_stamp_duty,
      ...vatSettingsPayload(settings),
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
    const { error } = await saveTolerant(updateData,
      payload => supabase.from('companies').update(payload as never).eq('id', companyId));
    invalidateCompaniesCache();
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
    // Read-only flags, not columns.
    delete updateData.payment_settings_available;
    delete updateData.vat_settings_available;
    if (updateData.tax_attestation_date === '') updateData.tax_attestation_date = null;
    Object.assign(updateData, vatSettingsPayload(settings));
    Object.keys(updateData).forEach(k => updateData[k] === undefined && delete updateData[k]);

    const { error } = await saveTolerant(updateData,
      payload => supabase.from('company_settings').update(payload as never).eq('id', current.id));

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
