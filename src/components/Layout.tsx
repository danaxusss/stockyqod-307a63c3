import React, { ReactNode, useState, useRef, useCallback } from 'react';
import { RefreshCw, Home } from 'lucide-react';
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
          className="fixed top-14 left-1/2 -translate-x-1/2 z-40 transition-all duration-300"
          style={{ transform: `translateX(-50%) translateY(${Math.max(0, pullDistance - 40)}px)` }}
        >
          <div className="bg-card rounded-full p-2.5 shadow-lg border border-border">
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
          transition: isPulling ? 'none' : 'transform 0.3s ease-out'
        }}
      >
        {children}
      </main>
      
      {!isHomePage && (
        <div className="container mx-auto px-3 my-4">
          <div className="flex justify-center">
            <Link
              to="/"
              className="flex items-center space-x-2 px-5 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg shadow hover:shadow-lg transition-all duration-200 transform hover:scale-105 text-sm"
            >
              <Home className="h-4 w-4" />
              <span className="font-medium">Accueil</span>
            </Link>
          </div>
        </div>
      )}
      
      <footer className="py-3 border-t border-border/50 mt-auto">
        <div className="container mx-auto px-3">
          <div className="text-center">
            <p className="text-xs text-muted-foreground font-medium">
              Stocky V1.0 - Cuisimat Gr - By{' '}
              <a 
                href="https://www.qodweb.com" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-primary hover:text-primary/80 hover:underline transition-colors font-semibold"
              >
                QodWeb
              </a>
              {' '}2025
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
