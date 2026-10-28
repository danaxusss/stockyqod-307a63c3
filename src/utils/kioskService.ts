import { supabase } from './supabaseClient';
import { getToken } from './session';
import { describeEdgeError } from './edgeError';

const FUNCTION_NAME = 'kiosk';
const KIOSK_LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
const KIOSK_LOGO_MAX_BYTES = 2 * 1024 * 1024;
const SHOWCASE_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const SHOWCASE_VIDEO_TYPES = ['video/mp4', 'video/webm'];
const SHOWCASE_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const SHOWCASE_VIDEO_MAX_BYTES = 50 * 1024 * 1024;

/**
 * Keeps the HTTP status of a failed kiosk call so the tablet can tell a
 * kiosk that is gone (404) from a transient failure (network, 429, 5xx) and
 * react differently: the first ends the session, the others offer a retry.
 */
export class KioskRequestError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly serverMessage: string | null,
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = 'KioskRequestError';
  }
}

export type KioskLanguage = 'fr' | 'en' | 'ar';
export type KioskPriceMode = 'retail' | 'reseller';
export type KioskCategory = 'utensils' | 'furniture' | 'equipment';
export type KioskRequestStatus = 'new' | 'assigned' | 'reviewing' | 'prepared' | 'contacted' | 'converted' | 'rejected';

/** An extra showcase slide set from the kiosk settings. */
export interface KioskShowcaseSlide {
  id: string;
  media_url: string;
  media_type: 'image' | 'video';
  kicker: string;
  title: string;
  text: string;
}

/** Showcase ("vitrine") settings; absent until the showcase migration has run. */
export interface KioskShowcaseSettings {
  showcase_enabled: boolean;
  /** Idle seconds on the welcome screen before the showcase starts. */
  showcase_idle_seconds: number;
  /** Seconds per slide. */
  showcase_slide_seconds: number;
  /** Include the built-in Cuisimat Groupe presentation. */
  showcase_builtin: boolean;
  showcase_slides: KioskShowcaseSlide[];
  google_review_url: string | null;
}

export interface KioskPublicProfile extends Partial<KioskShowcaseSettings> {
  id: string;
  name: string;
  company_name: string;
  greeting_title: string;
  greeting_message: string;
  logo_url: string | null;
  accent_color: string;
  language: KioskLanguage;
  /** Languages the customer can switch to; the first is the default. */
  customer_languages: KioskLanguage[];
  allow_deferred_contact: boolean;
  success_screen_seconds: number;
  /** Products per row on a tablet; 0 = automatic. */
  grid_columns: number;
  show_prices: boolean;
  price_mode: KioskPriceMode;
  require_email: boolean;
  show_availability: boolean;
  inactivity_timeout_seconds: number;
}

export interface KioskSector {
  id: string;
  name: string;
  name_en: string | null;
  name_ar: string | null;
}

export interface KioskProduct {
  barcode: string;
  name: string;
  brand: string;
  image: string | null;
  kiosk_category: KioskCategory | null;
  price: number | null;
  available: boolean;
  featured?: boolean;
}

export interface KioskAdminProfile extends KioskShowcaseSettings {
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
  customer_languages: KioskLanguage[];
  allow_deferred_contact: boolean;
  success_screen_seconds: number;
  grid_columns: number;
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
  contact_details_pending: boolean;
  status: KioskRequestStatus;
  total_amount: number;
  quote_id: string | null;
  submitted_at: string;
  created_at: string;
  kiosk_profile?: { name: string; require_email?: boolean };
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
  if (error) {
    const failure = await describeEdgeError(error, FUNCTION_NAME);
    console.error(`[edge:${FUNCTION_NAME}] status=${failure.status ?? '?'} — ${failure.serverMessage ?? failure.message}`);
    throw new KioskRequestError(failure.message, failure.status, failure.serverMessage, failure.retryAfter);
  }
  if (data?.error) throw new KioskRequestError(data.error, 200, data.error);
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

  static async loadPublic(token: string): Promise<{ profile: KioskPublicProfile; brands: string[]; sectors?: KioskSector[] }> {
    return invoke({ action: 'public_profile', token });
  }

