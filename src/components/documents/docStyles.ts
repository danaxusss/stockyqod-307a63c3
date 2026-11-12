// Shared look of the document detail pages (BL, proforma).
export const docPanel = 'rounded-xl border border-border bg-card shadow-sm';
export const docInputCls = 'w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring';
export const docFieldCls = 'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring';
export const docSideAction = 'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium text-foreground hover:bg-secondary disabled:opacity-50';
export const docTh = 'px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground';

/** Initials shown in the client avatar. */
export const docInitials = (name?: string) => (name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('');

/** The document's date as shown on the page. */
export const docDate = (doc: { quote_date?: string | null; createdAt: Date | string }) =>
  (doc.quote_date ? new Date(doc.quote_date) : new Date(doc.createdAt)).toLocaleDateString('fr-FR');
