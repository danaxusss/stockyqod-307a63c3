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
  quoteName?: string;
  quoteBrand?: string;
  quoteBarcode?: string;
  is_billed?: boolean; // used in proforma items for invoice tracking
  billed_by_company_id?: string; // issuing company that generated the invoice for this item
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
  status: 'draft' | 'final' | 'pending' | 'solde';
  customer: CustomerInfo;
  items: QuoteItem[];
  totalAmount: number;
  notes?: string;
  createdBy?: string;
  // Financial document pipeline fields
  document_type?: 'quote' | 'bl' | 'proforma' | 'invoice';
  parent_document_id?: string;
  source_bl_ids?: string[];
  paid_amount?: number;
  issuing_company_id?: string;
  company_id?: string;
  payment_date?: string;
  payment_method?: string;
  payment_reference?: string; // cheque no., transfer ref, effect no., etc.
  payment_bank?: string;      // bank / financial institution name
}

export interface QuoteTemplate {
  id: string;
  name: string;
  fileData: ArrayBuffer;
  fileType: string;
  uploadedAt: Date;
  isActive: boolean;
}

export interface Company {
  id: string;
  name: string;
  address: string;
  phone: string;
  phone2: string;
  email: string;
  website: string;
  ice: string;
  rc: string;
  if_number: string;
  cnss: string;
  patente: string;
  logo_url: string | null;
  logo_size: 'small' | 'medium' | 'large';
  accent_color: string;
  font_family: string;
  tva_rate: number;
  quote_validity_days: number;
  payment_terms: string;
  share_templates: Record<string, string>;
  quote_visible_fields: Record<string, boolean>;
  quote_style: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface AppUser {
  id: string;
  username: string;
  pin: string;
  is_admin: boolean;
  is_superadmin?: boolean;
  is_compta?: boolean;
  company_id?: string;
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
  is_superadmin?: boolean;
  is_compta?: boolean;
  company_id?: string;
  can_create_quote?: boolean;
  allowed_stock_locations?: string[];
  allowed_brands?: string[];
  price_display_type?: 'normal' | 'reseller' | 'buy' | 'calculated';
  custom_seller_name?: string;
}

export interface UpdateAppUserRequest {
  username?: string;
  pin?: string;
  is_admin?: boolean;
  is_superadmin?: boolean;
  is_compta?: boolean;
  company_id?: string;
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
  isSuperAdmin: boolean;
  isCompta: boolean;
  companyId: string | null;
}

export interface TechnicalSheet {
  id: string;
  title: string;
  manufacturer: string;
  category: string;
  sector: string;
  file_url: string;
  file_size: number;
  file_type: string;
  view_count: number;
  download_count: number;
  created_at: string;
  updated_at: string;
}

export interface TechnicalSheetProduct {
  id: string;
  sheet_id: string;
  product_barcode: string;
  created_at: string;
}

export interface SheetShareLink {
  id: string;
  token: string;
  title: string | null;
  sheet_ids: string[];
  expires_at: string | null;
  view_count: number;
  created_at: string;
}
