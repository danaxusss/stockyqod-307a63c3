export interface Product {
  barcode: string;
  name: string;
  brand: string;
  techsheet: string;
  price: number;
  buyprice: number;
  reseller_price: number;
  provider: string;
  stock_levels: Record<string, number>;
  created_at?: string;
  updated_at?: string;
}

export interface Meta {
  version: string;
  adminPin: string;
}

export interface SyncData {
  meta: Meta;
  rows: Product[];
}

export type UserRole = 'sales' | 'admin';

export interface AppState {
  role: UserRole;
  isOnline: boolean;
  hasNewData: boolean;
  products: Product[];
  meta: Meta | null;
}

export interface ExcelRow {
  barcode: string;
  'product name': string;
  brand: string;
  'stock location': string;
  'stock level': number;
  'buy price': number;
  'sell price': number;
  'reseller price': number;
  'provider': string;
}

export interface QuoteItem {
  id: string;
  product: Product;
  priceType: 'normal' | 'reseller';
  marginPercentage: number;
  finalPrice: number;
  addedAt: Date;
  // Quote-specific editable fields
  unitPrice: number;
  quantity: number;
  subtotal: number;
  discount?: number; // percentage discount (0-100)
}

export interface QuoteCart {
  items: QuoteItem[];
  totalItems: number;
}

export interface CustomerInfo {
  fullName: string;
  phoneNumber: string;
  address: string;
  city: string;
  ice?: string;
  salesPerson: string;
}

export interface Quote {
  id: string;
  quoteNumber: string;
  commandNumber?: string;
  createdAt: Date;
  updatedAt: Date;
  status: 'draft' | 'final';
  customer: CustomerInfo;
  items: QuoteItem[];
  totalAmount: number;
  notes?: string;
}

export interface QuoteTemplate {
  id: string;
  name: string;
  fileData: ArrayBuffer;
  fileType: string;
  uploadedAt: Date;
  isActive: boolean;
}

export interface AppUser {
  id: string;
  username: string;
  pin: string;
  is_admin: boolean;
  can_create_quote: boolean;
  allowed_stock_locations: string[];
  allowed_brands: string[];
  price_display_type: 'normal' | 'reseller' | 'buy' | 'calculated';
  custom_seller_name?: string;
  created_at: Date;
  updated_at: Date;
}

export interface CreateAppUserRequest {
  username: string;
  pin: string;
  is_admin?: boolean;
  can_create_quote?: boolean;
  allowed_stock_locations?: string[];
  allowed_brands?: string[];
  price_display_type?: 'normal' | 'reseller' | 'buy' | 'calculated';
}

export interface UpdateAppUserRequest {
  username?: string;
  pin?: string;
  is_admin?: boolean;
  can_create_quote?: boolean;
  allowed_stock_locations?: string[];
  allowed_brands?: string[];
  price_display_type?: 'normal' | 'reseller' | 'buy' | 'calculated';
  custom_seller_name?: string;
}

export interface UserPermissions {
  canCreateQuote: boolean;
  allowedStockLocations: string[];
  allowedBrands: string[];
  priceDisplayType: 'normal' | 'reseller' | 'buy' | 'calculated';
  isAdmin: boolean;
}