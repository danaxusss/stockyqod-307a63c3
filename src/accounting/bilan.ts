// Simplified balance sheet (bilan, modèle simplifié) from account balances.
//
// Each account is shown on the side its balance belongs to, not netted by
// class: a debit balance in class 4 (VAT credit on 3456/4456, an advance to a
// supplier) is an asset, a credit balance in class 3 (a customer who paid in
// advance) is a liability, class 5 goes by sign. The year's result has its
// own line. Totals are equal whenever the entries are balanced.

export interface BilanLine { code: string; label: string; amount: number }
export interface BilanSection { key: string; title: string; lines: BilanLine[]; total: number }
export interface Bilan {
  actif: BilanSection[];
  passif: BilanSection[];
  resultat: number;
  totalActif: number;
  totalPassif: number;
}

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export function buildBilan(balances: Map<string, number>, labelOf: (code: string) => string = () => ''): Bilan {
  const sec = (key: string, title: string): BilanSection => ({ key, title, lines: [], total: 0 });
  const immo = sec('immobilise', 'Actif immobilisé (net)');
  const circAct = sec('circulant', 'Actif circulant');
  const tresoAct = sec('tresorerie_actif', 'Trésorerie - Actif');
  const capitaux = sec('capitaux', 'Capitaux propres et financement permanent');
  const dettes = sec('dettes', 'Passif circulant');
  const tresoPas = sec('tresorerie_passif', 'Trésorerie - Passif');
  let resultat = 0;

  const push = (s: BilanSection, code: string, amount: number) => {
    if (Math.abs(amount) <= 0.005) return;
    s.lines.push({ code, label: labelOf(code), amount: r2(amount) });
  };
  Array.from(balances.entries()).sort((a, b) => a[0].localeCompare(b[0])).forEach(([code, b]) => {
    if (Math.abs(b) <= 0.005) return;
    switch (String(code)[0]) {
      case '1': push(capitaux, code, -b); break;
      // Depreciation (28x) and impairment (29x) stay in class 2 with a credit balance: they reduce the gross value.
      case '2': push(immo, code, b); break;
      case '3': case '4':
        if (b > 0) push(circAct, code, b); else push(dettes, code, -b);
        break;
      case '5': if (b > 0) push(tresoAct, code, b); else push(tresoPas, code, -b); break;
      // Classes 6, 7 (and 8, result accounts) make the year's result.
      case '6': case '7': case '8': resultat -= b; break;
      default: break;
    }
  });
  for (const s of [immo, circAct, tresoAct, capitaux, dettes, tresoPas]) s.total = r2(s.lines.reduce((t, l) => t + l.amount, 0));
  resultat = r2(resultat);
  const actif = [immo, circAct, tresoAct];
  const passif = [capitaux, dettes, tresoPas];
  const totalActif = r2(actif.reduce((t, s) => t + s.total, 0));
  const totalPassif = r2(passif.reduce((t, s) => t + s.total, 0) + resultat);
  return { actif, passif, resultat, totalActif, totalPassif };
}
