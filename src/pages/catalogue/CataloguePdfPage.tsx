import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  BookImage, Loader, Search, Plus, Pencil, Trash2, ChevronUp, ChevronDown,
  Eye, EyeOff, FileDown, Upload, ImageOff, Calculator, X,
} from 'lucide-react';
import { CatalogService, type CatalogFamily, type CatalogProduct } from '../../utils/supabaseCatalog';
import { generateCataloguePdf, fetchCatalogImages, type CatalogueVariant, type CatalogueTemplate } from '../../utils/cataloguePdf';
import { CompanySettingsService } from '../../utils/companySettings';
import { getCompanyContext } from '../../utils/supabaseCompanyFilter';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';

function fmt(n: number) { return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2 }).format(n); }
type VisFilter = 'all' | 'visible' | 'hidden' | 'nophoto';
const PAGE_SIZE = 50;

/**
 * Bulk price calculator. Two operations on the current filter scope:
 *  - Prix Pro = Prix TTC × N %  (fills reseller_price)
 *  - Prix TTC ajusté de ±N %    (updates the base price itself)
 */
function PriceCalculator({ scope, scopeLabel, onClose, onApplied }: {
  scope: CatalogProduct[];
  scopeLabel: string;
  onClose: () => void;
  onApplied: (patches: Map<string, Partial<CatalogProduct>>) => void;
}) {
  const { showToast } = useToast();
  const [proPct, setProPct] = useState('90');
  const [ttcPct, setTtcPct] = useState('5');
  const [rounding, setRounding] = useState<'cents' | 'dirham'>('cents');
  const [applying, setApplying] = useState<null | { label: string; done: number; total: number }>(null);

  const roundP = (n: number) => rounding === 'dirham' ? Math.round(n) : Math.round(n * 100) / 100;
  const sample = scope.find(p => p.price > 0);

  const apply = async (op: 'pro' | 'ttc') => {
    const pct = Number(op === 'pro' ? proPct : ttcPct);
    if (!isFinite(pct)) { showToast({ type: 'error', message: 'Pourcentage invalide' }); return; }
    const rows = scope
      .filter(p => p.price > 0)
      .map(p => ({
        barcode: p.barcode,
        patch: op === 'pro'
          ? { reseller_price: roundP(p.price * (pct / 100)) }
          : { price: roundP(p.price * (1 + pct / 100)) },
      }));
    if (rows.length === 0) { showToast({ type: 'error', message: 'Aucun produit avec un prix > 0 dans la sélection' }); return; }
    const label = op === 'pro'
      ? `Prix Pro = Prix TTC × ${pct} %`
      : `Prix TTC ${pct >= 0 ? '+' : ''}${pct} %`;
    if (!window.confirm(`${label}\nAppliquer à ${rows.length} produit(s) (${scopeLabel}) ?${op === 'ttc' ? '\n\n⚠ Le Prix TTC est utilisé partout dans Stocky (devis, factures…).' : ''}`)) return;
    setApplying({ label, done: 0, total: rows.length });
    try {
      await CatalogService.bulkPatch(rows, (done, total) => setApplying({ label, done, total }));
      onApplied(new Map(rows.map(r => [r.barcode, r.patch])));
      showToast({ type: 'success', title: 'Prix mis à jour', message: `${rows.length} produit(s) · ${label}` });
    } catch (e: any) {
      showToast({ type: 'error', title: 'Erreur', message: e?.message || 'Échec' });
    } finally { setApplying(null); }
  };

  return (
    <div className="mb-4 bg-card border border-primary/25 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Calculator className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">Calculateur de prix</span>
          <span className="text-xs text-muted-foreground">· s'applique à {scopeLabel} ({scope.length})</span>
        </div>
        <div className="flex items-center gap-2">
          <select value={rounding} onChange={e => setRounding(e.target.value as any)} className="px-2 py-1 text-xs rounded bg-secondary border border-border">
            <option value="cents">Arrondi : centimes</option>
            <option value="dirham">Arrondi : dirham entier</option>
          </select>
          <button onClick={onClose} className="p-1 rounded hover:bg-secondary"><X className="h-4 w-4 text-muted-foreground" /></button>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        {/* Prix Pro */}
        <div className="border border-border/60 rounded-lg p-3">
          <div className="text-xs font-medium text-foreground mb-2">Prix Pro (revendeur)</div>
          <div className="flex items-center gap-1.5 text-sm flex-wrap">
            <span className="text-muted-foreground text-xs">Prix Pro = Prix TTC ×</span>
            <input type="number" value={proPct} onChange={e => setProPct(e.target.value)}
              className="w-20 px-2 py-1.5 text-sm text-right rounded bg-secondary border border-border" />
            <span className="text-muted-foreground text-xs">%</span>
            <button onClick={() => apply('pro')} disabled={!!applying}
              className="ml-auto px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium disabled:opacity-60">
              Appliquer ({scope.filter(p => p.price > 0).length})
            </button>
          </div>
          {sample && (
            <p className="text-[11px] text-muted-foreground mt-2">
              Ex. {sample.barcode} : {fmt(sample.price)} → <b className="text-foreground">{fmt(roundP(sample.price * (Number(proPct) || 0) / 100))} MAD</b>
            </p>
          )}
        </div>

        {/* Prix TTC */}
        <div className="border border-border/60 rounded-lg p-3">
          <div className="text-xs font-medium text-foreground mb-2">Prix TTC (prix de base) <span className="text-amber-600 dark:text-amber-400 font-normal">— impacte devis & factures</span></div>
          <div className="flex items-center gap-1.5 text-sm flex-wrap">
            <span className="text-muted-foreground text-xs">Ajuster de</span>
            <input type="number" value={ttcPct} onChange={e => setTtcPct(e.target.value)}
              className="w-20 px-2 py-1.5 text-sm text-right rounded bg-secondary border border-border" />
            <span className="text-muted-foreground text-xs">% (négatif = baisse)</span>
            <button onClick={() => apply('ttc')} disabled={!!applying}
              className="ml-auto px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium disabled:opacity-60">
              Appliquer ({scope.filter(p => p.price > 0).length})
            </button>
          </div>
          {sample && (
            <p className="text-[11px] text-muted-foreground mt-2">
              Ex. {sample.barcode} : {fmt(sample.price)} → <b className="text-foreground">{fmt(roundP(sample.price * (1 + (Number(ttcPct) || 0) / 100)))} MAD</b>
            </p>
          )}
        </div>
      </div>

      {applying && (
        <div className="mt-3">
          <div className="flex justify-between text-xs mb-1"><span className="text-muted-foreground">{applying.label}</span><span className="tabular-nums">{applying.done}/{applying.total}</span></div>
          <div className="h-1.5 bg-secondary rounded-full overflow-hidden"><div className="h-full bg-primary transition-all" style={{ width: `${Math.round((applying.done / applying.total) * 100)}%` }} /></div>
        </div>
      )}
    </div>
  );
}

