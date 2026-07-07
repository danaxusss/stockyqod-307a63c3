// Plan Comptable Marocain (CGNC) — commonly-used subset for the accounting
// module. Seeded per company on "Initialiser le plan comptable".

export type AccountType = 'bilan_actif' | 'bilan_passif' | 'charge' | 'produit' | 'tresorerie';

export interface SeedAccount {
  code: string;
  label: string;
  class: number;
  type: AccountType;
  vat_rate?: number;
  lettrable?: boolean;
  aux_kind?: 'client' | 'fournisseur';
}

// type derived from the leading digit (Moroccan PCM structure)
function t(code: string): AccountType {
  const c = code[0];
  if (c === '1') return 'bilan_passif';
  if (c === '2' || c === '3') return 'bilan_actif';
  if (c === '4') return 'bilan_passif';
  if (c === '5') return 'tresorerie';
  if (c === '6') return 'charge';
  return 'produit';
}

const RAW: [string, string, (Partial<SeedAccount>)?][] = [
  // Classe 1 — Financement permanent
  ['1111', 'Capital social', {}],
  ['1140', 'Réserve légale', {}],
  ['1161', 'Report à nouveau (SC)', {}],
  ['1181', 'Résultat net en instance d\'affectation', {}],
  ['1191', 'Résultat net de l\'exercice (SC)', {}],
  ['1481', 'Emprunts auprès des établissements de crédit', {}],
  // Classe 2 — Actif immobilisé
  ['2111', 'Frais de constitution', {}],
  ['2220', 'Brevets, marques, droits', {}],
  ['2230', 'Fonds commercial', {}],
  ['2321', 'Bâtiments', {}],
  ['2331', 'Installations techniques', {}],
  ['2340', 'Matériel de transport', {}],
  ['2351', 'Mobilier de bureau', {}],
  ['2355', 'Matériel informatique', {}],
  ['2356', 'Agencements, aménagements', {}],
  ['2811', 'Amort. frais de constitution', {}],
  ['2832', 'Amort. des bâtiments', {}],
  ['2833', 'Amort. installations techniques', {}],
  ['2834', 'Amort. matériel de transport', {}],
  ['2835', 'Amort. mobilier & matériel de bureau', {}],
  // Classe 3 — Actif circulant (hors trésorerie)
  ['3111', 'Marchandises (stock)', {}],
  ['3421', 'Clients', { lettrable: true, aux_kind: 'client' }],
  ['3424', 'Clients douteux ou litigieux', { lettrable: true }],
  ['3427', 'Clients - factures à établir', {}],
  ['3455', 'État - TVA récupérable', {}],
  ['34551', 'État - TVA récupérable sur immobilisations', {}],
  ['34552', 'État - TVA récupérable sur charges', {}],
  ['3458', 'État - autres comptes débiteurs', {}],
  ['3488', 'Divers débiteurs', { lettrable: true }],
  // Classe 4 — Passif circulant (hors trésorerie)
  ['4411', 'Fournisseurs', { lettrable: true, aux_kind: 'fournisseur' }],
  ['4417', 'Fournisseurs - factures non parvenues', {}],
  ['4432', 'Rémunérations dues au personnel', { lettrable: true }],
  ['4441', 'CNSS', {}],
  ['4443', 'Caisses de retraite (CIMR)', {}],
  ['4445', 'Mutuelles / AMO', {}],
  ['4452', 'État - IR (retenue à la source)', {}],
  ['4455', 'État - TVA facturée', { vat_rate: 20 }],
  ['44551', 'État - TVA facturée 20%', { vat_rate: 20 }],
  ['44552', 'État - TVA facturée 14%', { vat_rate: 14 }],
  ['44553', 'État - TVA facturée 10%', { vat_rate: 10 }],
  ['44557', 'État - TVA facturée 7%', { vat_rate: 7 }],
  ['4456', 'État - TVA due', {}],
  ['4458', 'État - autres comptes créditeurs', {}],
  ['4488', 'Divers créditeurs', { lettrable: true }],
  // Classe 5 — Trésorerie
  ['5141', 'Banque', {}],
  ['5143', 'Banque (compte 2)', {}],
  ['5111', 'Chèques et valeurs à encaisser', {}],
  ['5161', 'Caisse', {}],
  // Classe 6 — Charges
  ['6111', 'Achats de marchandises', {}],
  ['6114', 'Variation de stocks de marchandises', {}],
  ['6121', 'Achats de matières premières', {}],
  ['6125', 'Achats non stockés (fournitures)', {}],
  ['6131', 'Locations et charges locatives', {}],
  ['6133', 'Entretien et réparations', {}],
  ['6136', 'Rémunérations d\'intermédiaires & honoraires', {}],
  ['6141', 'Transports', {}],
  ['6142', 'Déplacements, missions, réceptions', {}],
  ['6145', 'Frais postaux et télécommunications', {}],
  ['6147', 'Services bancaires', {}],
  ['6167', 'Impôts et taxes', {}],
  ['6171', 'Rémunérations du personnel', {}],
  ['6174', 'Charges sociales (CNSS/AMO patronales)', {}],
  ['6182', 'Fournitures de bureau', {}],
  ['6311', 'Intérêts des emprunts', {}],
  ['6386', 'Escomptes accordés', {}],
  ['6191', 'Dotations d\'exploitation aux amortissements', {}],
  // Classe 7 — Produits
  ['7111', 'Ventes de marchandises', {}],
  ['7121', 'Ventes de biens produits', {}],
  ['7124', 'Ventes de services / prestations', {}],
  ['7127', 'Ventes de produits accessoires', {}],
  ['7386', 'Escomptes obtenus', {}],
  ['7381', 'Intérêts et produits assimilés', {}],
];

export const PCM_SEED: SeedAccount[] = RAW.map(([code, label, extra]) => ({
  code, label, class: Number(code[0]), type: t(code), ...(extra || {}),
}));

export interface SeedJournal { code: string; label: string; type: 'vente' | 'achat' | 'banque' | 'caisse' | 'od' | 'anouveaux' | 'paie'; counterpart_account_code?: string; }

export const DEFAULT_JOURNALS: SeedJournal[] = [
  { code: 'VT', label: 'Ventes', type: 'vente' },
  { code: 'AC', label: 'Achats', type: 'achat' },
  { code: 'BQ', label: 'Banque', type: 'banque', counterpart_account_code: '5141' },
  { code: 'CS', label: 'Caisse', type: 'caisse', counterpart_account_code: '5161' },
  { code: 'OD', label: 'Opérations diverses', type: 'od' },
  { code: 'AN', label: 'À-nouveaux', type: 'anouveaux' },
  { code: 'PAIE', label: 'Paie', type: 'paie' },
];

// Default account mapping used by the auto-posting engine (Phase 2).
export const DEFAULT_ACCOUNTS = {
  clients: '3421',
  fournisseurs: '4411',
  ventesMarchandises: '7111',
  ventesServices: '7124',
  tvaFacturee: '4455',
  tvaRecuperableCharges: '34552',
  achatsMarchandises: '6111',
  banque: '5141',
  caisse: '5161',
  cheques: '5111',
  remunerationsDues: '4432',
  cnss: '4441',
  irRetenue: '4452',
  chargesPersonnel: '6171',
  chargesSociales: '6174',
};
