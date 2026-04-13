import { settingsApi, productsApi } from '@/lib/apiClient';
import { AppUser, CreateAppUserRequest, UpdateAppUserRequest } from '../types';

function mapRow(data: Record<string, unknown>): AppUser {
  return {
    id: data.id as string,
    username: data.username as string,
    pin: '******',
    is_admin: data.is_admin as boolean,
    can_create_quote: data.can_create_quote as boolean,
    allowed_stock_locations: (data.allowed_stock_locations as string[]) ?? [],
    allowed_brands: (data.allowed_brands as string[]) ?? [],
    price_display_type: (data.price_display_type as AppUser['price_display_type']) ?? 'normal',
    custom_seller_name: (data.custom_seller_name as string) ?? '',
    created_at: new Date(data.created_at as string),
    updated_at: new Date(data.updated_at as string),
  };
}

export class SupabaseUsersService {
  static async getAllUsers(): Promise<AppUser[]> {
    const { users } = await settingsApi.getUsers();
    return (users as Record<string, unknown>[]).map(mapRow);
  }

  static async createUser(userData: CreateAppUserRequest): Promise<AppUser> {
    const { user } = await settingsApi.createUser(userData);
    return mapRow(user as Record<string, unknown>);
  }

  static async updateUser(id: string, updates: UpdateAppUserRequest): Promise<AppUser> {
    const { user } = await settingsApi.updateUser(id, updates);
    return mapRow(user as Record<string, unknown>);
  }

  static async deleteUser(id: string): Promise<void> {
    await settingsApi.deleteUser(id);
  }

  static async isUsernameAvailable(username: string, excludeId?: string): Promise<boolean> {
    const { available } = await settingsApi.checkUsername(username, excludeId);
    return available;
  }

  static async getAvailableStockLocations(): Promise<string[]> {
    const { locations } = await productsApi.getLocations();
    return locations;
  }

  static async getAvailableBrands(): Promise<string[]> {
    const { brands } = await productsApi.getBrands();
    return brands;
  }

  static async getUserStats() {
    const users = await this.getAllUsers();
    return {
      totalUsers: users.length,
      adminUsers: users.filter(u => u.is_admin).length,
      regularUsers: users.filter(u => !u.is_admin).length,
      usersWithQuoteAccess: users.filter(u => u.can_create_quote).length,
      usersWithRestrictedStock: users.filter(u => u.allowed_stock_locations.length > 0).length,
    };
  }

  static validateUserData(userData: CreateAppUserRequest | UpdateAppUserRequest): string[] {
    const errors: string[] = [];
    if ('username' in userData && userData.username !== undefined) {
      if (!userData.username?.trim()) errors.push("Le nom d'utilisateur est requis");
      else if (userData.username.trim().length < 3) errors.push("Le nom d'utilisateur doit contenir au moins 3 caractères");
      else if (userData.username.trim().length > 50) errors.push("Le nom d'utilisateur ne peut pas dépasser 50 caractères");
      else if (!/^[a-zA-Z0-9_-]+$/.test(userData.username.trim())) errors.push("Caractères invalides dans le nom d'utilisateur");
    }
    if ('pin' in userData && userData.pin !== undefined) {
      if (!userData.pin) errors.push('Le PIN est requis');
      else if (userData.pin.length !== 6) errors.push('Le PIN doit contenir exactement 6 chiffres');
      else if (!/^\d{6}$/.test(userData.pin)) errors.push('Le PIN ne peut contenir que des chiffres');
    }
    return errors;
  }
}
