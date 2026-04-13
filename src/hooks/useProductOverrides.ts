import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

type OverrideType = 'brand' | 'provider';

interface Override {
  type: string;
  original_name: string;
  custom_name: string;
}

const normalizeName = (value: string) => value.trim().toLowerCase();

export function useProductOverrides() {
  const [overrides, setOverrides] = useState<Override[]>([]);

  useEffect(() => {
    const load = async () => {
      try {
        const { data } = await supabase
          .from('product_name_overrides')
          .select('type, original_name, custom_name');
        setOverrides((data as Override[]) || []);
      } catch {
        setOverrides([]);
      }
    };
    load();
  }, []);

  const overrideMaps = useMemo(() => {
    const byCustom = {
      brand: new Map<string, Override>(),
      provider: new Map<string, Override>(),
    };
    const byOriginal = {
      brand: new Map<string, Override>(),
      provider: new Map<string, Override>(),
    };

    for (const override of overrides) {
      if (override.type !== 'brand' && override.type !== 'provider') continue;

      const customName = normalizeName(override.custom_name);
      const originalName = normalizeName(override.original_name);

      if (customName) byCustom[override.type].set(customName, override);
      if (originalName) byOriginal[override.type].set(originalName, override);
    }

    return { byCustom, byOriginal };
  }, [overrides]);

  const getMatchingOverride = useCallback((type: OverrideType, name: string): Override | null => {
    const normalizedName = normalizeName(name);
    if (!normalizedName) return null;

    return overrideMaps.byCustom[type].get(normalizedName)
      ?? overrideMaps.byOriginal[type].get(normalizedName)
      ?? null;
  }, [overrideMaps]);

  const getOriginalName = useCallback((type: OverrideType, currentName: string): string | null => {
    const normalizedName = normalizeName(currentName);
    if (!normalizedName) return null;

    return overrideMaps.byCustom[type].get(normalizedName)?.original_name ?? null;
  }, [overrideMaps]);

  const getAllNames = useCallback((type: OverrideType, name: string): string[] => {
    const normalizedName = normalizeName(name);
    if (!normalizedName) return [];

    const match = getMatchingOverride(type, name);
    if (!match) return [name];

    return Array.from(new Set([match.custom_name, match.original_name].filter(Boolean)));
  }, [getMatchingOverride]);

  const getDisplayName = useCallback((type: OverrideType, name: string): string => {
    const match = getMatchingOverride(type, name);
    if (!match) return name;

    return `${match.custom_name} (${match.original_name})`;
  }, [getMatchingOverride]);

  return { overrides, getOriginalName, getAllNames, getDisplayName };
}
