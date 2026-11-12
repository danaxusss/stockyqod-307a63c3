import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { MoreHorizontal } from 'lucide-react';

export type RowMenuItem = {
  label: string;
  icon?: ReactNode;
  /** Internal link instead of an action. */
  to?: string;
  onSelect?: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** A line above this item. */
  separated?: boolean;
};

const MENU_WIDTH = 220;

/**
 * The "⋯" button of a list row and its menu. The menu is drawn on top of the
 * page (not inside the row), so a scrolling table cannot cut it off.
 */
export function RowMenu({ label, items, className = '' }: { label: string; items: RowMenuItem[]; className?: string }) {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const shown = items.filter(Boolean);

  useEffect(() => {
    if (!position) return;
    const close = (event: Event) => {
      if (event.type === 'keydown') {
        if ((event as KeyboardEvent).key !== 'Escape') return;
        setPosition(null);
        buttonRef.current?.focus();
        return;
      }
      if (event.target instanceof Node && (menuRef.current?.contains(event.target) || buttonRef.current?.contains(event.target))) return;
      setPosition(null);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus();
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [position]);

  if (!shown.length) return null;

  const toggle = () => {
    if (position) { setPosition(null); return; }
    const rect = buttonRef.current!.getBoundingClientRect();
    const height = shown.length * 40 + 16;
    const top = window.innerHeight - rect.bottom < height + 8 ? Math.max(8, rect.top - height - 4) : rect.bottom + 4;
    const left = Math.min(Math.max(8, rect.right - MENU_WIDTH), window.innerWidth - MENU_WIDTH - 8);
    setPosition({ top, left });
  };

  const itemClass = (item: RowMenuItem) => `flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm ${item.danger ? 'text-destructive hover:bg-destructive/10' : 'text-foreground hover:bg-secondary'} disabled:opacity-40 ${item.separated ? 'border-t border-border' : ''}`;

  return (
    <>
      <button ref={buttonRef} type="button" onClick={event => { event.stopPropagation(); toggle(); }}
        aria-label={label} title="Plus d’actions" aria-haspopup="menu" aria-expanded={!!position}
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground ${className}`}>
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {position && createPortal(
        <div ref={menuRef} role="menu" aria-label={label} style={{ top: position.top, left: position.left, width: MENU_WIDTH }}
          onClick={event => event.stopPropagation()}
          className="fixed z-[90] overflow-hidden rounded-lg border border-border bg-popover py-1 text-popover-foreground shadow-xl">
          {shown.map(item => item.to ? (
            <Link key={item.label} role="menuitem" to={item.to} onClick={() => setPosition(null)} className={itemClass(item)}>
              {item.icon}<span className="truncate">{item.label}</span>
            </Link>
          ) : (
            <button key={item.label} role="menuitem" type="button" disabled={item.disabled} aria-disabled={item.disabled || undefined}
              onClick={() => { setPosition(null); item.onSelect?.(); }} className={itemClass(item)}>
              {item.icon}<span className="truncate">{item.label}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
