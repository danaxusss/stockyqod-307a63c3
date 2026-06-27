import React, { Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AppProvider, useAppContext } from './context/AppContext';
import { ToastProvider } from './context/ToastContext';
import { Layout } from './components/Layout';
import { LoginModal } from './components/LoginModal';
import { FloatingQuoteCart } from './components/FloatingQuoteCart';
import { useAuth } from './hooks/useAuth';
import { useUserAuth } from './hooks/useUserAuth';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Toaster as SonnerToaster } from './components/ui/sonner';

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
const ProductPhotosPage = React.lazy(() => import('./pages/ProductPhotosPage'));
const PublicSharePage = React.lazy(() => import('./pages/PublicSharePage'));
const CompaniesPage = React.lazy(() => import('./pages/CompaniesPage'));
const UserManagementPage = React.lazy(() => import('./pages/UserManagementPage'));
const ProformaDirectoryPage = React.lazy(() => import('./pages/compta/ProformaDirectoryPage'));
const ProformaDetailPage = React.lazy(() => import('./pages/compta/ProformaDetailPage'));
const InvoiceDirectoryPage = React.lazy(() => import('./pages/compta/InvoiceDirectoryPage'));
const InvoiceDetailPage = React.lazy(() => import('./pages/compta/InvoiceDetailPage'));
const ClientFinancialPage = React.lazy(() => import('./pages/compta/ClientFinancialPage'));
const BLDirectoryPage = React.lazy(() => import('./pages/compta/BLDirectoryPage'));
const BLDetailPage = React.lazy(() => import('./pages/compta/BLDetailPage'));
const ReturnsPage = React.lazy(() => import('./pages/compta/ReturnsPage'));
const AvoirDirectoryPage = React.lazy(() => import('./pages/compta/AvoirDirectoryPage'));
const AvoirDetailPage = React.lazy(() => import('./pages/compta/AvoirDetailPage'));
const BonCommandeDirectoryPage = React.lazy(() => import('./pages/compta/BonCommandeDirectoryPage'));
const BonCommandeDetailPage = React.lazy(() => import('./pages/compta/BonCommandeDetailPage'));
const BackupPage = React.lazy(() => import('./pages/BackupPage'));
const ImportPage = React.lazy(() => import('./pages/ImportPage'));
const ComptabiliteComingSoon = React.lazy(() => import('./pages/ComptabiliteComingSoon'));
const EmployeesPage = React.lazy(() => import('./pages/paie/EmployeesPage'));
const PayslipsPage = React.lazy(() => import('./pages/paie/PayslipsPage'));
const PayslipDetailPage = React.lazy(() => import('./pages/paie/PayslipDetailPage'));
const TasksLayout = React.lazy(() => import('./tasks/TasksLayout'));
const TasksDashboard = React.lazy(() => import('./tasks/pages/Dashboard'));
const TasksList = React.lazy(() => import('./tasks/pages/SalesTasks'));
const TasksMine = React.lazy(() => import('./tasks/pages/MyTasks'));
const TasksArchive = React.lazy(() => import('./tasks/pages/Archive'));
const TasksContacts = React.lazy(() => import('./tasks/pages/Contacts'));
const TrackDelivery = React.lazy(() => import('./tasks/pages/TrackDelivery'));
const TasksLanguageProvider = React.lazy(() =>
  import('./tasks/contexts/LanguageContext').then(m => ({ default: m.LanguageProvider }))
);

function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
    </div>
  );
}

function AppContent() {
  const { activeLoginModalRole, openLoginModal } = useAppContext();
  const { canCreateQuote, isSuperAdmin, isFacturation, isPaie, isTasks } = useAuth();
  const { isAuthenticated: isUserAuthenticated } = useUserAuth();

  const handleUserLoginSuccess = () => {};

  const handleAdminLoginSuccess = () => {
    openLoginModal(null);
  };

  if (!isUserAuthenticated) {
    // Allow public pages without auth (shared quotes + delivery tracking)
    const path = window.location.pathname;
    if (path.startsWith('/share/') || path.startsWith('/track/')) {
      return (
        <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-400" /></div>}>
          <Routes>
            <Route path="/share/:token" element={<PublicSharePage />} />
            <Route path="/track/:token" element={<TasksLanguageProvider><TrackDelivery /></TasksLanguageProvider>} />
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
        <ErrorBoundary>
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
            <Route path="/photos" element={<ProductPhotosPage />} />
            <Route path="/share/:token" element={<PublicSharePage />} />
            <Route path="/admin/statistics" element={<StatisticsPage />} />
            <Route path="/admin/settings" element={<CompanySettingsPage />} />
            {isSuperAdmin && (
              <>
                <Route path="/companies" element={<CompaniesPage />} />
                <Route path="/admin/users" element={<UserManagementPage />} />
                <Route path="/admin/backup" element={<BackupPage />} />
                <Route path="/admin/import" element={<ImportPage />} />
              </>
            )}
            {(isFacturation || isSuperAdmin) && (
              <>
                <Route path="/comptabilite" element={<ComptabiliteComingSoon />} />
                <Route path="/compta/bls" element={<BLDirectoryPage />} />
                <Route path="/compta/bls/:id" element={<BLDetailPage />} />
                <Route path="/compta/proformas" element={<ProformaDirectoryPage />} />
                <Route path="/compta/proformas/:id" element={<ProformaDetailPage />} />
                <Route path="/compta/invoices" element={<InvoiceDirectoryPage />} />
                <Route path="/compta/invoices/:id" element={<InvoiceDetailPage />} />
                <Route path="/compta/clients" element={<ClientFinancialPage />} />
                <Route path="/compta/returns" element={<ReturnsPage />} />
                <Route path="/compta/avoirs" element={<AvoirDirectoryPage />} />
                <Route path="/compta/avoirs/:id" element={<AvoirDetailPage />} />
                <Route path="/compta/bons-commande" element={<BonCommandeDirectoryPage />} />
                <Route path="/compta/bons-commande/:id" element={<BonCommandeDetailPage />} />
              </>
            )}
            {(isPaie || isSuperAdmin) && (
              <>
                <Route path="/paie/employes" element={<EmployeesPage />} />
                <Route path="/paie/bulletins" element={<PayslipsPage />} />
                <Route path="/paie/bulletins/:id" element={<PayslipDetailPage />} />
              </>
            )}
            {(isTasks || isSuperAdmin) && (
              <Route element={<TasksLayout />}>
                <Route path="/tasks" element={<TasksList />} />
                <Route path="/tasks/dashboard" element={<TasksDashboard />} />
                <Route path="/tasks/mine" element={<TasksMine />} />
                <Route path="/tasks/archive" element={<TasksArchive />} />
                <Route path="/tasks/contacts" element={<TasksContacts />} />
              </Route>
            )}
            <Route path="/track/:token" element={<TasksLanguageProvider><TrackDelivery /></TasksLanguageProvider>} />
          </Routes>
        </Suspense>
        </ErrorBoundary>
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
    <ErrorBoundary>
      <AppProvider>
        <ToastProvider>
          <Router>
            <ErrorBoundary>
              <AppContent />
            </ErrorBoundary>
            <SonnerToaster position="top-right" />
          </Router>
        </ToastProvider>
      </AppProvider>
    </ErrorBoundary>
  );
}

export default App;
