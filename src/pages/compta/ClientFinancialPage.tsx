import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Calculator, Search, Download, Plus, Trash2, FileDown, Loader } from 'lucide-react';
import { SupabaseDocumentsService, ClientFinancialRow } from '../../utils/supabaseDocuments';
import { SupabaseClientsService } from '../../utils/supabaseClients';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../hooks/useAuth';
import { exportToCSV } from '../../utils/csvExport';
import { ClientFormModal } from '../../components/ClientFormModal';
import { PdfExportService } from '../../utils/pdfExport';
import { CompanySettingsService } from '../../utils/companySettings';

function fmt(n: number) {
  return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2 }).format(n);
}

export default function ClientFinancialPage() {
  const { isSuperAdmin, isCompta, companyId } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [rows, setRows] = useState<ClientFinancialRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showClientForm, setShowClientForm] = useState(false);
  const [exportingPdf, setExportingPdf] = useState<string | null>(null);

  const handleExportClientPdf = async (row: ClientFinancialRow, e: React.MouseEvent) => {
    e.stopPropagation();
    const key = row.clientId || row.clientName;
    setExportingPdf(key);
    try {
      const identifier = row.phoneNumber || row.clientName;
      const invoices = await SupabaseDocumentsService.getInvoicesForClient(identifier);
      const settings = await CompanySettingsService.getSettings(companyId || undefined).catch(() => null);
      await PdfExportService.exportClientFinancialPdf(row.clientName, invoices, settings?.tva_rate ?? 20, settings || undefined);
    } catch (e: any) {
      showToast({ type: 'error', message: e.message || 'Erreur export PDF' });
    } finally {
      setExportingPdf(null);
    }
  };

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await SupabaseDocumentsService.getClientFinancialSummary();
      setRows(data);

      // Silently generate client codes for registered clients that don't have one yet
      const missing = data.filter(r => r.clientId && !r.clientCode);
      if (missing.length > 0) {
        await Promise.all(
          missing.map(r =>
            SupabaseClientsService.assignClientCode(
              r.clientId!,
              (r.fullName?.[0] || 'X').toUpperCase()
            )
          )
        );
        // Reload to show the newly generated codes
        const fresh = await SupabaseDocumentsService.getClientFinancialSummary();
        setRows(fresh);
      }
    } catch (e) {
      showToast({ type: 'error', title: 'Erreur', message: String(e) });
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = useCallback(async (row: ClientFinancialRow, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!row.clientId) {
      showToast({ type: 'error', message: 'Client non enregistré — suppression impossible.' });
      return;
    }
    const phone = row.phoneNumber?.trim() || '';
    let counts = { invoiceCount: 0, blCount: 0, proformaCount: 0, quoteCount: 0, avoirCount: 0 };
    try {
      counts = await SupabaseDocumentsService.getClientDocumentCounts(phone);
    } catch { /* non-fatal */ }

    const hardLinked = counts.invoiceCount + counts.blCount + counts.proformaCount + counts.avoirCount;

    if (hardLinked > 0) {
      const parts = [
        counts.invoiceCount > 0 && `${counts.invoiceCount} facture(s)`,
        counts.blCount > 0 && `${counts.blCount} BL(s)`,
        counts.proformaCount > 0 && `${counts.proformaCount} proforma(s)`,
        counts.avoirCount > 0 && `${counts.avoirCount} avoir(s)`,
      ].filter(Boolean).join(', ');
      showToast({ type: 'error', title: 'Suppression impossible', message: `Ce client a ${parts}. Supprimez ces documents d'abord.` });
      return;
    }

    if (counts.quoteCount > 0) {
      if (!window.confirm(`Ce client a ${counts.quoteCount} devis. Supprimer le client et tous ses devis ?`)) return;
      try {
        if (phone) await SupabaseDocumentsService.deleteClientQuotesByPhone(phone);
      } catch (err: any) {
        showToast({ type: 'error', message: `Erreur suppression devis: ${err?.message}` });
        return;
      }
    } else {
      if (!window.confirm(`Supprimer le client ${row.clientName} ?`)) return;
    }

    try {
      await SupabaseClientsService.deleteClient(row.clientId);
      showToast({ type: 'success', message: 'Client supprimé' });
      load();
    } catch (err: any) {
      showToast({ type: 'error', message: err?.message || 'Erreur lors de la suppression' });
    }
  }, [showToast, load]);

  const filtered = rows.filter(r =>
    !search ||
    r.clientName.toLowerCase().includes(search.toLowerCase()) ||
    (r.clientCode || '').toLowerCase().includes(search.toLowerCase()) ||
    (r.phoneNumber || '').includes(search)
  );

  const totalRemaining = filtered.reduce((s, r) => s + r.remaining, 0);
  const totalBilled    = filtered.reduce((s, r) => s + r.totalAmount, 0);

  if (!isSuperAdmin && !isCompta) {
    return <div className="text-center py-12 text-muted-foreground">Accès réservé au rôle Comptabilité.</div>;
  }

  return (
    <div className="space-y-4">
      <div className="glass rounded-xl shadow-lg p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-violet-600 rounded-lg">
              <Calculator className="h-4 w-4 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground">Clients (financier)</h1>
              <p className="text-xs text-muted-foreground">
                {filtered.length} client{filtered.length !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowClientForm(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
            >
              <Plus className="h-3.5 w-3.5" /><span>Nouveau client</span>
            </button>
            <button
              onClick={() => {
                const exportRows = filtered.map(r => ({
                  'Code Client':   r.clientCode || '',
                  'Client':        r.fullName || r.clientName,
                  'Téléphone':     r.phoneNumber || '',
                  'Total Facturé': r.totalAmount,
                  'Payé':          r.paidAmount,
                  'Reste':         r.remaining,
                  'N° Proformas':  r.proformaCount,
                  'N° Factures':   r.invoiceCount,
                }));
                exportToCSV(exportRows, `clients-financier-${new Date().toISOString().slice(0, 10)}`);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-accent text-foreground"
            >
              <Download className="h-3.5 w-3.5" /><span>CSV</span>
            </button>
          </div>
        </div>

        <div className="relative mb-4">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Rechercher par nom, code ou téléphone..."
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-input rounded-lg bg-secondary text-foreground"
          />
        </div>

        {/* Summary */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-secondary rounded-lg p-3 text-center">
            <div className="text-base font-bold text-emerald-600 dark:text-emerald-400 finance-amount">
              {fmt(totalBilled)} Dh
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">Total Facturé</div>
          </div>
          <div className="bg-secondary rounded-lg p-3 text-center">
            <div className="text-base font-bold text-destructive finance-amount">
              {fmt(totalRemaining)} Dh
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">Reste à Payer</div>
          </div>
        </div>
      </div>

      <div className="glass rounded-xl shadow-lg overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Aucun client trouvé</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-secondary">
                <tr>
                  {['Code', 'Client', 'Tel', 'Total', 'Payé', 'Reste', 'Pro.', 'Fact.', ''].map(h => (
                    <th key={h} className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((row, idx) => (
                  <tr
                    key={row.clientId || `${row.clientName}-${idx}`}
                    className="hover:bg-accent/50 cursor-pointer"
                    onClick={() => navigate(`/compta/proformas?client=${encodeURIComponent(row.clientName)}`)}
                  >
                    {/* Code Client */}
                    <td className="px-3 py-2.5">
                      {row.clientCode ? (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-primary/10 text-primary">
                          {row.clientCode}
                        </span>
                      ) : row.clientId ? (
                        <span className="text-[10px] text-muted-foreground/50 italic">—</span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground/30">n/a</span>
                      )}
                    </td>

                    <td className="px-3 py-2.5">
                      <span className="text-xs font-medium text-foreground">{row.clientName}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="text-[10px] text-muted-foreground">{row.phoneNumber || '—'}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="text-xs font-mono text-foreground finance-amount">{fmt(row.totalAmount)} Dh</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="text-xs font-mono text-emerald-600 dark:text-emerald-400 finance-amount">{fmt(row.paidAmount)} Dh</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`text-xs font-mono font-bold finance-amount ${row.remaining > 0 ? 'text-destructive' : 'text-emerald-600 dark:text-emerald-400'}`}>
                        {fmt(row.remaining)} Dh
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 font-semibold">
                        {row.proformaCount}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-semibold">
                        {row.invoiceCount}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={(e) => handleExportClientPdf(row, e)}
                          disabled={exportingPdf === (row.clientId || row.clientName)}
                          className="p-1 text-muted-foreground hover:text-foreground hover:bg-accent rounded transition-colors"
                          title="Exporter situation PDF"
                        >
                          {exportingPdf === (row.clientId || row.clientName)
                            ? <Loader className="h-3.5 w-3.5 animate-spin" />
                            : <FileDown className="h-3.5 w-3.5" />}
                        </button>
                        {row.clientId && (isSuperAdmin || isCompta) && (
                          <button
                            onClick={(e) => handleDelete(row, e)}
                            className="p-1 text-destructive hover:bg-destructive/10 rounded transition-colors"
                            title="Supprimer le client"
                          >
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

      {showClientForm && (
        <ClientFormModal
          onSave={() => { setShowClientForm(false); load(); }}
          onClose={() => setShowClientForm(false)}
        />
      )}
    </div>
  );
}
