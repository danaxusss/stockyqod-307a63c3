import { payrollDb, writeWithFallback } from './payrollDb';
import { getCompanyContext } from './supabaseCompanyFilter';
import { DEFAULT_RUBRIQUES, type ExemptionCeiling } from './payrollDefaults';

export interface Rubrique {
  id: string;
  company_id: string;
  code: string;
  label: string;
  type: 'gain' | 'retenue';
  base: 'fixe' | 'pourcentage_base' | 'heures' | 'formule';
  rate: number;
  soumis_cnss: boolean;
  soumis_amo: boolean;
  soumis_ir: boolean;
  soumis_cimr: boolean;
  inclus_anciennete: boolean;
  compte_comptable: string | null;
  active: boolean;
  sort_order: number;
  /** Exemption ceilings (null: none). Columns added by the 2026 migration. */
  ir_ceiling: ExemptionCeiling | null;
  cnss_ceiling: ExemptionCeiling | null;
}

type RubriqueRow = Record<string, unknown>;

/** Ceiling columns added by the 2026 payroll migration. */
const CEILING_COLUMNS = ['ir_ceiling_type', 'ir_ceiling_value', 'cnss_ceiling_type', 'cnss_ceiling_value'];

function ceiling(type: unknown, value: unknown): ExemptionCeiling | null {
  if ((type !== 'amount' && type !== 'percent') || value == null || !Number.isFinite(Number(value))) return null;
  return { type, value: Number(value) };
}

function mapRow(r: RubriqueRow): Rubrique {
  return {
    ...(r as unknown as Rubrique),
    rate: Number(r.rate) || 0,
    soumis_amo: r.soumis_amo == null ? r.soumis_cnss !== false : r.soumis_amo !== false,
    ir_ceiling: ceiling(r.ir_ceiling_type, r.ir_ceiling_value),
    cnss_ceiling: ceiling(r.cnss_ceiling_type, r.cnss_ceiling_value),
  };
}

/** Columns of a rubrique to write (ceilings spread into their two columns each). */
function toRow(r: Partial<Rubrique>): RubriqueRow {
  const { ir_ceiling, cnss_ceiling } = r;
  const row: RubriqueRow = { ...r };
  delete row.id; delete row.ir_ceiling; delete row.cnss_ceiling;
  if (ir_ceiling !== undefined) { row.ir_ceiling_type = ir_ceiling?.type ?? null; row.ir_ceiling_value = ir_ceiling?.value ?? null; }
  if (cnss_ceiling !== undefined) { row.cnss_ceiling_type = cnss_ceiling?.type ?? null; row.cnss_ceiling_value = cnss_ceiling?.value ?? null; }
  return row;
}

const hasCeiling = (row: RubriqueRow) => row.ir_ceiling_type != null || row.cnss_ceiling_type != null;
const ceilingLost = (row: RubriqueRow) => (hasCeiling(row) ? 'Les plafonds d\'exonération ne peuvent pas être enregistrés tant que la base n\'est pas à jour.' : null);

export class RubriquesService {
  static async list(): Promise<Rubrique[]> {
    const { companyId, bypassFilter } = getCompanyContext();
    let q = payrollDb().from('payroll_rubriques').select('*').order('sort_order').order('code');
    if (!bypassFilter && companyId) q = q.eq('company_id', companyId);
    const { data, error } = await q;
    if (error) throw error;
    return ((data || []) as RubriqueRow[]).map(mapRow);
  }

  static async initDefaults(): Promise<number> {
    const { companyId } = getCompanyContext();
    const existing = await this.list();
    const have = new Set(existing.map(r => r.code));
    const rows = DEFAULT_RUBRIQUES.filter(r => !have.has(r.code)).map((r, i) => toRow({
      company_id: companyId as string, code: r.code, label: r.label, type: r.type, base: r.base, rate: r.rate ?? 0,
      soumis_cnss: r.soumis_cnss, soumis_amo: r.soumis_amo, soumis_ir: r.soumis_ir, soumis_cimr: r.soumis_cimr,
      inclus_anciennete: r.inclus_anciennete, compte_comptable: r.compte_comptable ?? null, sort_order: existing.length + i,
      ir_ceiling: r.ir_ceiling ?? null, cnss_ceiling: r.cnss_ceiling ?? null,
    }));
    if (rows.length > 0) {
      // Seeding without the ceilings is better than no rubriques: they can be
      // set once the migration has run.
      const { error } = await writeWithFallback(p => payrollDb().from('payroll_rubriques').insert(p), rows, CEILING_COLUMNS);
      if (error) throw error;
    }
    return rows.length;
  }

  /** Creates a rubrique, or replaces the one with the same code. */
  static async upsert(r: Partial<Rubrique> & { code: string; label: string; type: string }): Promise<Rubrique> {
    const { companyId } = getCompanyContext();
    const row = toRow({ ...r, company_id: r.company_id ?? (companyId as string) } as Partial<Rubrique>);
    const { data, error } = await writeWithFallback(
      p => payrollDb().from('payroll_rubriques').upsert(p, { onConflict: 'company_id,code' }).select().single(),
      row, CEILING_COLUMNS, ceilingLost,
    );
    if (error) throw error;
    return mapRow(data as RubriqueRow);
  }

  /** Edits a rubrique in place (its code may change). */
  static async update(id: string, patch: Partial<Rubrique>): Promise<Rubrique> {
    const row = toRow(patch);
    const { data, error } = await writeWithFallback(
      p => payrollDb().from('payroll_rubriques').update(p).eq('id', id).select().single(),
      row, CEILING_COLUMNS, ceilingLost,
    );
    if (error) throw error;
    return mapRow(data as RubriqueRow);
  }

  static async remove(id: string): Promise<void> {
    const { error } = await payrollDb().from('payroll_rubriques').delete().eq('id', id);
    if (error) throw error;
  }
}
