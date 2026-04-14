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
      .or(`full_name.ilike.%${q}%,phone_number.ilike.%${q}%`)
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
    const { data, error } = await supabase
      .from('clients')
      .insert({
        full_name: client.full_name,
        phone_number: client.phone_number,
        address: client.address || '',
        city: client.city || '',
        ice: client.ice || '',
        email: client.email || '',
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

  static async deleteClient(id: string): Promise<void> {
    const { error } = await supabase
      .from('clients')
      .delete()
      .eq('id', id);
    if (error) throw error;
  }
}