/** Prominent one-click initialisation when the catalogue is empty. */
function SeedImportBanner({ onDone }: { onDone: () => void }) {
  const { showToast } = useToast();
  const [state, setState] = useState<{ msg: string; pct: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setError(null);
    setState({ msg: 'Chargement des données…', pct: 0 });
    try {
      const seed = (await import('../../data/cataloguePmSeed.json')).default as any;
      const report = await CatalogService.importSeed(seed, (msg, pct) => setState({ msg, pct }));
      showToast({ type: 'success', title: 'Catalogue initialisé', message: `${report.familiesCreated} familles · ${report.productsMatched} produits liés · ${report.productsCreated} créés` });
      onDone();
    } catch (e: any) {
      const msg = e?.message || String(e);
      setError(msg);
      showToast({ type: 'error', title: 'Import échoué', message: msg });
    } finally { setState(null); }
  };

  return (
    <div className="mb-4 bg-primary/5 border border-primary/25 rounded-lg p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="text-sm font-semibold text-foreground">Catalogue non initialisé</div>
          <p className="text-xs text-muted-foreground mt-0.5 max-w-xl">
            Importez en un clic les <b>642 familles</b>, liez les <b>2 705 produits</b> (vos prix et noms
            Stocky sont conservés) et attachez les <b>photos embarquées</b>. Relançable sans doublons.
          </p>
        </div>
        <button onClick={run} disabled={!!state}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-60">
          {state ? <Loader className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          Importer maintenant
        </button>
      </div>
      {state && (
        <div className="mt-3">
          <div className="flex justify-between text-xs mb-1"><span className="text-muted-foreground">{state.msg}</span><span className="tabular-nums">{state.pct}%</span></div>
          <div className="h-1.5 bg-secondary rounded-full overflow-hidden"><div className="h-full bg-primary transition-all" style={{ width: `${state.pct}%` }} /></div>
        </div>
      )}
      {error && (
        <div className="mt-3 text-xs bg-destructive/10 text-destructive rounded-md px-3 py-2 font-mono break-all">
          {error}
        </div>
      )}
    </div>
  );
}

export default function CataloguePdfPage() {
  const { isAdmin, isSuperAdmin } = useAuth();
  const { showToast } = useToast();

  const [families, setFamilies] = useState<CatalogFamily[]>([]);
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [famFilter, setFamFilter] = useState<string>('');
  const [famQuery, setFamQuery] = useState('');
  const [vis, setVis] = useState<VisFilter>('all');
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);

  // generation state
  const [variant, setVariant] = useState<CatalogueVariant>('ttc');
  const [template, setTemplate] = useState<CatalogueTemplate>('list');
  const [genFams, setGenFams] = useState<Set<string>>(new Set()); // empty = all
  const [genState, setGenState] = useState<{ msg: string; pct: number } | null>(null);
  const [showCalc, setShowCalc] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const photoTarget = useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [f, p] = await Promise.all([CatalogService.listFamilies(), CatalogService.listCatalogProducts()]);
      setFamilies(f); setProducts(p);
    } catch (e: any) {
      showToast({ type: 'error', message: e?.message || 'Erreur de chargement' });
    } finally { setLoading(false); }
  }, [showToast]);
  useEffect(() => { load(); }, [load]);

  const countByFam = useMemo(() => {
    const m = new Map<string, number>();
    products.forEach(p => { if (p.catalog_family_id) m.set(p.catalog_family_id, (m.get(p.catalog_family_id) || 0) + 1); });
    return m;
  }, [products]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = products;
    if (famFilter) list = list.filter(p => p.catalog_family_id === famFilter);
    if (q) list = list.filter(p => p.barcode.toLowerCase().includes(q) || (p.name || '').toLowerCase().includes(q));
    if (vis === 'visible') list = list.filter(p => !p.catalog_hidden);
    else if (vis === 'hidden') list = list.filter(p => p.catalog_hidden);
    else if (vis === 'nophoto') list = list.filter(p => !p.catalog_image);
    return list;
  }, [products, query, famFilter, vis]);

  useEffect(() => { setPage(0); }, [query, famFilter, vis]);
  const pageItems = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const nPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  const patchLocal = (barcode: string, patch: Partial<CatalogProduct>) =>
    setProducts(prev => prev.map(p => p.barcode === barcode ? { ...p, ...patch } : p));

  const toggleHidden = async (p: CatalogProduct) => {
    patchLocal(p.barcode, { catalog_hidden: !p.catalog_hidden });
    try { await CatalogService.updateProduct(p.barcode, { catalog_hidden: !p.catalog_hidden }); }
    catch (e: any) { patchLocal(p.barcode, { catalog_hidden: p.catalog_hidden }); showToast({ type: 'error', message: e?.message || 'Échec' }); }
  };

  const setFamily = async (p: CatalogProduct, famId: string) => {
    const val = famId || null;
    patchLocal(p.barcode, { catalog_family_id: val });
    try { await CatalogService.updateProduct(p.barcode, { catalog_family_id: val }); }
    catch (e: any) { showToast({ type: 'error', message: e?.message || 'Échec' }); }
  };

  const onPickPhoto = (barcode: string) => { photoTarget.current = barcode; photoInputRef.current?.click(); };
  const onPhotoFile = async (file: File | undefined) => {
    const barcode = photoTarget.current;
    if (!file || !barcode) return;
    try {
      const path = await CatalogService.setProductPhoto(barcode, file);
      patchLocal(barcode, { catalog_image: path });
      showToast({ type: 'success', message: 'Photo mise à jour' });
    } catch (e: any) { showToast({ type: 'error', message: e?.message || 'Échec' }); }
  };

  // families CRUD
  const addFamily = async () => {
    const name = prompt('Nom de la nouvelle famille :');
    if (!name?.trim()) return;
    try { await CatalogService.addFamily(name); await load(); }
    catch (e: any) { showToast({ type: 'error', message: e?.message || 'Échec' }); }
  };
  const renameFamily = async (f: CatalogFamily) => {
    const name = prompt('Renommer la famille :', f.name);
    if (!name?.trim() || name === f.name) return;
    try { await CatalogService.renameFamily(f.id, name); await load(); }
    catch (e: any) { showToast({ type: 'error', message: e?.message || 'Échec' }); }
  };
  const deleteFamily = async (f: CatalogFamily) => {
    if (!confirm(`Supprimer la famille « ${f.name} » ? (les produits ne sont pas supprimés)`)) return;
    try { await CatalogService.deleteFamily(f.id); await load(); }
    catch (e: any) { showToast({ type: 'error', message: e?.message || 'Échec' }); }
  };
  const moveFamily = async (f: CatalogFamily, dir: -1 | 1) => {
    setBusy(true);
    try { await CatalogService.moveFamily(f.id, dir); await load(); }
    finally { setBusy(false); }
  };

  // PDF generation
  const generate = async () => {
    setGenState({ msg: 'Préparation…', pct: 0 });
    try {
      const wanted = genFams.size ? genFams : null;
      const fams = families
        .filter(f => !wanted || wanted.has(f.id))
        .map(f => ({
          ...f,
          products: products
            .filter(p => p.catalog_family_id === f.id && !p.catalog_hidden)
            .sort((a, b) => (a.catalog_sort - b.catalog_sort) || a.barcode.localeCompare(b.barcode)),
        }))
        .filter(f => f.products.length > 0);
      if (!fams.length) throw new Error('Aucun produit visible dans la sélection');

      const allProds = fams.flatMap(f => f.products);
      const images = await fetchCatalogImages(allProds, CatalogService.publicImageUrl,
        (msg, pct) => setGenState({ msg, pct: Math.round(pct * 0.35) }));

      const { companyId } = getCompanyContext();
      const settings = companyId ? await CompanySettingsService.getSettings(companyId).catch(() => null) : null;
      let logoDataUrl: string | null = null;
      if (settings?.logo_url) {
        try {
          const blob = await (await fetch(settings.logo_url)).blob();
          logoDataUrl = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(blob); });
        } catch { /* logo optional */ }
      }

      const { blob, pages, filename } = await generateCataloguePdf(fams, images, {
        variant,
        template,
        title: 'CATALOGUE PETIT MATÉRIEL',
        brand: settings?.company_name || 'CUISIMAT GROUPE',
        site: (settings?.website || 'cuisimat-groupe.ma').replace(/^https?:\/\//, ''),
        logoDataUrl,
        onProgress: (msg, pct) => setGenState({ msg, pct: 35 + Math.round(pct * 0.65) }),
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
      showToast({ type: 'success', title: 'Catalogue généré', message: `${pages} pages` });
    } catch (e: any) {
      showToast({ type: 'error', title: 'Erreur', message: e?.message || 'Échec de la génération' });
    } finally { setGenState(null); }
  };

  if (!isAdmin && !isSuperAdmin) return <div className="text-center py-12 text-muted-foreground">Accès réservé aux administrateurs.</div>;
  if (loading) return <div className="flex items-center justify-center py-24 text-muted-foreground"><Loader className="h-5 w-5 animate-spin mr-2" />Chargement…</div>;

  const famsFiltered = families.filter(f => !famQuery || f.name.toLowerCase().includes(famQuery.toLowerCase()));
  const inCatalogue = products.filter(p => p.catalog_family_id).length;

  return (
    <div className="max-w-6xl mx-auto py-6 px-3">
      <input ref={photoInputRef} type="file" accept="image/*" className="hidden"
        onChange={e => { onPhotoFile(e.target.files?.[0]); e.target.value = ''; }} />

      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10"><BookImage className="h-5 w-5 text-primary" /></div>
          <div>
            <h1 className="text-lg font-bold text-foreground leading-tight">Catalogue PDF</h1>
            <p className="text-xs text-muted-foreground">{inCatalogue} produits · {families.length} familles</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link to="/catalogue-pdf/import" className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-secondary border border-border text-sm">
            <Upload className="h-3.5 w-3.5" /> Import initial
          </Link>
          <button onClick={() => setShowCalc(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm ${showCalc ? 'bg-primary/10 border-primary/30 text-primary' : 'bg-secondary border-border'}`}>
            <Calculator className="h-3.5 w-3.5" /> Calculateur
          </button>
          <select value={template} onChange={e => setTemplate(e.target.value as CatalogueTemplate)}
            className="px-2 py-2 text-sm rounded-lg bg-secondary border border-border" title="Modèle de mise en page">
            <option value="list">Modèle : Liste</option>
            <option value="grid">Modèle : Grille</option>
          </select>
          <select value={variant} onChange={e => setVariant(e.target.value as CatalogueVariant)}
            className="px-2 py-2 text-sm rounded-lg bg-secondary border border-border">
            <option value="ttc">Prix TTC</option>
            <option value="pro">Prix Pro</option>
            <option value="none">Sans prix</option>
          </select>
          <button onClick={generate} disabled={!!genState}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-60">
            {genState ? <Loader className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
            {genFams.size ? `Générer (${genFams.size} fam.)` : 'Générer le PDF'}
          </button>
        </div>
      </div>

      {genState && (
        <div className="mb-4 bg-card border border-border rounded-lg p-3">
          <div className="flex justify-between text-xs mb-1"><span className="text-muted-foreground">{genState.msg}</span><span className="tabular-nums">{genState.pct}%</span></div>
          <div className="h-1.5 bg-secondary rounded-full overflow-hidden"><div className="h-full bg-primary transition-all" style={{ width: `${genState.pct}%` }} /></div>
        </div>
      )}

      {/* Zero-state: catalogue not yet initialized — run the import right here */}
      {families.length === 0 && !loading && (
        <SeedImportBanner onDone={load} />
      )}

      {showCalc && (
        <PriceCalculator
          scope={filtered}
          scopeLabel={famFilter || query || vis !== 'all' ? 'les produits filtrés' : 'tous les produits'}
          onClose={() => setShowCalc(false)}
          onApplied={patches => setProducts(prev => prev.map(p => patches.get(p.barcode) ? { ...p, ...patches.get(p.barcode)! } : p))}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">
        {/* Families sidebar */}
        <div className="bg-card border border-border/60 rounded-lg overflow-hidden self-start">
          <div className="flex items-center justify-between px-3 py-2 bg-secondary/50 border-b border-border/60">
            <span className="text-sm font-semibold">Familles</span>
            <button onClick={addFamily} className="p-1 rounded hover:bg-secondary" title="Ajouter"><Plus className="h-3.5 w-3.5" /></button>
          </div>
          <div className="p-2 border-b border-border/40">
            <input value={famQuery} onChange={e => setFamQuery(e.target.value)} placeholder="Filtrer…"
              className="w-full px-2 py-1.5 text-xs rounded bg-secondary border border-border" />
          </div>
          <div className="max-h-[480px] overflow-y-auto">
            <button onClick={() => setFamFilter('')}
              className={`w-full text-left px-3 py-1.5 text-xs ${!famFilter ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-secondary/40'}`}>
              Toutes les familles
            </button>
            {famsFiltered.map(f => (
              <div key={f.id} className={`group flex items-center gap-1 px-1.5 ${famFilter === f.id ? 'bg-primary/10' : 'hover:bg-secondary/40'}`}>
                <input type="checkbox" checked={genFams.has(f.id)} title="Inclure dans le PDF (aucune coche = tout)"
                  onChange={e => setGenFams(prev => { const n = new Set(prev); e.target.checked ? n.add(f.id) : n.delete(f.id); return n; })}
                  className="accent-[hsl(var(--primary))] shrink-0" />
                <button onClick={() => setFamFilter(famFilter === f.id ? '' : f.id)}
                  className={`flex-1 min-w-0 text-left py-1.5 text-xs truncate ${famFilter === f.id ? 'text-primary font-medium' : ''}`}
                  title={f.name}>
                  {f.name} <span className="text-muted-foreground">({countByFam.get(f.id) || 0})</span>
                </button>
                <div className="hidden group-hover:flex items-center shrink-0">
                  <button onClick={() => moveFamily(f, -1)} disabled={busy} className="p-0.5 hover:bg-secondary rounded"><ChevronUp className="h-3 w-3" /></button>
                  <button onClick={() => moveFamily(f, 1)} disabled={busy} className="p-0.5 hover:bg-secondary rounded"><ChevronDown className="h-3 w-3" /></button>
                  <button onClick={() => renameFamily(f)} className="p-0.5 hover:bg-secondary rounded"><Pencil className="h-3 w-3" /></button>
                  <button onClick={() => deleteFamily(f)} className="p-0.5 hover:bg-secondary rounded text-destructive"><Trash2 className="h-3 w-3" /></button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Products */}
        <div>
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
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
            <span className="text-xs text-muted-foreground">{filtered.length} résultat(s)</span>
          </div>

          <div className="bg-card border border-border/60 rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-secondary/50 text-xs text-muted-foreground border-b border-border/60">
                    <th className="text-left font-medium px-3 py-2 w-14">Photo</th>
                    <th className="text-left font-medium px-3 py-2">Réf. / Désignation</th>
                    <th className="text-left font-medium px-3 py-2 w-56">Famille</th>
                    <th className="text-right font-medium px-3 py-2 w-24">Prix TTC</th>
                    <th className="text-center font-medium px-3 py-2 w-16">PDF</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map(p => (
                    <tr key={p.barcode} className={`border-b border-border/40 ${p.catalog_hidden ? 'opacity-50' : ''}`}>
                      <td className="px-3 py-1.5">
                        <button onClick={() => onPickPhoto(p.barcode)} title="Changer la photo"
                          className="w-10 h-10 rounded border border-border bg-secondary/40 flex items-center justify-center overflow-hidden">
                          {p.catalog_image
                            ? <img src={CatalogService.publicImageUrl(p.catalog_image)} alt="" className="w-full h-full object-contain" loading="lazy" />
                            : <ImageOff className="h-4 w-4 text-muted-foreground/50" />}
                        </button>
                      </td>
                      <td className="px-3 py-1.5">
                        <div className="font-mono text-xs text-primary">{p.barcode}</div>
                        <div className="text-xs text-foreground truncate max-w-[320px]" title={p.name}>{p.name}</div>
                      </td>
                      <td className="px-3 py-1.5">
                        <select value={p.catalog_family_id || ''} onChange={e => setFamily(p, e.target.value)}
                          className="w-full px-1.5 py-1 text-xs rounded bg-secondary border border-border">
                          <option value="">— hors catalogue —</option>
                          {families.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{fmt(p.price)}</td>
                      <td className="px-3 py-1.5 text-center">
                        <button onClick={() => toggleHidden(p)} title={p.catalog_hidden ? 'Réafficher dans le PDF' : 'Masquer du PDF'}
                          className="p-1.5 rounded hover:bg-secondary">
                          {p.catalog_hidden ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {pageItems.length === 0 && <tr><td colSpan={5} className="px-3 py-10 text-center text-muted-foreground text-sm">Aucun produit — lancez l'« Import initial » si le catalogue est vide.</td></tr>}
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
