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

export interface CompanySettings {
  id: string;
  company_name: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  ice: string;
  logo_url: string | null;
  quote_visible_fields: QuoteVisibleFields;
  quote_style: QuoteStyle;
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

    return {
      ...data,
      quote_visible_fields: {
        ...DEFAULT_VISIBLE_FIELDS,
        ...(data.quote_visible_fields as Record<string, boolean>),
      },
      quote_style: {
        ...DEFAULT_QUOTE_STYLE,
        ...(data.quote_style as Record<string, unknown>),
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
    // Cast quote_visible_fields to JSON-compatible type
    if (settings.quote_visible_fields) {
      updateData.quote_visible_fields = settings.quote_visible_fields as unknown as Record<string, boolean>;
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

    // Remove old logo
    await supabase.storage.from('company-assets').remove([path]);

    const { error } = await supabase.storage
      .from('company-assets')
      .upload(path, file, { upsert: true });

    if (error) throw error;

    const { data } = supabase.storage
      .from('company-assets')
      .getPublicUrl(path);

    return data.publicUrl;
  }

  static async deleteLogo(): Promise<void> {
    // Try to remove common extensions
    await supabase.storage
      .from('company-assets')
      .remove(['logo.png', 'logo.jpg', 'logo.jpeg', 'logo.webp', 'logo.svg']);
  }
}
