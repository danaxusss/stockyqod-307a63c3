import { useEffect, useRef } from 'react';

export function useKeyboardSave(onSave: () => void, enabled = true) {
  const savedHandler = useRef(onSave);
  savedHandler.current = onSave;
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        savedHandler.current();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [enabled]);
}

export function useEscapeKey(onEscape: () => void, enabled = true) {
  const savedHandler = useRef(onEscape);
  savedHandler.current = onEscape;
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') savedHandler.current(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [enabled]);
}

export function useAutoSave(onSave: () => void, enabled: boolean, intervalMs = 60_000) {
  const savedHandler = useRef(onSave);
  savedHandler.current = onSave;
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => savedHandler.current(), intervalMs);
    return () => clearInterval(id);
  }, [enabled, intervalMs]);
}
