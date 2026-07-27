import { supabase } from './supabaseClient';

export interface CatalogFamily {
  id: string;
  name: string;
  sort_order: number;
}

export interface CatalogProduct {
  barcode: string;
  name: string;
  price: number;
  reseller_price: number;
  catalog_family_id: string | null;
  catalog_sort: number;
  catalog_hidden: boolean;
  catalog_image: string | null;
}

export interface ImportReport {
  familiesCreated: number;
  productsMatched: number;
  productsCreated: number;
}

export interface PhotoReport {
  uploaded: number;
  unmatched: string[];
  failed: number;
}

/** Same normalization as the catalogue-pm tool: strip spaces/dashes, uppercase. */
export const normRef = (s: string) => (s || '').toUpperCase().replace(/[\s\-_.]/g, '');

const sanitizePath = (s: string) => normRef(s).replace(/[^A-Z0-9]/g, '') || 'X';

export class CatalogService {
  static async listFamilies(): Promise<CatalogFamily[]> {
    const { data, error } = await (supabase as any).from('catalog_families')
      .select('id, name, sort_order').order('sort_order').order('name');
    if (error) throw error;
    return (data || []) as CatalogFamily[];
  }

  static async addFamily(name: string): Promise<void> {
    const fams = await this.listFamilies();
    const max = fams.reduce((m, f) => Math.max(m, f.sort_order), 0);
    const { error } = await (supabase as any).from('catalog_families').insert({ name: name.trim(), sort_order: max + 1 });
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
    const idx = fams.findIndex(f => f.id === id);
    const other = fams[idx + dir];
    if (idx < 0 || !other) return;
    // renumber the whole list to keep orders dense, then swap
    fams.forEach((f, i) => { f.sort_order = i; });
    fams[idx].sort_order = idx + dir;
    other.sort_order = idx;
    for (const f of fams) {
      await (supabase as any).from('catalog_families').update({ sort_order: f.sort_order }).eq('id', f.id);
    }
  }

