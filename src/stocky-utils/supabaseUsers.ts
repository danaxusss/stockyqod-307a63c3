import { supabase } from './supabaseClient';
import { AppUser, CreateAppUserRequest, UpdateAppUserRequest } from '../types';

export class SupabaseUsersService {
  // Create a new user
  static async createUser(userData: CreateAppUserRequest): Promise<AppUser> {
    console.log('Creating new user:', userData.username);
    
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
      console.error('Failed to create user:', error);
      if (error.code === '23505') {
        throw new Error('Un utilisateur avec ce nom existe déjà');
      }
      throw new Error(`Échec de la création de l'utilisateur: ${error.message}`);
    }

    if (!data) {
      throw new Error('Aucune donnée retournée lors de la création de l\'utilisateur');
    }

    return this.mapSupabaseUserToAppUser(data);
  }

  // Get a user by username (for authentication)
  static async getUserByUsername(username: string): Promise<AppUser | null> {
    console.log('Fetching user by username:', username);
    
    const { data, error } = await supabase
      .from('app_users')
      .select('*')
      .eq('username', username)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // No rows returned
        return null;
      }
      console.error('Failed to fetch user by username:', error);
      throw new Error(`Échec de la récupération de l'utilisateur: ${error.message}`);
    }

    if (!data) return null;

    return this.mapSupabaseUserToAppUser(data);
  }

  // Get a user by ID
  static async getUserById(id: string): Promise<AppUser | null> {
    console.log('Fetching user by ID:', id);
    
    const { data, error } = await supabase
      .from('app_users')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // No rows returned
        return null;
      }
      console.error('Failed to fetch user by ID:', error);
      throw new Error(`Échec de la récupération de l'utilisateur: ${error.message}`);
    }

    if (!data) return null;

    return this.mapSupabaseUserToAppUser(data);
  }

  // Get all users (for management page)
  static async getAllUsers(): Promise<AppUser[]> {
    console.log('Fetching all users');
    
    const { data, error } = await supabase
      .from('app_users')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Failed to fetch all users:', error);
      throw new Error(`Échec de la récupération des utilisateurs: ${error.message}`);
    }

    return (data || []).map(user => this.mapSupabaseUserToAppUser(user));
  }

  // Update a user
  static async updateUser(id: string, updates: UpdateAppUserRequest): Promise<AppUser> {
    console.log('Updating user:', id, updates);
    
    const updateData: any = {
      updated_at: new Date().toISOString()
    };

    // Only include fields that are being updated
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
      console.error('Failed to update user:', error);
      if (error.code === '23505') {
        throw new Error('Un utilisateur avec ce nom existe déjà');
      }
      throw new Error(`Échec de la mise à jour de l'utilisateur: ${error.message}`);
    }

    if (!data) {
      throw new Error('Aucune donnée retournée lors de la mise à jour de l\'utilisateur');
    }

    return this.mapSupabaseUserToAppUser(data);
  }

  // Delete a user
  static async deleteUser(id: string): Promise<void> {
    console.log('Deleting user:', id);
    
    const { error } = await supabase
      .from('app_users')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Failed to delete user:', error);
      throw new Error(`Échec de la suppression de l'utilisateur: ${error.message}`);
    }

    console.log('User deleted successfully');
  }

  // Authenticate user (verify username and PIN)
  static async authenticateUser(username: string, pin: string): Promise<AppUser | null> {
    console.log('Authenticating user:', username);
    
    const user = await this.getUserByUsername(username);
    
    if (!user) {
      console.log('User not found:', username);
      return null;
    }

    // In a production app, you should hash the PIN and compare hashes
    // For this implementation, we're doing a direct comparison
    if (user.pin !== pin) {
      console.log('Invalid PIN for user:', username);
      return null;
    }

    console.log('User authenticated successfully:', username);
    return user;
  }

  // Get unique stock locations from products (helper for UI)
  static async getAvailableStockLocations(): Promise<string[]> {
    console.log('Fetching available stock locations');
    
    const { data, error } = await supabase
      .from('products')
      .select('stock_levels');

    if (error) {
      console.error('Failed to fetch stock locations:', error);
      throw new Error(`Échec de la récupération des emplacements de stock: ${error.message}`);
    }

    const locations = new Set<string>();
    
    (data || []).forEach(product => {
      if (product.stock_levels && typeof product.stock_levels === 'object') {
        Object.keys(product.stock_levels).forEach(location => {
          if (location && location.trim()) {
            locations.add(location.trim());
          }
        });
      }
    });

    return Array.from(locations).sort();
  }

  // Check if username is available
  static async isUsernameAvailable(username: string, excludeId?: string): Promise<boolean> {
    console.log('Checking username availability:', username);
    
    let query = supabase
      .from('app_users')
      .select('id')
      .eq('username', username);

    if (excludeId) {
      query = query.neq('id', excludeId);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Failed to check username availability:', error);
      throw new Error(`Échec de la vérification du nom d'utilisateur: ${error.message}`);
    }

    return !data || data.length === 0;
  }

  // Get user statistics
  static async getUserStats(): Promise<{
    totalUsers: number;
    adminUsers: number;
    regularUsers: number;
    usersWithQuoteAccess: number;
    usersWithRestrictedStock: number;
  }> {
    console.log('Fetching user statistics');
    
    const users = await this.getAllUsers();
    
    const stats = {
      totalUsers: users.length,
      adminUsers: users.filter(u => u.is_admin).length,
      regularUsers: users.filter(u => !u.is_admin).length,
      usersWithQuoteAccess: users.filter(u => u.can_create_quote).length,
      usersWithRestrictedStock: users.filter(u => u.allowed_stock_locations.length > 0).length
    };

    console.log('User statistics:', stats);
    return stats;
  }

  // Helper method to map Supabase data to AppUser interface
  private static mapSupabaseUserToAppUser(data: any): AppUser {
    return {
      id: data.id,
      username: data.username,
      pin: data.pin,
      is_admin: data.is_admin,
      can_create_quote: data.can_create_quote,
      allowed_stock_locations: data.allowed_stock_locations || [],
      allowed_brands: data.allowed_brands || [],
      price_display_type: data.price_display_type || 'normal',
      created_at: new Date(data.created_at),
      updated_at: new Date(data.updated_at)
    };
  }

  // Validate user data before creation/update
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
  // Get unique brands from products (helper for UI)
  static async getAvailableBrands(): Promise<string[]> {
    console.log('Fetching available brands');
    
    const { data, error } = await supabase
      .from('products')
      .select('brand');

    if (error) {
      console.error('Failed to fetch brands:', error);
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
}