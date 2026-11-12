import { useState } from 'react';

/**
 * Columns a person chose to show in a list, remembered in this browser.
 * Storage can be unavailable (private window): the defaults are used then.
 */
export function usePersistentColumns<K extends string>(storageKey: string, defaults: K[], allowed: K[]) {
  const [columns, setColumns] = useState<K[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (Array.isArray(saved)) return saved.filter((key): key is K => allowed.includes(key));
    } catch { /* defaults */ }
    return defaults;
  });
  const toggle = (key: K) => setColumns(current => {
    const next = current.includes(key) ? current.filter(item => item !== key) : [...current, key];
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* not remembered */ }
    return next;
  });
  return { columns, toggle };
}
