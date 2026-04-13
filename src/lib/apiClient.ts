// Central API client — replaces all @supabase/supabase-js usage.
// Every call goes through /api/* which the Express server handles.

const BASE = '/api';

async function req<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const isFormData = options.body instanceof FormData;
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      ...(!isFormData ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

function body(data: unknown): string {
  return JSON.stringify(data);
}

function getAdminCreds(): { admin_username: string; admin_pin: string } | null {
  try {
    const stored = localStorage.getItem('inventory_authenticated_user');
    const pin = sessionStorage.getItem('inventory_admin_pin');
    if (stored && pin) {
      const user = JSON.parse(stored);
      if (user.username) return { admin_username: user.username, admin_pin: pin };
    }
  } catch { /* ignore */ }
  return null;
}

// ── Auth ──────────────────────────────────────────────────────────────────
export const authApi = {
  login: (username: string, pin: string) =>
    req<{ success: boolean; user: Record<string, unknown> }>('/auth/login', {
      method: 'POST',
      body: body({ username, pin }),
    }),

  getUsers: () =>
    req<{ users: Record<string, unknown>[] }>('/auth/users'),

  loginByPin: (pin: string, username?: string) =>
    req<{ success: boolean; user: Record<string, unknown> }>('/auth/login-by-pin', {
      method: 'POST',
      body: body({ pin, username }),
    }),
};

// ── Products ──────────────────────────────────────────────────────────────
export const productsApi = {
  getAll: () => req<{ products: unknown[] }>('/products'),

  bulkUpsert: (products: unknown[]) =>
    req<{ success: boolean; count: number }>('/products/bulk', {
      method: 'POST',
      body: body({ products }),
    }),

  update: (barcode: string, data: unknown) =>
    req<{ product: unknown }>(`/products/${barcode}`, {
      method: 'PUT',
      body: body(data),
    }),

  delete: (barcode: string) =>
    req<{ success: boolean }>(`/products/${barcode}`, { method: 'DELETE' }),

  getBrands: () => req<{ brands: string[] }>('/products/brands'),

  getProviders: () => req<{ providers: string[] }>('/products/providers'),

  getLocations: () => req<{ locations: string[] }>('/products/locations'),
};

// ── Quotes ────────────────────────────────────────────────────────────────
export const quotesApi = {
  getAll: () => req<{ quotes: unknown[] }>('/quotes'),

  getById: (id: string) => req<{ quote: unknown }>(`/quotes/${id}`),

  upsert: (quote: unknown) =>
    req<{ quote: unknown }>('/quotes', { method: 'POST', body: body(quote) }),

  updateStatus: (id: string, status: string) =>
    req<{ quote: unknown }>(`/quotes/${id}/status`, {
      method: 'PATCH',
      body: body({ status }),
    }),

  delete: (id: string) =>
    req<{ success: boolean }>(`/quotes/${id}`, { method: 'DELETE' }),

  // Templates
  getTemplates: () => req<{ templates: unknown[] }>('/quotes/templates/all'),

  getActiveTemplate: () => req<{ template: unknown }>('/quotes/templates/active'),

  saveTemplate: (template: unknown) =>
    req<{ template: unknown }>('/quotes/templates', {
      method: 'POST',
      body: body(template),
    }),

  activateTemplate: (id: string) =>
    req<{ template: unknown }>(`/quotes/templates/${id}/activate`, { method: 'PATCH', body: body({}) }),

  deleteTemplate: (id: string) =>
    req<{ success: boolean }>(`/quotes/templates/${id}`, { method: 'DELETE' }),
};

// ── Clients ───────────────────────────────────────────────────────────────
export const clientsApi = {
  getAll: () => req<{ clients: unknown[] }>('/clients'),

  search: (q: string) =>
    req<{ clients: unknown[] }>(`/clients/search?q=${encodeURIComponent(q)}`),

  create: (data: unknown) =>
    req<{ client: unknown }>('/clients', { method: 'POST', body: body(data) }),

  upsert: (data: unknown) =>
    req<{ client: unknown }>('/clients/upsert', { method: 'POST', body: body(data) }),

  update: (id: string, data: unknown) =>
    req<{ client: unknown }>(`/clients/${id}`, { method: 'PUT', body: body(data) }),

  delete: (id: string) =>
    req<{ success: boolean }>(`/clients/${id}`, { method: 'DELETE' }),
};

// ── Company Settings ──────────────────────────────────────────────────────
export const settingsApi = {
  get: () => req<{ settings: unknown }>('/settings'),

  update: (data: unknown) =>
    req<{ settings: unknown }>('/settings', { method: 'PUT', body: body(data) }),

  uploadLogo: async (file: File): Promise<string> => {
    const form = new FormData();
    form.append('file', file);
    const data = await req<{ url: string }>('/upload/logo', { method: 'POST', body: form });
    return data.url;
  },

  // AI Settings
  getAi: () => req<{ ai: unknown }>('/settings/ai'),

  updateAi: (data: unknown) => {
    const creds = getAdminCreds();
    if (!creds) throw new Error('Admin credentials required');
    return req<{ ai: unknown }>('/settings/ai', {
      method: 'PUT',
      body: body({ ...creds, ...(data as object) }),
    });
  },

  // Users (admin)
  getUsers: () => req<{ users: unknown[] }>('/settings/users'),

  createUser: (data: unknown) => {
    const creds = getAdminCreds();
    if (!creds) throw new Error('Admin credentials required');
    return req<{ user: unknown }>('/settings/users', {
      method: 'POST',
      body: body({ ...creds, ...(data as object) }),
    });
  },

  updateUser: (id: string, data: unknown) => {
    const creds = getAdminCreds();
    if (!creds) throw new Error('Admin credentials required');
    return req<{ user: unknown }>(`/settings/users/${id}`, {
      method: 'PUT',
      body: body({ ...creds, ...(data as object) }),
    });
  },

  deleteUser: (id: string) => {
    const creds = getAdminCreds();
    if (!creds) throw new Error('Admin credentials required');
    return req<{ success: boolean }>(`/settings/users/${id}`, {
      method: 'DELETE',
      body: body(creds),
    });
  },

  checkUsername: (username: string, excludeId?: string) =>
    req<{ available: boolean }>(
      `/settings/users/check-username?username=${encodeURIComponent(username)}${excludeId ? `&exclude_id=${excludeId}` : ''}`
    ),
};

// ── Technical Sheets ──────────────────────────────────────────────────────
export const sheetsApi = {
  getAll: () => req<{ sheets: unknown[] }>('/sheets'),

  getById: (id: string) => req<{ sheet: unknown }>(`/sheets/${id}`),

  create: (data: unknown) =>
    req<{ sheet: unknown }>('/sheets', { method: 'POST', body: body(data) }),

  update: (id: string, data: unknown) =>
    req<{ sheet: unknown }>(`/sheets/${id}`, { method: 'PUT', body: body(data) }),

  delete: (id: string) =>
    req<{ success: boolean }>(`/sheets/${id}`, { method: 'DELETE' }),

  uploadFile: async (file: File): Promise<{ url: string; size: number; mimetype: string }> => {
    const form = new FormData();
    form.append('file', file);
    const data = await req<{ url: string; size: number; mimetype: string }>('/upload/sheet', {
      method: 'POST',
      body: form,
    });
    return data;
  },

  getByProducts: (barcodes: string[]) =>
    req<{ sheet_ids: string[]; product_sheet_counts: Record<string, number> }>('/sheets/by-products', {
      method: 'POST',
      body: body({ barcodes }),
    }),

  getSheetCounts: () =>
    req<{ counts: Record<string, number> }>('/sheets/sheet-counts'),

  getForProduct: (barcode: string) =>
    req<{ sheets: unknown[] }>(`/sheets/for-product/${encodeURIComponent(barcode)}`),

  incrementDownload: (id: string) =>
    req<{ success: boolean }>(`/sheets/${id}/download`, { method: 'PATCH', body: body({}) }),

  linkProducts: (sheetId: string, barcodes: string[]) =>
    req<{ success: boolean }>(`/sheets/${sheetId}/products`, {
      method: 'POST',
      body: body({ barcodes }),
    }),

  unlinkProduct: (sheetId: string, barcode: string) =>
    req<{ success: boolean }>(`/sheets/${sheetId}/products/${barcode}`, { method: 'DELETE' }),

  // Share links
  getShareLinks: () => req<{ links: unknown[] }>('/sheets/share/list'),

  getShareByToken: (token: string) =>
    req<{ link: unknown; sheets: unknown[] }>(`/sheets/share/${token}`),

  createShareLink: (data: unknown) =>
    req<{ link: unknown }>('/sheets/share', { method: 'POST', body: body(data) }),

  deleteShareLink: (id: string) =>
    req<{ success: boolean }>(`/sheets/share/${id}`, { method: 'DELETE' }),
};

// ── Activity Log ──────────────────────────────────────────────────────────
export const activityApi = {
  log: (action: string, details?: string, entityType?: string, entityId?: string) => {
    try {
      const stored = localStorage.getItem('inventory_authenticated_user');
      const user = stored ? JSON.parse(stored) : null;
      return req('/activity', {
        method: 'POST',
        body: body({
          user_id: user?.id ?? null,
          username: user?.username ?? 'unknown',
          action,
          details: details ?? null,
          entity_type: entityType ?? null,
          entity_id: entityId ?? null,
        }),
      });
    } catch {
      return Promise.resolve();
    }
  },

  getRecent: (limit = 50) => req<{ logs: unknown[] }>(`/activity?limit=${limit}`),

  getByUser: (username: string, limit = 50) =>
    req<{ logs: unknown[] }>(`/activity/user/${encodeURIComponent(username)}?limit=${limit}`),
};

// ── Product Name Overrides ────────────────────────────────────────────────
export const overridesApi = {
  getAll: () => req<{ overrides: unknown[] }>('/overrides'),

  upsert: (data: { type: string; original_name: string; custom_name: string }) =>
    req<{ override: unknown }>('/overrides', { method: 'POST', body: body(data) }),

  delete: (id: string) =>
    req<{ success: boolean }>(`/overrides/${id}`, { method: 'DELETE' }),

  revert: (data: { id: string; field: string; custom_name: string; original_name: string }) =>
    req<{ success: boolean }>('/overrides/revert', { method: 'POST', body: body(data) }),

  apply: (data: { field: string; current_name: string; new_name: string }) =>
    req<{ success: boolean }>('/overrides/apply', { method: 'POST', body: body(data) }),
};

// ── AI Chat (streaming) ───────────────────────────────────────────────────
export const AI_CHAT_URL = `${BASE}/ai/chat`;
