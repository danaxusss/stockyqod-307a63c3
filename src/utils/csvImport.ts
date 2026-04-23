import { supabase } from './supabaseClient';
import { getCompanyContext } from './supabaseCompanyFilter';

export type ImportDocType = 'clients' | 'quote' | 'bl' | 'proforma' | 'invoice' | 'avoir' | 'retour';

// ── Template column sets ──────────────────────────────────────────────────────

const DOC_HEADERS = [
  'numero', 'client_code', 'client_nom', 'client_telephone', 'client_ville', 'client_ice',
  'designation', 'quantite', 'prix_unitaire_ht', 'remise_pct', 'notes', 'statut',
];
const INV_HEADERS = [...DOC_HEADERS, 'date_paiement', 'mode_paiement', 'reference_paiement', 'banque'];
const AVOIR_HEADERS = [...DOC_HEADERS, 'raison_avoir'];
const RET_HEADERS = ['numero_reference', 'client_nom', 'raison', 'designation', 'quantite', 'notes', 'statut'];

export const TEMPLATES: Record<ImportDocType, { label: string; headers: string[]; rows: string[][] }> = {
  clients: {
    label: 'Clients',
    headers: ['client_code', 'full_name', 'phone_number', 'address', 'city', 'ice', 'email'],
    rows: [
      ['3421A1', 'Ahmed Benali', '0612345678', '123 Rue Hassan II', 'Casablanca', '001234567000089', 'ahmed@example.com'],
      ['', 'Sara Idrissi', '0661234567', '45 Bd Zerktouni', 'Rabat', '', 'sara@example.com'],
    ],
  },
  quote: {
    label: 'Devis',
    headers: DOC_HEADERS,
    rows: [
      ['DEV-001', '3421A1', 'Ahmed Benali', '0612345678', 'Casablanca', '', 'Produit A', '2', '100.00', '0', 'Livraison rapide', 'draft'],
      ['DEV-001', '', '', '', '', '', 'Produit B', '1', '50.00', '10', '', ''],
      ['DEV-002', '3421B3', 'Sara Idrissi', '0661234567', 'Rabat', '', 'Produit C', '3', '200.00', '0', '', 'final'],
    ],
  },
  bl: {
    label: 'Bon de Livraison',
    headers: DOC_HEADERS,
    rows: [
      ['BL-001', '3421A1', 'Ahmed Benali', '0612345678', 'Casablanca', '', 'Article X', '5', '80.00', '0', '', 'final'],
      ['BL-001', '', '', '', '', '', 'Article Y', '2', '120.00', '0', '', ''],
    ],
  },
  proforma: {
    label: 'Proforma',
    headers: DOC_HEADERS,
    rows: [
      ['PRO-001', '3421C2', 'Karim Alaoui', '0622222222', 'Marrakech', '002345678000012', 'Service A', '1', '500.00', '0', '', 'draft'],
    ],
  },
  invoice: {
    label: 'Facture',
    headers: INV_HEADERS,
    rows: [
      ['FAC-001', '3421A1', 'Ahmed Benali', '0612345678', 'Casablanca', '001234567000089', 'Produit A', '2', '100.00', '0', '', 'final', '2026-04-15', 'Virement', 'REF-001', 'CIH'],
      ['FAC-001', '', '', '', '', '', 'Produit B', '1', '50.00', '0', '', '', '', '', '', ''],
    ],
  },
  avoir: {
    label: 'Avoir',
    headers: AVOIR_HEADERS,
    rows: [
      ['AV-001', '3421A1', 'Ahmed Benali', '0612345678', 'Casablanca', '', 'Retour Produit A', '1', '100.00', '0', '', 'final', 'Produit défectueux'],
    ],
  },
  retour: {
    label: 'Retour',
    headers: RET_HEADERS,
    rows: [
      ['RET-001', 'Ahmed Benali', 'Produit endommagé', 'Produit A', '2', 'Retour sous garantie', 'open'],
      ['RET-001', '', '', 'Accessoire B', '1', '', ''],
    ],
  },
};

// ── CSV helpers ───────────────────────────────────────────────────────────────

