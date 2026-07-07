// Default Moroccan statutory payroll parameters (LF2023 frais pro reform +
// LF2025 IR scale). Overridable per company/year via payroll_settings.

export interface PayrollSettings {
  year?: number;
  cnss_rate_emp: number;
  cnss_cap: number;
  amo_rate_emp: number;
  cnss_rate_er: number;
  af_rate: number;
  amo_rate_er: number;
  tfp_rate: number;
  frais_pro_low: number;
  frais_pro_high: number;
  frais_pro_threshold: number;
  frais_pro_cap: number;
  family_ded_per_dep: number;
  family_ded_max: number;
  smig_hourly: number;
  conges_days_per_month: number;
  ir_brackets: [number, number, number, number][]; // [lo, hi, rate, fixedDeduction]
}

export const DEFAULT_PAYROLL_SETTINGS: PayrollSettings = {
  cnss_rate_emp: 0.0448,
  cnss_cap: 6000,
  amo_rate_emp: 0.0226,
  cnss_rate_er: 0.0898,
  af_rate: 0.0640,
  amo_rate_er: 0.0411,
  tfp_rate: 0.0160,
  frais_pro_low: 0.35,
  frais_pro_high: 0.25,
  frais_pro_threshold: 78000,
  frais_pro_cap: 35000,
  family_ded_per_dep: 500,
  family_ded_max: 6,
  smig_hourly: 17.10,
  conges_days_per_month: 1.5,
  ir_brackets: [
    [0, 40000, 0.00, 0],
    [40000, 60000, 0.10, 4000],
    [60000, 80000, 0.20, 10000],
    [80000, 100000, 0.30, 18000],
    [100000, 180000, 0.34, 22000],
    [180000, Infinity, 0.37, 27400],
  ],
};

export interface DefaultRubrique {
  code: string; label: string; type: 'gain' | 'retenue';
  base: 'fixe' | 'pourcentage_base' | 'heures' | 'formule'; rate?: number;
  soumis_cnss: boolean; soumis_amo: boolean; soumis_ir: boolean; soumis_cimr: boolean; inclus_anciennete: boolean;
  compte_comptable?: string;
}

// Common Moroccan rubriques seeded on init.
export const DEFAULT_RUBRIQUES: DefaultRubrique[] = [
  { code: 'HS25', label: 'Heures supplémentaires 25%', type: 'gain', base: 'heures', rate: 1.25, soumis_cnss: true, soumis_amo: true, soumis_ir: true, soumis_cimr: false, inclus_anciennete: false, compte_comptable: '6171' },
  { code: 'HS50', label: 'Heures supplémentaires 50%', type: 'gain', base: 'heures', rate: 1.50, soumis_cnss: true, soumis_amo: true, soumis_ir: true, soumis_cimr: false, inclus_anciennete: false, compte_comptable: '6171' },
  { code: 'HS100', label: 'Heures supplémentaires 100%', type: 'gain', base: 'heures', rate: 2.00, soumis_cnss: true, soumis_amo: true, soumis_ir: true, soumis_cimr: false, inclus_anciennete: false, compte_comptable: '6171' },
  { code: 'PRIME_RESP', label: 'Prime de responsabilité', type: 'gain', base: 'fixe', soumis_cnss: true, soumis_amo: true, soumis_ir: true, soumis_cimr: false, inclus_anciennete: true, compte_comptable: '6171' },
  { code: 'PRIME_REND', label: 'Prime de rendement', type: 'gain', base: 'fixe', soumis_cnss: true, soumis_amo: true, soumis_ir: true, soumis_cimr: false, inclus_anciennete: false, compte_comptable: '6171' },
  { code: 'IND_TRANSPORT', label: 'Indemnité de transport', type: 'gain', base: 'fixe', soumis_cnss: false, soumis_amo: false, soumis_ir: false, soumis_cimr: false, inclus_anciennete: false, compte_comptable: '6171' },
  { code: 'IND_PANIER', label: 'Indemnité de panier', type: 'gain', base: 'fixe', soumis_cnss: false, soumis_amo: false, soumis_ir: false, soumis_cimr: false, inclus_anciennete: false, compte_comptable: '6171' },
  { code: 'IND_REPR', label: 'Indemnité de représentation', type: 'gain', base: 'fixe', soumis_cnss: false, soumis_amo: false, soumis_ir: false, soumis_cimr: false, inclus_anciennete: false, compte_comptable: '6171' },
  { code: 'ABSENCE', label: 'Retenue pour absence', type: 'retenue', base: 'heures', soumis_cnss: true, soumis_amo: true, soumis_ir: true, soumis_cimr: false, inclus_anciennete: false, compte_comptable: '6171' },
  { code: 'AVANCE', label: 'Retenue avance / prêt', type: 'retenue', base: 'fixe', soumis_cnss: false, soumis_amo: false, soumis_ir: false, soumis_cimr: false, inclus_anciennete: false, compte_comptable: '3488' },
];
