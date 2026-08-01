import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import {
  BookImage, Loader, Search, Plus, Pencil, Trash2, ChevronUp, ChevronDown,
  Eye, EyeOff, FileDown, Upload, ImageOff, Calculator, X, Save, SlidersHorizontal,
} from 'lucide-react';
import { CatalogueService, type CatalogueFamily, type CatalogueProduct, type PriceField } from '../../utils/supabaseCatalogue';
import { generateCataloguePdf, fetchCatalogueImages, type CatalogueVariant, type CatalogueLayout } from '../../utils/cataloguePdf';
import { CompanySettingsService } from '../../utils/companySettings';
import { getCompanyContext } from '../../utils/supabaseCompanyFilter';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';

const fmt = (n: number | null) => n == null ? '—' : new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2 }).format(n);
type VisFilter = 'all' | 'visible' | 'hidden' | 'nophoto';
const PAGE_SIZE = 50;

export default function CataloguePage() {
  const { isAdmin, isSuperAdmin, currentUser } = useAuth();
  const { showToast } = useToast();

  const [families, setFamilies] = useState<CatalogueFamily[]>([]);
  const [products, setProducts] = useState<CatalogueProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [famFilter, setFamFilter] = useState('');
  const [famQuery, setFamQuery] = useState('');
  const [vis, setVis] = useState<VisFilter>('all');
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Record<string, Partial<CatalogueProduct>>>({});
  const [showCalc, setShowCalc] = useState(false);

  const [variant, setVariant] = useState<CatalogueVariant>('ttc');
  const [layout, setLayout] = useState<CatalogueLayout>('list');
  const [genFams, setGenFams] = useState<Set<string>>(new Set());
  const [gen, setGen] = useState<{ msg: string; pct: number } | null>(null);
  const [pdfUrl, setPdfUrl] = useState<{ url: string; name: string; pages: number } | null>(null);

  // export options
  const [showExport, setShowExport] = useState(false);
  const [expPhoto, setExpPhoto] = useState<'all' | 'with' | 'without'>('all');
  const [expPrice, setExpPrice] = useState<'all' | 'with' | 'without'>('all');
  const [expMin, setExpMin] = useState('');
  const [expMax, setExpMax] = useState('');
  const [expUseFilter, setExpUseFilter] = useState(false);

  const photoInput = useRef<HTMLInputElement>(null);
  const photoTarget = useRef<CatalogueProduct | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [f, p] = await Promise.all([CatalogueService.listFamilies(), CatalogueService.listProducts()]);
      setFamilies(f); setProducts(p);
    } catch (e: any) {
      showToast({ type: 'error', message: e?.message || 'Erreur de chargement' });
    } finally { setLoading(false); }
  }, [showToast]);
  useEffect(() => { load(); }, [load]);

  const countByFam = useMemo(() => {
    const m = new Map<string, number>();
    products.forEach(p => { if (p.family_id) m.set(p.family_id, (m.get(p.family_id) || 0) + 1); });
    return m;
  }, [products]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let l = products;
    if (famFilter) l = l.filter(p => p.family_id === famFilter);
    if (q) l = l.filter(p => p.ref.toLowerCase().includes(q) || p.designation.toLowerCase().includes(q));
    if (vis === 'visible') l = l.filter(p => !p.hidden);
    else if (vis === 'hidden') l = l.filter(p => p.hidden);
    else if (vis === 'nophoto') l = l.filter(p => !p.image);
    return l;
  }, [products, query, famFilter, vis]);

  useEffect(() => { setPage(0); }, [query, famFilter, vis]);
  const pageItems = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const nPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  const patch = (id: string, p: Partial<CatalogueProduct>) =>
    setProducts(prev => prev.map(x => x.id === id ? { ...x, ...p } : x));

  // ── inline edit ───────────────────────────────────────────────────────────
  const edit = (id: string, field: keyof CatalogueProduct, value: any) =>
    setEditing(prev => ({ ...prev, [id]: { ...prev[id], [field]: value } }));

  const saveRow = async (p: CatalogueProduct) => {
    const e = editing[p.id];
    if (!e) return;
    try {
      await CatalogueService.updateProduct(p.id, e);
      patch(p.id, e);
      setEditing(prev => { const n = { ...prev }; delete n[p.id]; return n; });
      showToast({ type: 'success', message: 'Enregistré' });
    } catch (err: any) { showToast({ type: 'error', message: err?.message || 'Échec' }); }
  };

  const toggleHidden = async (p: CatalogueProduct) => {
    patch(p.id, { hidden: !p.hidden });
    try { await CatalogueService.setHidden([p.id], !p.hidden); }
    catch (e: any) { patch(p.id, { hidden: p.hidden }); showToast({ type: 'error', message: e?.message || 'Échec' }); }
  };

  const bulk = async (action: 'hide' | 'show' | 'delete') => {
    const ids = Array.from(selected);
    if (!ids.length) return;
    if (action === 'delete' && !window.confirm(`Supprimer définitivement ${ids.length} produit(s) du catalogue ?`)) return;
    setBusy(true);
    try {
      if (action === 'delete') { await CatalogueService.deleteProducts(ids); setProducts(prev => prev.filter(p => !selected.has(p.id))); }
      else { const h = action === 'hide'; await CatalogueService.setHidden(ids, h); setProducts(prev => prev.map(p => selected.has(p.id) ? { ...p, hidden: h } : p)); }
      setSelected(new Set());
      showToast({ type: 'success', message: `${ids.length} produit(s) mis à jour` });
    } catch (e: any) { showToast({ type: 'error', message: e?.message || 'Échec' }); }
    finally { setBusy(false); }
  };

  // ── photos ────────────────────────────────────────────────────────────────
  const pickPhoto = (p: CatalogueProduct) => { photoTarget.current = p; photoInput.current?.click(); };
  const onPhoto = async (file?: File) => {
    const p = photoTarget.current;
    if (!file || !p) return;
    try {
      const path = await CatalogueService.setPhoto(p, file);
      patch(p.id, { image: path });
      showToast({ type: 'success', message: 'Photo mise à jour' });
    } catch (e: any) { showToast({ type: 'error', message: e?.message || 'Échec' }); }
  };

  // ── families ──────────────────────────────────────────────────────────────
  const addFamily = async () => {
    const n = prompt('Nom de la nouvelle famille :');
    if (!n?.trim()) return;
    try { await CatalogueService.addFamily(n); await load(); }
    catch (e: any) { showToast({ type: 'error', message: e?.message || 'Échec' }); }
  };
  const renameFamily = async (f: CatalogueFamily) => {
    const n = prompt('Renommer la famille :', f.name);
    if (!n?.trim() || n === f.name) return;
    try { await CatalogueService.renameFamily(f.id, n); await load(); }
    catch (e: any) { showToast({ type: 'error', message: e?.message || 'Échec' }); }
  };
  const delFamily = async (f: CatalogueFamily) => {
    if (!window.confirm(`Supprimer la famille « ${f.name} » ? Les produits deviennent « hors famille ».`)) return;
    try { await CatalogueService.deleteFamily(f.id); await load(); }
    catch (e: any) { showToast({ type: 'error', message: e?.message || 'Échec' }); }
  };
  const moveFamily = async (f: CatalogueFamily, dir: -1 | 1) => {
    setBusy(true);
    try { await CatalogueService.moveFamily(f.id, dir); await load(); }
    finally { setBusy(false); }
  };

  const addProduct = async () => {
    const ref = prompt('Référence du nouveau produit :');
    if (!ref?.trim()) return;
    try {
      const p = await CatalogueService.createProduct({ ref, designation: '', family_id: famFilter || null });
      setProducts(prev => [p, ...prev]);
      showToast({ type: 'success', message: 'Produit créé — complétez la ligne' });
    } catch (e: any) { showToast({ type: 'error', message: e?.message || 'Échec (référence déjà utilisée ?)' }); }
  };

  // ── Export selection (shared by the live count and the generator) ─────────
  const exportFams = useMemo(() => {
    const want = genFams.size ? genFams : null;
    const min = expMin === '' ? null : Number(expMin);
    const max = expMax === '' ? null : Number(expMax);
    const q = query.trim().toLowerCase();
    // price actually printed for the chosen variant
    const effPrice = (p: CatalogueProduct) => variant === 'pro' ? (p.price_pro ?? p.price) : p.price;

    const keep = (p: CatalogueProduct) => {
      if (p.hidden) return false;
      if (expPhoto === 'with' && !p.image) return false;
      if (expPhoto === 'without' && p.image) return false;
      const v = effPrice(p);
      if (expPrice === 'with' && (v == null || v <= 0)) return false;
      if (expPrice === 'without' && v != null && v > 0) return false;
      if (min != null && (v == null || v < min)) return false;
      if (max != null && (v == null || v > max)) return false;
      if (expUseFilter) {
        if (famFilter && p.family_id !== famFilter) return false;
        if (q && !p.ref.toLowerCase().includes(q) && !p.designation.toLowerCase().includes(q)) return false;
      }
      return true;
    };

    return families
      .filter(f => !want || want.has(f.id))
      .map(f => ({ ...f, products: products.filter(p => p.family_id === f.id && keep(p)).sort((a, b) => (a.sort_order - b.sort_order) || a.ref.localeCompare(b.ref)) }))
      .filter(f => f.products.length > 0);
  }, [families, products, genFams, expPhoto, expPrice, expMin, expMax, expUseFilter, famFilter, query, variant]);

  const exportCount = useMemo(() => exportFams.reduce((s, f) => s + f.products.length, 0), [exportFams]);
  const exportFiltersOn = expPhoto !== 'all' || expPrice !== 'all' || expMin !== '' || expMax !== '' || expUseFilter;

  // ── PDF ───────────────────────────────────────────────────────────────────
  const generate = async () => {
    setGen({ msg: 'Préparation…', pct: 0 });
    if (pdfUrl) { URL.revokeObjectURL(pdfUrl.url); setPdfUrl(null); }
    try {
      const fams = exportFams;
      if (!fams.length) throw new Error('Aucun produit ne correspond aux options d\'export');

      const all = fams.flatMap(f => f.products);
      const images = await fetchCatalogueImages(all, CatalogueService.imageUrl, (msg, pct) => setGen({ msg, pct: Math.round(pct * 0.35) }));

      const { companyId } = getCompanyContext();
      const s = companyId ? await CompanySettingsService.getSettings(companyId).catch(() => null) : null;
      let logoDataUrl: string | null = null;
      if (s?.logo_url) {
        try {
          const b = await (await fetch(s.logo_url)).blob();
          logoDataUrl = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(b); });
        } catch { /* optional */ }
      }

      const { blob, pages, filename } = await generateCataloguePdf(fams, images, {
        variant, layout,
        title: 'CATALOGUE PETIT MATÉRIEL',
        brand: s?.company_name || 'CUISIMAT GROUPE',
        site: (s?.website || 'cuisimat-groupe.ma').replace(/^https?:\/\//, ''),
        logoDataUrl,
        tag: expPhoto === 'with' ? 'PHOTOS' : expPhoto === 'without' ? 'SANS-PHOTO' : undefined,
        onProgress: (msg, pct) => setGen({ msg, pct: 35 + Math.round(pct * 0.65) }),
      });
      setPdfUrl({ url: URL.createObjectURL(blob), name: filename, pages });
      showToast({ type: 'success', title: 'Catalogue généré', message: `${pages} pages — aperçu ou téléchargement ci-dessous` });
    } catch (e: any) {
      showToast({ type: 'error', title: 'Erreur', message: e?.message || 'Échec de la génération' });
    } finally { setGen(null); }
  };

  if (!isAdmin && !isSuperAdmin) return <div className="text-center py-12 text-muted-foreground">Accès réservé aux administrateurs.</div>;
  if (loading) return <div className="flex items-center justify-center py-24 text-muted-foreground"><Loader className="h-5 w-5 animate-spin mr-2" />Chargement…</div>;

  const famList = families.filter(f => !famQuery || f.name.toLowerCase().includes(famQuery.toLowerCase()));
  const scopeLabel = selected.size ? `${selected.size} produit(s) coché(s)`
    : (famFilter || query || vis !== 'all') ? `les ${filtered.length} produits filtrés` : `tous les produits (${products.length})`;
  const scopeItems = selected.size ? products.filter(p => selected.has(p.id)) : filtered;

  return (
    <div className="max-w-7xl mx-auto py-6 px-3">
      <input ref={photoInput} type="file" accept="image/*" className="hidden"
        onChange={e => { onPhoto(e.target.files?.[0]); e.target.value = ''; }} />

      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10"><BookImage className="h-5 w-5 text-primary" /></div>
          <div>
            <h1 className="text-lg font-bold text-foreground leading-tight">Catalogue</h1>
            <p className="text-xs text-muted-foreground">{products.length} produits · {families.length} familles · liste indépendante de Stocky</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setShowCalc(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm ${showCalc ? 'bg-primary/10 border-primary/30 text-primary' : 'bg-secondary border-border'}`}>
            <Calculator className="h-3.5 w-3.5" /> % Prix
          </button>
          <select value={layout} onChange={e => setLayout(e.target.value as CatalogueLayout)} className="px-2 py-2 text-sm rounded-lg bg-secondary border border-border">
            <option value="list">Modèle : Liste</option>
            <option value="grid">Modèle : Grille photos</option>
          </select>
          <select value={variant} onChange={e => setVariant(e.target.value as CatalogueVariant)} className="px-2 py-2 text-sm rounded-lg bg-secondary border border-border">
            <option value="ttc">Prix TTC</option>
            <option value="pro">Prix Pro</option>
            <option value="none">Sans prix</option>
          </select>
          <button onClick={() => setShowExport(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm ${showExport || exportFiltersOn ? 'bg-primary/10 border-primary/30 text-primary' : 'bg-secondary border-border'}`}>
            <SlidersHorizontal className="h-3.5 w-3.5" /> Filtres export{exportFiltersOn ? ' •' : ''}
          </button>
          <button onClick={generate} disabled={!!gen || exportCount === 0}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-60">
            {gen ? <Loader className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
            Générer ({exportCount})
          </button>
        </div>
      </div>

      {showExport && (
        <div className="mb-4 bg-card border border-primary/25 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold text-foreground">Filtres d'export</span>
              <span className="text-xs text-muted-foreground">· ce qui entrera dans le PDF</span>
            </div>
            <div className="flex items-center gap-2">
              {exportFiltersOn && (
                <button onClick={() => { setExpPhoto('all'); setExpPrice('all'); setExpMin(''); setExpMax(''); setExpUseFilter(false); }}
                  className="text-xs text-muted-foreground hover:text-foreground">Réinitialiser</button>
              )}
              <button onClick={() => setShowExport(false)} className="p-1 rounded hover:bg-secondary"><X className="h-4 w-4 text-muted-foreground" /></button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-[11px] text-muted-foreground mb-1">Photos</label>
              <select value={expPhoto} onChange={e => setExpPhoto(e.target.value as any)}
                className="w-full px-2 py-1.5 text-sm rounded bg-secondary border border-border">
                <option value="all">Tous les produits</option>
                <option value="with">Avec photo uniquement</option>
                <option value="without">Sans photo uniquement</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-muted-foreground mb-1">Prix ({variant === 'pro' ? 'Pro' : variant === 'ttc' ? 'TTC' : 'n/a'})</label>
              <select value={expPrice} onChange={e => setExpPrice(e.target.value as any)} disabled={variant === 'none'}
                className="w-full px-2 py-1.5 text-sm rounded bg-secondary border border-border disabled:opacity-50">
                <option value="all">Tous les produits</option>
                <option value="with">Avec prix uniquement</option>
                <option value="without">Sans prix uniquement</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-muted-foreground mb-1">Prix min (MAD)</label>
              <input type="number" value={expMin} onChange={e => setExpMin(e.target.value)} placeholder="—"
                className="w-full px-2 py-1.5 text-sm rounded bg-secondary border border-border" />
            </div>
            <div>
              <label className="block text-[11px] text-muted-foreground mb-1">Prix max (MAD)</label>
              <input type="number" value={expMax} onChange={e => setExpMax(e.target.value)} placeholder="—"
                className="w-full px-2 py-1.5 text-sm rounded bg-secondary border border-border" />
            </div>
          </div>

          <label className="flex items-center gap-1.5 text-xs text-muted-foreground mt-3 cursor-pointer">
            <input type="checkbox" checked={expUseFilter} onChange={e => setExpUseFilter(e.target.checked)} className="accent-[hsl(var(--primary))]" />
            Appliquer aussi la recherche et la famille sélectionnées à l'écran
          </label>

          <div className="mt-3 pt-3 border-t border-border/60 flex items-center gap-3 flex-wrap text-xs">
            <span className={exportCount === 0 ? 'text-destructive font-medium' : 'text-foreground font-medium'}>
              {exportCount === 0 ? 'Aucun produit ne correspond' : `${exportCount} produit(s) · ${exportFams.length} famille(s)`}
            </span>
            <span className="text-muted-foreground">
              Les produits masqués (🚫) sont toujours exclus{genFams.size ? ` · ${genFams.size} famille(s) cochée(s)` : ''}
            </span>
          </div>
        </div>
      )}

      {gen && (
        <div className="mb-4 bg-card border border-border rounded-lg p-3">
          <div className="flex justify-between text-xs mb-1"><span className="text-muted-foreground">{gen.msg}</span><span className="tabular-nums">{gen.pct}%</span></div>
          <div className="h-1.5 bg-secondary rounded-full overflow-hidden"><div className="h-full bg-primary transition-all" style={{ width: `${gen.pct}%` }} /></div>
        </div>
      )}

      {pdfUrl && (
        <div className="mb-4 bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3 flex items-center justify-between flex-wrap gap-2">
          <span className="text-sm text-emerald-700 dark:text-emerald-400 font-medium">✓ {pdfUrl.name} — {pdfUrl.pages} pages</span>
          <div className="flex gap-2">
            <a href={pdfUrl.url} target="_blank" rel="noreferrer" className="px-3 py-1.5 rounded-lg bg-secondary border border-border text-sm">👁 Aperçu</a>
            <a href={pdfUrl.url} download={pdfUrl.name} className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium">⬇ Télécharger</a>
          </div>
        </div>
      )}

      {families.length === 0 && <SeedBanner onDone={load} />}

      {showCalc && (
        <PriceCalculator scope={scopeItems} scopeLabel={scopeLabel} onClose={() => setShowCalc(false)}
          onApplied={async () => { await load(); }} />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[250px_1fr] gap-4">
        {/* Families */}
        <div className="bg-card border border-border/60 rounded-lg overflow-hidden self-start">
          <div className="flex items-center justify-between px-3 py-2 bg-secondary/50 border-b border-border/60">
            <span className="text-sm font-semibold">Familles</span>
            <button onClick={addFamily} className="p-1 rounded hover:bg-secondary" title="Ajouter"><Plus className="h-3.5 w-3.5" /></button>
          </div>
          <div className="p-2 border-b border-border/40">
            <input value={famQuery} onChange={e => setFamQuery(e.target.value)} placeholder="Filtrer…"
              className="w-full px-2 py-1.5 text-xs rounded bg-secondary border border-border" />
          </div>
          <div className="max-h-[520px] overflow-y-auto">
            <button onClick={() => setFamFilter('')}
              className={`w-full text-left px-3 py-1.5 text-xs ${!famFilter ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-secondary/40'}`}>
              Toutes les familles
            </button>
            {famList.map(f => (
              <div key={f.id} className={`group flex items-center gap-1 px-1.5 ${famFilter === f.id ? 'bg-primary/10' : 'hover:bg-secondary/40'}`}>
                <input type="checkbox" checked={genFams.has(f.id)} title="Inclure au PDF (aucune coche = tout)"
                  onChange={e => setGenFams(prev => { const n = new Set(prev); e.target.checked ? n.add(f.id) : n.delete(f.id); return n; })}
                  className="accent-[hsl(var(--primary))] shrink-0" />
                <button onClick={() => setFamFilter(famFilter === f.id ? '' : f.id)}
                  className={`flex-1 min-w-0 text-left py-1.5 text-xs truncate ${famFilter === f.id ? 'text-primary font-medium' : ''}`} title={f.name}>
                  {f.name} <span className="text-muted-foreground">({countByFam.get(f.id) || 0})</span>
                </button>
                <div className="hidden group-hover:flex items-center shrink-0">
                  <button onClick={() => moveFamily(f, -1)} disabled={busy} className="p-0.5 hover:bg-secondary rounded"><ChevronUp className="h-3 w-3" /></button>
                  <button onClick={() => moveFamily(f, 1)} disabled={busy} className="p-0.5 hover:bg-secondary rounded"><ChevronDown className="h-3 w-3" /></button>
                  <button onClick={() => renameFamily(f)} className="p-0.5 hover:bg-secondary rounded"><Pencil className="h-3 w-3" /></button>
                  <button onClick={() => delFamily(f)} className="p-0.5 hover:bg-secondary rounded text-destructive"><Trash2 className="h-3 w-3" /></button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Products */}
        <div>
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Réf. ou désignation…"
                className="w-full pl-8 pr-3 py-2 text-sm rounded-lg bg-secondary border border-border" />
            </div>
            <div className="flex rounded-lg border border-border overflow-hidden text-xs">
              {(['all', 'visible', 'hidden', 'nophoto'] as VisFilter[]).map(v => (
                <button key={v} onClick={() => setVis(v)}
                  className={`px-2.5 py-2 font-medium ${vis === v ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}>
                  {{ all: 'Tous', visible: 'Visibles', hidden: 'Masqués', nophoto: 'Sans photo' }[v]}
                </button>
              ))}
            </div>
            <button onClick={addProduct} className="flex items-center gap-1 px-2.5 py-2 rounded-lg bg-secondary border border-border text-xs"><Plus className="h-3.5 w-3.5" /> Produit</button>
            <span className="text-xs text-muted-foreground">{filtered.length} résultat(s)</span>
          </div>

          {selected.size > 0 && (
            <div className="mb-3 bg-primary/5 border border-primary/25 rounded-lg px-3 py-2 flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium text-foreground">{selected.size} sélectionné(s)</span>
              <button onClick={() => bulk('hide')} disabled={busy} className="px-2.5 py-1 rounded bg-secondary border border-border text-xs">🚫 Masquer</button>
              <button onClick={() => bulk('show')} disabled={busy} className="px-2.5 py-1 rounded bg-secondary border border-border text-xs">👁 Réafficher</button>
              <button onClick={() => bulk('delete')} disabled={busy} className="px-2.5 py-1 rounded bg-destructive/10 text-destructive text-xs">🗑 Supprimer</button>
              <button onClick={() => setSelected(new Set())} className="ml-auto text-xs text-muted-foreground hover:text-foreground">Désélectionner</button>
            </div>
          )}

          <div className="bg-card border border-border/60 rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-secondary/50 text-xs text-muted-foreground border-b border-border/60">
                    <th className="px-2 py-2 w-8">
                      <input type="checkbox"
                        checked={pageItems.length > 0 && pageItems.every(p => selected.has(p.id))}
                        onChange={e => setSelected(prev => {
                          const n = new Set(prev);
                          pageItems.forEach(p => e.target.checked ? n.add(p.id) : n.delete(p.id));
                          return n;
                        })} className="accent-[hsl(var(--primary))]" />
                    </th>
                    <th className="text-left font-medium px-2 py-2 w-14">Photo</th>
                    <th className="text-left font-medium px-2 py-2 w-28">Réf.</th>
                    <th className="text-left font-medium px-2 py-2">Désignation</th>
                    <th className="text-left font-medium px-2 py-2 w-44">Famille</th>
                    <th className="text-right font-medium px-2 py-2 w-24">Prix TTC</th>
                    <th className="text-right font-medium px-2 py-2 w-24">Prix Pro</th>
                    <th className="px-2 py-2 w-20"></th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map(p => {
                    const e = editing[p.id] || {};
                    const val = <K extends keyof CatalogueProduct>(k: K) => (e[k] !== undefined ? e[k] : p[k]) as any;
                    const dirty = Object.keys(e).length > 0;
                    return (
                      <tr key={p.id} className={`border-b border-border/40 ${p.hidden ? 'opacity-50' : ''}`}>
                        <td className="px-2 py-1.5">
                          <input type="checkbox" checked={selected.has(p.id)} className="accent-[hsl(var(--primary))]"
                            onChange={ev => setSelected(prev => { const n = new Set(prev); ev.target.checked ? n.add(p.id) : n.delete(p.id); return n; })} />
                        </td>
                        <td className="px-2 py-1.5">
                          <button onClick={() => pickPhoto(p)} title="Ajouter / remplacer la photo"
                            className="w-10 h-10 rounded border border-border bg-secondary/40 flex items-center justify-center overflow-hidden">
                            {p.image ? <img src={CatalogueService.imageUrl(p.image)} alt="" className="w-full h-full object-contain" loading="lazy" />
                              : <ImageOff className="h-4 w-4 text-muted-foreground/50" />}
                          </button>
                        </td>
                        <td className="px-2 py-1.5">
                          <input value={val('ref') || ''} onChange={ev => edit(p.id, 'ref', ev.target.value)}
                            className="w-full px-1.5 py-1 text-xs font-mono rounded bg-secondary border border-border" />
                        </td>
                        <td className="px-2 py-1.5">
                          <input value={val('designation') || ''} onChange={ev => edit(p.id, 'designation', ev.target.value)}
                            className="w-full px-1.5 py-1 text-xs rounded bg-secondary border border-border" />
                        </td>
                        <td className="px-2 py-1.5">
                          <select value={val('family_id') || ''} onChange={ev => edit(p.id, 'family_id', ev.target.value || null)}
                            className="w-full px-1 py-1 text-xs rounded bg-secondary border border-border">
                            <option value="">— hors famille —</option>
                            {families.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-1.5">
                          <input type="number" step="0.01" value={val('price') ?? ''} onChange={ev => edit(p.id, 'price', ev.target.value === '' ? null : Number(ev.target.value))}
                            className="w-full px-1.5 py-1 text-xs text-right rounded bg-secondary border border-border" />
                        </td>
                        <td className="px-2 py-1.5">
                          <input type="number" step="0.01" value={val('price_pro') ?? ''} onChange={ev => edit(p.id, 'price_pro', ev.target.value === '' ? null : Number(ev.target.value))}
                            className="w-full px-1.5 py-1 text-xs text-right rounded bg-secondary border border-border" />
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="flex items-center justify-end gap-0.5">
                            {dirty && <button onClick={() => saveRow(p)} title="Enregistrer" className="p-1 rounded bg-primary/10 text-primary"><Save className="h-3.5 w-3.5" /></button>}
                            <button onClick={() => toggleHidden(p)} title={p.hidden ? 'Réafficher' : 'Masquer du PDF'} className="p-1 rounded hover:bg-secondary">
                              {p.hidden ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {pageItems.length === 0 && <tr><td colSpan={8} className="px-3 py-10 text-center text-muted-foreground text-sm">Aucun produit</td></tr>}
                </tbody>
              </table>
            </div>
            {nPages > 1 && (
              <div className="flex items-center justify-between px-3 py-2 border-t border-border/60 text-xs">
                <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="px-2 py-1 rounded bg-secondary border border-border disabled:opacity-40">← Précédent</button>
                <span className="text-muted-foreground">Page {page + 1} / {nPages}</span>
                <button onClick={() => setPage(p => Math.min(nPages - 1, p + 1))} disabled={page >= nPages - 1} className="px-2 py-1 rounded bg-secondary border border-border disabled:opacity-40">Suivant →</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Price calculator ──────────────────────────────────────────────────────── */
function PriceCalculator({ scope, scopeLabel, onClose, onApplied }: {
  scope: CatalogueProduct[]; scopeLabel: string; onClose: () => void; onApplied: () => void | Promise<void>;
}) {
  const { showToast } = useToast();
  const [pct, setPct] = useState('-20');
  const [field, setField] = useState<PriceField>('pro_from_ttc');
  const [roundInt, setRoundInt] = useState(false);
  const [keepExisting, setKeepExisting] = useState(false);
  const [state, setState] = useState<{ done: number; total: number } | null>(null);

  const n = Number(pct);
  const sample = scope.find(p => p.price != null && p.price > 0);
  const preview = sample?.price != null ? (roundInt ? Math.round(sample.price * (1 + n / 100)) : Math.round(sample.price * (1 + n / 100) * 100) / 100) : null;

  const LABEL: Record<PriceField, string> = {
    pro_from_ttc: 'Prix Pro calculé depuis le Prix TTC',
    price: 'Prix TTC',
    price_pro: 'Prix Pro',
    both: 'Prix TTC et Prix Pro',
  };

  const apply = async () => {
    const msg = `${LABEL[field]} — ${n > 0 ? '+' : ''}${n} %\nAppliquer à ${scopeLabel} ?` +
      (field !== 'pro_from_ttc' ? '\n\n⚠ Modification définitive des prix du catalogue.' : '');
    if (!window.confirm(msg)) return;
    setState({ done: 0, total: scope.length });
    try {
      const count = await CatalogueService.adjustPrices(scope, n, field, { roundInt, keepExisting },
        (done, total) => setState({ done, total }));
      showToast({ type: 'success', title: 'Prix mis à jour', message: `${count} produit(s) · ${LABEL[field]} ${n > 0 ? '+' : ''}${n} %` });
      await onApplied();
    } catch (e: any) {
      showToast({ type: 'error', title: 'Erreur', message: e?.message || 'Échec' });
    } finally { setState(null); }
  };

  return (
    <div className="mb-4 bg-card border border-primary/25 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Calculator className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">Calculateur de prix</span>
          <span className="text-xs text-muted-foreground">· portée : {scopeLabel}</span>
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-secondary"><X className="h-4 w-4 text-muted-foreground" /></button>
      </div>

      <div className="flex items-end gap-2 flex-wrap">
        <div>
          <label className="block text-[11px] text-muted-foreground mb-1">Opération</label>
          <select value={field} onChange={e => setField(e.target.value as PriceField)} className="px-2 py-1.5 text-sm rounded bg-secondary border border-border">
            <option value="pro_from_ttc">Prix Pro = Prix TTC ± %</option>
            <option value="price">Ajuster le Prix TTC</option>
            <option value="price_pro">Ajuster le Prix Pro</option>
            <option value="both">Ajuster les deux</option>
          </select>
        </div>
        <div>
          <label className="block text-[11px] text-muted-foreground mb-1">Pourcentage</label>
          <input type="number" value={pct} onChange={e => setPct(e.target.value)}
            className="w-24 px-2 py-1.5 text-sm text-right rounded bg-secondary border border-border" />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground pb-2">
          <input type="checkbox" checked={roundInt} onChange={e => setRoundInt(e.target.checked)} className="accent-[hsl(var(--primary))]" /> Arrondir à l'entier
        </label>
        {field === 'pro_from_ttc' && (
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground pb-2">
            <input type="checkbox" checked={keepExisting} onChange={e => setKeepExisting(e.target.checked)} className="accent-[hsl(var(--primary))]" /> Ne remplir que les Prix Pro vides
          </label>
        )}
        <button onClick={apply} disabled={!!state || !n}
          className="ml-auto px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-60">
          Appliquer
        </button>
      </div>

      {sample && preview != null && (
        <p className="text-[11px] text-muted-foreground mt-2">
          Exemple — {sample.ref} : {fmt(sample.price)} → <b className="text-foreground">{fmt(preview)} MAD</b>
          {field === 'pro_from_ttc' ? ' (Prix Pro)' : ''}
        </p>
      )}
      <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
        ⚠ Aucune annulation automatique — vérifiez la portée avant d'appliquer.
      </p>

      {state && (
        <div className="mt-3">
          <div className="flex justify-between text-xs mb-1"><span className="text-muted-foreground">Application…</span><span className="tabular-nums">{state.done}/{state.total}</span></div>
          <div className="h-1.5 bg-secondary rounded-full overflow-hidden"><div className="h-full bg-primary transition-all" style={{ width: `${Math.round((state.done / Math.max(state.total, 1)) * 100)}%` }} /></div>
        </div>
      )}
    </div>
  );
}

/* ── Seed import banner ────────────────────────────────────────────────────── */
function SeedBanner({ onDone }: { onDone: () => void }) {
  const { showToast } = useToast();
  const [state, setState] = useState<{ msg: string; pct: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setError(null);
    setState({ msg: 'Chargement…', pct: 0 });
    try {
      const seed = (await import('../../data/catalogueSeed.json')).default as any;
      const rep = await CatalogueService.importSeed(seed, (msg, pct) => setState({ msg, pct }));
      showToast({ type: 'success', title: 'Catalogue importé', message: `${rep.families} familles · ${rep.products} produits` });
      onDone();
    } catch (e: any) {
      const m = e?.message || String(e);
      setError(m);
      showToast({ type: 'error', title: 'Import échoué', message: m });
    } finally { setState(null); }
  };

  return (
    <div className="mb-4 bg-primary/5 border border-primary/25 rounded-lg p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="text-sm font-semibold text-foreground">Catalogue vide</div>
          <p className="text-xs text-muted-foreground mt-0.5 max-w-2xl">
            Importez le catalogue « petit matériel » : <b>642 familles</b>, <b>2 705 produits</b> avec
            Prix TTC, Prix Pro et <b>photos incluses</b>. Cette liste est <b>propre au catalogue</b> —
            elle n'affecte pas les produits Stocky.
          </p>
        </div>
        <button onClick={run} disabled={!!state}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-60">
          {state ? <Loader className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Importer le catalogue
        </button>
      </div>
      {state && (
        <div className="mt-3">
          <div className="flex justify-between text-xs mb-1"><span className="text-muted-foreground">{state.msg}</span><span className="tabular-nums">{state.pct}%</span></div>
          <div className="h-1.5 bg-secondary rounded-full overflow-hidden"><div className="h-full bg-primary transition-all" style={{ width: `${state.pct}%` }} /></div>
        </div>
      )}
      {error && <div className="mt-3 text-xs bg-destructive/10 text-destructive rounded px-3 py-2 font-mono break-all">{error}</div>}
    </div>
  );
}
