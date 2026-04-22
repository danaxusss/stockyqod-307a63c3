import { supabase } from './supabaseClient';
import { getCompanyContext } from './supabaseCompanyFilter';

export interface Client {
  id: string;
  full_name: string;
  phone_number: string;
  address: string;
  city: string;
  ice: string;
  email: string;
  client_code?: string;
  company_id?: string;
  created_at: string;
  updated_at: string;
}

export interface CreateClientRequest {
  full_name: string;
  phone_number: string;
  address?: string;
  city?: string;
  ice?: string;
  email?: string;
}

export interface UpdateClientRequest {
  full_name?: string;
  phone_number?: string;
  address?: string;
  city?: string;
  ice?: string;
  email?: string;
}

export class SupabaseClientsService {
  static async getAllClients(): Promise<Client[]> {
    const { companyId, isSuperAdmin } = getCompanyContext();
    let query = supabase.from('clients').select('*').order('created_at', { ascending: false });
    if (!isSuperAdmin && companyId) query = query.eq('company_id', companyId);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  static async searchClients(query: string): Promise<Client[]> {
    const q = query.trim();
    if (!q) return [];
    const { companyId, isSuperAdmin } = getCompanyContext();
    let dbQuery = supabase
      .from('clients')
      .select('*')
      .or(`full_name.ilike.%${q}%,phone_number.ilike.%${q}%,client_code.ilike.%${q}%`)
      .order('full_name')
      .limit(10);
    if (!isSuperAdmin && companyId) dbQuery = dbQuery.eq('company_id', companyId);
    const { data, error } = await dbQuery;
    if (error) throw error;
    return data || [];
  }

  static async getClientByPhone(phone: string): Promise<Client | null> {
    const { data, error } = await supabase
      .from('clients')
      .select('*')
      .eq('phone_number', phone)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  static async upsertClient(client: CreateClientRequest): Promise<Client> {
    const { companyId } = getCompanyContext();
    const { data, error } = await supabase
      .from('clients')
      .upsert(
        {
          full_name: client.full_name,
          phone_number: client.phone_number,
          address: client.address || '',
          city: client.city || '',
          ice: client.ice || '',
          email: client.email || '',
          ...(companyId ? { company_id: companyId } : {}),
        },
        { onConflict: 'phone_number' }
      )
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  static async createClient(client: CreateClientRequest): Promise<Client> {
    const { companyId } = getCompanyContext();

    // Generate client_code atomically via RPC
    const firstLetter = (client.full_name?.trim()?.[0] || 'X').toUpperCase();
    let clientCode: string | undefined;
    try {
      const { data: codeData } = await (supabase.rpc as any)('next_client_code', { p_first_letter: firstLetter });
      if (codeData) clientCode = codeData as string;
    } catch { /* non-fatal — proceed without code */ }

    const { data, error } = await supabase
      .from('clients')
      .insert({
        full_name: client.full_name,
        phone_number: client.phone_number,
        address: client.address || '',
        city: client.city || '',
        ice: client.ice || '',
        email: client.email || '',
        ...(clientCode ? { client_code: clientCode } : {}),
        ...(companyId ? { company_id: companyId } : {}),
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  static async updateClient(id: string, updates: UpdateClientRequest): Promise<Client> {
    const { data, error } = await supabase
      .from('clients')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  static async smartUpsertClient(client: CreateClientRequest): Promise<Client> {
    const existing = await SupabaseClientsService.getClientByPhone(client.phone_number);
    if (existing) {
      // Update name/address fields; if no code yet, assign one
      const updates: UpdateClientRequest & { client_code?: string } = {
        full_name: client.full_name,
        address: client.address || existing.address,
        city: client.city || existing.city,
        ice: client.ice || existing.ice,
        email: client.email || existing.email,
      };
      if (!existing.client_code) {
        const firstLetter = (client.full_name?.trim()?.[0] || 'X').toUpperCase();
        try {
          const { data: codeData } = await (supabase.rpc as any)('next_client_code', { p_first_letter: firstLetter });
          if (codeData) (updates as any).client_code = codeData as string;
        } catch { /* non-fatal */ }
      }
      return SupabaseClientsService.updateClient(existing.id, updates);
    }
    return SupabaseClientsService.createClient(client);
  }

  static async assignClientCode(clientId: string, firstLetter: string): Promise<string | null> {
    try {
      const { data: codeData } = await (supabase.rpc as any)('next_client_code', { p_first_letter: firstLetter });
      if (!codeData) return null;
      await supabase.from('clients').update({ client_code: codeData }).eq('id', clientId);
      return codeData as string;
    } catch {
      return null;
    }
  }

  static async deleteClient(id: string): Promise<void> {
    const { error } = await supabase
      .from('clients')
      .delete()
      .eq('id', id);
    if (error) throw error;
  }
}
