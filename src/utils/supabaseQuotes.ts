// @ts-nocheck
import { supabase } from './supabaseClient';
import { Quote, QuoteTemplate } from '../types';

export class SupabaseQuotesService {
  // Quote management
  static async saveQuote(quote: Quote): Promise<void> {
    console.log('Saving quote to Supabase:', quote.quoteNumber);
    
    const quoteData = {
      id: quote.id,
      quote_number: quote.quoteNumber,
      command_number: quote.commandNumber || null,
      created_at: quote.createdAt.toISOString(),
      updated_at: quote.updatedAt.toISOString(),
      status: quote.status,
      customer_info: quote.customer,
      items: quote.items,
      total_amount: quote.totalAmount,
      notes: quote.notes || null
    };

    const { error } = await supabase
      .from('quotes')
      .upsert(quoteData, {
        onConflict: 'id',
        ignoreDuplicates: false
      });

    if (error) {
      console.error('Failed to save quote to Supabase:', error);
      throw new Error(`Failed to save quote: ${error.message}`);
    }

    console.log('Quote saved successfully to Supabase');
  }

  static async getQuote(id: string): Promise<Quote | null> {
    console.log('Fetching quote from Supabase:', id);
    
    const { data, error } = await supabase
      .from('quotes')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // No rows returned
        return null;
      }
      console.error('Failed to fetch quote from Supabase:', error);
      throw new Error(`Failed to fetch quote: ${error.message}`);
    }

    if (!data) return null;

    return {
      id: data.id,
      quoteNumber: data.quote_number,
      commandNumber: data.command_number,
      createdAt: new Date(data.created_at),
      updatedAt: new Date(data.updated_at),
      status: data.status,
      customer: data.customer_info,
      items: data.items.map((item: any) => ({
        ...item,
        addedAt: new Date(item.addedAt)
      })),
      totalAmount: parseFloat(data.total_amount),
      notes: data.notes
    };
  }

  static async getAllQuotes(filterBySalesPerson?: string): Promise<Quote[]> {
    console.log('Fetching all quotes from Supabase');
    
    let query = supabase
      .from('quotes')
      .select('*');
    
    // Apply sales person filter if provided (for non-admin users)
    if (filterBySalesPerson) {
      query = query.eq('customer_info->>salesPerson', filterBySalesPerson);
      console.log('Filtering quotes by sales person:', filterBySalesPerson);
    }
    
    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) {
      console.error('Failed to fetch quotes from Supabase:', error);
      throw new Error(`Failed to fetch quotes: ${error.message}`);
    }

    return (data || []).map(quote => ({
      id: quote.id,
      quoteNumber: quote.quote_number,
      commandNumber: quote.command_number,
      createdAt: new Date(quote.created_at),
      updatedAt: new Date(quote.updated_at),
      status: quote.status,
      customer: quote.customer_info,
      items: quote.items.map((item: any) => ({
        ...item,
        addedAt: new Date(item.addedAt)
      })),
      totalAmount: parseFloat(quote.total_amount),
      notes: quote.notes
    }));
  }

  static async deleteQuote(id: string): Promise<void> {
    console.log('Deleting quote from Supabase:', id);
    
    const { error } = await supabase
      .from('quotes')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Failed to delete quote from Supabase:', error);
      throw new Error(`Failed to delete quote: ${error.message}`);
    }

    console.log('Quote deleted successfully from Supabase');
  }

  static async searchQuotes(query: string, filterBySalesPerson?: string): Promise<Quote[]> {
    console.log('Searching quotes in Supabase:', query);
    
    let supabaseQuery = supabase
      .from('quotes')
      .select('*')
      .or(`quote_number.ilike.%${query}%,customer_info->>fullName.ilike.%${query}%,customer_info->>phoneNumber.ilike.%${query}%`);
    
    // Apply sales person filter if provided (for non-admin users)
    if (filterBySalesPerson) {
      supabaseQuery = supabaseQuery.eq('customer_info->>salesPerson', filterBySalesPerson);
      console.log('Filtering search results by sales person:', filterBySalesPerson);
    }
    
    const { data, error } = await supabaseQuery.order('created_at', { ascending: false });

    if (error) {
      console.error('Failed to search quotes in Supabase:', error);
      throw new Error(`Failed to search quotes: ${error.message}`);
    }

    return (data || []).map(quote => ({
      id: quote.id,
      quoteNumber: quote.quote_number,
      commandNumber: quote.command_number,
      createdAt: new Date(quote.created_at),
      updatedAt: new Date(quote.updated_at),
      status: quote.status,
      customer: quote.customer_info,
      items: quote.items.map((item: any) => ({
        ...item,
        addedAt: new Date(item.addedAt)
      })),
      totalAmount: parseFloat(quote.total_amount),
      notes: quote.notes
    }));
  }

  // Quote template management
  static async saveQuoteTemplate(template: QuoteTemplate): Promise<void> {
    console.log('Saving quote template to Supabase:', template.name);
    
    // If this template is being set as active, deactivate all others first
    if (template.isActive) {
      await this.deactivateAllTemplates();
    }

    const templateData = {
      id: template.id,
      name: template.name,
      file_data: new Uint8Array(template.fileData),
      file_type: template.fileType,
      uploaded_at: template.uploadedAt.toISOString(),
      is_active: template.isActive
    };

    const { error } = await supabase
      .from('quote_templates')
      .upsert(templateData, {
        onConflict: 'id',
        ignoreDuplicates: false
      });

    if (error) {
      console.error('Failed to save quote template to Supabase:', error);
      throw new Error(`Failed to save template: ${error.message}`);
    }

    console.log('Quote template saved successfully to Supabase');
  }

  static async getQuoteTemplates(): Promise<QuoteTemplate[]> {
    console.log('Fetching quote templates from Supabase');
    
    const { data, error } = await supabase
      .from('quote_templates')
      .select('*')
      .order('uploaded_at', { ascending: false });

    if (error) {
      console.error('Failed to fetch quote templates from Supabase:', error);
      throw new Error(`Failed to fetch templates: ${error.message}`);
    }

    return (data || []).map(template => ({
      id: template.id,
      name: template.name,
      fileData: template.file_data.buffer,
      fileType: template.file_type,
      uploadedAt: new Date(template.uploaded_at),
      isActive: template.is_active
    }));
  }

  static async getActiveQuoteTemplate(): Promise<QuoteTemplate | null> {
    console.log('Fetching active quote template from Supabase');
    
    const { data, error } = await supabase
      .from('quote_templates')
      .select('*')
      .eq('is_active', true)
      .maybeSingle();

    if (error) {
      console.error('Failed to fetch active quote template from Supabase:', error);
      throw new Error(`Failed to fetch active template: ${error.message}`);
    }

    if (!data) return null;

    return {
      id: data.id,
      name: data.name,
      fileData: data.file_data.buffer,
      fileType: data.file_type,
      uploadedAt: new Date(data.uploaded_at),
      isActive: data.is_active
    };
  }

  static async deleteQuoteTemplate(id: string): Promise<void> {
    console.log('Deleting quote template from Supabase:', id);
    
    const { error } = await supabase
      .from('quote_templates')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Failed to delete quote template from Supabase:', error);
      throw new Error(`Failed to delete template: ${error.message}`);
    }

    console.log('Quote template deleted successfully from Supabase');
  }

  static async setActiveTemplate(templateId: string): Promise<void> {
    console.log('Setting active template in Supabase:', templateId);
    
    // First deactivate all templates
    await this.deactivateAllTemplates();
    
    // Then activate the specified template
    const { error } = await supabase
      .from('quote_templates')
      .update({ is_active: true })
      .eq('id', templateId);

    if (error) {
      console.error('Failed to set active template in Supabase:', error);
      throw new Error(`Failed to set active template: ${error.message}`);
    }

    console.log('Active template set successfully in Supabase');
  }

  private static async deactivateAllTemplates(): Promise<void> {
    const { error } = await supabase
      .from('quote_templates')
      .update({ is_active: false })
      .eq('is_active', true);

    if (error) {
      console.error('Failed to deactivate templates in Supabase:', error);
      throw new Error(`Failed to deactivate templates: ${error.message}`);
    }
  }

  // Analytics and statistics
  static async getQuoteStats(): Promise<{
    totalQuotes: number;
    totalValue: number;
    draftQuotes: number;
    finalQuotes: number;
    averageValue: number;
  }> {
    console.log('Fetching quote statistics from Supabase');
    
    const { data, error } = await supabase
      .from('quotes')
      .select('status, total_amount');

    if (error) {
      console.error('Failed to fetch quote stats from Supabase:', error);
      throw new Error(`Failed to fetch quote stats: ${error.message}`);
    }

    const quotes = data || [];
    const totalQuotes = quotes.length;
    const totalValue = quotes.reduce((sum, quote) => sum + parseFloat(quote.total_amount), 0);
    const draftQuotes = quotes.filter(q => q.status === 'draft').length;
    const finalQuotes = quotes.filter(q => q.status === 'final').length;
    const averageValue = totalQuotes > 0 ? totalValue / totalQuotes : 0;

    return {
      totalQuotes,
      totalValue,
      draftQuotes,
      finalQuotes,
      averageValue
    };
  }

  // Migration helper - move quotes from IndexedDB to Supabase
  static async migrateFromIndexedDB(quotes: Quote[]): Promise<void> {
    console.log(`Migrating ${quotes.length} quotes from IndexedDB to Supabase`);
    
    if (quotes.length === 0) {
      console.log('No quotes to migrate');
      return;
    }

    const BATCH_SIZE = 10;
    let migratedCount = 0;
    let failedCount = 0;

    for (let i = 0; i < quotes.length; i += BATCH_SIZE) {
      const batch = quotes.slice(i, i + BATCH_SIZE);
      console.log(`Migrating batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(quotes.length / BATCH_SIZE)}`);
      
      for (const quote of batch) {
        try {
          await this.saveQuote(quote);
          migratedCount++;
        } catch (error) {
          console.error(`Failed to migrate quote ${quote.quoteNumber}:`, error);
          failedCount++;
        }
      }
    }

    console.log(`Migration completed: ${migratedCount} successful, ${failedCount} failed`);
    
    if (failedCount > 0) {
      throw new Error(`Migration partially failed: ${migratedCount} quotes migrated, ${failedCount} failed`);
    }
  }

  // Migration helper - move templates from IndexedDB to Supabase
  static async migrateTemplatesFromIndexedDB(templates: QuoteTemplate[]): Promise<void> {
    console.log(`Migrating ${templates.length} templates from IndexedDB to Supabase`);
    
    if (templates.length === 0) {
      console.log('No templates to migrate');
      return;
    }

    let migratedCount = 0;
    let failedCount = 0;

    for (const template of templates) {
      try {
        await this.saveQuoteTemplate(template);
        migratedCount++;
      } catch (error) {
        console.error(`Failed to migrate template ${template.name}:`, error);
        failedCount++;
      }
    }

    console.log(`Template migration completed: ${migratedCount} successful, ${failedCount} failed`);
    
    if (failedCount > 0) {
      throw new Error(`Template migration partially failed: ${migratedCount} templates migrated, ${failedCount} failed`);
    }
  }
}