/**
 * Hoja de filtros de dieta y alergenos.
 *
 * Es la funcion que mas importa a quien tiene una restriccion alimentaria, asi
 * que los filtros son explicitos ("sin estos alergenos") y el conteo de
 * resultados se actualiza en vivo: nadie tiene que aplicar a ciegas.
 */
import { Allergen, DietTag, type Locale } from '@men3d/shared';
import type { ReactNode } from 'react';

import { allergenLabel, dietLabel, type Translate } from '../lib/i18n.js';

export interface FilterValue {
  diets: string[];
  excludeAllergens: string[];
  only3d: boolean;
}

export const EMPTY_FILTERS: FilterValue = {
  diets: [],
  excludeAllergens: [],
  only3d: false,
};

export function countActiveFilters(value: FilterValue): number {
  return (
    value.diets.length + value.excludeAllergens.length + (value.only3d ? 1 : 0)
  );
}

function toggle(list: string[], item: string): string[] {
  return list.includes(item) ? list.filter((i) => i !== item) : [...list, item];
}

export function FilterSheet({
  value,
  onChange,
  onClose,
  resultCount,
  locale,
  t,
}: {
  value: FilterValue;
  onChange: (value: FilterValue) => void;
  onClose: () => void;
  resultCount: number;
  locale: Locale;
  t: Translate;
}): ReactNode {
  return (
    <div
      className="sheet-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={t('filters.title')}
      // Click en el fondo cierra; el click dentro no debe propagarse.
      onClick={onClose}
    >
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head row-between">
          <h2>{t('filters.title')}</h2>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            aria-label={t('common.close')}
          >
            ✕
          </button>
        </div>

        <div className="sheet-body stack stack-5">

        <fieldset className="stack stack-3" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="label">{t('filters.diets')}</legend>
          <div className="row wrap" style={{ gap: 8 }}>
            {Object.values(DietTag).map((tag) => (
              <button
                key={tag}
                type="button"
                className="chip"
                aria-pressed={value.diets.includes(tag)}
                onClick={() => onChange({ ...value, diets: toggle(value.diets, tag) })}
              >
                {dietLabel(tag, locale)}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="stack stack-3" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="label">{t('filters.allergens')}</legend>
          <div className="row wrap" style={{ gap: 8 }}>
            {Object.values(Allergen).map((allergen) => (
              <button
                key={allergen}
                type="button"
                className="chip"
                aria-pressed={value.excludeAllergens.includes(allergen)}
                onClick={() =>
                  onChange({
                    ...value,
                    excludeAllergens: toggle(value.excludeAllergens, allergen),
                  })
                }
              >
                {allergenLabel(allergen, locale)}
              </button>
            ))}
          </div>
          <p className="tiny muted">
            Se excluyen tambien los platos que declaran trazas de ese alergeno.
          </p>
        </fieldset>

        <label className="row-between" style={{ cursor: 'pointer' }}>
          <span className="bold small">{t('filters.only3d')}</span>
          <input
            type="checkbox"
            checked={value.only3d}
            onChange={(e) => onChange({ ...value, only3d: e.target.checked })}
            style={{ width: 20, height: 20 }}
          />
        </label>

        </div>

        {/* Las acciones quedan fijas al pie: el conteo de resultados se actualiza
            en vivo mientras se tocan los filtros, sin perderlo de vista. */}
        <div className="sheet-actions row" style={{ gap: 8 }}>
          <button
            type="button"
            className="btn grow"
            onClick={() => onChange(EMPTY_FILTERS)}
            disabled={countActiveFilters(value) === 0}
          >
            {t('filters.clear')}
          </button>
          <button type="button" className="btn btn-primary grow" onClick={onClose}>
            {t('filters.apply', { n: resultCount })}
          </button>
        </div>
      </div>
    </div>
  );
}
