import React from 'react';
import type { Employee } from '../../types';
import { field, fieldLabel } from '../../components/backoffice/BackOfficeUi';
import { DTS_CATEGORY_LABELS, type DtsCategory } from '../../utils/dts9421';

export type DeclarationField = 'last_name' | 'first_name' | 'address' | 'residence_card' | 'tax_id' | 'dts_category';

/**
 * The "Déclarations" group of the employee form: what the annual salary
 * return (9421) needs and the rest of the form does not ask for.
 */
export function EmployeeDeclarationFields({ value, onChange }: {
  value: Partial<Pick<Employee, DeclarationField | 'contract_type'>>;
  onChange: (field: DeclarationField, v: string | null) => void;
}) {
  const legendCls = 'mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground';
  const text = (k: DeclarationField, label: string, extra: { mono?: boolean; span?: boolean; placeholder?: string } = {}) => (
    <div className={extra.span ? 'sm:col-span-2' : ''}>
      <label className={fieldLabel} htmlFor={`emp-${k}`}>{label}</label>
      <input id={`emp-${k}`} className={`${field}${extra.mono ? ' font-mono' : ''}`} placeholder={extra.placeholder}
        value={(value[k] as string) || ''} onChange={e => onChange(k, e.target.value)} />
    </div>
  );
  const auto = (value.contract_type as string) === 'Stage' ? DTS_CATEGORY_LABELS.stagiaire : DTS_CATEGORY_LABELS.permanent;
  return (
    <fieldset className="border-t border-border pt-4">
      <legend className={`${legendCls} float-left w-full`}>Déclarations</legend>
      <p className="clear-both mb-3 text-xs text-muted-foreground">Pour la déclaration annuelle des salaires (9421) : nom et prénom séparés, adresse, pièce d'identité.</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {text('last_name', 'Nom')}
        {text('first_name', 'Prénom')}
        {text('address', 'Adresse personnelle', { span: true })}
        {text('residence_card', 'N° carte de séjour (étranger)', { mono: true })}
        {text('tax_id', 'IF du salarié', { mono: true })}
        <div className="sm:col-span-2">
          <label className={fieldLabel} htmlFor="emp-dts_category">Liste de la déclaration 9421</label>
          <select id="emp-dts_category" className={field} value={value.dts_category || ''} onChange={e => onChange('dts_category', e.target.value || null)}>
            <option value="">Automatique ({auto})</option>
            {(Object.entries(DTS_CATEGORY_LABELS) as [DtsCategory, string][]).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      </div>
    </fieldset>
  );
}
