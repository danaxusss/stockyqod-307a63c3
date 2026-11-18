import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PackagePlus, PackageMinus, FileStack, Search } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { StatusPill } from '../../components/lists/StatusPill';
import { DocumentCard } from '../../components/lists/DocumentCard';
import { OpsLoading } from './StockOpsUi';
import { opsField, opsPrimaryBtn, opsSecondaryBtn } from './stockOpsStyles';
import { useToast } from '../../context/ToastContext';
import { useAccessibleLocations } from '../../inventory/hooks/useAccessibleLocations';
import { KIND_LABEL, KIND_SHORT, reasonLabel, StockVouchersService, VOUCHER_STATUS, type StockVoucher, type VoucherKind, type VoucherStatus } from '../../utils/stockVouchers';


const th = 'px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground';
const KIND_TONE: Record<VoucherKind, string> = {
  entree: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  sortie: 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
};

export default function StockVouchersPage() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { locations } = useAccessibleLocations();
  const [vouchers, setVouchers] = useState<StockVoucher[]>([]);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<VoucherKind | ''>('');
  const [status, setStatus] = useState<VoucherStatus | ''>('');
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try { setVouchers(await StockVouchersService.list()); }
    catch (e) { showToast({ type: 'error', message: e instanceof Error ? e.message : 'Erreur de chargement' }); }
    finally { setLoading(false); }
  }, [showToast]);
  useEffect(() => { load(); }, [load]);

  const locationName = useCallback((id: string | null) => locations.find(l => l.id === id)?.name || '—', [locations]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return vouchers.filter(v => (!kind || v.kind === kind) && (!status || v.status === status) && (!q
      || (v.number || '').toLowerCase().includes(q)
      || reasonLabel(v.kind, v.reason).toLowerCase().includes(q)
      || (v.note || '').toLowerCase().includes(q)
      || (v.created_by || '').toLowerCase().includes(q)));
  }, [vouchers, kind, status, query]);

  const label = (v: StockVoucher) => v.number || `Brouillon ${KIND_SHORT[v.kind]}`;

  return (
    <div className="mx-auto max-w-[110rem]">
      <PageHeader title="Bons d'entrée et de sortie" subtitle="Entrées et sorties de stock hors achats, ventes et transferts"
        actions={(
          <>
            <button onClick={() => navigate('/inventaire/bons/nouveau?type=sortie')} className={opsSecondaryBtn}>
              <PackageMinus className="h-4 w-4" aria-hidden="true" /> Bon de sortie
            </button>
            <button onClick={() => navigate('/inventaire/bons/nouveau?type=entree')} className={opsPrimaryBtn}>
              <PackagePlus className="h-4 w-4" aria-hidden="true" /> Bon d'entrée
            </button>
          </>
        )}>
        <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_12rem_12rem]">
          <label className="relative">
            <span className="sr-only">Rechercher</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="N°, motif, note, auteur…" className={`${opsField} pl-9`} />
          </label>
          <select value={kind} onChange={e => setKind(e.target.value as VoucherKind | '')} aria-label="Type" className={opsField}>
            <option value="">Entrées et sorties</option>
            <option value="entree">Bons d'entrée</option>
            <option value="sortie">Bons de sortie</option>
          </select>
          <select value={status} onChange={e => setStatus(e.target.value as VoucherStatus | '')} aria-label="Statut" className={opsField}>
            <option value="">Tous les statuts</option>
            <option value="draft">Brouillons</option>
            <option value="validated">Validés</option>
            <option value="cancelled">Annulés</option>
          </select>
        </div>
      </PageHeader>

      {loading ? <OpsLoading /> : (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          {shown.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <FileStack className="mx-auto h-10 w-10 text-muted-foreground" aria-hidden="true" />
              <p className="mt-3 font-medium text-foreground">{vouchers.length ? 'Aucun bon ne correspond' : 'Aucun bon pour le moment'}</p>
              <p className="mt-1 text-sm text-muted-foreground">Un bon d'entrée ajoute du stock, un bon de sortie en retire, une fois validé.</p>
            </div>
          ) : (
            <>
              <ul className="divide-y divide-border md:hidden">
                {shown.map(v => (
                  <DocumentCard key={v.id} to={`/inventaire/bons/${v.id}`}
                    number={label(v)}
                    status={<StatusPill tone={VOUCHER_STATUS[v.status].tone}>{VOUCHER_STATUS[v.status].label}</StatusPill>}
                    title={reasonLabel(v.kind, v.reason)}
                    subtitle={`${KIND_LABEL[v.kind]} · ${locationName(v.location_id)}`}
                    date={new Date(v.voucher_date).toLocaleDateString('fr-FR')} />
                ))}
              </ul>
              <table className="hidden w-full text-sm md:table">
                <thead className="border-b border-border bg-secondary/40">
                  <tr>
                    <th className={`${th} text-left`}>N°</th>
                    <th className={`${th} text-left`}>Type</th>
                    <th className={`${th} text-left`}>Motif</th>
                    <th className={`${th} text-left`}>Emplacement</th>
                    <th className={`${th} text-left`}>Date</th>
                    <th className={`${th} text-left`}>Par</th>
                    <th className={`${th} text-left`}>Statut</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {shown.map(v => (
                    <tr key={v.id} onClick={() => navigate(`/inventaire/bons/${v.id}`)} className="cursor-pointer hover:bg-secondary/60">
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <Link to={`/inventaire/bons/${v.id}`} onClick={e => e.stopPropagation()} className={`font-mono font-semibold hover:underline ${v.number ? 'text-primary' : 'text-muted-foreground'}`}>{label(v)}</Link>
                      </td>
                      <td className="px-3 py-2.5"><span className={`rounded-md px-2 py-0.5 text-xs font-bold ${KIND_TONE[v.kind]}`}>{KIND_SHORT[v.kind]}</span></td>
                      <td className="px-3 py-2.5 font-medium text-foreground">{reasonLabel(v.kind, v.reason)}{v.note && <span className="block max-w-[22rem] truncate text-xs font-normal text-muted-foreground" title={v.note}>{v.note}</span>}</td>
                      <td className="px-3 py-2.5 text-muted-foreground">{locationName(v.location_id)}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">{new Date(v.voucher_date).toLocaleDateString('fr-FR')}</td>
                      <td className="px-3 py-2.5 text-muted-foreground">{v.validated_by || v.created_by || '—'}</td>
                      <td className="px-3 py-2.5"><StatusPill tone={VOUCHER_STATUS[v.status].tone}>{VOUCHER_STATUS[v.status].label}</StatusPill></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
    </div>
  );
}
