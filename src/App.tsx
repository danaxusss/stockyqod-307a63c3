import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AppProvider, useAppContext } from './context/AppContext';
import { ToastProvider } from './context/ToastContext';
import { Layout } from './components/Layout';
import { Home } from './pages/Home';
import { SearchPage } from './pages/Search';
import { ProductDetail } from './pages/ProductDetail';
import { QuoteCartPage } from './pages/QuoteCartPage';
import { QuotesHistoryPage } from './pages/QuotesHistoryPage';
import UserManagementPage from './pages/UserManagementPage';
import { StatisticsPage } from './pages/StatisticsPage';
import { LoginModal } from './components/LoginModal';
import { FloatingQuoteCart } from './components/FloatingQuoteCart';
import { useAuth } from './hooks/useAuth';
import { useUserAuth } from './hooks/useUserAuth';

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
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 dark:from-slate-900 dark:via-blue-900 dark:to-indigo-900 flex items-center justify-center">
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
      </Layout>

      {canCreateQuote() && <FloatingQuoteCart />}

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