  /** All products with catalogue fields (light columns only). */
  static async listCatalogProducts(): Promise<CatalogProduct[]> {
    const out: CatalogProduct[] = [];
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await (supabase as any).from('products')
        .select('barcode, name, price, reseller_price, catalog_family_id, catalog_sort, catalog_hidden, catalog_image')
        .order('barcode').range(from, from + PAGE - 1);
      if (error) throw error;
      out.push(...((data || []) as CatalogProduct[]));
      if (!data || data.length < PAGE) break;
    }
    return out;
  }

  static async updateProduct(barcode: string, patch: Partial<CatalogProduct>): Promise<void> {
    const { error } = await (supabase as any).from('products').update(patch).eq('barcode', barcode);
    if (error) throw error;
  }

  /**
   * Bundled catalogue photos (shipped in public/catalogue-images/) are stored
   * as bare filenames; user-replaced photos live in Storage under catalogue/.
   */
  static publicImageUrl(path: string): string {
    if (!path.includes('/')) return `${import.meta.env.BASE_URL || '/'}catalogue-images/${path}`;
    return supabase.storage.from('product-photos').getPublicUrl(path).data.publicUrl;
  }

  // ── One-time import of the catalogue-pm dataset ───────────────────────────
  static async importSeed(
    seed: { families: { name: string; sort_order: number }[]; products: any[] },
    onProgress: (msg: string, pct: number) => void,
  ): Promise<ImportReport> {
    // 1. Families (upsert by name)
    onProgress('Création des familles…', 2);
    const existingFams = await this.listFamilies();
    const famByName = new Map(existingFams.map(f => [f.name, f]));
    const newFams = seed.families.filter(f => !famByName.has(f.name))
      .map(f => ({ name: f.name, sort_order: f.sort_order }));
    let familiesCreated = 0;
    for (let i = 0; i < newFams.length; i += 200) {
      const batch = newFams.slice(i, i + 200);
      const { error } = await (supabase as any).from('catalog_families').insert(batch);
      if (error) throw error;
      familiesCreated += batch.length;
    }
    (await this.listFamilies()).forEach(f => famByName.set(f.name, f));

    // 2. Existing products, matched by normalized ref ↔ barcode
    onProgress('Chargement des produits existants…', 8);
    const existing = await this.listCatalogProducts();
    const byNorm = new Map<string, CatalogProduct>();
    existing.forEach(p => byNorm.set(normRef(p.barcode), p));

    const updates: any[] = [];
    const creates: any[] = [];
    for (const sp of seed.products) {
      const famId = sp.family ? famByName.get(sp.family)?.id ?? null : null;
      const meta = {
        catalog_family_id: famId,
        catalog_sort: sp.sort ?? 0,
        catalog_hidden: !!sp.hidden,
      };
      const match = byNorm.get(normRef(sp.ref));
      if (match) {
        // Collision policy: keep Stocky's name/price — attach catalogue metadata only.
        // Photo: link the bundled image, but never clobber a Storage upload (contains '/').
        const keepUpload = match.catalog_image && match.catalog_image.includes('/');
        updates.push({
          barcode: match.barcode, ...meta,
          catalog_image: keepUpload ? match.catalog_image : (sp.image ?? match.catalog_image ?? null),
        });
      } else {
        creates.push({
          barcode: sp.ref, name: sp.designation || sp.ref, brand: '', techsheet: '',
          price: sp.price ?? 0, buyprice: 0, reseller_price: sp.price_pro ?? 0,
          provider: '', stock_levels: {}, catalog_image: sp.image ?? null, ...meta,
        });
      }
    }

    let done = 0;
    const total = updates.length + creates.length;
    for (let i = 0; i < updates.length; i += 100) {
      const batch = updates.slice(i, i + 100);
      await Promise.all(batch.map(u => {
        const { barcode, ...patch } = u;
        return (supabase as any).from('products').update(patch).eq('barcode', barcode);
      }));
      done += batch.length;
      onProgress(`Association des produits existants… ${done}/${total}`, 10 + Math.round((done / total) * 80));
    }
    for (let i = 0; i < creates.length; i += 200) {
      const batch = creates.slice(i, i + 200);
      const { error } = await (supabase as any).from('products').insert(batch);
      if (error) throw error;
      done += batch.length;
      onProgress(`Création des nouveaux produits… ${done}/${total}`, 10 + Math.round((done / total) * 80));
    }

    onProgress('Terminé', 100);
    return { familiesCreated, productsMatched: updates.length, productsCreated: creates.length };
  }

  /**
   * Bulk photo import: files from the local images/ folder are matched via the
   * seed (image filename → ref), with a fallback on normalized-ref filenames.
   */
  static async importPhotos(
    files: File[],
    seed: { products: any[] },
    onProgress: (msg: string, pct: number) => void,
  ): Promise<PhotoReport> {
    const products = await this.listCatalogProducts();
    const byNorm = new Map(products.map(p => [normRef(p.barcode), p]));
    // seed image filename → product (via ref)
    const byImageName = new Map<string, CatalogProduct>();
    for (const sp of seed.products) {
      if (!sp.image) continue;
      const match = byNorm.get(normRef(sp.ref));
      if (match) byImageName.set(sp.image.toLowerCase(), match);
    }

    let uploaded = 0, failed = 0;
    const unmatched: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const name = file.name.toLowerCase();
      if (!/\.(jpe?g|png|webp)$/.test(name)) continue;
      const stem = file.name.replace(/\.[^.]+$/, '');
      const product = byImageName.get(name) || byNorm.get(normRef(stem));
      if (!product) { unmatched.push(file.name); continue; }
      try {
        const path = `catalogue/${sanitizePath(product.barcode)}.jpg`;
        const { error: upErr } = await supabase.storage.from('product-photos')
          .upload(path, file, { upsert: true, contentType: 'image/jpeg' });
        if (upErr) throw upErr;
        await this.updateProduct(product.barcode, { catalog_image: path });
        uploaded++;
      } catch {
        failed++;
      }
      if (i % 10 === 0 || i === files.length - 1) {
        onProgress(`Photos… ${i + 1}/${files.length}`, Math.round(((i + 1) / files.length) * 100));
      }
    }
    return { uploaded, unmatched, failed };
  }

  /** Upload/replace a single product catalogue photo. */
  static async setProductPhoto(barcode: string, file: File): Promise<string> {
    const path = `catalogue/${sanitizePath(barcode)}.jpg`;
    const { error } = await supabase.storage.from('product-photos')
      .upload(path, file, { upsert: true, contentType: file.type || 'image/jpeg' });
    if (error) throw error;
    await this.updateProduct(barcode, { catalog_image: path });
    return path;
  }
}
