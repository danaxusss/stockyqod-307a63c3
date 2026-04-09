import { supabase } from './supabaseClient';
import { AppUser, CreateAppUserRequest, UpdateAppUserRequest } from '../types';
import type { Json } from '@/integrations/supabase/types';

type AppUserRow = {
  id: string;
  username: string;
  pin: string;
  is_admin: boolean;
  can_create_quote: boolean;
  allowed_stock_locations: string[];
  allowed_brands: string[];
  price_display_type: string;
  created_at: string;
  updated_at: string;
};

export class SupabaseUsersService {
  static async createUser(userData: CreateAppUserRequest): Promise<AppUser> {
    const userToCreate = {
      username: userData.username,
      pin: userData.pin,
      is_admin: userData.is_admin || false,
      can_create_quote: userData.can_create_quote !== undefined ? userData.can_create_quote : true,
      allowed_stock_locations: userData.allowed_stock_locations || [],
      allowed_brands: userData.allowed_brands || [],
      price_display_type: userData.price_display_type || 'normal'
    };

    const { data, error } = await supabase
      .from('app_users')
      .insert(userToCreate)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        throw new Error('Un utilisateur avec ce nom existe déjà');
      }
      throw new Error(`Échec de la création de l'utilisateur: ${error.message}`);
    }

    if (!data) {
      throw new Error('Aucune donnée retournée lors de la création de l\'utilisateur');
    }

    return this.mapRow(data as unknown as AppUserRow);
  }

  static async getUserByUsername(username: string): Promise<AppUser | null> {
    const { data, error } = await supabase
      .from('app_users')
      .select('*')
      .eq('username', username)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw new Error(`Échec de la récupération de l'utilisateur: ${error.message}`);
    }

    if (!data) return null;
    return this.mapRow(data as unknown as AppUserRow);
  }

  static async getUserById(id: string): Promise<AppUser | null> {
    const { data, error } = await supabase
      .from('app_users')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw new Error(`Échec de la récupération de l'utilisateur: ${error.message}`);
    }

    if (!data) return null;
    return this.mapRow(data as unknown as AppUserRow);
  }

  static async getAllUsers(): Promise<AppUser[]> {
    const { data, error } = await supabase
      .from('app_users')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Échec de la récupération des utilisateurs: ${error.message}`);
    }

    return (data || []).map(row => this.mapRow(row as unknown as AppUserRow));
  }

  static async updateUser(id: string, updates: UpdateAppUserRequest): Promise<AppUser> {
    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString()
    };

    if (updates.username !== undefined) updateData.username = updates.username;
    if (updates.pin !== undefined) updateData.pin = updates.pin;
    if (updates.is_admin !== undefined) updateData.is_admin = updates.is_admin;
    if (updates.can_create_quote !== undefined) updateData.can_create_quote = updates.can_create_quote;
    if (updates.allowed_stock_locations !== undefined) updateData.allowed_stock_locations = updates.allowed_stock_locations;
    if (updates.allowed_brands !== undefined) updateData.allowed_brands = updates.allowed_brands;
    if (updates.price_display_type !== undefined) updateData.price_display_type = updates.price_display_type;

    const { data, error } = await supabase
      .from('app_users')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        throw new Error('Un utilisateur avec ce nom existe déjà');
      }
      throw new Error(`Échec de la mise à jour de l'utilisateur: ${error.message}`);
    }

    if (!data) {
      throw new Error('Aucune donnée retournée lors de la mise à jour de l\'utilisateur');
    }

    return this.mapRow(data as unknown as AppUserRow);
  }

  static async deleteUser(id: string): Promise<void> {
    const { error } = await supabase
      .from('app_users')
      .delete()
      .eq('id', id);

    if (error) {
      throw new Error(`Échec de la suppression de l'utilisateur: ${error.message}`);
    }
  }

  static async authenticateUser(username: string, pin: string): Promise<AppUser | null> {
    const user = await this.getUserByUsername(username);
    if (!user) return null;
    if (user.pin !== pin) return null;
    return user;
  }

  static async getAvailableStockLocations(): Promise<string[]> {
    const { data, error } = await supabase
      .from('products')
      .select('stock_levels');

    if (error) {
      throw new Error(`Échec de la récupération des emplacements de stock: ${error.message}`);
    }

    const locations = new Set<string>();
    (data || []).forEach(product => {
      const levels = product.stock_levels as Record<string, number> | null;
      if (levels && typeof levels === 'object') {
        Object.keys(levels).forEach(location => {
          if (location && location.trim()) {
            locations.add(location.trim());
          }
        });
      }
    });

    return Array.from(locations).sort();
  }

  static async getAvailableBrands(): Promise<string[]> {
    const { data, error } = await supabase
      .from('products')
      .select('brand');

    if (error) {
      throw new Error(`Échec de la récupération des marques: ${error.message}`);
    }

    const brands = new Set<string>();
    (data || []).forEach(product => {
      if (product.brand && typeof product.brand === 'string' && product.brand.trim()) {
        brands.add(product.brand.trim());
      }
    });

    return Array.from(brands).sort();
  }

  static async isUsernameAvailable(username: string, excludeId?: string): Promise<boolean> {
    let query = supabase
      .from('app_users')
      .select('id')
      .eq('username', username);

    if (excludeId) {
      query = query.neq('id', excludeId);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Échec de la vérification du nom d'utilisateur: ${error.message}`);
    }

    return !data || data.length === 0;
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

  private static mapRow(data: AppUserRow): AppUser {
    return {
      id: data.id,
      username: data.username,
      pin: data.pin,
      is_admin: data.is_admin,
      can_create_quote: data.can_create_quote,
      allowed_stock_locations: data.allowed_stock_locations || [],
      allowed_brands: data.allowed_brands || [],
      price_display_type: (data.price_display_type || 'normal') as AppUser['price_display_type'],
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
