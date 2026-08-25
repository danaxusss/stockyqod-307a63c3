export interface Product {
  barcode: string;
  name: string;
  brand: string;
  image?: string | null;
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

export type AppUserRole = 'super_admin' | 'admin' | 'manager' | 'facturation' | 'compta' | 'senior_sales' | 'junior_sales';

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
  dispatch?: Array<{
    stock_location_id: string;
    stock_location_name?: string;
    stock_location_abbrev?: string;
    sub_location_code: string;
    quantity: number;
  }>;
  provider_id?: string;
  provider_name?: string;
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
  clientCode?: string;
}

export interface PaymentEntry {
  method: string;
  reference?: string;
  bank?: string;
  amount?: number;
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
  notes2?: string;
  createdBy?: string;
  quote_date?: string;
  is_locked?: boolean;
  avance_amount?: number;
  payment_methods_json?: PaymentEntry[];
  // Financial document pipeline fields
  document_type?: 'quote' | 'bl' | 'proforma' | 'invoice' | 'avoir' | 'bon_commande';
  avoir_reason?: string;
  parent_document_id?: string;
  source_bl_ids?: string[];
  paid_amount?: number;
  issuing_company_id?: string;
  company_id?: string;
  payment_date?: string;
  payment_method?: string;
  payment_reference?: string;
  payment_bank?: string;
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
  doc_prefix: string;
  qr_code_url: string;
  bl_show_prices: boolean;
  special_pin: string;
  created_at: string;
  updated_at: string;
}

export interface Client {
  id: string;
  full_name: string;
  phone_number: string;
  address: string;
  city: string;
  ice: string;
  email: string;
  client_code?: string;
  company_id?: string;
  created_at: string;
  updated_at: string;
}

export interface Return {
  id: string;
  company_id?: string;
  reference_document_id?: string;
  reference_number: string;
  client_name: string;
  reason: string;
  items: ReturnItem[];
  status: 'open' | 'closed';
  is_locked?: boolean;
  notes?: string;
  return_date?: string;
  created_by?: string;
  created_at: string;
  updated_at: string;
}

export interface ReturnItem {
  barcode: string;
  label: string;
  quantity: number;
}

