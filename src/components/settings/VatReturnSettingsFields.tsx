import React from 'react';
import { VAT_MIGRATION, type VatSettingsValue } from '../../accounting/vatReturn';

// The VAT return settings, one compact block shared by the company settings
// page, the companies page and the VAT return page.

export function VatReturnSettingsFields({ value, onChange, className, available = true, idPrefix = 'vat' }: {
  value: Partial<VatSettingsValue>;
  onChange: (patch: Partial<VatSettingsValue>) => void;
  className: string;
  available?: boolean;
  idPrefix?: string;
}) {
  const label = 'block text-xs font-medium text-foreground mb-1';
  const hint = 'mt-1 text-[11px] text-muted-foreground';
  const prorata = value.vat_prorata ?? 100;
  return (
    <fieldset className="col-span-full rounded-lg border border-border p-3">
      <legend className="px-1 text-xs font-semibold text-foreground">Déclaration de TVA</legend>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div>
          <label htmlFor={`${idPrefix}-regime`} className={label}>Régime</label>
          <select id={`${idPrefix}-regime`} value={value.vat_regime || 'encaissement'} className={className}
            onChange={e => onChange({ vat_regime: e.target.value as VatSettingsValue['vat_regime'] })}>
            <option value="encaissement">Encaissement (règle générale)</option>
            <option value="debit">Débit (sur option)</option>
          </select>
          <p className={hint}>TVA due à l’encaissement, sauf option pour les débits (art. 95 CGI).</p>
        </div>
        <div>
          <label htmlFor={`${idPrefix}-periodicite`} className={label}>Périodicité</label>
          <select id={`${idPrefix}-periodicite`} value={value.vat_periodicity || ''} className={className}
            onChange={e => onChange({ vat_periodicity: e.target.value as VatSettingsValue['vat_periodicity'] })}>
            <option value="">À choisir</option>
            <option value="M">Mensuelle</option>
            <option value="T">Trimestrielle</option>
          </select>
          <p className={hint}>Mensuelle dès 1 000 000 DH de CA taxable l’an dernier (art. 108 CGI).</p>
        </div>
        <div>
          <label htmlFor={`${idPrefix}-prorata`} className={label}>Prorata de déduction (%)</label>
          <input id={`${idPrefix}-prorata`} type="number" min="1" max="100" step="0.01" value={Number.isFinite(prorata) ? prorata : ''} className={className}
            onChange={e => onChange({ vat_prorata: e.target.value === '' ? NaN : Number(e.target.value) })} />
          <p className={hint}>100 % si toutes vos ventes sont taxables (art. 104 CGI).</p>
        </div>
        <div>
          <label htmlFor={`${idPrefix}-debut`} className={label}>Premier mois déclaré dans Stocky</label>
          <input id={`${idPrefix}-debut`} type="month" value={(value.vat_start_date || '').slice(0, 7)} className={className}
            onChange={e => onChange({ vat_start_date: e.target.value ? `${e.target.value}-01` : '' })} />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-credit`} className={label}>Crédit de TVA à cette date (DH)</label>
          <input id={`${idPrefix}-credit`} type="number" min="0" step="0.01" value={value.vat_opening_credit ?? 0} className={className}
            onChange={e => onChange({ vat_opening_credit: e.target.value === '' ? 0 : Number(e.target.value) })} />
          <p className={hint}>Crédit de votre dernière déclaration avant Stocky.</p>
        </div>
      </div>
      {!available && <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-300">Réglages non enregistrés tant que la migration {VAT_MIGRATION} n’est pas exécutée dans Supabase.</p>}
    </fieldset>
  );
}