function escapeCell(v: string): string {
  if (v.includes(',') || v.includes('"') || v.includes('\n')) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export function buildTemplateCSV(type: ImportDocType): string {
  const t = TEMPLATES[type];
  const bom = '﻿';
  const header = t.headers.join(',');
  const rows = t.rows.map(r => r.map(escapeCell).join(','));
  return bom + [header, ...rows].join('\r\n');
}

export function downloadTemplate(type: ImportDocType) {
  const csv = buildTemplateCSV(type);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `template_${type}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── CSV parser ────────────────────────────────────────────────────────────────

function parseCSV(text: string): string[][] {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const rows: string[][] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const cells: string[] = [];
    let inQuote = false;
    let cur = '';
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
        else inQuote = !inQuote;
      } else if (ch === ',' && !inQuote) {
        cells.push(cur.trim()); cur = '';
      } else {
        cur += ch;
      }
    }
    cells.push(cur.trim());
    rows.push(cells);
  }
  return rows;
}

// ── Parsed row types ──────────────────────────────────────────────────────────

export interface ParsedClient {
  client_code: string;
  full_name: string;
  phone_number: string;
  address: string;
  city: string;
  ice: string;
  email: string;
}

export interface ParsedDocItem {
  designation: string;
  quantity: number;
  unitPrice: number;
  discount: number;
}

export interface ParsedDocument {
  numero: string;
  clientCode: string;
  clientName: string;
  clientPhone: string;
  clientCity: string;
  clientIce: string;
  notes: string;
  status: string;
  items: ParsedDocItem[];
  avoirReason?: string;
  paymentDate?: string;
  paymentMethod?: string;
  paymentReference?: string;
  paymentBank?: string;
}

export interface ParsedReturn {
  referenceNumber: string;
  clientName: string;
  reason: string;
  notes: string;
  status: string;
  items: { label: string; quantity: number }[];
}

export interface ParseResult<T> {
  rows: T[];
  warnings: string[];
}

// ── Parsers ───────────────────────────────────────────────────────────────────

export function parseClientsCSV(text: string): ParseResult<ParsedClient> {
  const clean = text.replace(/^﻿/, '');
  const all = parseCSV(clean);
  if (all.length < 2) return { rows: [], warnings: ['Fichier vide ou entête manquant'] };

  const [header, ...dataRows] = all;
  const idx = (name: string) => header.findIndex(h => h.toLowerCase().trim() === name);

  const iCode     = idx('client_code');
  const iFullName = idx('full_name');
  const iPhone    = idx('phone_number');
  const iAddress  = idx('address');
  const iCity     = idx('city');
  const iIce      = idx('ice');
  const iEmail    = idx('email');

  const warnings: string[] = [];
  const rows: ParsedClient[] = [];

  dataRows.forEach((row, i) => {
    const lineNum = i + 2;
    const fullName = iFullName >= 0 ? row[iFullName] || '' : '';
    if (!fullName) { warnings.push(`Ligne ${lineNum}: full_name vide — ignoré`); return; }
    rows.push({
      client_code:  iCode >= 0 ? row[iCode] || '' : '',
      full_name:    fullName,
      phone_number: iPhone >= 0 ? row[iPhone] || '' : '',
      address:      iAddress >= 0 ? row[iAddress] || '' : '',
      city:         iCity >= 0 ? row[iCity] || '' : '',
      ice:          iIce >= 0 ? row[iIce] || '' : '',
      email:        iEmail >= 0 ? row[iEmail] || '' : '',
    });
  });

  return { rows, warnings };
}

function parseDocumentsCSV(text: string, type: ImportDocType): ParseResult<ParsedDocument> {
  const clean = text.replace(/^﻿/, '');
  const all = parseCSV(clean);
  if (all.length < 2) return { rows: [], warnings: ['Fichier vide ou entête manquant'] };

  const [header, ...dataRows] = all;
  const idx = (name: string) => header.findIndex(h => h.toLowerCase().trim() === name);

  const iNumero      = idx('numero');
  const iClientCode  = idx('client_code');
  const iClientNom   = idx('client_nom');
  const iClientTel   = idx('client_telephone');
  const iClientVille = idx('client_ville');
  const iClientIce   = idx('client_ice');
  const iDesig       = idx('designation');
  const iQty         = idx('quantite');
  const iPrix        = idx('prix_unitaire_ht');
  const iRemise      = idx('remise_pct');
  const iNotes       = idx('notes');
  const iStatut      = idx('statut');
  // avoir
  const iAvoirReason = idx('raison_avoir');
  // invoice
  const iDatePmt  = idx('date_paiement');
  const iModePmt  = idx('mode_paiement');
  const iRefPmt   = idx('reference_paiement');
  const iBanque   = idx('banque');

  const warnings: string[] = [];
  const grouped = new Map<string, ParsedDocument>();

  dataRows.forEach((row, i) => {
    const lineNum = i + 2;
    const numero      = iNumero >= 0 ? row[iNumero] || '' : '';
    const designation = iDesig >= 0 ? row[iDesig] || '' : '';

    if (!numero && !designation) return;
    if (!numero)      { warnings.push(`Ligne ${lineNum}: numero vide — ignoré`); return; }
    if (!designation) { warnings.push(`Ligne ${lineNum}: designation vide — ignoré`); return; }

    const qty   = parseFloat(iQty >= 0 ? row[iQty] || '1' : '1') || 1;
    const prix  = parseFloat(iPrix >= 0 ? row[iPrix] || '0' : '0') || 0;
    const remise = parseFloat(iRemise >= 0 ? row[iRemise] || '0' : '0') || 0;

    if (!grouped.has(numero)) {
      grouped.set(numero, {
        numero,
        clientCode:   iClientCode >= 0 ? row[iClientCode] || '' : '',
        clientName:   iClientNom >= 0 ? row[iClientNom] || '' : '',
        clientPhone:  iClientTel >= 0 ? row[iClientTel] || '' : '',
        clientCity:   iClientVille >= 0 ? row[iClientVille] || '' : '',
        clientIce:    iClientIce >= 0 ? row[iClientIce] || '' : '',
        notes:        iNotes >= 0 ? row[iNotes] || '' : '',
        status:       iStatut >= 0 ? (row[iStatut] || 'draft') : 'draft',
        items:        [],
        avoirReason:  iAvoirReason >= 0 ? row[iAvoirReason] || undefined : undefined,
        paymentDate:  iDatePmt >= 0 ? row[iDatePmt] || undefined : undefined,
        paymentMethod: iModePmt >= 0 ? row[iModePmt] || undefined : undefined,
        paymentReference: iRefPmt >= 0 ? row[iRefPmt] || undefined : undefined,
        paymentBank:  iBanque >= 0 ? row[iBanque] || undefined : undefined,
      });
    } else {
      const doc = grouped.get(numero)!;
      if (!doc.clientName && iClientNom >= 0 && row[iClientNom]) doc.clientName = row[iClientNom];
      if (!doc.clientCode && iClientCode >= 0 && row[iClientCode]) doc.clientCode = row[iClientCode];
    }

    grouped.get(numero)!.items.push({ designation, quantity: qty, unitPrice: prix, discount: remise });
  });

  const rows = Array.from(grouped.values());
  if (rows.length === 0) warnings.push('Aucun document valide trouvé');

  return { rows, warnings };
}

function parseReturnsCSV(text: string): ParseResult<ParsedReturn> {
  const clean = text.replace(/^﻿/, '');
  const all = parseCSV(clean);
  if (all.length < 2) return { rows: [], warnings: ['Fichier vide ou entête manquant'] };

  const [header, ...dataRows] = all;
  const idx = (name: string) => header.findIndex(h => h.toLowerCase().trim() === name);

  const iRef     = idx('numero_reference');
  const iClient  = idx('client_nom');
  const iRaison  = idx('raison');
  const iDesig   = idx('designation');
  const iQty     = idx('quantite');
  const iNotes   = idx('notes');
  const iStatut  = idx('statut');

  const warnings: string[] = [];
  const grouped = new Map<string, ParsedReturn>();

  dataRows.forEach((row, i) => {
    const lineNum = i + 2;
    const ref   = iRef >= 0 ? row[iRef] || '' : '';
    const desig = iDesig >= 0 ? row[iDesig] || '' : '';

    if (!ref && !desig) return;
    if (!ref)   { warnings.push(`Ligne ${lineNum}: numero_reference vide — ignoré`); return; }
    if (!desig) { warnings.push(`Ligne ${lineNum}: designation vide — ignoré`); return; }

    const qty = parseFloat(iQty >= 0 ? row[iQty] || '1' : '1') || 1;

    if (!grouped.has(ref)) {
      grouped.set(ref, {
        referenceNumber: ref,
        clientName: iClient >= 0 ? row[iClient] || '' : '',
        reason:     iRaison >= 0 ? row[iRaison] || '' : '',
        notes:      iNotes >= 0 ? row[iNotes] || '' : '',
        status:     iStatut >= 0 ? (row[iStatut] || 'open') : 'open',
        items:      [],
      });
    }

    grouped.get(ref)!.items.push({ label: desig, quantity: qty });
  });

  const rows = Array.from(grouped.values());
  if (rows.length === 0) warnings.push('Aucun retour valide trouvé');
  return { rows, warnings };
}

export function parseCSVFile(text: string, type: ImportDocType): ParseResult<ParsedClient> | ParseResult<ParsedDocument> | ParseResult<ParsedReturn> {
  if (type === 'clients') return parseClientsCSV(text);
  if (type === 'retour')  return parseReturnsCSV(text);
  return parseDocumentsCSV(text, type);
}

// ── Import logic ──────────────────────────────────────────────────────────────

export interface ImportResult {
  created: number;
  errors: string[];
}

export async function importClients(rows: ParsedClient[]): Promise<ImportResult> {
  const { companyId } = getCompanyContext();
  let created = 0;
  const errors: string[] = [];

  for (const row of rows) {
    try {
      let clientCode: string | null = row.client_code || null;

      // Only auto-generate if no code was provided
      if (!clientCode) {
        const firstLetter = row.full_name.charAt(0).toUpperCase();
        const { data: codeData } = await (supabase.rpc as any)('next_client_code', { p_first_letter: firstLetter });
        if (codeData) clientCode = codeData as string;
      }

      const { error } = await supabase.from('clients').insert({
        full_name:    row.full_name,
        phone_number: row.phone_number,
        address:      row.address,
        city:         row.city,
        ice:          row.ice,
        email:        row.email,
        ...(clientCode ? { client_code: clientCode } : {}),
        ...(companyId ? { company_id: companyId } : {}),
      });

      if (error) errors.push(`${row.full_name}: ${error.message}`);
      else created++;
    } catch (e: any) {
      errors.push(`${row.full_name}: ${e?.message || 'Erreur inconnue'}`);
    }
  }

  return { created, errors };
}

export async function importDocuments(rows: ParsedDocument[], type: ImportDocType, tvaRate = 20): Promise<ImportResult> {
  const { companyId } = getCompanyContext();
  let created = 0;
  const errors: string[] = [];

  const documentType = type; // 'quote' | 'bl' | 'proforma' | 'invoice' | 'avoir'
  const validStatuses = ['draft', 'pending', 'final', 'solde'];

  for (const doc of rows) {
    try {
      const items = doc.items.map((it, idx) => {
        const subtotalHT = it.unitPrice * it.quantity * (1 - it.discount / 100);
        return {
          id: crypto.randomUUID(),
          name: it.designation,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          discount: it.discount,
          subtotal: subtotalHT * (1 + tvaRate / 100),
          displayOrder: idx,
        };
      });

      const totalHT  = items.reduce((s, it) => s + it.unitPrice * it.quantity * (1 - (it.discount ?? 0) / 100), 0);
      const totalTTC = totalHT * (1 + tvaRate / 100);
      const status   = validStatuses.includes(doc.status) ? doc.status : 'draft';

      const payload: Record<string, unknown> = {
        quote_number:  doc.numero,
        document_type: documentType,
        customer_info: {
          fullName:    doc.clientName,
          phoneNumber: doc.clientPhone,
          city:        doc.clientCity,
          ice:         doc.clientIce,
          ...(doc.clientCode ? { clientCode: doc.clientCode } : {}),
        },
        items,
        total_amount: Math.round(totalTTC * 100) / 100,
        notes:        doc.notes || null,
        status,
        ...(companyId ? { company_id: companyId, issuing_company_id: companyId } : {}),
      };

      if (type === 'invoice') {
        if (doc.paymentDate)      payload.payment_date      = doc.paymentDate;
        if (doc.paymentMethod)    payload.payment_method    = doc.paymentMethod;
        if (doc.paymentReference) payload.payment_reference = doc.paymentReference;
        if (doc.paymentBank)      payload.payment_bank      = doc.paymentBank;
      }

      if (type === 'avoir' && doc.avoirReason) {
        payload.notes = doc.avoirReason + (doc.notes ? `\n${doc.notes}` : '');
      }

      const { error } = await supabase.from('quotes').insert(payload);
      if (error) errors.push(`${doc.numero}: ${error.message}`);
      else created++;
    } catch (e: any) {
      errors.push(`${doc.numero}: ${e?.message || 'Erreur inconnue'}`);
    }
  }

  return { created, errors };
}

export async function importReturns(rows: ParsedReturn[]): Promise<ImportResult> {
  const { companyId } = getCompanyContext();
  let created = 0;
  const errors: string[] = [];
  const validStatuses = ['open', 'closed'];

  for (const ret of rows) {
    try {
      const items = ret.items.map(it => ({
        barcode:  '',
        label:    it.label,
        quantity: it.quantity,
      }));

      const status = validStatuses.includes(ret.status) ? ret.status : 'open';

      const { error } = await (supabase.from('returns') as any).insert({
        reference_number: ret.referenceNumber,
        client_name:      ret.clientName,
        reason:           ret.reason,
        items,
        notes:            ret.notes || null,
        status,
        ...(companyId ? { company_id: companyId } : {}),
      });

      if (error) errors.push(`${ret.referenceNumber}: ${error.message}`);
      else created++;
    } catch (e: any) {
      errors.push(`${ret.referenceNumber}: ${e?.message || 'Erreur inconnue'}`);
    }
  }

  return { created, errors };
}
