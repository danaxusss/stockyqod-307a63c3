import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Calculator, Search, Download, Plus } from 'lucide-react';
import { SupabaseDocumentsService, ClientFinancialRow } from '../../utils/supabaseDocuments';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../hooks/useAuth';
import { exportToCSV } from '../../utils/csvExport';
import { ClientFormModal } from '../../components/ClientFormModal';

function fmt(n: number) {
  return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2 }).format(n);
}

export default function ClientFinancialPage() {
  const { isSuperAdmin, isCompta } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [rows, setRows] = useState<ClientFinancialRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showClientForm, setShowClientForm] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await SupabaseDocumentsService.getClientFinancialSummary();
      setRows(data);
    } catch (e) {
      showToast({ type: 'error', title: 'Erreur', message: String(e) });
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  const filtered = rows.filter(r =>
    !search || r.clientName.toLowerCase().includes(search.toLowerCase())
  );

  // Summary stats
  const totalRemaining = filtered.reduce((s, r) => s + r.remaining, 0);
  const totalBilled = filtered.reduce((s, r) => s + r.paidAmount, 0);

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
              <p className="text-xs text-muted-foreground">{filtered.length} client{filtered.length !== 1 ? 's' : ''}</p>
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
              const rows = filtered.map(r => ({
                'Code Client': r.clientCode || '',
                'Client': r.fullName || r.clientName,
                'Téléphone': r.phoneNumber || '',
                'Total Facturé': r.totalAmount,
                'Payé': r.paidAmount,
                'Reste': r.remaining,
                'N° Proformas': r.proformaCount,
                'N° Factures': r.invoiceCount,
              }));
              exportToCSV(rows, `clients-financier-${new Date().toISOString().slice(0, 10)}`);
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
            placeholder="Rechercher un client..."
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-input rounded-lg bg-secondary text-foreground"
          />
        </div>

        {/* Summary */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-secondary rounded-lg p-3 text-center">
            <div className="text-base font-bold text-emerald-600">{fmt(totalBilled)} Dh</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">Total Facturé</div>
          </div>
          <div className="bg-secondary rounded-lg p-3 text-center">
            <div className="text-base font-bold text-destructive">{fmt(totalRemaining)} Dh</div>
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
                  {['Client', 'Tel', 'Total', 'Payé', 'Reste', 'Proformas', 'Factures'].map(h => (
                    <th key={h} className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map(row => (
                  <tr
                    key={row.clientName}
                    className="hover:bg-accent/50 cursor-pointer"
                    onClick={() => navigate(`/compta/proformas?client=${encodeURIComponent(row.clientName)}`)}
                  >
                    <td className="px-3 py-2.5">
                      <span className="text-xs font-medium text-foreground">{row.clientName}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="text-[10px] text-muted-foreground">{row.phoneNumber || '—'}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="text-xs font-mono text-foreground">{fmt(row.totalAmount)} Dh</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="text-xs font-mono text-emerald-600">{fmt(row.paidAmount)} Dh</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`text-xs font-mono font-bold ${row.remaining > 0 ? 'text-destructive' : 'text-emerald-600'}`}>
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
