import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Home, ShoppingBag, FileText, Receipt, ListTodo, Menu, ChevronLeft, Search, type LucideIcon } from 'lucide-react';
import { useAccess } from '../hooks/useAccess';
import { useHomeData } from '../hooks/useHomeData';
import { pageTitle } from '../utils/pageTitles';
import { openSearch } from '../utils/searchEvents';

interface Tab { to: string; label: string; icon: LucideIcon; match: string[]; badge?: number; }

/** Phone header: page name, a back arrow on detail pages, and search. */
export function MobileHeader() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { access, modules } = useAccess();
  const isMenuPage = pathname === '/' || modules.some(m => m.items.some(i => i.to === pathname));
  const title = pageTitle(pathname) || 'Stocky';
  const back = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate(pathname.split('/').slice(0, -1).join('/') || '/');
  };
  return (
    <header className="flex h-14 shrink-0 items-center gap-1 border-b border-border bg-card px-2 md:hidden">
      {!isMenuPage && (
        <button onClick={back} className="flex h-11 w-11 items-center justify-center rounded-full text-foreground hover:bg-secondary" aria-label="Retour">
          <ChevronLeft className="h-6 w-6" aria-hidden="true" />
        </button>
      )}
      <h1 className={`min-w-0 flex-1 truncate text-lg font-bold text-foreground ${isMenuPage ? 'pl-2' : ''}`}>{title}</h1>
      {!access.tasksOnly && (
        <button onClick={openSearch} className="flex h-11 w-11 items-center justify-center rounded-full text-foreground hover:bg-secondary" aria-label="Rechercher">
          <Search className="h-5 w-5" aria-hidden="true" />
        </button>
      )}
    </header>
  );
}

/** Phone bottom bar: the user's four main places and the full menu. */
export function MobileTabBar({ onMenu }: { onMenu: () => void }) {
  const { pathname } = useLocation();
  const { access } = useAccess();
  const { data } = useHomeData();

  const candidates: (Tab | false)[] = [
    !access.tasksOnly && { to: '/', label: 'Accueil', icon: Home, match: [] },
    access.catalogue && { to: '/products', label: 'Produits', icon: ShoppingBag, match: ['/products', '/product/', '/search', '/catalogue'] },
    access.quotes && { to: '/quotes-history', label: 'Devis', icon: FileText, match: ['/quotes-history', '/quote-cart'], badge: data?.followUps?.length },
    access.billing && { to: '/compta/invoices', label: 'Factures', icon: Receipt, match: ['/compta/invoices'], badge: data?.unpaid?.length },
    access.tasks && { to: access.ownTasksOnly ? '/tasks/mine' : '/tasks', label: 'Tâches', icon: ListTodo, match: ['/tasks'], badge: data?.tasks?.length },
  ];
  const tabs = candidates.filter((t): t is Tab => !!t).slice(0, 4);
  const isActive = (t: Tab) => (t.to === '/' ? pathname === '/' : t.match.some(m => (m.endsWith('/') ? pathname.startsWith(m) : pathname === m || pathname.startsWith(m + '/'))));

  return (
    <nav aria-label="Navigation principale" className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      {tabs.map(t => {
        const active = isActive(t);
        return (
          <Link key={t.to} to={t.to} aria-current={active ? 'page' : undefined}
            className={`relative flex min-h-[3.5rem] flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${active ? 'text-primary' : 'text-muted-foreground'}`}>
            <t.icon className="h-6 w-6" aria-hidden="true" />
            {t.label}
            {!!t.badge && <span className="absolute left-1/2 top-1.5 ml-2 min-w-[1.125rem] rounded-full bg-destructive px-1 text-center text-[10px] font-bold leading-[1.125rem] text-destructive-foreground">{t.badge > 99 ? '99+' : t.badge}</span>}
          </Link>
        );
      })}
      <button type="button" onClick={onMenu} className="flex min-h-[3.5rem] flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold text-muted-foreground">
        <Menu className="h-6 w-6" aria-hidden="true" />
        Menu
      </button>
    </nav>
  );
}
