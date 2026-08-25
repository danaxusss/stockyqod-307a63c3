import { supabase } from './supabaseClient';
import { getCompanyContext } from './supabaseCompanyFilter';

export interface CatalogueFamily {
  id: string;
  name: string;
  sort_order: number;
}

export interface CatalogueProduct {
  id: string;
  company_id?: string;
  family_id: string | null;
  ref: string;
  designation: string;
  brand: string;
  price: number | null;
  price_pro: number | null;
  image: string | null;
  stock_levels: Record<string, number>;
  hidden: boolean;
  sort_order: number;
}

export type PriceField = 'price' | 'price_pro' | 'both' | 'pro_from_ttc';

export interface ImportReport { families: number; products: number }

/** Normalised ref matching (spaces/dashes/dots ignored), same as the desktop tool. */
export const normRef = (s: string) => (s || '').toUpperCase().replace(/[\s\-_.]/g, '');
const safeName = (s: string) => normRef(s).replace(/[^A-Z0-9]/g, '') || 'X';
const r2 = (n: number) => Math.round(n * 100) / 100;
const MASTER_BATCH = 200;

type MasterProduct = {
  barcode: string;
  name: string;
  brand: string;
  price: number;
  reseller_price: number;
  image: string | null;
  stock_levels: Record<string, number> | null;
};

async function loadMasterProducts(refs: string[]): Promise<Map<string, MasterProduct>> {
  const byRef = new Map<string, MasterProduct>();
  const uniqueRefs = Array.from(new Set(refs.filter(Boolean)));
  for (let i = 0; i < uniqueRefs.length; i += MASTER_BATCH) {
    const { data, error } = await (supabase as any).from('products')
      .select('barcode, name, brand, price, reseller_price, image, stock_levels')
      .in('barcode', uniqueRefs.slice(i, i + MASTER_BATCH));
    if (error) throw error;
    for (const row of data || []) byRef.set(row.barcode, row as MasterProduct);
  }
  return byRef;
}

function scoped(table: string) {
  const { companyId, bypassFilter } = getCompanyContext();
  let q = (supabase as any).from(table).select('*');
  if (!bypassFilter && companyId) q = q.eq('company_id', companyId);
  return q;
}

export class CatalogueService {
  // ── Families ──────────────────────────────────────────────────────────────
  static async listFamilies(): Promise<CatalogueFamily[]> {
    const { data, error } = await scoped('catalog_families').order('sort_order').order('name');
    if (error) throw error;
    return (data || []).map((f: any) => ({ id: f.id, name: f.name, sort_order: f.sort_order }));
  }

  static async addFamily(name: string): Promise<void> {
    const { companyId } = getCompanyContext();
    const fams = await this.listFamilies();
    const max = fams.reduce((m, f) => Math.max(m, f.sort_order), 0);
    const { error } = await (supabase as any).from('catalog_families')
      .insert({ company_id: companyId, name: name.trim(), sort_order: max + 1 });
    if (error) throw error;
  }

  static async renameFamily(id: string, name: string): Promise<void> {
    const { error } = await (supabase as any).from('catalog_families').update({ name: name.trim() }).eq('id', id);
    if (error) throw error;
  }

  static async deleteFamily(id: string): Promise<void> {
    const { error } = await (supabase as any).from('catalog_families').delete().eq('id', id);
    if (error) throw error;
  }

  static async moveFamily(id: string, dir: -1 | 1): Promise<void> {
    const fams = await this.listFamilies();
    const i = fams.findIndex(f => f.id === id);
    if (i < 0 || !fams[i + dir]) return;
    const a = fams[i], b = fams[i + dir];
    await (supabase as any).from('catalog_families').update({ sort_order: b.sort_order }).eq('id', a.id);
    await (supabase as any).from('catalog_families').update({ sort_order: a.sort_order }).eq('id', b.id);
  }

