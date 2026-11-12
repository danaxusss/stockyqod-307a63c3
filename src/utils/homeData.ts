// What the home page shows: the work waiting for this user, limited to what
// their role may see (see Access in lib/navigation.ts). Each section loads on
// its own; one failing section never hides the others.

import { supabase } from './supabaseClient';
import { getCompanyContext } from './supabaseCompanyFilter';
import type { Access } from '../lib/navigation';
import { ownedQuotesFilter, quoteOwnerOf } from './quoteOwnership';

export type DocType = 'quote' | 'bl' | 'proforma' | 'invoice' | 'avoir' | 'bon_commande';
export type Tone = 'red' | 'amber' | 'blue' | 'green' | 'gray';

export interface HomeDoc {
  id: string;
  number: string;
  type: DocType;
  client: string;
  phone: string;
  total: number;
  paid: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface HomeTask {
  id: string;
  type: 'technical_intervention' | 'delivery';
  status: string;
  client: string;
  address: string;
  details: string;
  priority: string;
  dueDate: string | null;
}

export interface HomeData {
  followUps: HomeDoc[] | null;
  unpaid: HomeDoc[] | null;
  tasks: HomeTask[] | null;
  recent: HomeDoc[] | null;
}

export interface HomeScope {
  access: Access;
  /** Username recorded as the quote's author (created_by). */
  username: string | null;
  /** Seller name shown on quotes (custom seller name, else the username). */
  sellerName?: string | null;
  userId: string | null;
}

// The generated database types lag behind the schema (tasks, document
// fields), so queries here go through one loosely typed handle.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Query = any;
export const looseDb = () => supabase as unknown as { from(table: string): Query };

interface DocRow {
  id: string; quote_number: string; document_type: string | null; status: string | null;
  customer_info: { fullName?: string; phoneNumber?: string } | null;
  total_amount: number | string | null; paid_amount: number | string | null;
  created_at: string; updated_at: string | null;
}
interface TaskRow {
  id: string; type: HomeTask['type']; status: string; client_name: string | null; address: string | null;
  problem_details: string | null; invoice_number: string | null; priority: string | null; due_date: string | null;
}

const DOC_FIELDS = 'id, quote_number, document_type, customer_info, total_amount, paid_amount, status, created_at, updated_at';

const toDoc = (r: DocRow): HomeDoc => ({
  id: r.id,
  number: r.quote_number,
  type: (r.document_type || 'quote') as DocType,
  client: r.customer_info?.fullName || 'Client sans nom',
  phone: r.customer_info?.phoneNumber || '',
  total: Number(r.total_amount) || 0,
  paid: Number(r.paid_amount) || 0,
  status: r.status || 'draft',
  createdAt: r.created_at,
  updatedAt: r.updated_at || r.created_at,
});

function scoped(query: Query): Query {
  const { companyId, bypassFilter } = getCompanyContext();
  return !bypassFilter && companyId ? query.eq('company_id', companyId) : query;
}

async function settle<T>(run: () => Promise<T>): Promise<T | null> {
  try { return await run(); } catch (e) { console.warn('home section failed', e); return null; }
}

async function rows<T>(query: Query): Promise<T[]> {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data || [];
}

/** A salesperson's quotes only: created by them or naming them as seller. */
function ownQuotes({ access, username, sellerName }: HomeScope, q: Query): Query {
  if (!access.ownQuotesOnly) return q;
  const owner = quoteOwnerOf({ username, custom_seller_name: sellerName });
  // Without a username a salesperson sees nothing rather than everyone's quotes.
  return owner ? q.or(ownedQuotesFilter(owner)) : q.eq('id', '00000000-0000-0000-0000-000000000000');
}

/** Quotes sent to the client and still waiting for an answer, oldest first. */
async function loadFollowUps(scope: HomeScope): Promise<HomeDoc[]> {
  // Sales staff follow up their own quotes, as in the quote permissions.
  const q = ownQuotes(scope, scoped(looseDb().from('quotes').select(DOC_FIELDS).or('document_type.eq.quote,document_type.is.null').eq('status', 'pending')));
  return (await rows<DocRow>(q)).map(toDoc).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
}

/** Invoices with money still owed, oldest first. */
async function loadUnpaid(): Promise<HomeDoc[]> {
  const q = scoped(looseDb().from('quotes').select(DOC_FIELDS).eq('document_type', 'invoice'));
  return (await rows<DocRow>(q)).map(toDoc)
    .filter(d => d.total - d.paid > 0.005 && d.status !== 'solde')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

const PRIORITY = ['urgent', 'high', 'medium', 'low'];

/** Open tasks; technicians and drivers only see the ones assigned to them. */
async function loadTasks({ access, userId }: HomeScope): Promise<HomeTask[]> {
  let q = scoped(looseDb().from('tasks').select('*').in('status', ['pending', 'doing']));
  if (access.ownTasksOnly && userId) q = q.eq('assigned_to', userId);
  return (await rows<TaskRow>(q))
    .map((r): HomeTask => ({
      id: r.id, type: r.type, status: r.status, client: r.client_name || '', address: r.address || '',
      details: r.problem_details || r.invoice_number || '', priority: r.priority || 'medium', dueDate: r.due_date || null,
    }))
    .sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || PRIORITY.indexOf(a.priority) - PRIORITY.indexOf(b.priority));
}

/** Latest documents the user may open: quotes, and billing documents for billing staff. */
async function loadRecent(scope: HomeScope): Promise<HomeDoc[]> {
  const { access } = scope;
  let q = scoped(looseDb().from('quotes').select(DOC_FIELDS));
  if (!access.billing) {
    q = ownQuotes(scope, q.or('document_type.eq.quote,document_type.is.null'));
  } else if (!access.quotes) {
    q = q.not('document_type', 'is', null).neq('document_type', 'quote');
  }
  return (await rows<DocRow>(q.order('created_at', { ascending: false }).limit(6))).map(toDoc);
}

export async function loadHomeData(scope: HomeScope): Promise<HomeData> {
  const { access } = scope;
  const [followUps, unpaid, tasks, recent] = await Promise.all([
    access.quotes ? settle(() => loadFollowUps(scope)) : Promise.resolve(null),
    access.billing ? settle(loadUnpaid) : Promise.resolve(null),
    access.tasks ? settle(() => loadTasks(scope)) : Promise.resolve(null),
    access.quotes || access.billing ? settle(() => loadRecent(scope)) : Promise.resolve(null),
  ]);
  return { followUps, unpaid, tasks, recent };
}

export const DOC_LABEL: Record<DocType, string> = {
  quote: 'Devis', invoice: 'Facture', bl: 'BL', proforma: 'Proforma', avoir: 'Avoir', bon_commande: 'BC',
};

/** Page that opens a document. */
export function docPath(doc: Pick<HomeDoc, 'id' | 'type'>): string {
  const id = encodeURIComponent(doc.id);
  switch (doc.type) {
    case 'invoice': return `/compta/invoices/${id}`;
    case 'bl': return `/compta/bls/${id}`;
    case 'proforma': return `/compta/proformas/${id}`;
    case 'avoir': return `/compta/avoirs/${id}`;
    case 'bon_commande': return `/compta/bons-commande/${id}`;
    default: return `/quote-cart/${id}`;
  }
}

/** Status as the lists show it, with its colour. */
export function docStatus(doc: Pick<HomeDoc, 'type' | 'status' | 'total' | 'paid'>): { label: string; tone: Tone } {
  if (doc.type === 'invoice') {
    const left = doc.total - doc.paid;
    if (left <= 0.005 || doc.status === 'solde') return { label: 'Payée', tone: 'green' };
    if (doc.paid > 0) return { label: `Payée ${Math.round((doc.paid / doc.total) * 100)} %`, tone: 'amber' };
    return { label: 'Non payée', tone: 'red' };
  }
  if (doc.type === 'quote') {
    if (doc.status === 'final') return { label: 'Confirmé', tone: 'green' };
    if (doc.status === 'pending') return { label: 'Envoyé', tone: 'blue' };
    return { label: 'En attente', tone: 'amber' };
  }
  if (doc.status === 'final' || doc.status === 'solde') return { label: 'Validé', tone: 'green' };
  if (doc.status === 'pending') return { label: 'En cours', tone: 'blue' };
  return { label: 'Brouillon', tone: 'gray' };
}
