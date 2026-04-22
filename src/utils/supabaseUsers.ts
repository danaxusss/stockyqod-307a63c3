import { supabase } from './supabaseClient';
import { AppUser, CreateAppUserRequest, UpdateAppUserRequest } from '../types';

type SafeAppUserRow = {
  id: string;
  username: string;
  is_admin: boolean;
  is_superadmin: boolean;
  is_compta: boolean;
  company_id: string | null;
  can_create_quote: boolean;
  allowed_stock_locations: string[];
  allowed_brands: string[];
  price_display_type: string;
  custom_seller_name: string;
  phone: string;
  created_at: string;
  updated_at: string;
};

// Hash a PIN client-side using the same PBKDF2 algorithm as verify-pin edge function
async function hashPin(pin: string): Promise<string> {
  const ITERATIONS = 100000;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']
  );
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    key, 256
  );
  const saltHex = [...salt].map(b => b.toString(16).padStart(2, '0')).join('');
  const hashHex = [...new Uint8Array(derived)].map(b => b.toString(16).padStart(2, '0')).join('');
  return `pbkdf2:${ITERATIONS}:${saltHex}:${hashHex}`;
}

export class SupabaseUsersService {
  static async createUser(userData: CreateAppUserRequest): Promise<AppUser> {
    if (!userData.pin) throw new Error('PIN requis');
    const hashedPin = await hashPin(userData.pin);

    const { data, error } = await supabase
      .from('app_users')
      .insert({
        username: userData.username.trim(),
        pin: hashedPin,
        is_admin: userData.is_admin || false,
        is_superadmin: userData.is_superadmin || false,
        is_compta: userData.is_compta || false,
        company_id: userData.company_id || null,
        can_create_quote: userData.can_create_quote !== undefined ? userData.can_create_quote : true,
        allowed_stock_locations: userData.allowed_stock_locations || [],
        allowed_brands: userData.allowed_brands || [],
        price_display_type: userData.price_display_type || 'normal',
        custom_seller_name: userData.custom_seller_name || '',
        phone: userData.phone || '',
      })
      .select('id, username, is_admin, is_superadmin, is_compta, company_id, can_create_quote, allowed_stock_locations, allowed_brands, price_display_type, custom_seller_name, phone, created_at, updated_at')
      .single();

    if (error) {
      if (error.code === '23505') throw new Error("Ce nom d'utilisateur existe déjà");
      throw new Error(error.message);
    }
    return this.mapRow(data as SafeAppUserRow);
  }

  static async getUserByUsername(username: string): Promise<AppUser | null> {
    const { data, error } = await supabase.rpc('get_app_user_by_username_safe', { p_username: username });
    if (error) {
      if (error.code === 'PGRST116') return null;
      throw new Error(`Failed to get user: ${error.message}`);
    }
    if (!data || (data as any[]).length === 0) return null;
    return this.mapRow((data as any[])[0] as SafeAppUserRow);
  }

  static async getUserById(id: string): Promise<AppUser | null> {
    const { data, error } = await supabase.rpc('get_app_user_by_id_safe', { p_id: id });
    if (error) {
      if (error.code === 'PGRST116') return null;
      throw new Error(`Failed to get user: ${error.message}`);
    }
    if (!data || (data as any[]).length === 0) return null;
    return this.mapRow((data as any[])[0] as SafeAppUserRow);
  }

  static async getAllUsers(): Promise<AppUser[]> {
    const { data, error } = await supabase.rpc('get_app_users_safe');
    if (error) throw new Error(`Failed to get users: ${error.message}`);
    return ((data as any[]) || []).map(row => this.mapRow(row as SafeAppUserRow));
  }

  static async updateUser(id: string, updates: UpdateAppUserRequest): Promise<AppUser> {
    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (updates.username !== undefined) updateData.username = updates.username.trim();
    if (updates.pin !== undefined) updateData.pin = await hashPin(updates.pin);
    if (updates.is_admin !== undefined) updateData.is_admin = updates.is_admin;
    if (updates.is_superadmin !== undefined) updateData.is_superadmin = updates.is_superadmin;
    if (updates.is_compta !== undefined) updateData.is_compta = updates.is_compta;
    if (updates.company_id !== undefined) updateData.company_id = updates.company_id || null;
    if (updates.can_create_quote !== undefined) updateData.can_create_quote = updates.can_create_quote;
    if (updates.allowed_stock_locations !== undefined) updateData.allowed_stock_locations = updates.allowed_stock_locations;
    if (updates.allowed_brands !== undefined) updateData.allowed_brands = updates.allowed_brands;
    if (updates.price_display_type !== undefined) updateData.price_display_type = updates.price_display_type;
    if (updates.custom_seller_name !== undefined) updateData.custom_seller_name = updates.custom_seller_name;
    if (updates.phone !== undefined) updateData.phone = updates.phone;

    const { data, error } = await supabase
      .from('app_users')
      .update(updateData)
      .eq('id', id)
      .select('id, username, is_admin, is_superadmin, is_compta, company_id, can_create_quote, allowed_stock_locations, allowed_brands, price_display_type, custom_seller_name, phone, created_at, updated_at')
      .single();

    if (error) {
      if (error.code === '23505') throw new Error("Ce nom d'utilisateur existe déjà");
      throw new Error(error.message);
    }
    return this.mapRow(data as SafeAppUserRow);
  }

