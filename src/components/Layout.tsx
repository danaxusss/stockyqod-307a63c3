import React, { ReactNode, useState, useRef, useCallback } from 'react';
import { RefreshCw, ArrowLeft } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { Header } from './Header';
import { useAuth } from '../hooks/useAuth';
import { useUserAuth } from '../hooks/useUserAuth';
import { useAppContext } from '../context/AppContext';

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const { isAdmin } = useAuth();
  const { isAuthenticated: isUserAuthenticated } = useUserAuth();
  const { syncData } = useAppContext();
  const location = useLocation();

  const [startY, setStartY] = useState(0);
  const [pullDistance, setPullDistance] = useState(0);
  const [isPulling, setIsPulling] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const mainRef = useRef<HTMLElement>(null);

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

  const isHomePage = location.pathname === '/';

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />

      {/* Pull-to-refresh indicator */}
      {isUserAuthenticated && (isPulling || isSyncing) && (
        <div
          className="fixed top-14 left-1/2 z-40 transition-all duration-300 -translate-x-1/2"
          style={{ transform: `translateX(-50%) translateY(${Math.max(0, pullDistance - 40)}px)` }}
        >
          <div className="
            bg-card rounded-full p-2.5
            shadow-[0_4px_16px_rgba(0,0,0,0.12)]
            dark:shadow-[0_4px_16px_rgba(0,0,0,0.5)]
            border border-border/60
          ">
            <RefreshCw className={`h-4 w-4 text-primary ${isSyncing ? 'animate-spin' : ''}`} />
          </div>
        </div>
      )}

      <main
        ref={mainRef}
        className="container mx-auto px-3 py-4 flex-1 overflow-y-auto"
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

      {/* Back to home — clean, minimal */}
      {!isHomePage && (
        <div className="container mx-auto px-3 pb-4">
          <div className="flex justify-center">
            <Link
              to="/"
              className="
                inline-flex items-center gap-1.5
                px-4 py-1.5 rounded-full
                text-xs font-medium text-muted-foreground
                bg-secondary border border-border/60
                hover:bg-card hover:text-foreground hover:border-border
                transition-all duration-150
              "
            >
              <ArrowLeft className="h-3 w-3" />
              <span>Accueil</span>
            </Link>
          </div>
        </div>
      )}

      {/* Footer — minimal */}
      <footer className="py-2.5 border-t border-border/30">
        <div className="container mx-auto px-3 text-center">
          <p className="text-[10px] text-muted-foreground/50 font-medium tracking-wide">
            Stocky V2.2 · Cuisimat Gr ·{' '}
            <a
              href="https://www.qodweb.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary/60 hover:text-primary transition-colors"
            >
              QodWeb
            </a>
            {' '}2026
          </p>
        </div>
      </footer>
    </div>
  );
}
