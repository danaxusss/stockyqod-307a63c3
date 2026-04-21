import { useState, useEffect } from 'react';

const STORAGE_KEY = 'stocky-theme';

function getInitialTheme(): 'dark' | 'light' {
  return (localStorage.getItem(STORAGE_KEY) as 'dark' | 'light') || 'dark';
}

export function useTheme() {
  const [theme, setTheme] = useState<'dark' | 'light'>(getInitialTheme);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const toggle = () => setTheme(t => t === 'dark' ? 'light' : 'dark');

  return { theme, toggle };
}