  // ── Products ──────────────────────────────────────────────────────────────
  static async listProducts(): Promise<CatalogueProduct[]> {
    const { companyId, bypassFilter } = getCompanyContext();
    const settings: any[] = [];
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      let q = (supabase as any).from('catalog_products')
        .select('id, company_id, family_id, ref, designation, price, price_pro, image, hidden, sort_order')
        .order('sort_order').order('ref').range(from, from + PAGE - 1);
      if (!bypassFilter && companyId) q = q.eq('company_id', companyId);
      const { data, error } = await q;
      if (error) throw error;
      settings.push(...(data || []));
      if (!data || data.length < PAGE) break;
    }

    const masters = await loadMasterProducts(settings.map(row => row.ref));
    return settings.map(row => {
      const master = masters.get(row.ref);
      return {
        id: row.id,
        company_id: row.company_id,
        family_id: row.family_id,
        ref: row.ref,
        designation: master?.name ?? row.designation ?? row.ref,
        brand: master?.brand ?? '',
        price: master ? Number(master.price) : row.price == null ? null : Number(row.price),
        price_pro: master ? Number(master.reseller_price) : row.price_pro == null ? null : Number(row.price_pro),
        image: master?.image ?? row.image ?? null,
        stock_levels: (master?.stock_levels || {}) as Record<string, number>,
        hidden: !!row.hidden,
        sort_order: Number(row.sort_order) || 0,
      };
    });
  }

  static async updateProduct(id: string, patch: Partial<CatalogueProduct>): Promise<void> {
    const safePatch = Object.fromEntries(Object.entries(patch).filter(([key]) =>
      ['designation', 'brand', 'price', 'price_pro', 'image', 'family_id', 'hidden', 'sort_order'].includes(key)));
    const { error } = await (supabase.rpc as any)('update_catalogue_product_master', {
      p_catalog_id: id,
      p_patch: safePatch,
    });
    if (error) throw error;
  }

  static async createProduct(p: Partial<CatalogueProduct>): Promise<CatalogueProduct> {
    const { companyId } = getCompanyContext();
    if (!companyId) throw new Error('Aucune société sélectionnée');
    const ref = (p.ref || '').trim();
    if (!ref) throw new Error('Référence obligatoire');
    const { data, error } = await (supabase.rpc as any)('create_catalogue_product_master', {
      p_company_id: companyId,
      p_ref: ref,
      p_family_id: p.family_id ?? null,
      p_designation: p.designation || ref,
      p_price: p.price ?? 0,
      p_price_pro: p.price_pro ?? 0,
      p_image: p.image ?? null,
      p_hidden: !!p.hidden,
      p_sort_order: p.sort_order ?? 0,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    const master = (await loadMasterProducts([ref])).get(ref);
    return {
      id: row.id,
      company_id: row.company_id,
      family_id: row.family_id,
      ref,
      designation: master?.name ?? row.designation,
      brand: master?.brand ?? '',
      price: master ? Number(master.price) : Number(row.price || 0),
      price_pro: master ? Number(master.reseller_price) : Number(row.price_pro || 0),
      image: master?.image ?? row.image ?? null,
      stock_levels: (master?.stock_levels || {}) as Record<string, number>,
      hidden: !!row.hidden,
      sort_order: Number(row.sort_order) || 0,
    };
  }

  static async deleteProducts(ids: string[]): Promise<void> {
    for (let i = 0; i < ids.length; i += 200) {
      const { error } = await (supabase as any).from('catalog_products').delete().in('id', ids.slice(i, i + 200));
      if (error) throw error;
    }
  }

  static async setHidden(ids: string[], hidden: boolean): Promise<void> {
    for (let i = 0; i < ids.length; i += 200) {
      const { error } = await (supabase as any).from('catalog_products').update({ hidden }).in('id', ids.slice(i, i + 200));
      if (error) throw error;
    }
  }

  // ── Photos ────────────────────────────────────────────────────────────────
  /** Bundled seed photos are bare filenames; user uploads are storage paths. */
  static imageUrl(image: string): string {
    if (!image.includes('/')) return `${import.meta.env.BASE_URL || '/'}catalogue-images/${image}`;
    return supabase.storage.from('product-photos').getPublicUrl(image).data.publicUrl;
  }

  static async setPhoto(product: CatalogueProduct, file: File): Promise<string> {
    const path = `catalogue/${safeName(product.ref)}-${Date.now()}.jpg`;
    const { error } = await supabase.storage.from('product-photos')
      .upload(path, file, { upsert: true, contentType: file.type || 'image/jpeg' });
    if (error) throw error;
    await this.updateProduct(product.id, { image: path });
    return path;
  }

  /** Bulk photo import: files named by ref (BRP-YL.jpg), normalised matching. */
  static async importPhotos(
    files: File[], products: CatalogueProduct[],
    onProgress: (msg: string, pct: number) => void,
  ): Promise<{ uploaded: number; unmatched: string[]; failed: number }> {
    const byRef = new Map(products.map(p => [normRef(p.ref), p]));
    let uploaded = 0, failed = 0;
    const unmatched: string[] = [];
    const imgs = files.filter(f => /\.(jpe?g|png|webp)$/i.test(f.name));
    for (let i = 0; i < imgs.length; i++) {
      const f = imgs[i];
      const p = byRef.get(normRef(f.name.replace(/\.[^.]+$/, '')));
      if (!p) { unmatched.push(f.name); continue; }
      try { await this.setPhoto(p, f); uploaded++; } catch { failed++; }
      if (i % 5 === 0 || i === imgs.length - 1) onProgress(`Photos… ${i + 1}/${imgs.length}`, Math.round(((i + 1) / imgs.length) * 100));
    }
    return { uploaded, unmatched, failed };
  }

  // ── Price adjustment (percentage tool) ────────────────────────────────────
  /**
   * pct: -90..500 (non-zero). field:
   *   price | price_pro | both  → multiply that field by (1 + pct/100)
   *   pro_from_ttc            → price_pro = price × (1 + pct/100)  (e.g. -20 → 80% of TTC)
   * keepExisting only applies to pro_from_ttc (fill empty Prix Pro only).
   */
  static async adjustPrices(
    targets: CatalogueProduct[], pct: number, field: PriceField,
    opts: { roundInt?: boolean; keepExisting?: boolean } = {},
    onProgress?: (done: number, total: number) => void,
  ): Promise<number> {
    if (!isFinite(pct) || pct === 0) throw new Error('Pourcentage invalide (non nul)');
    if (pct < -90 || pct > 500) throw new Error('Pourcentage hors limites (-90 à +500)');
    const factor = 1 + pct / 100;
    const round = (n: number) => opts.roundInt ? Math.round(n) : r2(n);

    const rows: { id: string; patch: Partial<CatalogueProduct> }[] = [];
    const uniqueTargets = Array.from(new Map(targets.map(p => [p.ref, p])).values());
    for (const p of uniqueTargets) {
      if (field === 'pro_from_ttc') {
        if (p.price == null) continue;
        if (opts.keepExisting && p.price_pro != null) continue;
        rows.push({ id: p.id, patch: { price_pro: round(p.price * factor) } });
      } else {
        const patch: Partial<CatalogueProduct> = {};
        if ((field === 'price' || field === 'both') && p.price != null) patch.price = round(p.price * factor);
        if ((field === 'price_pro' || field === 'both') && p.price_pro != null) patch.price_pro = round(p.price_pro * factor);
        if (Object.keys(patch).length) rows.push({ id: p.id, patch });
      }
    }
    if (!rows.length) {
      throw new Error(field === 'price' ? "Les produits visés n'ont pas de Prix TTC renseigné."
        : field === 'price_pro' ? "Les produits visés n'ont pas de Prix Pro renseigné."
        : 'Aucun produit concerné dans la portée choisie.');
    }
    for (let i = 0; i < rows.length; i += 100) {
      const batch = rows.slice(i, i + 100);
      await Promise.all(batch.map(r => this.updateProduct(r.id, r.patch)));
      onProgress?.(Math.min(i + 100, rows.length), rows.length);
    }
    return rows.length;
  }

  // ── Seed import (one-time, re-runnable) ───────────────────────────────────
  static async importSeed(
    seed: { families: { n: string; o: number }[]; products: any[] },
    onProgress: (msg: string, pct: number) => void,
  ): Promise<ImportReport> {
    const { companyId } = getCompanyContext();
    if (!companyId) throw new Error('Aucune société sélectionnée');

    onProgress('Création des familles…', 3);
    const existing = await this.listFamilies();
    const byName = new Map(existing.map(f => [f.name, f]));
    const newFams = seed.families.filter(f => !byName.has(f.n))
      .map(f => ({ company_id: companyId, name: f.n, sort_order: f.o }));
    for (let i = 0; i < newFams.length; i += 200) {
      const { error } = await (supabase as any).from('catalog_families').insert(newFams.slice(i, i + 200));
      if (error) throw new Error(`Familles: ${error.message}`);
    }
    (await this.listFamilies()).forEach(f => byName.set(f.name, f));

    onProgress('Lecture du catalogue existant…', 8);
    const current = await this.listProducts();
    const haveRef = new Set(current.map(p => p.ref));
    const seedProducts = Array.from(new Map(seed.products.map(sp => [String(sp.r || '').trim(), sp])).entries())
      .filter(([ref]) => ref && !haveRef.has(ref));

    let masters = await loadMasterProducts(seedProducts.map(([ref]) => ref));
    const missingMasters = seedProducts.filter(([ref]) => !masters.has(ref)).map(([ref, sp]) => ({
      barcode: ref,
      name: sp.d || ref,
      brand: '',
      image: sp.i ?? null,
      techsheet: '',
      price: sp.p ?? 0,
      buyprice: 0,
      reseller_price: sp.pp ?? 0,
      provider: '',
      stock_levels: {},
    }));
    for (let i = 0; i < missingMasters.length; i += 200) {
      const { error } = await (supabase as any).from('products')
        .upsert(missingMasters.slice(i, i + 200), { onConflict: 'barcode', ignoreDuplicates: true });
      if (error) throw new Error(`Produits Stocky: ${error.message}`);
    }
    if (missingMasters.length) masters = await loadMasterProducts(seedProducts.map(([ref]) => ref));

    const rows = seedProducts.map(([ref, sp]) => {
      const master = masters.get(ref);
      return {
        company_id: companyId,
        family_id: sp.f ? byName.get(sp.f)?.id ?? null : null,
        ref,
        designation: master?.name ?? (sp.d || ref),
        price: master?.price ?? sp.p ?? 0,
        price_pro: master?.reseller_price ?? sp.pp ?? 0,
        image: master?.image ?? sp.i ?? null,
        hidden: !!sp.h,
        sort_order: sp.s ?? 0,
      };
    });

    for (let i = 0; i < rows.length; i += 250) {
      const { error } = await (supabase as any).from('catalog_products').insert(rows.slice(i, i + 250));
      if (error) throw new Error(`Produits: ${error.message}`);
      onProgress(`Import des produits… ${Math.min(i + 250, rows.length)}/${rows.length}`, 10 + Math.round((i / Math.max(rows.length, 1)) * 85));
    }

    onProgress('Vérification…', 97);
    const famCount = (await this.listFamilies()).length;
    const prodCount = (await this.listProducts()).length;
    if (!famCount || !prodCount) throw new Error('Vérification échouée : catalogue vide après import');
    onProgress('Terminé', 100);
    return { families: famCount, products: prodCount };
  }
}
