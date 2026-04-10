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

const StatisticsPage = React.lazy(() => import('./pages/StatisticsPage').then(m => ({ default: m.StatisticsPage })));
const CompanySettingsPage = React.lazy(() => import('./pages/CompanySettingsPage'));
const ClientsPage = React.lazy(() => import('./pages/ClientsPage'));
const ProductsPage = React.lazy(() => import('./pages/ProductsPage'));
const TechnicalSheetsPage = React.lazy(() => import('./pages/TechnicalSheetsPage'));
const PublicSharePage = React.lazy(() => import('./pages/PublicSharePage'));

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
    // Allow public share page without auth
    const path = window.location.pathname;
    if (path.startsWith('/share/')) {
      return (
        <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-400" /></div>}>
          <Routes>
            <Route path="/share/:token" element={<PublicSharePage />} />
          </Routes>
        </Suspense>
      );
    }

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
            <Route path="/clients" element={<ClientsPage />} />
            <Route path="/products" element={<ProductsPage />} />
            <Route path="/sheets" element={<TechnicalSheetsPage />} />
            <Route path="/share/:token" element={<PublicSharePage />} />
            <Route path="/admin/statistics" element={<StatisticsPage />} />
            <Route path="/admin/settings" element={<CompanySettingsPage />} />
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
