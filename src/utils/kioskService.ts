import { supabase } from './supabaseClient';
import { getToken } from './session';
import { throwEdgeError } from './edgeError';

const FUNCTION_NAME = 'kiosk';

export type KioskLanguage = 'fr' | 'en' | 'ar';
export type KioskPriceMode = 'retail' | 'reseller';
export type KioskRequestStatus = 'new' | 'assigned' | 'reviewing' | 'prepared' | 'contacted' | 'converted' | 'rejected';

export interface KioskPublicProfile {
  id: string;
  name: string;
  company_name: string;
  greeting_title: string;
  greeting_message: string;
  logo_url: string | null;
  accent_color: string;
  language: KioskLanguage;
  show_prices: boolean;
  price_mode: KioskPriceMode;
  require_email: boolean;
  show_availability: boolean;
  inactivity_timeout_seconds: number;
}

export interface KioskFamily {
  id: string;
  name: string;
  sort_order: number;
}

export interface KioskProduct {
  barcode: string;
  name: string;
  brand: string;
  image: string | null;
  family_id: string | null;
  family_name: string | null;
  price: number | null;
  available: boolean;
}

export interface KioskAdminProfile {
  id?: string;
  company_id: string;
  name: string;
  public_token?: string;
  enabled: boolean;
  greeting_title: string;
  greeting_message: string;
  logo_url: string | null;
  accent_color: string | null;
  language: KioskLanguage;
  show_prices: boolean;
  price_mode: KioskPriceMode;
  require_email: boolean;
  show_out_of_stock: boolean;
  show_availability: boolean;
  inactivity_timeout_seconds: number;
  default_assignee_id: string | null;
  visible_family_ids: string[];
  visible_brands: string[];
  featured_barcodes: string[];
  company?: { name: string };
}

export interface KioskCompanyOption {
  id: string;
  name: string;
  logo_url?: string | null;
  accent_color?: string | null;
}

export interface KioskUserOption {
  id: string;
  username: string;
  custom_seller_name: string | null;
  company_id: string | null;
  can_create_quote: boolean;
  new_role: string | null;
}

export interface KioskRequestItem {
  id?: string;
  product_barcode: string;
  product_name: string;
  product_brand: string;
  product_image: string | null;
  quantity: number;
  unit_price: number;
  customer_unit_price?: number | null;
  price_mode: KioskPriceMode;
  subtotal: number;
  sort_order?: number;
}

export interface KioskRequestSummary {
  id: string;
  request_number: string;
  kiosk_profile_id: string;
  company_id: string;
  assigned_company_id: string;
  assigned_user_id: string | null;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  status: KioskRequestStatus;
  total_amount: number;
  quote_id: string | null;
  submitted_at: string;
  created_at: string;
  kiosk_profile?: { name: string };
  assigned_company?: { name: string };
  assigned_user?: { username: string; custom_seller_name: string | null } | null;
  kiosk_request_items?: Array<{ count: number }>;
}

export interface KioskRequestDetail extends KioskRequestSummary {
  customer_note: string | null;
  internal_notes: string | null;
  original_submission: Record<string, unknown>;
  items: KioskRequestItem[];
  events: Array<{
    id: string;
    event_type: string;
    actor_name: string | null;
    details: Record<string, unknown>;
    created_at: string;
  }>;
}

export interface KioskAdminProduct {
  barcode: string;
  name: string;
  brand: string;
  image: string | null;
  retail_price: number;
  reseller_price: number;
}

async function invoke<T>(body: Record<string, unknown>, staff = false): Promise<T> {
  const payload = staff ? { ...body, session_token: getToken() } : body;
  if (staff && !payload.session_token) throw new Error('Reconnectez-vous pour accéder aux demandes kiosque.');
  const { data, error } = await supabase.functions.invoke(FUNCTION_NAME, { body: payload });
  if (error) return throwEdgeError(error, FUNCTION_NAME);
  if (data?.error) throw new Error(data.error);
  return data as T;
}

