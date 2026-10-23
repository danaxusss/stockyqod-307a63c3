import { useEffect, useState } from 'react';
import { supabase } from '../integrations/supabase/client';
import type { BusinessSector } from '../types';

export { sectorLabel, type SectorLanguage } from './sectorLabel';

/** Names of the given sector ids, in the sector list order. Unknown ids are ignored. */
export function sectorNames(sectorIds: string[] | null | undefined, sectors: BusinessSector[]): string[] {
  if (!sectorIds?.length) return [];
  return sectors.filter(sector => sectorIds.includes(sector.id)).map(sector => sector.name);
}

// One shared copy for every page and picker, so a sector added from one
// product row shows up everywhere at once.
let cache: BusinessSector[] | null = null;
let pending: Promise<BusinessSector[]> | null = null;
const listeners = new Set<(sectors: BusinessSector[]) => void>();

function publish(sectors: BusinessSector[]) {
  cache = sectors;
  listeners.forEach(listener => listener(sectors));
}

const byOrder = (a: BusinessSector, b: BusinessSector) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'fr');

export const BusinessSectorsService = {
  async list(force = false): Promise<BusinessSector[]> {
    if (cache && !force) return cache;
    if (!pending || force) {
      pending = (async () => {
        const { data, error } = await supabase.from('business_sectors')
          .select('id, name, name_en, name_ar, sort_order')
          .order('sort_order')
          .order('name');
        if (error) throw error;
        const sectors = (data || []) as BusinessSector[];
        publish(sectors);
        return sectors;
      })().finally(() => { pending = null; });
    }
    return pending;
  },

  async create(name: string): Promise<BusinessSector> {
    const clean = name.replace(/\s+/g, ' ').trim();
    if (!clean) throw new Error('Nom du secteur requis');
    const current = cache || await this.list();
    const existing = current.find(sector => sector.name.toLowerCase() === clean.toLowerCase());
    if (existing) return existing;
    const sortOrder = current.reduce((max, sector) => Math.max(max, sector.sort_order), 0) + 10;
    const { data, error } = await supabase.from('business_sectors')
      .insert({ name: clean.slice(0, 60), sort_order: sortOrder })
      .select('id, name, name_en, name_ar, sort_order')
      .single();
    if (error) throw error;
    publish([...current, data as BusinessSector].sort(byOrder));
    return data as BusinessSector;
  },

  async update(id: string, values: Partial<Pick<BusinessSector, 'name' | 'name_en' | 'name_ar'>>): Promise<void> {
    const clean = {
      ...(values.name !== undefined ? { name: values.name.replace(/\s+/g, ' ').trim().slice(0, 60) } : {}),
      ...(values.name_en !== undefined ? { name_en: values.name_en.trim() || null } : {}),
      ...(values.name_ar !== undefined ? { name_ar: values.name_ar.trim() || null } : {}),
    };
    if (clean.name === '') throw new Error('Nom du secteur requis');
    const { error } = await supabase.from('business_sectors').update(clean).eq('id', id);
    if (error) throw error;
    publish((cache || []).map(sector => sector.id === id ? { ...sector, ...clean } : sector).sort(byOrder));
  },

  /** Deletes the sector and removes it from every product. */
  async remove(id: string): Promise<void> {
    const { error } = await supabase.rpc('delete_business_sector', { p_id: id });
    if (error) throw error;
    publish((cache || []).filter(sector => sector.id !== id));
  },

  async setProductSectors(barcode: string, sectorIds: string[]): Promise<void> {
    const { error } = await supabase.from('products').update({ sector_ids: sectorIds }).eq('barcode', barcode);
    if (error) throw error;
  },
};

/** The sector list, loaded once and kept in sync across the app. */
export function useBusinessSectors(): { sectors: BusinessSector[]; loading: boolean; error: string } {
  const [sectors, setSectors] = useState<BusinessSector[]>(cache || []);
  const [loading, setLoading] = useState(!cache);
  const [error, setError] = useState('');

  useEffect(() => {
    listeners.add(setSectors);
    BusinessSectorsService.list()
      .then(setSectors)
      .catch(err => setError(err instanceof Error ? err.message : 'Secteurs indisponibles'))
      .finally(() => setLoading(false));
    return () => { listeners.delete(setSectors); };
  }, []);

  return { sectors, loading, error };
}

/** Test helper: forget the shared copy. */
export function resetBusinessSectorsCache() {
  cache = null;
  pending = null;
}
