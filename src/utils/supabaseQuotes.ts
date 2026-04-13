import { quotesApi } from '@/lib/apiClient';
import { Quote, QuoteTemplate, QuoteItem } from '../types';

function mapQuote(row: Record<string, unknown>): Quote {
  const items = (Array.isArray(row.items) ? row.items : []) as QuoteItem[];
  return {
    id: row.id as string,
    quoteNumber: row.quote_number as string,
    commandNumber: (row.command_number as string | null) ?? undefined,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
    status: row.status as 'draft' | 'final',
    customer: row.customer_info as Quote['customer'],
    items: items.map(item => ({ ...item, addedAt: new Date(item.addedAt) })),
    totalAmount: Number(row.total_amount),
    notes: (row.notes as string | null) ?? undefined,
  };
}

function mapTemplate(row: Record<string, unknown>): QuoteTemplate {
  const fileDataStr = row.file_data as string;
  const binary = atob(fileDataStr);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return {
    id: row.id as string,
    name: row.name as string,
    fileData: bytes.buffer,
    fileType: row.file_type as string,
    uploadedAt: new Date(row.uploaded_at as string),
    isActive: row.is_active as boolean,
  };
}

export class SupabaseQuotesService {
  static async saveQuote(quote: Quote): Promise<void> {
    await quotesApi.upsert({
      id: quote.id,
      quote_number: quote.quoteNumber,
      command_number: quote.commandNumber ?? null,
      created_at: quote.createdAt.toISOString(),
      updated_at: new Date().toISOString(),
      status: quote.status,
      customer_info: quote.customer,
      items: quote.items,
      total_amount: quote.totalAmount,
      notes: quote.notes ?? null,
    });
  }

  static async updateQuoteStatus(id: string, status: string): Promise<void> {
    await quotesApi.updateStatus(id, status);
  }

  static async getQuote(id: string): Promise<Quote | null> {
    try {
      const { quote } = await quotesApi.getById(id);
      return mapQuote(quote as Record<string, unknown>);
    } catch {
      return null;
    }
  }

  static async getAllQuotes(): Promise<Quote[]> {
    const { quotes } = await quotesApi.getAll();
    return (quotes as Record<string, unknown>[]).map(mapQuote);
  }

  static async deleteQuote(id: string): Promise<void> {
    await quotesApi.delete(id);
  }

  static async getQuoteTemplates(): Promise<QuoteTemplate[]> {
    const { templates } = await quotesApi.getTemplates();
    return (templates as Record<string, unknown>[]).map(mapTemplate);
  }

  static async getActiveQuoteTemplate(): Promise<QuoteTemplate | null> {
    const { template } = await quotesApi.getActiveTemplate();
    if (!template) return null;
    return mapTemplate(template as Record<string, unknown>);
  }

  static async saveTemplate(template: QuoteTemplate): Promise<void> {
    const base64 = btoa(String.fromCharCode(...new Uint8Array(template.fileData)));
    await quotesApi.saveTemplate({
      id: template.id,
      name: template.name,
      file_data: base64,
      file_type: template.fileType,
    });
  }

  static async setActiveTemplate(templateId: string): Promise<void> {
    await quotesApi.activateTemplate(templateId);
  }

  static async deleteQuoteTemplate(id: string): Promise<void> {
    await quotesApi.deleteTemplate(id);
  }

  static async getQuoteStats(): Promise<{
    totalQuotes: number; totalValue: number; draftQuotes: number;
    finalQuotes: number; averageValue: number;
  }> {
    const { quotes } = await quotesApi.getAll();
    const qs = quotes as Array<{ status: string; total_amount: unknown }>;
    const total = qs.reduce((s, q) => s + Number(q.total_amount), 0);
    return {
      totalQuotes: qs.length,
      totalValue: total,
      draftQuotes: qs.filter(q => q.status === 'draft').length,
      finalQuotes: qs.filter(q => q.status === 'final').length,
      averageValue: qs.length > 0 ? total / qs.length : 0,
    };
  }
}