export class KioskService {
  static imageUrl(image: string | null): string | null {
    if (!image) return null;
    if (!image.includes('/')) return `${import.meta.env.BASE_URL || '/'}catalogue-images/${image}`;
    return supabase.storage.from('product-photos').getPublicUrl(image).data.publicUrl;
  }

  static publicUrl(token: string): string {
    const base = new URL(import.meta.env.BASE_URL || '/', window.location.origin);
    return new URL(`kiosk/${token}`, base).toString();
  }

  static async loadPublic(token: string): Promise<{ profile: KioskPublicProfile; families: KioskFamily[] }> {
    return invoke({ action: 'public_profile', token });
  }

  static async listPublicProducts(token: string, options: {
    search?: string;
    familyId?: string | null;
    page?: number;
    pageSize?: number;
  } = {}): Promise<{ products: KioskProduct[]; total: number; page: number; page_size: number }> {
    return invoke({
      action: 'public_catalog', token,
      search: options.search || '', family_id: options.familyId || null,
      page: options.page || 0, page_size: options.pageSize || 30,
    });
  }

  static async submit(token: string, customer: {
    name: string;
    phone: string;
    email?: string;
    note?: string;
  }, items: Array<{ barcode: string; quantity: number }>): Promise<{ request_id: string; request_number: string }> {
    return invoke({ action: 'public_submit', token, customer, items });
  }

  static async adminBootstrap(): Promise<{
    profiles: KioskAdminProfile[];
    companies: KioskCompanyOption[];
    users: KioskUserOption[];
    permissions: { can_manage_profiles: boolean; can_assign_requests: boolean; is_superadmin: boolean };
  }> {
    return invoke({ action: 'admin_bootstrap' }, true);
  }

  static async companyOptions(companyId: string): Promise<{ families: KioskFamily[]; brands: string[] }> {
    return invoke({ action: 'admin_company_options', company_id: companyId }, true);
  }

  static async saveProfile(profile: KioskAdminProfile): Promise<KioskAdminProfile> {
    const result = await invoke<{ profile: KioskAdminProfile }>({ action: 'admin_save_profile', profile }, true);
    return result.profile;
  }

  static async rotateToken(profileId: string): Promise<string> {
    const result = await invoke<{ profile: { public_token: string } }>({ action: 'admin_rotate_token', profile_id: profileId }, true);
    return result.profile.public_token;
  }

  static async listRequests(options: {
    search?: string;
    status?: KioskRequestStatus | 'all';
    page?: number;
    pageSize?: number;
  } = {}): Promise<{ requests: KioskRequestSummary[]; total: number; page: number; page_size: number }> {
    return invoke({
      action: 'admin_list_requests', search: options.search || '', status: options.status || 'all',
      page: options.page || 0, page_size: options.pageSize || 50,
    }, true);
  }

  static async getRequest(requestId: string): Promise<KioskRequestDetail> {
    const result = await invoke<{ request: KioskRequestDetail }>({ action: 'admin_get_request', request_id: requestId }, true);
    return result.request;
  }

  static async updateRequest(requestId: string, request: Partial<KioskRequestDetail> & { items: KioskRequestItem[] }): Promise<void> {
    await invoke({ action: 'admin_update_request', request_id: requestId, request }, true);
  }

  static async searchProducts(companyId: string, search: string): Promise<KioskAdminProduct[]> {
    const result = await invoke<{ products: KioskAdminProduct[] }>({
      action: 'admin_product_search', company_id: companyId, search,
    }, true);
    return result.products;
  }

  static async convertRequest(requestId: string): Promise<{ quote_id: string; quote_number: string }> {
    const result = await invoke<{ quote: { quote_id: string; quote_number: string } }>({
      action: 'admin_convert_request', request_id: requestId,
    }, true);
    return result.quote;
  }
}
