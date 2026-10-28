import { supabase } from './supabaseClient';
import { getToken } from './session';
import { describeEdgeError } from './edgeError';
import { AppUser, AppUserRole, CreateAppUserRequest, UpdateAppUserRequest } from '../types';

type SafeAppUserRow = {
  id: string;
  username: string;
  is_admin: boolean;
  is_superadmin: boolean;
  is_compta: boolean;
  new_role: AppUserRole | null;
  cross_branch_read: boolean;
  company_id: string | null;
  can_create_quote: boolean;
  can_edit_products?: boolean;
  allowed_stock_locations: string[];
  allowed_brands: string[];
  price_display_type: string;
  custom_seller_name: string;
  phone: string;
  tasks_role?: string | null;
  tasks_only?: boolean | null;
  created_at: string;
  updated_at: string;
};

/**
 * User management goes through the admin-users edge function: it checks the
 * signed session (superadmin only) and hashes PINs server-side. The browser
 * never writes app_users itself.
 */
async function adminUsers<T>(action: string, body: Record<string, unknown>): Promise<T> {
  const session_token = getToken();
  if (!session_token) throw new Error('Session expirée : reconnectez-vous.');
  const { data, error } = await supabase.functions.invoke('admin-users', { body: { ...body, action, session_token } });
  if (error) {
    const failure = await describeEdgeError(error, 'admin-users');
    throw new Error(failure.serverMessage || failure.message);
  }
  if (data?.error) throw new Error(data.error);
  return data as T;
}

export class SupabaseUsersService {
  static async createUser(userData: CreateAppUserRequest): Promise<AppUser> {
    if (!userData.pin) throw new Error('PIN requis');
    const { user } = await adminUsers<{ user: SafeAppUserRow }>('create_user', { ...userData });
    return { ...this.mapRow(user), can_edit_products: userData.can_edit_products === true };
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
    const { user } = await adminUsers<{ user: SafeAppUserRow }>('update_user', { ...updates, user_id: id });
    const updated = this.mapRow(user);
    return updates.can_edit_products !== undefined ? { ...updated, can_edit_products: updates.can_edit_products } : updated;
  }

  /** Seller name shown on the signed-in user's own quotes (any role). */
  static async updateOwnSellerName(name: string): Promise<void> {
    await adminUsers('update_own_profile', { custom_seller_name: name });
  }

  static async deleteUser(id: string): Promise<void> {
    await adminUsers('delete_user', { user_id: id });
  }

  static async isUsernameAvailable(username: string, excludeId?: string): Promise<boolean> {
    const { available } = await adminUsers<{ available: boolean }>('check_username', { username, exclude_id: excludeId });
    return available;
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
      new_role: data.new_role || undefined,
      cross_branch_read: data.cross_branch_read || false,
      company_id: data.company_id || undefined,
      can_create_quote: data.can_create_quote,
      can_edit_products: data.can_edit_products === true,
      allowed_stock_locations: data.allowed_stock_locations || [],
      allowed_brands: data.allowed_brands || [],
      price_display_type: (data.price_display_type || 'normal') as AppUser['price_display_type'],
      custom_seller_name: data.custom_seller_name || '',
      phone: data.phone || '',
      tasks_role: (data.tasks_role as AppUser['tasks_role']) || null,
      tasks_only: data.tasks_only || false,
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
