import { supabase } from '@/integrations/supabase/client';
import { describeEdgeError } from './edgeError';
import type {
  LinkStatus, PublicCompany, PublicLocation, PublicSharedImage, PublicSheet, PublicTrackingSession,
} from '../../supabase/functions/_shared/publicLinks';

/**
 * Public pages (share links, delivery tracking) have no login, and the public
 * key reads nothing in the database since secure login step 2. They talk to
 * the public-share and public-tracking edge functions instead, which check the
 * link and return only what the page shows.
 */

export type { LinkStatus, PublicCompany, PublicLocation, PublicSharedImage, PublicSheet, PublicTrackingSession };

async function call<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) {
    const failure = await describeEdgeError(error, fn);
    throw new Error(failure.serverMessage || failure.message);
  }
  if (data?.error) throw new Error(String(data.error));
  return data as T;
}

export interface SharePayload {
  status: LinkStatus;
  link?: { title: string | null; expires_at: string | null; product_images: PublicSharedImage[] };
  sheets?: PublicSheet[];
  company?: PublicCompany | null;
}

/** Opens a share link (counts one view). */
export const loadShare = (token: string) => call<SharePayload>('public-share', { action: 'get', token });

/** Counts one download for each of these sheets of the link. */
export const countSheetDownloads = (token: string, sheetIds: string[]) =>
  call<{ status: LinkStatus }>('public-share', { action: 'downloaded', token, sheet_ids: sheetIds }).then(() => undefined, () => undefined);

export interface TrackingPayload {
  status: LinkStatus;
  session?: PublicTrackingSession;
  driver_phone?: string | null;
  location?: PublicLocation | null;
}

export const loadTracking = (token: string) => call<TrackingPayload>('public-tracking', { action: 'get', token });

/** Fresh position and destination, polled while the page is open. */
export const pollTracking = (token: string) => call<TrackingPayload>('public-tracking', { action: 'poll', token });

/** Address of the delivery, to place the destination when GPS is refused (null once a destination is known). */
export const trackingAddress = (token: string) =>
  call<{ status: LinkStatus; address?: string | null }>('public-tracking', { action: 'address', token }).then(r => r.address || null);

export const setTrackingDestination = (token: string, latitude: number, longitude: number, source: 'gps' | 'address') =>
  call<TrackingPayload>('public-tracking', { action: 'set_destination', token, latitude, longitude, source });
