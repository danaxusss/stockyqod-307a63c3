// What the public pages (share links /share/…, delivery tracking /track/…)
// may see. Those pages run without a login, so since secure login step 2 they
// no longer read the database themselves: the public-share and public-tracking
// functions check the link and return only these fields.
//
// Pure functions (no Deno or network), also used by the web app's tests.

/** Share links use a UUID (or its first 12 characters), tracking links 64 hex characters. */
export function isLinkToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(value);
}

export type LinkStatus = "ok" | "missing" | "expired";

/** A share link opens until its expiry date, if it has one. */
export function shareLinkStatus(link: { expires_at?: string | null } | null | undefined, now = Date.now()): LinkStatus {
  if (!link) return "missing";
  if (link.expires_at && new Date(link.expires_at).getTime() < now) return "expired";
  return "ok";
}

/** A tracking link works while the delivery is running and until its expiry. */
export function trackingStatus(
  session: { is_active?: boolean | null; expires_at?: string | null } | null | undefined,
  now = Date.now(),
): LinkStatus {
  if (!session) return "missing";
  if (!session.is_active) return "expired";
  if (!session.expires_at || new Date(session.expires_at).getTime() < now) return "expired";
  return "ok";
}

export interface PublicSharedImage {
  barcode: string;
  name: string;
  brand: string;
  url: string;
}

const str = (value: unknown, max = 500) => (typeof value === "string" ? value.slice(0, max) : "");

/** Photos stored on the link: only well-formed entries with a web address. */
export function publicImages(value: unknown): PublicSharedImage[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .map(item => ({ barcode: str(item.barcode, 200), name: str(item.name, 300), brand: str(item.brand, 200), url: str(item.url, 2000) }))
    .filter(item => /^https?:\/\//.test(item.url))
    .slice(0, 200);
}

export interface PublicSheet {
  id: string;
  title: string;
  manufacturer: string;
  category: string;
  sector: string;
  file_url: string;
  file_size: number;
  file_type: string;
}

/** The columns of a technical sheet the share page shows. */
export function publicSheet(row: Record<string, unknown>): PublicSheet {
  return {
    id: str(row.id, 100),
    title: str(row.title, 300),
    manufacturer: str(row.manufacturer, 200),
    category: str(row.category, 200),
    sector: str(row.sector, 200),
    file_url: str(row.file_url, 2000),
    file_size: Number(row.file_size) || 0,
    file_type: str(row.file_type, 100),
  };
}

/** Company details for the cover of the one-file download (logo, contacts). */
export interface PublicCompany {
  company_name: string;
  logo_url: string | null;
  address: string;
  phone: string;
  phone2: string;
  phone_gsm: string;
  phone_dir: string;
  email: string;
  website: string;
  ice: string;
  quote_style: { accentColor: string };
}

const DEFAULT_ACCENT = "#3B82F6";

/**
 * The same company the app used before: the link's company (companies row),
 * else the legacy single company_settings row. Nothing private (PINs, AI
 * settings, bank details) is passed on.
 */
export function publicCompany(
  company: Record<string, unknown> | null | undefined,
  legacy: Record<string, unknown> | null | undefined,
): PublicCompany | null {
  if (company && str(company.name)) {
    return {
      company_name: str(company.name, 300),
      logo_url: str(company.logo_url, 2000) || null,
      address: str(company.address),
      phone: str(company.phone, 100),
      phone2: str(company.phone2, 100),
      phone_gsm: "",
      phone_dir: "",
      email: str(company.email, 300),
      website: str(company.website, 300),
      ice: str(company.ice, 100),
      quote_style: { accentColor: str(company.accent_color, 20) || DEFAULT_ACCENT },
    };
  }
  if (legacy && str(legacy.company_name)) {
    const style = legacy.quote_style && typeof legacy.quote_style === "object" ? legacy.quote_style as Record<string, unknown> : {};
    return {
      company_name: str(legacy.company_name, 300),
      logo_url: str(legacy.logo_url, 2000) || null,
      address: str(legacy.address),
      phone: str(legacy.phone, 100),
      phone2: str(legacy.phone2, 100),
      phone_gsm: str(legacy.phone_gsm, 100),
      phone_dir: str(legacy.phone_dir, 100),
      email: str(legacy.email, 300),
      website: str(legacy.website, 300),
      ice: str(legacy.ice, 100),
      quote_style: { accentColor: str(style.accentColor, 20) || DEFAULT_ACCENT },
    };
  }
  return null;
}

export interface PublicTrackingSession {
  client_name: string;
  expires_at: string;
  destination_latitude: number | null;
  destination_longitude: number | null;
  destination_source: string | null;
}

const coord = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** The delivery as the customer sees it (no driver id, phone of the client, task…). */
export function publicTrackingSession(row: Record<string, unknown>): PublicTrackingSession {
  return {
    client_name: str(row.client_name, 300),
    expires_at: str(row.expires_at, 60),
    destination_latitude: coord(row.destination_latitude),
    destination_longitude: coord(row.destination_longitude),
    destination_source: str(row.destination_source, 20) || null,
  };
}

export interface PublicLocation {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  created_at: string;
}

export function publicLocation(row: Record<string, unknown> | null | undefined): PublicLocation | null {
  const latitude = coord(row?.latitude);
  const longitude = coord(row?.longitude);
  if (!row || latitude === null || longitude === null) return null;
  return { latitude, longitude, accuracy: coord(row.accuracy), created_at: str(row.created_at, 60) };
}

/** A destination the customer may set: real coordinates, from GPS or from the task address. */
export function destinationInput(body: Record<string, unknown>): { latitude: number; longitude: number; source: "gps" | "address" } | null {
  const latitude = Number(body.latitude);
  const longitude = Number(body.longitude);
  const source = body.source === "address" ? "address" : body.source === "gps" ? "gps" : null;
  if (!source || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude, source };
}