  static async listPublicProducts(token: string, options: {
    search?: string;
    category?: KioskCategory | null;
    brand?: string | null;
    onlyAvailable?: boolean;
    featuredOnly?: boolean;
    sector?: string | null;
    page?: number;
    pageSize?: number;
  } = {}): Promise<{ products: KioskProduct[]; total: number; page: number; page_size: number }> {
    return invoke({
      action: 'public_catalog', token,
      search: options.search || '', category: options.category || null,
      brand: options.brand || null, only_available: options.onlyAvailable === true,
      featured_only: options.featuredOnly === true,
      sector: options.sector || null,
      page: options.page || 0, page_size: options.pageSize || 30,
    });
  }

  static async submit(token: string, customer: {
    name: string;
    phone: string;
    email?: string;
    note?: string;
  }, items: Array<{ barcode: string; quantity: number }>, deferContact = false): Promise<{ request_id: string; request_number: string }> {
    return invoke({ action: 'public_submit', token, customer, items, defer_contact: deferContact });
  }

  static async adminBootstrap(): Promise<{
    profiles: KioskAdminProfile[];
    companies: KioskCompanyOption[];
    users: KioskUserOption[];
    permissions: { can_manage_profiles: boolean; can_assign_requests: boolean; is_superadmin: boolean };
  }> {
    return invoke({ action: 'admin_bootstrap' }, true);
  }

  static async companyOptions(companyId: string): Promise<{ brands: string[] }> {
    return invoke({ action: 'admin_company_options', company_id: companyId }, true);
  }

  static async saveProfile(profile: KioskAdminProfile): Promise<KioskAdminProfile> {
    const result = await invoke<{ profile: KioskAdminProfile }>({ action: 'admin_save_profile', profile }, true);
    return result.profile;
  }

  static async featuredProducts(barcodes: string[]): Promise<Array<Pick<KioskAdminProduct, 'barcode' | 'name' | 'brand' | 'image'>>> {
    if (!barcodes.length) return [];
    const result = await invoke<{ products: Array<Pick<KioskAdminProduct, 'barcode' | 'name' | 'brand' | 'image'>> }>({
      action: 'admin_featured_products', barcodes,
    }, true);
    return result.products;
  }

  /** Store a kiosk logo next to the product photos and return its public URL. */
  static async uploadLogo(companyId: string, file: File): Promise<string> {
    if (!KIOSK_LOGO_TYPES.includes(file.type)) throw new Error('Format accepté : PNG, JPG, WEBP ou SVG.');
    if (file.size > KIOSK_LOGO_MAX_BYTES) throw new Error('Logo trop volumineux (2 Mo maximum).');
    const extension = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
    const path = `${companyId}/kiosk/logo-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${extension}`;
    const { error } = await supabase.storage.from('product-photos').upload(path, file, { upsert: false, contentType: file.type });
    if (error) throw error;
    return supabase.storage.from('product-photos').getPublicUrl(path).data.publicUrl;
  }

  /** Upload a showcase image or video; returns its public address. */
  static async uploadShowcaseMedia(companyId: string, file: File): Promise<{ url: string; type: KioskShowcaseSlide['media_type'] }> {
    const video = SHOWCASE_VIDEO_TYPES.includes(file.type);
    if (!video && !SHOWCASE_IMAGE_TYPES.includes(file.type)) throw new Error('Format accepté : JPG, PNG, WEBP, MP4 ou WEBM.');
    if (file.size > (video ? SHOWCASE_VIDEO_MAX_BYTES : SHOWCASE_IMAGE_MAX_BYTES)) {
      throw new Error(video ? 'Vidéo trop volumineuse (50 Mo maximum).' : 'Image trop volumineuse (8 Mo maximum).');
    }
    const extension = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || (video ? 'mp4' : 'jpg');
    const path = `${companyId}/kiosk/showcase-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${extension}`;
    const { error } = await supabase.storage.from('product-photos').upload(path, file, { upsert: false, contentType: file.type });
    if (error) throw error;
    return { url: supabase.storage.from('product-photos').getPublicUrl(path).data.publicUrl, type: video ? 'video' : 'image' };
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