export interface AppUser {
  id: string;
  username: string;
  pin: string;
  is_admin: boolean;
  is_superadmin?: boolean;
  is_compta?: boolean;
  new_role?: AppUserRole;
  cross_branch_read?: boolean;
  company_id?: string;
  can_create_quote: boolean;
  allowed_stock_locations: string[];
  allowed_brands: string[];
  price_display_type: 'normal' | 'reseller' | 'buy' | 'calculated';
  custom_seller_name?: string;
  phone?: string;
  tasks_role?: TasksRole | null;
  tasks_only?: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface CreateAppUserRequest {
  username: string;
  pin: string;
  is_admin?: boolean;
  is_superadmin?: boolean;
  is_compta?: boolean;
  new_role?: AppUserRole;
  cross_branch_read?: boolean;
  company_id?: string;
  can_create_quote?: boolean;
  allowed_stock_locations?: string[];
  allowed_brands?: string[];
  price_display_type?: 'normal' | 'reseller' | 'buy' | 'calculated';
  custom_seller_name?: string;
  phone?: string;
  tasks_role?: TasksRole | null;
  tasks_only?: boolean;
}

export interface UpdateAppUserRequest {
  username?: string;
  pin?: string;
  is_admin?: boolean;
  is_superadmin?: boolean;
  is_compta?: boolean;
  new_role?: AppUserRole;
  cross_branch_read?: boolean;
  company_id?: string;
  can_create_quote?: boolean;
  allowed_stock_locations?: string[];
  allowed_brands?: string[];
  price_display_type?: 'normal' | 'reseller' | 'buy' | 'calculated';
  custom_seller_name?: string;
  phone?: string;
  tasks_role?: TasksRole | null;
  tasks_only?: boolean;
}

export interface UserPermissions {
  canCreateQuote: boolean;
  allowedStockLocations: string[];
  allowedBrands: string[];
  priceDisplayType: 'normal' | 'reseller' | 'buy' | 'calculated';
  isAdmin: boolean;
  isSuperAdmin: boolean;
  isFacturation: boolean;
  isCompta: boolean;
  isManager: boolean;
  isSeniorSales: boolean;
  isJuniorSales: boolean;
  isPaie: boolean;
  isTasks: boolean;
  isTasksOnly: boolean;
  tasksRole: TasksRole | null;
  crossBranchRead: boolean;
  newRole: AppUserRole | null;
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

export interface Provider {
  id: string;
  company_id: string;
  name: string;
  abbreviation: string;
  is_custom: boolean;
  created_at: string;
}

export interface SubStockLocation {
  id: string;
  stock_location_id: string;
  name: string;
  code: string;
  created_at: string;
}

export interface StockLocation {
  id: string;
  company_id: string;
  name: string;
  abbreviation: string;
  provider_id?: string;
  sub_locations?: SubStockLocation[];
  created_at: string;
}

export type StockMovementType =
  | 'in' | 'out' | 'adjustment' | 'count' | 'transfer_in' | 'transfer_out' | 'return';

export type StockSourceType =
  | 'manual' | 'bl' | 'invoice' | 'receipt' | 'transfer' | 'count' | 'return';

export interface StockMovement {
  id: string;
  company_id: string | null;
  barcode: string;
  location_key: string;
  location_id: string | null;
  type: StockMovementType;
  quantity: number;          // signed applied delta (+in / -out)
  unit_cost: number | null;
  balance_after: number | null;
  reason: string | null;
  source_type: StockSourceType;
  source_id: string | null;
  transfer_group_id: string | null;
  created_by: string | null;
  created_at: string;
}

export interface ProductStockSetting {
  id: string;
  company_id: string | null;
  barcode: string;
  location_key: string | null;
  reorder_point: number;
  reorder_qty: number;
  min_qty: number | null;
  max_qty: number | null;
  created_at: string;
  updated_at: string;
}

// ── Comptabilité générale ───────────────────────────────────────────────────
export type AccountingType = 'bilan_actif' | 'bilan_passif' | 'charge' | 'produit' | 'tresorerie';

export interface FiscalYear {
  id: string;
  company_id: string;
  label: string;
  start_date: string;
  end_date: string;
  status: 'open' | 'closed';
  closed_at: string | null;
  closed_by: string | null;
}

export interface Account {
  id: string;
  company_id: string;
  code: string;
  label: string;
  class: number;
  type: AccountingType;
  parent_code: string | null;
  is_auxiliary: boolean;
  aux_kind: 'client' | 'fournisseur' | null;
  vat_rate: number | null;
  lettrable: boolean;
  active: boolean;
  is_system: boolean;
}

export type JournalType = 'vente' | 'achat' | 'banque' | 'caisse' | 'od' | 'anouveaux' | 'paie';

export interface Journal {
  id: string;
  company_id: string;
  code: string;
  label: string;
  type: JournalType;
  counterpart_account_code: string | null;
}

export interface JournalEntryLine {
  id?: string;
  entry_id?: string;
  company_id?: string;
  account_code: string;
  aux_account_id?: string | null;
  label?: string | null;
  debit: number;
  credit: number;
  vat_rate?: number | null;
  lettrage_code?: string | null;
  lettered_at?: string | null;
  analytic_code?: string | null;
  sort_order?: number;
}

export interface JournalEntry {
  id: string;
  company_id: string;
  fiscal_year_id: string;
  journal_id: string;
  entry_number: number | null;
  entry_date: string;
  reference: string | null;
  label: string | null;
  status: 'draft' | 'posted' | 'reversed';
  source_type: string;
  source_id: string | null;
  posted_at: string | null;
  posted_by: string | null;
  reversed_by: string | null;
  created_by: string | null;
  created_at: string;
  lines?: JournalEntryLine[];
}

export type PurchaseOrderStatus = 'draft' | 'sent' | 'partial' | 'received' | 'cancelled';

export interface PurchaseOrderItem {
  id?: string;
  po_id?: string;
  barcode: string;
  label: string;
  qty_ordered: number;
  qty_received: number;
  unit_cost: number;
  sort_order?: number;
}

export interface PurchaseOrder {
  id: string;
  company_id: string | null;
  po_number: string;
  provider_id: string | null;
  provider_name: string | null;
  location_key: string | null;
  status: PurchaseOrderStatus;
  order_date: string;
  expected_date: string | null;
  total_ht: number;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  items?: PurchaseOrderItem[];
}

export interface ProductPhoto {
  id: string;
  company_id?: string;
  title: string;
  storage_path: string;
  file_name: string;
  file_size?: number;
  created_at: string;
  created_by?: string;
  product_photo_products?: { barcode: string; product_name: string }[];
}

// PAIE types
export interface Employee {
  id: string;
  company_id: string;
  full_name: string;
  cin?: string;
  gender?: 'M' | 'F';
  birth_date?: string;
  marital_status?: 'celibataire' | 'marie' | 'divorce' | 'veuf';
  dependents_count: number;
  position?: string;
  department?: string;
  contract_type: 'CDI' | 'CDD' | 'Interim';
  cnss_number?: string;
  cimr_number?: string;
  cimr_rate?: number;
  bank_iban?: string;
  hire_date?: string;
  base_salary: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PayslipItem {
  id: string;
  payslip_id?: string;
  label: string;
  item_type: 'earning' | 'deduction';
  amount: number;
  included_in_anciennete_base: boolean;
  sort_order: number;
}

export interface Payslip {
  id: string;
  company_id: string;
  employee_id: string;
  employee?: Employee;
  period_month: number;
  period_year: number;
  payslip_number: string;
  hours_worked: number;
  base_salary: number;
  anciennete_rate: number;
  anciennete_amount: number;
  other_earnings: number;
  total_gross: number;
  cnss_employee: number;
  amo_employee: number;
  cimr_employee: number;
  frais_pro: number;
  ir_amount: number;
  other_deductions: number;
  total_deductions: number;
  net_salary: number;
  cnss_employer: number;
  amo_employer: number;
  alloc_familiales: number;
  notes?: string;
  items: PayslipItem[];
  created_at: string;
  updated_at: string;
}

// ===== Tasks / Delivery module (ported from CuisiTask) =====

// In-module role. The DB column app_users.tasks_role stores only
// 'sales' | 'technician' | 'driver'; super_admin gets full access implicitly.
export type TasksRole = 'super_admin' | 'sales' | 'technician' | 'driver';

export type TaskType = 'technical_intervention' | 'delivery';
export type TaskStatus = 'pending' | 'doing' | 'done' | 'refused';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';
export type TaskActivityAction =
  | 'created' | 'updated' | 'status_changed' | 'reassigned' | 'commented' | 'archived';

export interface Task {
  id: string;
  company_id?: string | null;
  type: TaskType;
  status: TaskStatus;
  client_name: string;
  client_phone: string;
  address: string;
  problem_details?: string;
  invoice_number?: string;
  payment_details?: string;
  comment?: string;
  priority: TaskPriority;
  created_by: string;
  assigned_to: string;
  due_date?: string;
  archived_at?: string;
  edited?: boolean;
  created_at: string;
  updated_at: string;
}

export interface TaskActivity {
  id: string;
  task_id: string;
  user_id: string;
  action: TaskActivityAction;
  old_value?: string;
  new_value?: string;
  note?: string;
  created_at: string;
}

export interface TaskContact {
  id: string;
  company_id?: string | null;
  name: string;
  phone: string;
  role_label: string;
  created_by: string;
  created_at: string;
}

export type TaskNotificationType =
  | 'task_assigned' | 'status_changed' | 'task_created'
  | 'task_reassigned' | 'priority_changed' | 'location_request';

export interface TaskNotification {
  id: string;
  user_id: string;
  type: TaskNotificationType;
  title: string;
  message: string;
  task_id?: string;
  is_read: boolean;
  created_at: string;
}

export interface TrackingSession {
  id: string;
  token: string;
  task_id?: string;
  driver_id: string;
  client_name: string;
  client_phone?: string;
  destination_latitude?: number;
  destination_longitude?: number;
  destination_source?: string;
  is_active: boolean;
  expires_at: string;
  created_at: string;
}

export interface DriverLocation {
  id: string;
  driver_id: string;
  session_id?: string;
  latitude: number;
  longitude: number;
  accuracy?: number;
  created_at: string;
}
