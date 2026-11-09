import {
  ShoppingBag, FileText, Boxes, Calculator, Wallet, ListTodo, Megaphone, Settings,
  type LucideIcon,
} from 'lucide-react';

/**
 * What the signed-in user may open, in one place. The routes (App.tsx), the
 * sidebar, the phone tab bar, the search and the home page all read this, so
 * a link is never shown for a page the user cannot open, and the reverse.
 */
export interface Access {
  /** Catalogue pages (products, clients, sheets, photos). Everyone but field staff. */
  catalogue: boolean;
  quotes: boolean;
  kioskRequests: boolean;
  /** Billing documents: invoices, BL, proformas, credit notes, returns. */
  billing: boolean;
  accounting: boolean;
  stock: boolean;
  payroll: boolean;
  tasks: boolean;
  /** Field staff (technicians, drivers): tasks only. */
  tasksOnly: boolean;
  /** Tasks role that sees only the tasks assigned to them. */
  ownTasksOnly: boolean;
  tasksDashboard: boolean;
  marketing: boolean;
  tools: boolean;
  statistics: boolean;
  superAdmin: boolean;
  /** Sales staff follow up their own quotes; managers and admins see all. */
  ownQuotesOnly: boolean;
}

export interface AccessFlags {
  canCreateQuote: boolean;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  isFacturation: boolean;
  isCompta: boolean;
  isManager: boolean;
  isSeniorSales: boolean;
  isJuniorSales: boolean;
  isPaie: boolean;
  isStock: boolean;
  isTasks: boolean;
  isTasksOnly: boolean;
  tasksRole: string | null;
}

export function computeAccess(f: AccessFlags): Access {
  const main = !f.isTasksOnly;
  const admin = f.isAdmin || f.isSuperAdmin;
  return {
    catalogue: main,
    quotes: main && f.canCreateQuote,
    kioskRequests: main && (f.canCreateQuote || admin || f.isFacturation || f.isManager),
    billing: main && (f.isFacturation || f.isSuperAdmin),
    accounting: main && (f.isSuperAdmin || f.isAdmin || f.isCompta),
    stock: main && (f.isStock || f.isSuperAdmin),
    payroll: main && (f.isPaie || f.isSuperAdmin),
    tasks: f.isTasks || f.isSuperAdmin,
    tasksOnly: f.isTasksOnly,
    ownTasksOnly: f.tasksRole === 'technician' || f.tasksRole === 'driver',
    tasksDashboard: f.isSuperAdmin || f.tasksRole === 'super_admin',
    marketing: main && admin,
    tools: main && admin,
    statistics: main && admin,
    superAdmin: main && f.isSuperAdmin,
    ownQuotesOnly: (f.isJuniorSales || f.isSeniorSales) && !admin && !f.isManager,
  };
}

export interface NavItem { to: string; label: string; }
export interface NavModule {
  id: string;
  label: string;
  icon: LucideIcon;
  items: NavItem[];
  /** Other paths that belong to the module (detail pages, sub-pages). */
  prefixes: string[];
}

