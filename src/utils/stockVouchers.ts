import { supabase } from './supabaseClient';
import { getCompanyContext } from './supabaseCompanyFilter';
import type { StatusTone } from '../components/lists/StatusPill';

/**
 * Bons d'entrée (BE) and Bons de sortie (BS): numbered documents that move
 * stock for everything that is not a supplier receipt, a sale or a transfer.
 * A draft does not touch stock; validate_stock_voucher posts it and locks it;
 * cancel_stock_voucher posts the opposite movements. The rules (who may
 * validate, negative stock, average cost) live in the database.
 */

export type VoucherKind = 'entree' | 'sortie';
export type VoucherStatus = 'draft' | 'validated' | 'cancelled';

export interface StockVoucherLine {
  id?: string;
  barcode: string;
  product_name: string;
  quantity: number;
  unit_cost: number | null;
  /** Where this line leaves from / arrives, when it differs from the voucher's location. */
  location_id?: string | null;
}

export interface StockVoucher {
  id: string;
  company_id: string | null;
  kind: VoucherKind;
  number: string | null;
  status: VoucherStatus;
  voucher_date: string;
  location_id: string | null;
  reason: string;
  note: string | null;
  created_by: string | null;
  validated_by: string | null;
  validated_at: string | null;
  negative_override: boolean;
  cancelled_by: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  /** The delivery note this Bon de sortie takes out of stock. */
  source_document_id?: string | null;
  source_document_number?: string | null;
  created_at: string;
  lines?: StockVoucherLine[];
}

export const VOUCHER_REASONS: Record<VoucherKind, Array<{ value: string; label: string }>> = {
  entree: [
    { value: 'stock_initial', label: 'Stock initial' },
    { value: 'retour_client', label: 'Retour client (sans avoir)' },
    { value: 'reception_sans_commande', label: 'Réception sans commande' },
    { value: 'trouve_correction', label: 'Trouvé / correction' },
    { value: 'assemblage', label: 'Assemblage' },
    { value: 'autre', label: 'Autre' },
  ],
  sortie: [
    { value: 'casse_perte', label: 'Casse / perte' },
    { value: 'livraison_client', label: 'Livraison client' },
    { value: 'usage_interne', label: 'Usage interne' },
    { value: 'echantillon_demo', label: 'Échantillon / démo' },
    { value: 'don', label: 'Don' },
    { value: 'vol', label: 'Vol' },
    { value: 'correction', label: 'Correction' },
    { value: 'autre', label: 'Autre' },
  ],
};

export const VOUCHER_STATUS: Record<VoucherStatus, { label: string; tone: StatusTone }> = {
  draft: { label: 'Brouillon', tone: 'neutral' },
  validated: { label: 'Validé', tone: 'success' },
  cancelled: { label: 'Annulé', tone: 'danger' },
};

export const KIND_LABEL: Record<VoucherKind, string> = { entree: "Bon d'entrée", sortie: 'Bon de sortie' };
export const KIND_SHORT: Record<VoucherKind, string> = { entree: 'BE', sortie: 'BS' };

/** Reasons offered in the editor: "Livraison client" only for a voucher made from a delivery note. */
export function reasonsFor(kind: VoucherKind, fromDocument: boolean) {
  return VOUCHER_REASONS[kind].filter(r => fromDocument ? r.value === 'livraison_client' : r.value !== 'livraison_client');
}

export function reasonLabel(kind: VoucherKind, reason: string): string {
  return VOUCHER_REASONS[kind].find(r => r.value === reason)?.label || reason;
}

/** The unit cost changes the average purchase price only for a receipt without order. */
export const costUpdatesAverage = (kind: VoucherKind, reason: string) => kind === 'entree' && reason === 'reception_sans_commande';

/** What is missing before a draft can be validated (empty = ready). */
export function draftProblems(draft: { location_id: string | null; reason: string; lines: StockVoucherLine[] }): string[] {
  const problems: string[] = [];
  if (!draft.location_id) problems.push('Choisissez un emplacement.');
  if (!draft.reason) problems.push('Choisissez un motif.');
  if (draft.lines.length === 0) problems.push('Ajoutez au moins un article.');
  if (draft.lines.some(l => !(Number(l.quantity) > 0))) problems.push('Chaque quantité doit être supérieure à 0.');
  if (draft.lines.some(l => l.unit_cost != null && Number(l.unit_cost) < 0)) problems.push('Un coût unitaire ne peut pas être négatif.');
  return problems;
}

