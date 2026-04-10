import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface Override {
  type: string;
  original_name: string;
  custom_name: string;
}

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

  const getOriginalName = (type: 'brand' | 'provider', currentName: string): string | null => {
    const match = overrides.find(o => o.type === type && o.custom_name === currentName);
    return match ? match.original_name : null;
  };

  return { getOriginalName };
}
