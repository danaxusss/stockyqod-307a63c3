import { supabase } from './supabaseClient';
import { AppUser, CreateAppUserRequest, UpdateAppUserRequest } from '../types';

type SafeAppUserRow = {
  id: string;
  username: string;
  is_admin: boolean;
  can_create_quote: boolean;
  allowed_stock_locations: string[];
  allowed_brands: string[];
  price_display_type: string;
  custom_seller_name: string;
  created_at: string;
  updated_at: string;
};

function getAdminCredentials(): { admin_username: string; admin_pin: string } | null {
  try {
    const stored = localStorage.getItem('inventory_authenticated_user');
    if (stored) {
      const user = JSON.parse(stored);
      const pin = sessionStorage.getItem('inventory_admin_pin');
      if (user.username && pin) {
        return { admin_username: user.username, admin_pin: pin };
      }
    }
  } catch { /* ignore */ }
  return null;
}

export class SupabaseUsersService {
  static async createUser(userData: CreateAppUserRequest): Promise<AppUser> {
    const creds = getAdminCredentials();
    if (!creds) throw new Error('Admin authentication required');

    const { data, error } = await supabase.functions.invoke('admin-users', {
      body: {
        action: 'create_user',
        ...creds,
        username: userData.username,
        pin: userData.pin,
        is_admin: userData.is_admin || false,
        can_create_quote: userData.can_create_quote !== undefined ? userData.can_create_quote : true,
        allowed_stock_locations: userData.allowed_stock_locations || [],
        allowed_brands: userData.allowed_brands || [],
        price_display_type: userData.price_display_type || 'normal',
      }
    });

    if (error) throw new Error(`Failed to create user: ${error.message}`);
    if (!data?.success) throw new Error(data?.error || 'Failed to create user');
    return this.mapRow(data.user as SafeAppUserRow);
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
    const creds = getAdminCredentials();
    if (!creds) throw new Error('Admin authentication required');

    const { data, error } = await supabase.functions.invoke('admin-users', {
      body: {
        action: 'update_user',
        ...creds,
        user_id: id,
        ...(updates.username !== undefined && { username: updates.username }),
        ...(updates.pin !== undefined && { pin: updates.pin }),
        ...(updates.is_admin !== undefined && { is_admin: updates.is_admin }),
        ...(updates.can_create_quote !== undefined && { can_create_quote: updates.can_create_quote }),
        ...(updates.allowed_stock_locations !== undefined && { allowed_stock_locations: updates.allowed_stock_locations }),
        ...(updates.allowed_brands !== undefined && { allowed_brands: updates.allowed_brands }),
        ...(updates.price_display_type !== undefined && { price_display_type: updates.price_display_type }),
        ...(updates.custom_seller_name !== undefined && { custom_seller_name: updates.custom_seller_name }),
      }
    });

    if (error) throw new Error(`Failed to update user: ${error.message}`);
    if (!data?.success) throw new Error(data?.error || 'Failed to update user');
    return this.mapRow(data.user as SafeAppUserRow);
  }

  static async deleteUser(id: string): Promise<void> {
    const creds = getAdminCredentials();
    if (!creds) throw new Error('Admin authentication required');

    const { data, error } = await supabase.functions.invoke('admin-users', {
      body: { action: 'delete_user', ...creds, user_id: id }
    });

    if (error) throw new Error(`Failed to delete user: ${error.message}`);
    if (!data?.success) throw new Error(data?.error || 'Failed to delete user');
  }

  static async getAvailableStockLocations(): Promise<string[]> {
    const { data, error } = await supabase
      .from('products')
      .select('stock_levels');

    if (error) throw new Error(`Failed to get stock locations: ${error.message}`);

    const locations = new Set<string>();
    (data || []).forEach(product => {
      const levels = product.stock_levels as Record<string, number> | null;
      if (levels && typeof levels === 'object') {
        Object.keys(levels).forEach(location => {
          if (location && location.trim()) locations.add(location.trim());
        });
      }
    });
    return Array.from(locations).sort();
  }

  static async getAvailableBrands(): Promise<string[]> {
    const { data, error } = await supabase
      .from('products')
      .select('brand');

    if (error) throw new Error(`Failed to get brands: ${error.message}`);

    const brands = new Set<string>();
    (data || []).forEach(product => {
      if (product.brand && typeof product.brand === 'string' && product.brand.trim()) {
        brands.add(product.brand.trim());
      }
    });
    return Array.from(brands).sort();
  }

  static async isUsernameAvailable(username: string, excludeId?: string): Promise<boolean> {
    const creds = getAdminCredentials();
    if (!creds) throw new Error('Admin authentication required');

    const { data, error } = await supabase.functions.invoke('admin-users', {
      body: { action: 'check_username', ...creds, username, exclude_id: excludeId }
    });

    if (error) throw new Error(`Failed to check username: ${error.message}`);
    return data?.available ?? false;
  }

  static async getUserStats(): Promise<{
    totalUsers: number;
    adminUsers: number;
    regularUsers: number;
    usersWithQuoteAccess: number;
    usersWithRestrictedStock: number;
  }> {
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
      pin: '******', // PIN is never exposed to client
      is_admin: data.is_admin,
      can_create_quote: data.can_create_quote,
      allowed_stock_locations: data.allowed_stock_locations || [],
      allowed_brands: data.allowed_brands || [],
      price_display_type: (data.price_display_type || 'normal') as AppUser['price_display_type'],
      custom_seller_name: data.custom_seller_name || '',
      created_at: new Date(data.created_at),
      updated_at: new Date(data.updated_at)
    };
  }

  static validateUserData(userData: CreateAppUserRequest | UpdateAppUserRequest): string[] {
    const errors: string[] = [];

    if ('username' in userData && userData.username !== undefined) {
      if (!userData.username || userData.username.trim().length === 0) {
        errors.push('Le nom d\'utilisateur est requis');
      } else if (userData.username.trim().length < 3) {
        errors.push('Le nom d\'utilisateur doit contenir au moins 3 caractères');
      } else if (userData.username.trim().length > 50) {
        errors.push('Le nom d\'utilisateur ne peut pas dépasser 50 caractères');
      } else if (!/^[a-zA-Z0-9_-]+$/.test(userData.username.trim())) {
        errors.push('Le nom d\'utilisateur ne peut contenir que des lettres, chiffres, tirets et underscores');
      }
    }

    if ('pin' in userData && userData.pin !== undefined) {
      if (!userData.pin || userData.pin.length === 0) {
        errors.push('Le PIN est requis');
      } else if (userData.pin.length !== 6) {
        errors.push('Le PIN doit contenir exactement 6 chiffres');
      } else if (!/^\d{6}$/.test(userData.pin)) {
        errors.push('Le PIN ne peut contenir que des chiffres');
      }
    }

    if ('price_display_type' in userData && userData.price_display_type !== undefined) {
      const validPriceTypes = ['normal', 'reseller', 'buy', 'calculated'];
      if (!validPriceTypes.includes(userData.price_display_type)) {
        errors.push('Type de prix invalide');
      }
    }

    if ('allowed_stock_locations' in userData && userData.allowed_stock_locations !== undefined) {
      if (!Array.isArray(userData.allowed_stock_locations)) {
        errors.push('Les emplacements de stock doivent être un tableau');
      }
    }

    return errors;
  }
}
