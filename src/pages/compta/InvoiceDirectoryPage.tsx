import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Receipt, Search, Download, Trash2, ChevronUp, ChevronDown, Filter, X } from 'lucide-react';
import { Quote } from '../../types';
import { SupabaseDocumentsService } from '../../utils/supabaseDocuments';
import { SupabaseCompaniesService } from '../../utils/supabaseCompanies';
import { PdfExportService } from '../../utils/pdfExport';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../hooks/useAuth';
import { exportToCSV } from '../../utils/csvExport';

function fmt(n: number) {
  return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2 }).format(n);
}

type SortField = 'quoteNumber' | 'customer' | 'date' | 'total';
type SortDir = 'asc' | 'desc';

const PAYMENT_METHODS = ['Tous', 'Virement', 'Chèque', 'Espèces', 'Carte', 'Effet', 'Versement'];

export default function InvoiceDirectoryPage() {
  const { isSuperAdmin, isCompta } = useAuth();
  const { showToast } = useToast();
  const [invoices, setInvoices] = useState<Quote[]>([]);
  const [companies, setCompanies] = useState<Record<string, string>>({});
  const [companyList, setCompanyList] = useState<{ id: string; name: string }[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [filterPayment, setFilterPayment] = useState('Tous');
  const [filterCompany, setFilterCompany] = useState('');

  // Sort
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [data, allCompanies] = await Promise.all([
        SupabaseDocumentsService.getAllByType('invoice'),
        SupabaseCompaniesService.getAllCompanies(),
      ]);
      setInvoices(data);
      const map: Record<string, string> = {};
      allCompanies.forEach(c => { map[c.id] = c.name; });
      setCompanies(map);
      setCompanyList(allCompanies.map(c => ({ id: c.id, name: c.name })));
    } catch (e) {
      showToast({ type: 'error', title: 'Erreur', message: String(e) });
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id: string, num: string) => {
    if (!window.confirm(`Supprimer la facture ${num} ? Action irréversible.`)) return;
    try {
      await SupabaseDocumentsService.deleteDocument(id);
      showToast({ type: 'success', message: `${num} supprimée` });
      await load();
    } catch (e) {
      showToast({ type: 'error', title: 'Erreur', message: String(e) });
    }
  };

  const handleExportPdf = async (invoice: Quote) => {
    try {
      const compId = invoice.issuing_company_id || invoice.company_id;
      const company = compId ? await SupabaseCompaniesService.getCompanyById(compId) : null;
      const settings = company ? {
        company_name: company.name, address: company.address, phone: company.phone,
        phone2: company.phone2, email: company.email, ice: company.ice, rc: company.rc,
        if_number: company.if_number, cnss: company.cnss, patente: company.patente,
        logo_url: company.logo_url, logo_size: company.logo_size,
        tva_rate: company.tva_rate, quote_validity_days: company.quote_validity_days,
        payment_terms: company.payment_terms, quote_visible_fields: company.quote_visible_fields,
        quote_style: { accentColor: company.accent_color, fontFamily: company.font_family, showBorders: true, borderRadius: 1, headerSize: 'large', totalsStyle: 'highlighted' },
      } as any : null;
      await PdfExportService.exportQuoteToPdf(invoice, settings, undefined, undefined, undefined, 'invoice');
    } catch (e) {
      showToast({ type: 'error', title: 'Erreur PDF', message: String(e) });
    }
  };

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ChevronDown className="h-3 w-3 opacity-30 inline ml-0.5" />;
    return sortDir === 'asc'
      ? <ChevronUp className="h-3 w-3 inline ml-0.5 text-primary" />
      : <ChevronDown className="h-3 w-3 inline ml-0.5 text-primary" />;
  };

  const filtered = useMemo(() => {
    let list = invoices.filter(inv => {
      const q = search.toLowerCase();
      if (q && !inv.quoteNumber.toLowerCase().includes(q)
        && !inv.customer?.fullName?.toLowerCase().includes(q)
        && !(inv.customer as any)?.client_code?.toLowerCase().includes(q)
        && !inv.customer?.phoneNumber?.toLowerCase().includes(q)) return false;

      if (dateFrom && new Date(inv.createdAt) < new Date(dateFrom)) return false;
      if (dateTo && new Date(inv.createdAt) > new Date(dateTo + 'T23:59:59')) return false;

      if (filterPayment !== 'Tous' && inv.payment_method?.toLowerCase() !== filterPayment.toLowerCase()) return false;

      if (filterCompany && inv.issuing_company_id !== filterCompany) return false;

      return true;
    });

    list.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'quoteNumber') cmp = a.quoteNumber.localeCompare(b.quoteNumber);
      else if (sortField === 'customer') cmp = (a.customer?.fullName || '').localeCompare(b.customer?.fullName || '');
      else if (sortField === 'date') cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      else if (sortField === 'total') cmp = a.totalAmount - b.totalAmount;
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return list;
  }, [invoices, search, dateFrom, dateTo, filterPayment, filterCompany, sortField, sortDir]);

  const handleExportCSV = () => {
    const rows = filtered.map(inv => ({
      'N° Facture': inv.quoteNumber,
      'Client': inv.customer?.fullName || '',
      'Téléphone': inv.customer?.phoneNumber || '',
      'Ville': inv.customer?.city || '',
      'Société Émettrice': (inv.issuing_company_id && companies[inv.issuing_company_id]) || '',
      'Total TTC': inv.totalAmount,
      'Mode Paiement': inv.payment_method || '',
      'Référence Paiement': inv.payment_reference || '',
      'Date': new Date(inv.createdAt).toLocaleDateString('fr-FR'),
    }));
    exportToCSV(rows, `factures-${new Date().toISOString().slice(0, 10)}`);
  };

  const hasFilters = search || dateFrom || dateTo || filterPayment !== 'Tous' || filterCompany;
  const clearFilters = () => { setSearch(''); setDateFrom(''); setDateTo(''); setFilterPayment('Tous'); setFilterCompany(''); };

  if (!isSuperAdmin && !isCompta) {
    return <div className="text-center py-12 text-muted-foreground">Accès réservé au rôle Comptabilité.</div>;
  }

  return (
    <div className="space-y-4">
      <div className="glass rounded-xl shadow-lg p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-blue-600 rounded-lg">
              <Receipt className="h-4 w-4 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground">Factures</h1>
              <p className="text-xs text-muted-foreground">{filtered.length} / {invoices.length} facture{invoices.length !== 1 ? 's' : ''}</p>
            </div>
          </div>
          <button onClick={handleExportCSV} className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-accent text-foreground">
            <Download className="h-3.5 w-3.5" /><span>CSV</span>
          </button>
        </div>

        {/* Filters */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="text" value={search} onChange={e => setSearch(e.target.value)}
                placeholder="N° facture, client, téléphone..."
                className="w-full pl-8 pr-3 py-1.5 text-sm border border-input rounded-lg bg-secondary text-foreground"
              />
            </div>
            {hasFilters && (
              <button onClick={clearFilters} className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg" title="Effacer les filtres">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <input
              type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="px-2 py-1.5 text-xs border border-input rounded-lg bg-secondary text-foreground"
              title="Date de début"
            />
            <input
              type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="px-2 py-1.5 text-xs border border-input rounded-lg bg-secondary text-foreground"
              title="Date de fin"
            />
            <select
              value={filterPayment} onChange={e => setFilterPayment(e.target.value)}
              className="px-2 py-1.5 text-xs border border-input rounded-lg bg-secondary text-foreground"
            >
              {PAYMENT_METHODS.map(m => <option key={m}>{m}</option>)}
            </select>
            <select
              value={filterCompany} onChange={e => setFilterCompany(e.target.value)}
              className="px-2 py-1.5 text-xs border border-input rounded-lg bg-secondary text-foreground"
            >
              <option value="">Toutes les sociétés</option>
              {companyList.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="glass rounded-xl shadow-lg overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Aucune facture trouvée</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-secondary">
                <tr>
                  <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase cursor-pointer hover:text-foreground" onClick={() => toggleSort('quoteNumber')}>
                    N° Facture <SortIcon field="quoteNumber" />
                  </th>
                  <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase cursor-pointer hover:text-foreground" onClick={() => toggleSort('customer')}>
                    Client <SortIcon field="customer" />
                  </th>
                  <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase">Proforma</th>
                  <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase">Société</th>
                  <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase cursor-pointer hover:text-foreground" onClick={() => toggleSort('total')}>
                    Total TTC <SortIcon field="total" />
                  </th>
                  <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase cursor-pointer hover:text-foreground" onClick={() => toggleSort('date')}>
                    Date <SortIcon field="date" />
                  </th>
                  <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map(inv => (
                  <tr key={inv.id} className="hover:bg-accent/50">
                    <td className="px-3 py-2.5">
                      <Link to={`/compta/invoices/${inv.id}`} className="text-xs font-mono font-semibold text-primary hover:underline">{inv.quoteNumber}</Link>
                      {inv.is_locked && <span className="ml-1 text-[9px] text-amber-400">🔒</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="text-xs font-medium text-foreground">{inv.customer?.fullName || '—'}</div>
                      {inv.customer?.phoneNumber && <div className="text-[10px] text-muted-foreground">{inv.customer.phoneNumber}</div>}
                    </td>
                    <td className="px-3 py-2.5">
                      {inv.parent_document_id ? (
                        <Link to={`/compta/proformas/${inv.parent_document_id}`} className="text-xs text-primary hover:underline font-mono">
                          Voir Proforma
                        </Link>
                      ) : <span className="text-[10px] text-muted-foreground">—</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="text-xs text-muted-foreground">
                        {(inv.issuing_company_id && companies[inv.issuing_company_id]) || '—'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="text-xs font-mono font-bold text-foreground">{fmt(inv.totalAmount)} Dh</span>
                      {inv.payment_method && <div className="text-[9px] text-muted-foreground">{inv.payment_method}</div>}
                    </td>
                    <td className="px-3 py-2.5 text-[10px] text-muted-foreground">
                      {new Date(inv.createdAt).toLocaleDateString('fr-FR')}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center space-x-1">
                        <button onClick={() => handleExportPdf(inv)} className="p-1 text-blue-500 hover:bg-blue-500/10 rounded" title="Export PDF">
                          <Download className="h-3.5 w-3.5" />
                        </button>
                        {isSuperAdmin && (
                          <button onClick={() => handleDelete(inv.id, inv.quoteNumber)} className="p-1 text-destructive hover:bg-destructive/10 rounded" title="Supprimer">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
