import { supabase } from '../../utils/supabaseClient';
import { StockService, totalStock } from '../../utils/supabaseStock';

/**
 * After a stock-decreasing event, check whether any of the affected products
 * fell to/under its reorder point and, if so, send a web push to managers
 * (super_admin / admin / manager) via the existing send-push edge function.
 * Best-effort: never throws into the caller's flow.
 */
export async function notifyLowStock(barcodes: string[]): Promise<void> {
  try {
    const unique = Array.from(new Set(barcodes.filter(Boolean)));
    if (unique.length === 0) return;

    const [products, settings] = await Promise.all([
      StockService.getProducts(),
      StockService.getStockSettings().catch(() => []),
    ]);
    const reorder = new Map(
      settings.filter(s => !s.location_key).map(s => [s.barcode, s.reorder_point])
    );

    const flagged = products.filter(p =>
      unique.includes(p.barcode) &&
      (() => { const rp = reorder.get(p.barcode); return rp != null && rp > 0 && totalStock(p) <= rp; })()
    );
    if (flagged.length === 0) return;

    const { data: users } = await (supabase as any).rpc('get_app_users_safe');
    const managerIds = (users || [])
      .filter((u: any) => u.is_superadmin || u.is_admin || u.new_role === 'manager')
      .map((u: any) => u.id as string);
    if (managerIds.length === 0) return;

    const names = flagged.slice(0, 5).map(p => p.name).join(', ');
    const body = flagged.length === 1
      ? `${flagged[0].name} est au seuil de réapprovisionnement (stock ${totalStock(flagged[0])})`
      : `${flagged.length} articles sous le seuil : ${names}${flagged.length > 5 ? '…' : ''}`;

    await supabase.functions.invoke('send-push', {
      body: { user_ids: managerIds, title: '⚠️ Stock bas', body },
    });
  } catch (e) {
    console.warn('notifyLowStock failed:', e);
  }
}
