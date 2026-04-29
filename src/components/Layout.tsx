import React, { ReactNode, useState, useRef, useCallback } from 'react';
import { RefreshCw, Bot, Menu, Package } from 'lucide-react';
import { useUserAuth } from '../hooks/useUserAuth';
import { useAppContext } from '../context/AppContext';
import { Sidebar } from './Sidebar';
import { AIChatWidget } from './AIChatWidget';

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const { isAuthenticated: isUserAuthenticated } = useUserAuth();
  const { syncData } = useAppContext();

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
      {/* Mobile sidebar backdrop */}
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}

      <Sidebar mobileOpen={mobileSidebarOpen} onMobileClose={() => setMobileSidebarOpen(false)} />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile top bar */}
        <div className="md:hidden flex items-center h-12 px-3 border-b border-border/40 bg-card shrink-0 gap-2.5">
          <button
            onClick={() => setMobileSidebarOpen(true)}
            className="p-1.5 -ml-0.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            title="Menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-1.5">
            <div className="w-6 h-6 rounded-md bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center">
              <Package className="h-3.5 w-3.5 text-white" />
            </div>
            <span className="text-sm font-bold text-foreground">Stocky</span>
          </div>
        </div>

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
          className="flex-1 overflow-y-auto px-4 py-4"
          onTouchStart={isUserAuthenticated ? handleTouchStart : undefined}
          onTouchMove={isUserAuthenticated ? handleTouchMove : undefined}
          onTouchEnd={isUserAuthenticated ? handleTouchEnd : undefined}
          style={{
            transform: isPulling ? `translateY(${Math.min(pullDistance * 0.3, 30)}px)` : 'translateY(0)',
            transition: isPulling ? 'none' : 'transform 0.3s ease-out',
          }}
        >
          {children}
        </main>

        <footer className="py-2 border-t border-border/30 shrink-0">
          <div className="px-4 text-center">
            <p className="text-[10px] text-muted-foreground/50 font-medium tracking-wide">
              Stocky V2.2 · Cuisimat Gr ·{' '}
              <a href="https://www.qodweb.com" target="_blank" rel="noopener noreferrer" className="text-primary/60 hover:text-primary transition-colors">
                QodWeb
              </a>
              {' '}2026
            </p>
          </div>
        </footer>
      </div>

      {/* AI Chat side panel — desktop only */}
      <div className={`hidden md:flex flex-col border-l border-border/40 bg-card shrink-0 overflow-hidden transition-[width] duration-200 ease-in-out ${chatOpen ? 'w-80' : 'w-0'}`}>
        {chatOpen && <AIChatWidget embedded onClose={() => setChatOpen(false)} />}
      </div>

      {/* AI Chat tab button — desktop only */}
      {!chatOpen && (
        <button
          onClick={() => setChatOpen(true)}
          title="Assistant IA"
          className="hidden md:flex fixed right-0 top-1/2 -translate-y-1/2 z-30 flex-col items-center gap-1 py-3 px-1.5 bg-primary text-primary-foreground rounded-l-lg shadow-lg hover:bg-primary/90 transition-colors"
        >
          <Bot className="h-4 w-4" />
          <span className="text-[9px] font-semibold tracking-wide [writing-mode:vertical-lr] rotate-180">IA</span>
        </button>
      )}
    </div>
  );
}
