// Classes shared by the stock operation screens (reception, transfert,
// inventaire, bons de commande). Presentation only.
export const opsField = 'h-11 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring';
export const opsPanel = 'rounded-xl border border-border bg-card shadow-sm';
export const opsLabel = 'mb-1.5 block text-xs font-semibold text-muted-foreground';
export const opsPrimaryBtn = 'flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50';
export const opsSecondaryBtn = 'flex h-11 items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-semibold text-foreground hover:bg-secondary disabled:opacity-50';
/** Phone bar above the tab bar, like the quote editor's. */
export const opsPhoneBar = 'fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-20 border-t border-border bg-card px-4 py-2.5 shadow-[0_-4px_16px_rgba(17,24,39,0.06)] md:hidden';
