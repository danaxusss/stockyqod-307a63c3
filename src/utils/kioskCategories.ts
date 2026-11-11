// Kiosk product types. The database accepts exactly these values
// (products_kiosk_category_check), and so do kiosk_product_search and the
// kiosk edge function: change all four together.
export const KIOSK_CATEGORY_VALUES = ['utensils', 'furniture', 'equipment', 'decoration', 'raw_materials'] as const;
export type KioskCategory = typeof KIOSK_CATEGORY_VALUES[number];

export const KIOSK_CATEGORIES: Array<{ value: KioskCategory; label: string }> = [
  { value: 'utensils', label: 'Ustensiles' },
  { value: 'furniture', label: 'Mobilier' },
  { value: 'equipment', label: 'Équipement' },
  { value: 'decoration', label: 'Décoration' },
  { value: 'raw_materials', label: 'Matière première' },
];

/** What goes where, shown next to the picker. */
export const KIOSK_CATEGORY_HELP =
  'Mobilier : chaises, fauteuils, tabourets, banquettes, canapés, tables, pieds et dessus de table. Ustensiles : petit matériel à la main. '
  + 'Décoration : vases, pots, jardinières, parasols. Matière première : ingrédients, café. Équipement : tout le reste (machines, froid, inox neutre, rangement, chariots).';
