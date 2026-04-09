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
  
  // Pull-to-refresh state
  const [startY, setStartY] = useState(0);
  const [pullDistance, setPullDistance] = useState(0);
  const [isPulling, setIsPulling] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const mainRef = useRef<HTMLElement>(null);

  const PULL_THRESHOLD = 80; // Minimum distance to trigger refresh
  const MAX_PULL_DISTANCE = 120; // Maximum pull distance

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!isUserAuthenticated) return;
    
    const touch = e.touches[0];
    setStartY(touch.pageY);
  }, [isUserAuthenticated]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isUserAuthenticated || !mainRef.current) return;

    const touch = e.touches[0];
    const currentY = touch.pageY;
    const deltaY = currentY - startY;

    // Only allow pull-to-refresh when at the top of the page
    if (mainRef.current.scrollTop === 0 && deltaY > 0) {
      e.preventDefault(); // Prevent native pull-to-refresh
      
      const distance = Math.min(deltaY * 0.5, MAX_PULL_DISTANCE); // Apply resistance
      setPullDistance(distance);
      setIsPulling(distance > 10);
    }
  }, [isUserAuthenticated, startY]);

  const handleTouchEnd = useCallback(async () => {
    if (!isUserAuthenticated) return;

    if (isPulling && pullDistance >= PULL_THRESHOLD) {
      setIsSyncing(true);
      try {
        await syncData(true); // Force sync
      } catch (error) {
        console.error('Pull-to-refresh sync failed:', error);
      } finally {
        setIsSyncing(false);
      }
    }

    // Reset pull state
    setPullDistance(0);
    setIsPulling(false);
    setStartY(0);
  }, [isUserAuthenticated, isPulling, pullDistance, syncData]);

  const pullIndicatorOpacity = isPulling || isSyncing ? 1 : 0;
  const pullIndicatorTransform = `translateY(${Math.max(0, pullDistance - 40)}px)`;

  // Check if we're on the home page
  const isHomePage = location.pathname === '/';

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 dark:from-slate-900 dark:via-blue-900 dark:to-indigo-900 flex flex-col">
      <Header />
      
      {/* Pull-to-refresh indicator */}
      {isUserAuthenticated && (
        <div 
          className="fixed top-16 left-1/2 transform -translate-x-1/2 z-40 transition-all duration-300 ease-out"
          style={{ 
            opacity: pullIndicatorOpacity,
            transform: `translateX(-50%) ${pullIndicatorTransform}`
          }}
        >
          <div className="bg-white dark:bg-slate-800 rounded-full p-3 shadow-lg border border-gray-200 dark:border-gray-700">
            <RefreshCw 
              className={`h-5 w-5 text-blue-600 dark:text-blue-400 ${
                isSyncing ? 'animate-spin' : ''
              }`} 
            />
          </div>
        </div>
      )}

      <main 
        ref={mainRef}
        className="container mx-auto px-4 py-6 flex-1 overflow-y-auto"
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
      
      {/* Home Button - Only show when NOT on home page */}
      {!isHomePage && (
        <div className="container mx-auto px-4 my-6">
          <div className="flex justify-center">
            <Link
              to="/"
              className="flex items-center space-x-2 px-6 py-3 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white rounded-xl shadow-lg hover:shadow-xl transition-all duration-200 transform hover:scale-105"
            >
              <Home className="h-5 w-5" />
              <span className="font-medium">Accueil</span>
            </Link>
          </div>
        </div>
      )}
      
      {/* Copyright Footer - Always at bottom */}
      <footer className="py-6 border-t border-white/20 backdrop-blur-sm mt-auto">
        <div className="container mx-auto px-4">
          <div className="text-center">
            <p className="text-sm text-gray-600 dark:text-gray-400 font-medium">
              Stocky V1.0 - Cuisimat Gr - By{' '}
              <a 
                href="https://www.qodweb.com" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:underline transition-colors font-semibold"
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