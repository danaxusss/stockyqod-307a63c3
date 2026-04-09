import { supabase } from './supabaseClient';
import { Quote, QuoteTemplate, CustomerInfo, QuoteItem } from '../types';

type QuoteRow = {
  id: string;
  quote_number: string;
  command_number: string | null;
  created_at: string;
  updated_at: string;
  status: string;
  customer_info: unknown;
  items: unknown;
  total_amount: number;
  notes: string | null;
};

type TemplateRow = {
  id: string;
  name: string;
  file_data: string;
  file_type: string;
  uploaded_at: string;
  is_active: boolean;
};

function mapQuoteRow(row: QuoteRow): Quote {
  const items = (Array.isArray(row.items) ? row.items : []) as QuoteItem[];
  return {
    id: row.id,
    quoteNumber: row.quote_number,
    commandNumber: row.command_number || undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    status: row.status as 'draft' | 'final',
    customer: row.customer_info as CustomerInfo,
    items: items.map((item: QuoteItem) => ({
      ...item,
      addedAt: new Date(item.addedAt)
    })),
    totalAmount: Number(row.total_amount),
    notes: row.notes || undefined
  };
}

export class SupabaseQuotesService {
  static async saveQuote(quote: Quote): Promise<void> {
    const quoteData = {
      id: quote.id,
      quote_number: quote.quoteNumber,
      command_number: quote.commandNumber || null,
      created_at: quote.createdAt.toISOString(),
      updated_at: quote.updatedAt.toISOString(),
      status: quote.status,
      customer_info: quote.customer as unknown as import('@/integrations/supabase/types').Json,
      items: quote.items as unknown as import('@/integrations/supabase/types').Json,
      total_amount: quote.totalAmount,
      notes: quote.notes || null
    };

    const { error } = await (supabase
      .from('quotes') as any)
      .upsert(quoteData, { onConflict: 'id', ignoreDuplicates: false });

    if (error) {
      throw new Error(`Failed to save quote: ${error.message}`);
    }
  }

  static async getQuote(id: string): Promise<Quote | null> {
    const { data, error } = await supabase
      .from('quotes')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw new Error(`Failed to fetch quote: ${error.message}`);
    }

    if (!data) return null;
    return mapQuoteRow(data as unknown as QuoteRow);
  }

  static async getAllQuotes(filterBySalesPerson?: string): Promise<Quote[]> {
    let query = supabase.from('quotes').select('*');

    if (filterBySalesPerson) {
      query = query.eq('customer_info->>salesPerson', filterBySalesPerson);
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch quotes: ${error.message}`);
    }

    return (data || []).map(row => mapQuoteRow(row as unknown as QuoteRow));
  }

  static async deleteQuote(id: string): Promise<void> {
    const { error } = await supabase
      .from('quotes')
      .delete()
      .eq('id', id);

    if (error) {
      throw new Error(`Failed to delete quote: ${error.message}`);
    }
  }

  static async searchQuotes(query: string, filterBySalesPerson?: string): Promise<Quote[]> {
    let supabaseQuery = supabase
      .from('quotes')
      .select('*')
      .or(`quote_number.ilike.%${query}%,customer_info->>fullName.ilike.%${query}%,customer_info->>phoneNumber.ilike.%${query}%`);

    if (filterBySalesPerson) {
      supabaseQuery = supabaseQuery.eq('customer_info->>salesPerson', filterBySalesPerson);
    }

    const { data, error } = await supabaseQuery.order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to search quotes: ${error.message}`);
    }

    return (data || []).map(row => mapQuoteRow(row as unknown as QuoteRow));
  }

  // Template management
  static async saveQuoteTemplate(template: QuoteTemplate): Promise<void> {
    if (template.isActive) {
      await this.deactivateAllTemplates();
    }

    const templateData = {
      id: template.id,
      name: template.name,
      file_data: btoa(String.fromCharCode(...new Uint8Array(template.fileData))),
      file_type: template.fileType,
      uploaded_at: template.uploadedAt.toISOString(),
      is_active: template.isActive
    };

    const { error } = await supabase
      .from('quote_templates')
      .upsert(templateData, { onConflict: 'id', ignoreDuplicates: false });

    if (error) {
      throw new Error(`Failed to save template: ${error.message}`);
    }
  }

  static async getQuoteTemplates(): Promise<QuoteTemplate[]> {
    const { data, error } = await supabase
      .from('quote_templates')
      .select('*')
      .order('uploaded_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch templates: ${error.message}`);
    }

    return (data || []).map(row => {
      const r = row as unknown as TemplateRow;
      const binary = atob(r.file_data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return {
        id: r.id,
        name: r.name,
        fileData: bytes.buffer,
        fileType: r.file_type,
        uploadedAt: new Date(r.uploaded_at),
        isActive: r.is_active
      };
    });
  }

  static async getActiveQuoteTemplate(): Promise<QuoteTemplate | null> {
    const { data, error } = await supabase
      .from('quote_templates')
      .select('*')
      .eq('is_active', true)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch active template: ${error.message}`);
    }

    if (!data) return null;

    const r = data as unknown as TemplateRow;
    const binary = atob(r.file_data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return {
      id: r.id,
      name: r.name,
      fileData: bytes.buffer,
      fileType: r.file_type,
      uploadedAt: new Date(r.uploaded_at),
      isActive: r.is_active
    };
  }

  static async deleteQuoteTemplate(id: string): Promise<void> {
    const { error } = await supabase
      .from('quote_templates')
      .delete()
      .eq('id', id);

    if (error) {
      throw new Error(`Failed to delete template: ${error.message}`);
    }
  }

  static async setActiveTemplate(templateId: string): Promise<void> {
    await this.deactivateAllTemplates();

    const { error } = await supabase
      .from('quote_templates')
      .update({ is_active: true })
      .eq('id', templateId);

    if (error) {
      throw new Error(`Failed to set active template: ${error.message}`);
    }
  }

  private static async deactivateAllTemplates(): Promise<void> {
    const { error } = await supabase
      .from('quote_templates')
      .update({ is_active: false })
      .eq('is_active', true);

    if (error) {
      throw new Error(`Failed to deactivate templates: ${error.message}`);
    }
  }

  static async getQuoteStats(): Promise<{
    totalQuotes: number;
    totalValue: number;
    draftQuotes: number;
    finalQuotes: number;
    averageValue: number;
  }> {
    const { data, error } = await supabase
      .from('quotes')
      .select('status, total_amount');

    if (error) {
      throw new Error(`Failed to fetch quote stats: ${error.message}`);
    }

    const quotes = data || [];
    const totalQuotes = quotes.length;
    const totalValue = quotes.reduce((sum, q) => sum + Number(q.total_amount), 0);
    const draftQuotes = quotes.filter(q => q.status === 'draft').length;
    const finalQuotes = quotes.filter(q => q.status === 'final').length;
    const averageValue = totalQuotes > 0 ? totalValue / totalQuotes : 0;

    return { totalQuotes, totalValue, draftQuotes, finalQuotes, averageValue };
  }
}
