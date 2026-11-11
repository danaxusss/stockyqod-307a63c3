import React, { ReactNode, useState, useRef, useCallback, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { RefreshCw, Bot } from 'lucide-react';
import { useUserAuth } from '../hooks/useUserAuth';
import { useAppContext } from '../context/AppContext';
import { Sidebar } from './Sidebar';
import { AIChatWidget } from './AIChatWidget';
import { CommandPalette } from './CommandPalette';
import { MobileHeader, MobileTabBar } from './MobileNav';
import { cartHiddenOn, documentTitle } from '../utils/pageTitles';

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const { isAuthenticated: isUserAuthenticated } = useUserAuth();
  const { syncData } = useAppContext();
  const { pathname } = useLocation();

  // Name the browser tab after the page, so tabs and history are readable.
  useEffect(() => { document.title = documentTitle(pathname); }, [pathname]);

  const [startY, setStartY] = useState(0);
  const [pullDistance, setPullDistance] = useState(0);
  const [isPulling, setIsPulling] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const PULL_THRESHOLD = 80;
  const MAX_PULL_DISTANCE = 120;

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!isUserAuthenticated) return;
    setStartY(e.touches[0].pageY);
  }, [isUserAuthenticated]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isUserAuthenticated || !mainRef.current) return;
    const deltaY = e.touches[0].pageY - startY;
    if (mainRef.current.scrollTop === 0 && deltaY > 0) {
      e.preventDefault();
      const distance = Math.min(deltaY * 0.5, MAX_PULL_DISTANCE);
      setPullDistance(distance);
      setIsPulling(distance > 10);
    }
  }, [isUserAuthenticated, startY]);

  const handleTouchEnd = useCallback(async () => {
    if (!isUserAuthenticated) return;
    if (isPulling && pullDistance >= PULL_THRESHOLD) {
      setIsSyncing(true);
      try { await syncData(true); } catch (e) { console.error(e); } finally { setIsSyncing(false); }
    }
    setPullDistance(0);
    setIsPulling(false);
    setStartY(0);
  }, [isUserAuthenticated, isPulling, pullDistance, syncData]);

  const [chatOpen, setChatOpen] = useState(false);

  return (
    <div className="h-screen bg-background flex overflow-hidden">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[300] focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2.5 focus:text-sm focus:font-semibold focus:text-primary-foreground focus:shadow-lg">
        Aller au contenu
      </a>
      {/* Mobile sidebar backdrop */}
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}

      <Sidebar mobileOpen={mobileSidebarOpen} onMobileClose={() => setMobileSidebarOpen(false)} />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Phone: page name and back arrow (the menu is in the bottom bar) */}
        <MobileHeader />

        {/* Pull-to-refresh indicator */}
        {isUserAuthenticated && (isPulling || isSyncing) && (
          <div
            className="absolute top-4 left-1/2 z-40 -translate-x-1/2 transition-all duration-300"
            style={{ transform: `translateX(-50%) translateY(${Math.max(0, pullDistance - 40)}px)` }}
          >
            <div className="bg-card rounded-full p-2.5 shadow-[0_4px_16px_rgba(0,0,0,0.12)] dark:shadow-[0_4px_16px_rgba(0,0,0,0.5)] border border-border/60">
              <RefreshCw className={`h-4 w-4 text-primary ${isSyncing ? 'animate-spin' : ''}`} />
            </div>
          </div>
        )}

        <main
          ref={mainRef}
          id="main-content"
          tabIndex={-1}
          // Room under the content for the floating quote cart (and, on
          // phones, the bottom bar), so they never cover the last row.
          className={`flex-1 overflow-y-auto px-4 pt-4 focus:outline-none pb-28 ${cartHiddenOn(pathname) ? 'md:pb-6' : 'md:pb-20'}`}
          onTouchStart={isUserAuthenticated ? handleTouchStart : undefined}
          onTouchMove={isUserAuthenticated ? handleTouchMove : undefined}
          onTouchEnd={isUserAuthenticated ? handleTouchEnd : undefined}
          style={{
            // Only transform while pulling: any transform (even translateY(0))
            // makes every position:fixed overlay inside the page (dialogs, the
            // bulk-edit bar…) position against <main> instead of the screen,
            // shifting it off-screen on phones and under the floating cart.
            transform: isPulling ? `translateY(${Math.min(pullDistance * 0.3, 30)}px)` : undefined,
            transition: isPulling ? 'none' : 'transform 0.3s ease-out',
          }}
        >
          {children}
        </main>

        <footer className="hidden py-2 border-t border-border/30 shrink-0 md:block">
          <div className="px-4 text-center">
            <p className="text-[11px] text-muted-foreground font-medium tracking-wide">
              Stocky V2.2 · Cuisimat Gr ·{' '}
              <a href="https://www.qodweb.com" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-6 items-center text-primary underline underline-offset-2 hover:no-underline">
                QodWeb
              </a>
              {' '}2026
            </p>
          </div>
        </footer>
      </div>

      <MobileTabBar onMenu={() => setMobileSidebarOpen(true)} />
      <CommandPalette />

      {/* AI Chat side panel — desktop only */}
      <div className={`hidden md:flex flex-col border-l border-border/40 bg-card shrink-0 overflow-hidden transition-[width] duration-200 ease-in-out ${chatOpen ? 'w-80' : 'w-0'}`}>
        {chatOpen && <AIChatWidget embedded onClose={() => setChatOpen(false)} />}
      </div>

      {/* AI Chat tab button — desktop only */}
      {!chatOpen && (
        <button
          onClick={() => setChatOpen(true)}
          title="Assistant IA"
          aria-label="Assistant IA"
          className="hidden md:flex fixed right-0 top-1/2 -translate-y-1/2 z-30 flex-col items-center gap-1 py-3 px-1.5 bg-primary text-primary-foreground rounded-l-lg shadow-lg hover:bg-primary/90 transition-colors"
        >
          <Bot className="h-4 w-4" />
          <span className="text-[10px] font-semibold tracking-wide [writing-mode:vertical-lr] rotate-180">IA</span>
        </button>
      )}
    </div>
  );
}