export function buildModules(a: Access): NavModule[] {
  const modules: NavModule[] = [];
  if (a.catalogue) {
    modules.push({
      id: 'ventes', label: 'Ventes', icon: ShoppingBag,
      prefixes: ['/quote-cart', '/quotes-history', '/clients', '/products', '/product/', '/catalogue', '/sheets', '/photos', '/search', '/kiosk-admin'],
      items: [
        ...(a.quotes ? [{ to: '/quotes-history', label: 'Devis' }, { to: '/quote-cart', label: 'Nouveau devis' }] : []),
        { to: '/clients', label: 'Clients' },
        { to: '/products', label: 'Produits' },
        { to: '/catalogue', label: 'Catalogue' },
        { to: '/sheets', label: 'Fiches techniques' },
        { to: '/photos', label: 'Galerie photos' },
        ...(a.kioskRequests ? [{ to: '/kiosk-admin', label: 'Demandes kiosque' }] : []),
      ],
    });
  }
  if (a.billing) {
    modules.push({
      id: 'documents', label: 'Documents', icon: FileText, prefixes: ['/compta/'],
      items: [
        { to: '/compta/invoices', label: 'Factures' },
        { to: '/compta/bls', label: 'Bons de livraison' },
        { to: '/compta/proformas', label: 'Proformas' },
        { to: '/compta/avoirs', label: 'Avoirs' },
        { to: '/compta/bons-commande', label: 'Bons de commande' },
        { to: '/compta/returns', label: 'Retours' },
        { to: '/compta/clients', label: 'Clients (financier)' },
      ],
    });
  }
  if (a.stock) {
    modules.push({
      id: 'stock', label: 'Stock', icon: Boxes, prefixes: ['/inventaire'],
      items: [
        { to: '/inventaire', label: 'Tableau de bord' },
        { to: '/inventaire/niveaux', label: 'Niveaux de stock' },
        { to: '/inventaire/mouvements', label: 'Mouvements' },
        { to: '/inventaire/reception', label: 'Réception' },
        { to: '/inventaire/transfert', label: 'Transfert' },
        { to: '/inventaire/inventaire', label: 'Inventaire physique' },
        { to: '/inventaire/commandes', label: 'Commandes fournisseur' },
        { to: '/inventaire/rapports', label: 'Valorisation & rapports' },
      ],
    });
  }
  if (a.accounting) {
    modules.push({
      id: 'comptabilite', label: 'Comptabilité', icon: Calculator, prefixes: ['/comptabilite'],
      items: [
        { to: '/comptabilite', label: 'Tableau de bord' },
        { to: '/comptabilite/a-comptabiliser', label: 'À comptabiliser' },
        { to: '/comptabilite/journaux', label: 'Saisie / journaux' },
        { to: '/comptabilite/lettrage', label: 'Lettrage' },
        { to: '/comptabilite/grand-livre', label: 'Grand livre' },
        { to: '/comptabilite/balance', label: 'Balance' },
        { to: '/comptabilite/tva', label: 'Déclaration TVA' },
        { to: '/comptabilite/etats', label: 'États de synthèse' },
        { to: '/comptabilite/banque', label: 'Rapprochement bancaire' },
        { to: '/comptabilite/immobilisations', label: 'Immobilisations' },
        { to: '/comptabilite/cloture', label: 'Clôture d’exercice' },
        { to: '/comptabilite/plan', label: 'Plan comptable' },
      ],
    });
  }
  if (a.payroll) {
    modules.push({
      id: 'paie', label: 'Paie', icon: Wallet, prefixes: ['/paie'],
      items: [
        { to: '/paie/employes', label: 'Employés' },
        { to: '/paie/bulletins', label: 'Bulletins de paie' },
        { to: '/paie/journee', label: 'Journée de paie' },
        { to: '/paie/conges', label: 'Congés' },
        { to: '/paie/avances', label: 'Avances & prêts' },
        { to: '/paie/declarations', label: 'Déclarations & virements' },
        { to: '/paie/stc', label: 'Solde de tout compte' },
        { to: '/paie/attestations', label: 'Attestations' },
        { to: '/paie/simulation', label: 'Simulateur' },
        { to: '/paie/rubriques', label: 'Rubriques' },
        { to: '/paie/parametres', label: 'Paramètres' },
      ],
    });
  }
  if (a.tasks) {
    modules.push({
      id: 'taches', label: 'Tâches', icon: ListTodo, prefixes: ['/tasks'],
      items: [
        ...(a.tasksDashboard ? [{ to: '/tasks/dashboard', label: 'Tableau de bord' }] : []),
        a.ownTasksOnly ? { to: '/tasks/mine', label: 'Mes tâches' } : { to: '/tasks', label: 'Tâches' },
        { to: '/tasks/archive', label: 'Archives' },
        { to: '/tasks/contacts', label: 'Contacts' },
      ],
    });
  }
  if (a.marketing) {
    modules.push({
      id: 'marketing', label: 'Marketing', icon: Megaphone, prefixes: ['/whatsapp'],
      items: [
        { to: '/whatsapp', label: 'WhatsApp' },
        { to: '/whatsapp/contacts', label: 'Contacts WhatsApp' },
        { to: '/whatsapp/studio', label: 'Studio de contenu' },
        { to: '/whatsapp/campaigns', label: 'Campagnes' },
        { to: '/whatsapp/analytics', label: 'Analyse' },
      ],
    });
  }
  const adminItems: NavItem[] = [
    ...(a.statistics ? [{ to: '/admin/statistics', label: 'Statistiques' }] : []),
    ...(a.superAdmin ? [
      { to: '/admin/users', label: 'Utilisateurs' },
      { to: '/companies', label: 'Sociétés' },
      { to: '/admin/settings', label: 'Paramètres' },
      { to: '/admin/import', label: 'Import CSV' },
      { to: '/admin/backup', label: 'Sauvegarde' },
      { to: '/admin/tools', label: 'Outils système' },
    ] : []),
    ...(a.tools ? [{ to: '/tools/converter', label: 'Convertisseur PDF → Excel' }] : []),
  ];
  if (adminItems.length) {
    modules.push({ id: 'admin', label: 'Administration', icon: Settings, prefixes: ['/admin', '/companies', '/tools'], items: adminItems });
  }
  return modules;
}

const matches = (pathname: string, path: string) =>
  path.endsWith('/') ? pathname.startsWith(path) : pathname === path || pathname.startsWith(path + '/');

/** The module the page belongs to, so the sidebar opens it. */
export function moduleForPath(modules: NavModule[], pathname: string): NavModule | undefined {
  return modules.find(m => m.items.some(i => matches(pathname, i.to)) || m.prefixes.some(p => matches(pathname, p)));
}

/** The sidebar item to highlight: the longest matching link of the module. */
export function activeItem(module: NavModule | undefined, pathname: string): string | undefined {
  if (!module) return undefined;
  // An existing quote is opened from the list, not "Nouveau devis".
  if (pathname.startsWith('/quote-cart/')) return module.items.some(i => i.to === '/quotes-history') ? '/quotes-history' : undefined;
  return module.items
    .filter(i => pathname === i.to || pathname.startsWith(i.to + '/'))
    .sort((x, y) => y.to.length - x.to.length)[0]?.to;
}
