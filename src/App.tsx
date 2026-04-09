import React, { Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AppProvider, useAppContext } from './context/AppContext';
import { ToastProvider } from './context/ToastContext';
import { Layout } from './components/Layout';
import { LoginModal } from './components/LoginModal';
import { FloatingQuoteCart } from './components/FloatingQuoteCart';
import { AIChatWidget } from './components/AIChatWidget';
import { useAuth } from './hooks/useAuth';
import { useUserAuth } from './hooks/useUserAuth';

// Lazy-loaded pages
const Home = React.lazy(() => import('./pages/Home').then(m => ({ default: m.Home })));
const SearchPage = React.lazy(() => import('./pages/Search').then(m => ({ default: m.SearchPage })));
const ProductDetail = React.lazy(() => import('./pages/ProductDetail').then(m => ({ default: m.ProductDetail })));
const QuoteCartPage = React.lazy(() => import('./pages/QuoteCartPage').then(m => ({ default: m.QuoteCartPage })));
const QuotesHistoryPage = React.lazy(() => import('./pages/QuotesHistoryPage').then(m => ({ default: m.QuotesHistoryPage })));
const UserManagementPage = React.lazy(() => import('./pages/UserManagementPage'));
const StatisticsPage = React.lazy(() => import('./pages/StatisticsPage').then(m => ({ default: m.StatisticsPage })));

function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
    </div>
  );
}

function AppContent() {
  const { activeLoginModalRole, openLoginModal } = useAppContext();
  const { canCreateQuote } = useAuth();
  const { isAuthenticated: isUserAuthenticated } = useUserAuth();

  const handleUserLoginSuccess = () => {};

  const handleAdminLoginSuccess = () => {
    openLoginModal(null);
  };

  if (!isUserAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <LoginModal 
          roleType="user"
          isInitialGate={true}
          onClose={() => {}}
          onLoginSuccess={handleUserLoginSuccess}
        />
      </div>
    );
  }

  return (
    <>
      <Layout>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/product/:id" element={<ProductDetail />} />
            {canCreateQuote() && (
              <>
                <Route path="/quote-cart" element={<QuoteCartPage />} />
                <Route path="/quote-cart/:quoteId" element={<QuoteCartPage />} />
                <Route path="/quotes-history" element={<QuotesHistoryPage />} />
              </>
            )}
            <Route path="/admin/users" element={<UserManagementPage />} />
            <Route path="/admin/statistics" element={<StatisticsPage />} />
          </Routes>
        </Suspense>
      </Layout>

      {canCreateQuote() && <FloatingQuoteCart />}
      <AIChatWidget />

      {activeLoginModalRole === 'admin' && (
        <LoginModal 
          roleType="admin"
          isInitialGate={false}
          onClose={() => openLoginModal(null)}
          onLoginSuccess={handleAdminLoginSuccess}
        />
      )}
    </>
  );
}

function App() {
  return (
    <AppProvider>
      <ToastProvider>
        <Router>
          <AppContent />
        </Router>
      </ToastProvider>
    </AppProvider>
  );
}

export default App;
