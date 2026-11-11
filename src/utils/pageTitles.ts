// Page names for the browser tab (and anything else that needs to say where
// the user is). The longest matching path prefix wins, so a detail page such
// as /compta/invoices/123 reads "Facture".

const TITLES: [string, string][] = [
  ['/', 'Accueil'],
  ['/search', 'Recherche'],
  ['/products', 'Produits'],
  ['/product/', 'Fiche produit'],
  ['/clients', 'Clients'],
  ['/sheets', 'Fiches techniques'],
  ['/photos', 'Galerie photos'],
  ['/photos/finder', 'Recherche d’images'],
  ['/catalogue', 'Catalogue'],
  ['/quote-cart', 'Nouveau devis'],
  ['/quote-cart/', 'Devis'],
  ['/quotes-history', 'Historique des devis'],
  ['/kiosk-admin', 'Demandes kiosque'],
  ['/compta/bons-commande', 'Bons de commande'],
  ['/compta/bons-commande/', 'Bon de commande'],
  ['/compta/bls', 'Bons de livraison'],
  ['/compta/bls/', 'Bon de livraison'],
  ['/compta/proformas', 'Proformas'],
  ['/compta/proformas/', 'Proforma'],
  ['/compta/invoices', 'Factures'],
  ['/compta/invoices/', 'Facture'],
  ['/compta/avoirs', 'Avoirs'],
  ['/compta/avoirs/', 'Avoir'],
  ['/compta/returns', 'Retours'],
  ['/compta/clients', 'Clients (financier)'],
  ['/comptabilite', 'Comptabilité'],
  ['/comptabilite/plan', 'Plan comptable'],
  ['/comptabilite/a-comptabiliser', 'À comptabiliser'],
  ['/comptabilite/journaux', 'Saisie / journaux'],
  ['/comptabilite/lettrage', 'Lettrage'],
  ['/comptabilite/grand-livre', 'Grand livre'],
  ['/comptabilite/balance', 'Balance'],
  ['/comptabilite/tva', 'Déclaration TVA'],
  ['/comptabilite/etats', 'États de synthèse'],
  ['/comptabilite/cloture', 'Clôture d’exercice'],
  ['/comptabilite/banque', 'Rapprochement bancaire'],
  ['/comptabilite/immobilisations', 'Immobilisations'],
  ['/inventaire', 'Inventaire'],
  ['/inventaire/niveaux', 'Niveaux de stock'],
  ['/inventaire/mouvements', 'Mouvements de stock'],
  ['/inventaire/reception', 'Réception'],
  ['/inventaire/transfert', 'Transfert'],
  ['/inventaire/inventaire', 'Inventaire physique'],
  ['/inventaire/rapports', 'Valorisation & rapports'],
  ['/inventaire/commandes', 'Commandes fournisseur'],
  ['/inventaire/commandes/', 'Commande fournisseur'],
  ['/paie/employes', 'Employés'],
  ['/paie/bulletins', 'Bulletins de paie'],
  ['/paie/bulletins/', 'Bulletin de paie'],
  ['/paie/journee', 'Journée de paie'],
  ['/paie/conges', 'Congés'],
  ['/paie/avances', 'Avances & prêts'],
  ['/paie/declarations', 'Déclarations & virements'],
  ['/paie/stc', 'Solde de tout compte'],
  ['/paie/attestations', 'Attestations'],
  ['/paie/simulation', 'Simulateur de paie'],
  ['/paie/rubriques', 'Rubriques de paie'],
  ['/paie/parametres', 'Paramètres de paie'],
  ['/tasks', 'Tâches'],
  ['/tasks/dashboard', 'Tableau de bord des tâches'],
  ['/tasks/mine', 'Mes tâches'],
  ['/tasks/archive', 'Archives des tâches'],
  ['/tasks/contacts', 'Contacts'],
  ['/tools/converter', 'Convertisseur PDF → Excel'],
  ['/whatsapp', 'WhatsApp'],
  ['/whatsapp/contacts', 'Contacts WhatsApp'],
  ['/whatsapp/studio', 'Studio de contenu'],
  ['/whatsapp/campaigns', 'Campagnes WhatsApp'],
  ['/whatsapp/analytics', 'Analyse WhatsApp'],
  ['/admin/statistics', 'Statistiques'],
  ['/admin/settings', 'Paramètres'],
  ['/admin/users', 'Utilisateurs'],
  ['/admin/backup', 'Sauvegarde'],
  ['/admin/tools', 'Outils système'],
  ['/admin/import', 'Import CSV'],
  ['/companies', 'Sociétés'],
];

export function pageTitle(pathname: string): string | null {
  let best: [string, string] | null = null;
  for (const entry of TITLES) {
    const [path] = entry;
    const matches = path === '/'
      ? pathname === '/'
      : path.endsWith('/') ? pathname.startsWith(path) && pathname.length > path.length : pathname === path || pathname.startsWith(path + '/');
    if (matches && (!best || path.length > best[0].length)) best = entry;
  }
  return best ? best[1] : null;
}

export function documentTitle(pathname: string): string {
  const name = pageTitle(pathname);
  return name ? `${name} · Stocky` : 'Stocky';
}

// Pages with nothing to add to a quote: the floating quote cart would only
// cover their content there.
const CART_HIDDEN_PREFIXES = ['/tasks', '/paie', '/comptabilite', '/whatsapp', '/admin', '/companies', '/tools'];
export const cartHiddenOn = (pathname: string) =>
  CART_HIDDEN_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(prefix + '/'));
