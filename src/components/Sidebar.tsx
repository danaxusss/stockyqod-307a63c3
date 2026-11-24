import { useEffect, useRef, useState } from 'react';
import {
  Package, RefreshCw, LogOut, ChevronLeft, ChevronRight, ChevronDown, X, Sun, Moon, Home, Search, EllipsisVertical, Bot, Menu,
} from 'lucide-react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useTheme } from '../hooks/useTheme';
import { useAuth } from '../hooks/useAuth';
import { useUserAuth } from '../hooks/useUserAuth';
import { useAccess } from '../hooks/useAccess';
import { useHomeData } from '../hooks/useHomeData';
import { useAppContext } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { moduleForPath, activeItem, type NavModule } from '../lib/navigation';
import { openSearch } from '../utils/searchEvents';
import { useIsTouch, useMediaQuery } from '../hooks/useMediaQuery';

const SIDEBAR_KEY = 'stocky_sidebar_collapsed';

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super administrateur', admin: 'Administrateur', manager: 'Manager', facturation: 'Facturation',
  compta: 'Comptabilité', senior_sales: 'Commercial senior', junior_sales: 'Commercial',
};
const TASK_ROLE_LABELS: Record<string, string> = { technician: 'Technicien', driver: 'Chauffeur', sales: 'Commercial' };

/** Rail labels must fit 56 px. */
const RAIL_SHORT: Record<string, string> = { comptabilite: 'Compta', admin: 'Admin' };

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '');

function Badge({ count, strong = false }: { count?: number; strong?: boolean }) {
  if (!count) return null;
  return (
    <span className={`ml-auto shrink-0 rounded-full px-1.5 text-[11px] font-bold leading-5 tabular-nums ${strong ? 'bg-primary text-primary-foreground' : 'bg-secondary text-foreground/80'}`}>
      {count > 99 ? '99+' : count}
    </span>
  );
}

interface SidebarProps {
  mobileOpen?: boolean;
  onMobileClose?: () => void;
  /** Open the full menu over the page (tablet rail). */
  onRequestOpen?: () => void;
  onOpenAssistant?: () => void;
}

