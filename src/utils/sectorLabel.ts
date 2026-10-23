import type { BusinessSector } from '../types';

export type SectorLanguage = 'fr' | 'en' | 'ar';

/** Sector name in the kiosk language, falling back to the French name. */
export function sectorLabel(sector: Pick<BusinessSector, 'name' | 'name_en' | 'name_ar'>, language: SectorLanguage = 'fr'): string {
  if (language === 'en' && sector.name_en?.trim()) return sector.name_en.trim();
  if (language === 'ar' && sector.name_ar?.trim()) return sector.name_ar.trim();
  return sector.name;
}
