import React, { Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
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
const ComptabiliteHome = React.lazy(() => import('./pages/comptabilite/ComptabiliteHome'));
const PlanComptablePage = React.lazy(() => import('./pages/comptabilite/PlanComptablePage'));
const JournalEntryPage = React.lazy(() => import('./pages/comptabilite/JournalEntryPage'));
const GrandLivrePage = React.lazy(() => import('./pages/comptabilite/GrandLivrePage'));
const BalancePage = React.lazy(() => import('./pages/comptabilite/BalancePage'));
const AComptabiliserPage = React.lazy(() => import('./pages/comptabilite/AComptabiliserPage'));
const LettragePage = React.lazy(() => import('./pages/comptabilite/LettragePage'));
const TvaPage = React.lazy(() => import('./pages/comptabilite/TvaPage'));
const EtatsSynthesePage = React.lazy(() => import('./pages/comptabilite/EtatsSynthesePage'));
const CloturePage = React.lazy(() => import('./pages/comptabilite/CloturePage'));
const RapprochementPage = React.lazy(() => import('./pages/comptabilite/RapprochementPage'));
const ImmobilisationsPage = React.lazy(() => import('./pages/comptabilite/ImmobilisationsPage'));
const StockDashboardPage = React.lazy(() => import('./pages/inventaire/StockDashboardPage'));
const StockLevelsPage = React.lazy(() => import('./pages/inventaire/StockLevelsPage'));
const StockMovementsPage = React.lazy(() => import('./pages/inventaire/StockMovementsPage'));
const StockReceivePage = React.lazy(() => import('./pages/inventaire/StockReceivePage'));
const StockTransferPage = React.lazy(() => import('./pages/inventaire/StockTransferPage'));
const StockCountPage = React.lazy(() => import('./pages/inventaire/StockCountPage'));
const StockReportsPage = React.lazy(() => import('./pages/inventaire/StockReportsPage'));
const PurchaseOrdersPage = React.lazy(() => import('./pages/inventaire/PurchaseOrdersPage'));
const PurchaseOrderDetailPage = React.lazy(() => import('./pages/inventaire/PurchaseOrderDetailPage'));
const EmployeesPage = React.lazy(() => import('./pages/paie/EmployeesPage'));
const PayslipsPage = React.lazy(() => import('./pages/paie/PayslipsPage'));
const PayslipDetailPage = React.lazy(() => import('./pages/paie/PayslipDetailPage'));
const SimulationPage = React.lazy(() => import('./pages/paie/SimulationPage'));
const PayrollRunPage = React.lazy(() => import('./pages/paie/PayrollRunPage'));
const CongesPage = React.lazy(() => import('./pages/paie/CongesPage'));
const AvancesPage = React.lazy(() => import('./pages/paie/AvancesPage'));
const DeclarationsPage = React.lazy(() => import('./pages/paie/DeclarationsPage'));
const StcPage = React.lazy(() => import('./pages/paie/StcPage'));
const AttestationsPage = React.lazy(() => import('./pages/paie/AttestationsPage'));
const RubriquesPage = React.lazy(() => import('./pages/paie/RubriquesPage'));
const ParametresPaiePage = React.lazy(() => import('./pages/paie/ParametresPaiePage'));
const CataloguePage = React.lazy(() => import('./pages/catalogue/CataloguePage'));
const WhatsappConnectionPage = React.lazy(() => import('./pages/whatsapp/ConnectionCenterPage'));
const WhatsappContactsPage = React.lazy(() => import('./pages/whatsapp/ContactsPage'));
const WhatsappStudioPage = React.lazy(() => import('./pages/whatsapp/StudioPage'));
const WhatsappCampaignsPage = React.lazy(() => import('./pages/whatsapp/CampaignsPage'));
const WhatsappAnalyticsPage = React.lazy(() => import('./pages/whatsapp/AnalyticsPage'));
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
  const { canCreateQuote, isAdmin, isCompta, isSuperAdmin, isFacturation, isPaie, isStock, isTasks, isTasksOnly } = useAuth();
  const isAccounting = isSuperAdmin || isAdmin || isCompta;
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
            <Route path="/" element={isTasksOnly ? <Navigate to="/tasks/mine" replace /> : <Home />} />
            {!isTasksOnly && (
            <>
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
            <Route path="/catalogue" element={<CataloguePage />} />
            <Route path="/whatsapp" element={<WhatsappConnectionPage />} />
            <Route path="/whatsapp/contacts" element={<WhatsappContactsPage />} />
            <Route path="/whatsapp/studio" element={<WhatsappStudioPage />} />
            <Route path="/whatsapp/campaigns" element={<WhatsappCampaignsPage />} />
            <Route path="/whatsapp/analytics" element={<WhatsappAnalyticsPage />} />
            <Route path="/share/:token" element={<PublicSharePage />} />
            <Route path="/admin/statistics" element={<StatisticsPage />} />
            <Route path="/admin/settings" element={<CompanySettingsPage />} />
            </>
            )}
            {!isTasksOnly && isSuperAdmin && (
              <>
                <Route path="/companies" element={<CompaniesPage />} />
                <Route path="/admin/users" element={<UserManagementPage />} />
                <Route path="/admin/backup" element={<BackupPage />} />
                <Route path="/admin/import" element={<ImportPage />} />
              </>
            )}
            {isAccounting && (
              <>
                <Route path="/comptabilite" element={<ComptabiliteHome />} />
                <Route path="/comptabilite/plan" element={<PlanComptablePage />} />
                <Route path="/comptabilite/a-comptabiliser" element={<AComptabiliserPage />} />
                <Route path="/comptabilite/journaux" element={<JournalEntryPage />} />
                <Route path="/comptabilite/lettrage" element={<LettragePage />} />
                <Route path="/comptabilite/grand-livre" element={<GrandLivrePage />} />
                <Route path="/comptabilite/balance" element={<BalancePage />} />
                <Route path="/comptabilite/tva" element={<TvaPage />} />
                <Route path="/comptabilite/etats" element={<EtatsSynthesePage />} />
                <Route path="/comptabilite/cloture" element={<CloturePage />} />
                <Route path="/comptabilite/banque" element={<RapprochementPage />} />
                <Route path="/comptabilite/immobilisations" element={<ImmobilisationsPage />} />
              </>
            )}
            {(isFacturation || isSuperAdmin) && (
              <>
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
            {(isStock || isSuperAdmin) && (
              <>
                <Route path="/inventaire" element={<StockDashboardPage />} />
                <Route path="/inventaire/niveaux" element={<StockLevelsPage />} />
                <Route path="/inventaire/mouvements" element={<StockMovementsPage />} />
                <Route path="/inventaire/reception" element={<StockReceivePage />} />
                <Route path="/inventaire/transfert" element={<StockTransferPage />} />
                <Route path="/inventaire/inventaire" element={<StockCountPage />} />
                <Route path="/inventaire/rapports" element={<StockReportsPage />} />
                <Route path="/inventaire/commandes" element={<PurchaseOrdersPage />} />
                <Route path="/inventaire/commandes/:id" element={<PurchaseOrderDetailPage />} />
              </>
            )}
            {(isPaie || isSuperAdmin) && (
              <>
                <Route path="/paie/employes" element={<EmployeesPage />} />
                <Route path="/paie/bulletins" element={<PayslipsPage />} />
                <Route path="/paie/bulletins/:id" element={<PayslipDetailPage />} />
                <Route path="/paie/journee" element={<PayrollRunPage />} />
                <Route path="/paie/conges" element={<CongesPage />} />
                <Route path="/paie/avances" element={<AvancesPage />} />
                <Route path="/paie/declarations" element={<DeclarationsPage />} />
                <Route path="/paie/stc" element={<StcPage />} />
                <Route path="/paie/attestations" element={<AttestationsPage />} />
                <Route path="/paie/simulation" element={<SimulationPage />} />
                <Route path="/paie/rubriques" element={<RubriquesPage />} />
                <Route path="/paie/parametres" element={<ParametresPaiePage />} />
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
            {isTasksOnly && <Route path="*" element={<Navigate to="/tasks/mine" replace />} />}
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