/** The message of a database error, without the technical prefix. */
export function voucherErrorMessage(error: unknown): string {
  const raw = (error as { message?: string })?.message || String(error || 'Erreur');
  return raw.replace(/^(ERROR:\s*)?(P0001:\s*)?/i, '').trim();
}

/** True when the refusal is about stock going below zero (an admin may override). */
export const isNegativeStockRefusal = (error: unknown) => /stock insuffisant/i.test(voucherErrorMessage(error));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => supabase as any;

export class StockVouchersService {
  static async list(): Promise<StockVoucher[]> {
    const { data, error } = await db().from('stock_vouchers').select('*').order('created_at', { ascending: false }).limit(500);
    if (error) throw new Error(error.message);
    return data || [];
  }

  static async get(id: string): Promise<StockVoucher | null> {
    const [{ data: voucher, error }, { data: lines, error: linesError }] = await Promise.all([
      db().from('stock_vouchers').select('*').eq('id', id).maybeSingle(),
      db().from('stock_voucher_lines').select('*').eq('voucher_id', id).order('position'),
    ]);
    if (error) throw new Error(error.message);
    if (linesError) throw new Error(linesError.message);
    if (!voucher) return null;
    return { ...voucher, lines: (lines || []).map((l: StockVoucherLine) => ({ ...l, quantity: Number(l.quantity), unit_cost: l.unit_cost == null ? null : Number(l.unit_cost) })) };
  }

  /** Creates or updates a draft and replaces its lines. Returns its id. */
  static async saveDraft(draft: {
    id?: string | null; kind: VoucherKind; voucher_date: string; location_id: string | null;
    reason: string; note: string; created_by?: string | null; lines: StockVoucherLine[];
    source_document_id?: string | null; source_document_number?: string | null;
  }): Promise<string> {
    const header = {
      kind: draft.kind, voucher_date: draft.voucher_date, location_id: draft.location_id,
      reason: draft.reason, note: draft.note.trim() || null,
    };
    let id = draft.id || null;
    if (id) {
      const { error } = await db().from('stock_vouchers').update(header).eq('id', id);
      if (error) throw new Error(voucherErrorMessage(error));
      const { error: delError } = await db().from('stock_voucher_lines').delete().eq('voucher_id', id);
      if (delError) throw new Error(voucherErrorMessage(delError));
    } else {
      const { companyId } = getCompanyContext();
      const { data, error } = await db().from('stock_vouchers')
        .insert({
          ...header, company_id: companyId || null, created_by: draft.created_by || null,
          ...(draft.source_document_id ? { source_document_id: draft.source_document_id, source_document_number: draft.source_document_number || null } : {}),
        })
        .select('id').single();
      if (error) throw new Error(voucherErrorMessage(error));
      id = data.id as string;
    }
    if (draft.lines.length) {
      const { error } = await db().from('stock_voucher_lines').insert(draft.lines.map((l, i) => ({
        voucher_id: id, position: i, barcode: l.barcode, product_name: l.product_name,
        quantity: Number(l.quantity), unit_cost: draft.kind === 'entree' && l.unit_cost != null && String(l.unit_cost) !== '' ? Number(l.unit_cost) : null,
        ...(l.location_id ? { location_id: l.location_id } : {}),
      })));
      if (error) throw new Error(voucherErrorMessage(error));
    }
    return id as string;
  }

  /** The active (draft or validated) Bon de sortie of a delivery note, if any. */
  static async findForDocument(documentId: string): Promise<StockVoucher | null> {
    const { data, error } = await db().from('stock_vouchers').select('id, number, status, kind')
      .eq('source_document_id', documentId).neq('status', 'cancelled').limit(1);
    if (error) throw new Error(error.message);
    return data?.[0] || null;
  }

  static async deleteDraft(id: string): Promise<void> {
    const { error } = await db().from('stock_vouchers').delete().eq('id', id).eq('status', 'draft');
    if (error) throw new Error(voucherErrorMessage(error));
  }

  static async validate(id: string, allowNegative = false): Promise<{ number: string; movements: number; negative_override: boolean }> {
    const { data, error } = await db().rpc('validate_stock_voucher', { p_voucher_id: id, p_allow_negative: allowNegative });
    if (error) throw new Error(voucherErrorMessage(error));
    return data;
  }

  static async cancel(id: string, reason: string): Promise<{ reversed: number }> {
    const { data, error } = await db().rpc('cancel_stock_voucher', { p_voucher_id: id, p_reason: reason || null });
    if (error) throw new Error(voucherErrorMessage(error));
    return data;
  }
}