  static async deleteUser(id: string): Promise<void> {
    const { error } = await supabase.from('app_users').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }

  static async isUsernameAvailable(username: string, excludeId?: string): Promise<boolean> {
    let query = supabase.from('app_users').select('id').eq('username', username);
    if (excludeId) query = query.neq('id', excludeId);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return !data || data.length === 0;
  }

  static async getAvailableStockLocations(): Promise<string[]> {
    const { data, error } = await supabase.from('products').select('stock_levels');
    if (error) throw new Error(`Failed to get stock locations: ${error.message}`);
    const locations = new Set<string>();
    (data || []).forEach(product => {
      const levels = product.stock_levels as Record<string, number> | null;
      if (levels && typeof levels === 'object') {
        Object.keys(levels).forEach(loc => { if (loc?.trim()) locations.add(loc.trim()); });
      }
    });
    return Array.from(locations).sort();
  }

  static async getAvailableBrands(): Promise<string[]> {
    const { data, error } = await supabase.from('products').select('brand');
    if (error) throw new Error(`Failed to get brands: ${error.message}`);
    const brands = new Set<string>();
    (data || []).forEach(p => { if (p.brand?.trim()) brands.add(p.brand.trim()); });
    return Array.from(brands).sort();
  }

  static async getUserStats() {
    const users = await this.getAllUsers();
    return {
      totalUsers: users.length,
      adminUsers: users.filter(u => u.is_admin).length,
      regularUsers: users.filter(u => !u.is_admin).length,
      usersWithQuoteAccess: users.filter(u => u.can_create_quote).length,
      usersWithRestrictedStock: users.filter(u => u.allowed_stock_locations.length > 0).length
    };
  }

  private static mapRow(data: SafeAppUserRow): AppUser {
    return {
      id: data.id,
      username: data.username,
      pin: '******',
      is_admin: data.is_admin,
      is_superadmin: data.is_superadmin || false,
      is_compta: data.is_compta || false,
      company_id: data.company_id || undefined,
      can_create_quote: data.can_create_quote,
      allowed_stock_locations: data.allowed_stock_locations || [],
      allowed_brands: data.allowed_brands || [],
      price_display_type: (data.price_display_type || 'normal') as AppUser['price_display_type'],
      custom_seller_name: data.custom_seller_name || '',
      phone: data.phone || '',
      created_at: new Date(data.created_at),
      updated_at: new Date(data.updated_at)
    };
  }

  static validateUserData(userData: CreateAppUserRequest | UpdateAppUserRequest): string[] {
    const errors: string[] = [];
    if ('username' in userData && userData.username !== undefined) {
      if (!userData.username?.trim()) errors.push("Le nom d'utilisateur est requis");
      else if (userData.username.trim().length < 3) errors.push("Le nom d'utilisateur doit contenir au moins 3 caractères");
      else if (userData.username.trim().length > 50) errors.push("Le nom d'utilisateur ne peut pas dépasser 50 caractères");
      else if (!/^[a-zA-Z0-9_-]+$/.test(userData.username.trim())) errors.push("Le nom d'utilisateur ne peut contenir que des lettres, chiffres, tirets et underscores");
    }
    if ('pin' in userData && userData.pin !== undefined) {
      if (!userData.pin) errors.push('Le PIN est requis');
      else if (userData.pin.length !== 6) errors.push('Le PIN doit contenir exactement 6 chiffres');
      else if (!/^\d{6}$/.test(userData.pin)) errors.push('Le PIN ne peut contenir que des chiffres');
    }
    if ('price_display_type' in userData && userData.price_display_type !== undefined) {
      if (!['normal', 'reseller', 'buy', 'calculated'].includes(userData.price_display_type)) {
        errors.push('Type de prix invalide');
      }
    }
    return errors;
  }
}