export function Sidebar({ mobileOpen = false, onMobileClose, onRequestOpen, onOpenAssistant }: SidebarProps = {}) {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(SIDEBAR_KEY) === 'true'; } catch { return false; }
  });
  const [isSyncing, setIsSyncing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const { theme, toggle: toggleTheme } = useTheme();
  const { isAdmin, isSuperAdmin, companyName, currentUser, newRole, tasksRole, logout: adminLogout } = useAuth();
  const { isAuthenticated: isUserAuthenticated, authenticatedUser, logout: userLogout } = useUserAuth();
  const { access, modules } = useAccess();
  const { data } = useHomeData();
  const { syncInfo, syncData } = useAppContext();
  const { showToast } = useToast();

  const current = moduleForPath(modules, pathname);
  const currentItem = activeItem(current, pathname);
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set(current ? [current.id] : []));
  // Opening a page opens its module; the others keep the state the user left.
  useEffect(() => {
    if (current) setOpenIds(ids => (ids.has(current.id) ? ids : new Set(ids).add(current.id)));
  }, [current]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
      if (e.target instanceof Node && menuRef.current?.contains(e.target) && !(e instanceof KeyboardEvent)) return;
      setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [menuOpen]);

  const toggleCollapsed = () => setCollapsed(c => {
    const next = !c;
    try { localStorage.setItem(SIDEBAR_KEY, String(next)); } catch { /* storage unavailable */ }
    return next;
  });

  const handleSync = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      const hasUpdates = await syncData(true);
      showToast({ type: 'success', title: hasUpdates ? 'Synchronisation réussie' : 'Déjà à jour', message: hasUpdates ? 'Base de données mise à jour !' : 'La base de données est déjà à jour.' });
    } catch (error) {
      showToast({ type: 'error', title: 'Erreur de synchronisation', message: error instanceof Error ? error.message : 'Échec' });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleLogout = () => { adminLogout(); userLogout(); };

  const displayName = currentUser?.custom_seller_name?.trim() || currentUser?.username ||
    authenticatedUser?.custom_seller_name?.trim() || authenticatedUser?.username || 'Utilisateur';
  const taskRoleLabel = tasksRole ? TASK_ROLE_LABELS[tasksRole] : undefined;
  const roleLabel = (access.tasksOnly && taskRoleLabel) || (newRole && ROLE_LABELS[newRole])
    || (isSuperAdmin ? ROLE_LABELS.super_admin : isAdmin ? ROLE_LABELS.admin : taskRoleLabel || 'Utilisateur');
  const isOnline = syncInfo.isOnline;
  // From 1024 px the menu sits beside the page, open or folded as the user
  // left it. On a tablet below that (iPad portrait) it is an icon rail and
  // opens over the page; on a phone it is a drawer.
  const isWide = useMediaQuery('(min-width: 1024px)');
  const isTabletUp = useMediaQuery('(min-width: 768px)');
  const isTabletRail = isTabletUp && !isWide;
  const isTouch = useIsTouch();
  // The assistant panel opens from 768 px; its floating tab is only shown on
  // wide mouse-driven screens, so elsewhere it is offered here.
  const assistantInMenu = !!onOpenAssistant && isTabletUp && (!isWide || isTouch);
  const showExpanded = mobileOpen || (isWide && !collapsed);
  // A tablet has no hover tooltips: the rail names each icon.
  const railLabels = isTabletRail && !mobileOpen;
  const railRow = railLabels ? 'flex-col !gap-1 !px-0 py-2' : '';

  // Work waiting for the user, shown next to the pages that hold it.
  const itemBadges: Record<string, number | undefined> = {
    '/quotes-history': data?.followUps?.length,
    '/compta/invoices': data?.unpaid?.length,
  };
  const moduleBadges: Record<string, number | undefined> = {
    ventes: data?.followUps?.length,
    documents: data?.unpaid?.length,
    taches: data?.tasks?.length,
  };

  const toggleModule = (m: NavModule) => {
    if (!showExpanded && isTabletRail && onRequestOpen) {
      // Rail: open the menu over the page on that module, so its pages are one tap away.
      setOpenIds(ids => new Set(ids).add(m.id));
      onRequestOpen();
      return;
    }
    if (!showExpanded) { navigate(m.items[0].to); onMobileClose?.(); return; }
    setOpenIds(ids => {
      const next = new Set(ids);
      if (next.has(m.id)) next.delete(m.id); else next.add(m.id);
      return next;
    });
  };

  // Turning a tablet to landscape puts the menu back beside the page.
  useEffect(() => { if (isWide && mobileOpen) onMobileClose?.(); }, [isWide]); // eslint-disable-line react-hooks/exhaustive-deps

  // Escape closes the menu opened over the page.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onMobileClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mobileOpen, onMobileClose]);

  // Taller rows on touch screens: a finger needs about 44 px.
  const rowBase = 'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors touch:min-h-11';

  return (
    <aside className={`
      flex h-full flex-col overflow-hidden border-r border-border bg-card
      fixed inset-y-0 left-0 z-50 max-w-[85vw]
      lg:relative lg:z-auto lg:max-w-none lg:shrink-0 lg:translate-x-0 lg:shadow-none
      transition-[transform,width] duration-200 ease-in-out
      ${mobileOpen ? 'w-72 translate-x-0 shadow-[4px_0_24px_rgba(0,0,0,0.12)]' : 'w-72 -translate-x-full md:w-20 md:translate-x-0'}
      ${collapsed ? 'lg:w-16' : 'lg:w-60'}
    `}>
      {/* Brand + collapse */}
      <div className={`flex shrink-0 items-center gap-2 px-3 pt-3 ${!showExpanded ? 'flex-col' : ''}`}>
        <Link to="/" onClick={onMobileClose} className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg hover:opacity-80" title={!showExpanded ? 'Accueil' : undefined}>
          <span className="relative shrink-0">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm"><Package className="h-4 w-4" aria-hidden="true" /></span>
            <span className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card ${isOnline ? 'bg-emerald-500' : 'bg-red-500'}`} title={isOnline ? 'En ligne' : 'Hors ligne'} />
          </span>
          {showExpanded && (
            <span className="min-w-0">
              <span className="block text-sm font-bold leading-tight text-foreground">Stocky</span>
              <span className="block text-[11px] text-muted-foreground">
                {syncInfo.pendingChanges > 0 ? <span className="font-semibold text-amber-700 dark:text-amber-400">{syncInfo.pendingChanges} en attente de synchro</span> : 'by QodWeb'}
              </span>
            </span>
          )}
        </Link>
        <button onClick={toggleCollapsed} className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground lg:flex" aria-label={collapsed ? 'Déplier le menu' : 'Replier le menu'}>
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
        {mobileOpen && (
          <button onClick={onMobileClose} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary lg:hidden" aria-label="Fermer le menu">
            <X className="h-5 w-5" />
          </button>
        )}
        {isTabletRail && !mobileOpen && (
          <button onClick={onRequestOpen} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label="Ouvrir le menu">
            <Menu className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Company + search */}
      <div className="shrink-0 space-y-2 px-3 pb-2 pt-3">
        {companyName && showExpanded && (
          <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground" title="Société">
            <span className={`h-2 w-2 shrink-0 rounded-full ${isSuperAdmin ? 'bg-amber-500' : 'bg-emerald-500'}`} aria-hidden="true" />
            <span className="truncate">{companyName}</span>
          </div>
        )}
        {!access.tasksOnly && (
          <button
            type="button"
            onClick={() => { onMobileClose?.(); openSearch(); }}
            className={`flex w-full items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-left text-sm text-muted-foreground hover:text-foreground touch:min-h-11 ${!showExpanded ? 'justify-center px-0' : ''} ${railRow}`}
            aria-label="Rechercher"
            title={!showExpanded ? `Rechercher (${isMac ? '⌘' : 'Ctrl'} K)` : undefined}
          >
            <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
            {railLabels && <span className="text-[10px] font-semibold leading-none">Chercher</span>}
            {showExpanded && <><span className="flex-1">Rechercher…</span><kbd className="hidden rounded border border-border bg-card px-1.5 text-[11px] font-semibold md:inline">{isMac ? '⌘' : 'Ctrl'} K</kbd></>}
          </button>
        )}
      </div>

      {/* Modules */}
      <nav aria-label="Menu principal" className={`min-h-0 flex-1 space-y-0.5 overflow-y-auto pb-3 ${railLabels ? 'px-2' : 'px-3'}`}>
        {!access.tasksOnly && (
          <NavLink to="/" end onClick={onMobileClose} title={!showExpanded ? 'Accueil' : undefined}
            className={({ isActive }) => `${rowBase} ${isActive ? 'bg-primary/10 text-primary' : 'text-foreground/80 hover:bg-secondary hover:text-foreground'} ${!showExpanded ? 'justify-center px-0' : ''} ${railRow}`}>
            <Home className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
            {showExpanded && 'Accueil'}
            {railLabels && <span className="text-[10px] font-semibold leading-none">Accueil</span>}
          </NavLink>
        )}
        {modules.map(m => {
          const isOpen = openIds.has(m.id) && showExpanded;
          const isCurrent = current?.id === m.id;
          const panelId = `nav-${m.id}`;
          return (
            <div key={m.id}>
              <button
                type="button"
                onClick={() => toggleModule(m)}
                aria-expanded={showExpanded ? isOpen : undefined}
                aria-controls={showExpanded ? panelId : undefined}
                title={!showExpanded ? m.label : undefined}
                className={`${rowBase} ${isCurrent && !isOpen ? 'bg-primary/10 text-primary' : isCurrent ? 'text-foreground' : 'text-foreground/80 hover:bg-secondary hover:text-foreground'} ${!showExpanded ? 'relative justify-center px-0' : ''} ${railRow}`}
              >
                <m.icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
                {railLabels && <span className="max-w-full truncate text-[10px] font-semibold leading-none">{RAIL_SHORT[m.id] || m.label}</span>}
                {showExpanded ? (
                  <>
                    <span className="flex-1 text-left">{m.label}</span>
                    <Badge count={moduleBadges[m.id]} strong />
                    <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? '' : '-rotate-90'}`} aria-hidden="true" />
                  </>
                ) : moduleBadges[m.id] ? <span className="absolute right-1.5 top-1 h-2 w-2 rounded-full bg-primary" aria-hidden="true" /> : null}
              </button>
              {isOpen && (
                <div id={panelId} className="mb-1 ml-[1.15rem] mt-0.5 space-y-0.5 border-l border-border pl-2.5">
                  {m.items.map(item => {
                    const isActive = currentItem === item.to;
                    return (
                      <Link
                        key={item.to}
                        to={item.to}
                        onClick={onMobileClose}
                        aria-current={isActive ? 'page' : undefined}
                        className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm touch:min-h-11 ${isActive ? 'bg-primary/10 font-semibold text-primary' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'}`}
                      >
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        <Badge count={itemBadges[item.to]} />
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Account */}
      <div ref={menuRef} className="relative shrink-0 border-t border-border p-3">
        {menuOpen && (
          <div role="menu" className={`absolute bottom-full z-10 mb-1 overflow-hidden rounded-xl border border-border bg-popover py-1 text-sm shadow-xl ${showExpanded ? 'left-3 right-3' : 'left-2 w-56'}`}>
            {isOnline && (
              <button role="menuitem" onClick={() => { setMenuOpen(false); handleSync(); }} disabled={isSyncing} className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-secondary disabled:opacity-50 touch:min-h-11">
                <RefreshCw className={`h-4 w-4 text-muted-foreground ${isSyncing ? 'animate-spin' : ''}`} aria-hidden="true" />Synchroniser les données
              </button>
            )}
            {assistantInMenu && onOpenAssistant && (
              // The floating "IA" tab is kept for wide screens; on a tablet it covered pages.
              <button role="menuitem" onClick={() => { setMenuOpen(false); onMobileClose?.(); onOpenAssistant(); }} className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-secondary touch:min-h-11">
                <Bot className="h-4 w-4 text-muted-foreground" aria-hidden="true" />Assistant IA
              </button>
            )}
            <button role="menuitem" onClick={() => { toggleTheme(); setMenuOpen(false); }} className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-secondary touch:min-h-11">
              {theme === 'dark' ? <Sun className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> : <Moon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
              {theme === 'dark' ? 'Mode clair' : 'Mode sombre'}
            </button>
            {(isAdmin || isUserAuthenticated) && (
              <button role="menuitem" onClick={handleLogout} className="flex w-full items-center gap-2.5 border-t border-border px-3 py-2 text-left text-destructive hover:bg-destructive/10 touch:min-h-11">
                <LogOut className="h-4 w-4" aria-hidden="true" />Se déconnecter
              </button>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={() => setMenuOpen(o => !o)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label={`Compte : ${displayName}`}
          className={`flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left hover:bg-secondary ${!showExpanded ? 'justify-center' : ''}`}
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold uppercase text-primary">{displayName.charAt(0)}</span>
          {showExpanded && (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold leading-tight text-foreground">{displayName}</span>
                <span className="block truncate text-xs text-muted-foreground">{roleLabel}</span>
              </span>
              <EllipsisVertical className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
