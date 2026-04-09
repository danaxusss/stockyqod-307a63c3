// @ts-nocheck
import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  ShoppingCart, 
  Plus, 
  Minus, 
  Trash2, 
  Save, 
  FileDown, 
  Upload, 
  User, 
  Phone, 
  Building, 
  Calendar,
  Hash,
  DollarSign,
  Edit3,
  Check,
  X,
  Loader,
  Copy,
  FileText,
  Search,
  Package,
  Info
} from 'lucide-react';
import { Quote, QuoteItem, CustomerInfo, Product } from '../types';
import { ExcelExportService } from '../utils/excelExport';
import { PdfExportService } from '../utils/pdfExport';
import { CompanySettingsService, CompanySettings } from '../utils/companySettings';
import { SupabaseQuotesService } from '../utils/supabaseQuotes';
import { ActivityLogger } from '../utils/activityLogger';
import { useAppContext } from '../context/AppContext';
import { SupabaseUsersService } from '../utils/supabaseUsers';
import { useQuoteCart } from '../hooks/useQuoteCart';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../hooks/useAuth';

const ITEMS_PER_PAGE = 40;

// Margin percentage options for dropdown
const marginOptions = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100];

export function QuoteCartPage() {
  const { quoteId } = useParams<{ quoteId: string }>();
  const navigate = useNavigate();
  const isEditing = Boolean(quoteId);
  const { cart, emptyCart } = useQuoteCart();
  const { showToast } = useToast();
  const { state } = useAppContext();

  // Quote state
  const [quote, setQuote] = useState<Quote | null>(null);
  const [items, setItems] = useState<QuoteItem[]>([]);
  const [customer, setCustomer] = useState<CustomerInfo>({
    fullName: '',
    phoneNumber: '',
    address: '',
    city: '',
    salesPerson: ''
  });
  const [quoteNumber, setQuoteNumber] = useState('');
  const [commandNumber, setCommandNumber] = useState('');
  const [status, setStatus] = useState<'draft' | 'final'>('draft');
  const [notes, setNotes] = useState('');

  // UI state
  const [currentPage, setCurrentPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  // Company settings for PDF export
  const [companySettings, setCompanySettings] = useState<CompanySettings | null>(null);

  // Product search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Product[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showProductSearch, setShowProductSearch] = useState(false);

  // Auto-save timer
  const [autoSaveTimer, setAutoSaveTimer] = useState<NodeJS.Timeout | null>(null);

  // Users state for sales person dropdown
  const [availableUsers, setAvailableUsers] = useState<{ username: string; displayName: string }[]>([]);
  const { currentUser, authenticatedUser } = useAuth();

  // Load quote data if editing
  useEffect(() => {
    const loadQuote = async () => {
      if (!isEditing) {
        // Generate new quote number for new quotes
        setQuoteNumber(ExcelExportService.generateQuoteNumber());
        // Load items from cart if available
        if (cart.items.length > 0) {
          setItems(cart.items);
        }
        // Set default sales person to current user
        const currentUsername = currentUser?.username || authenticatedUser?.username || '';
        if (currentUsername) {
          setCustomer(prev => ({ ...prev, salesPerson: currentUsername }));
        }
        return;
      }

      setIsLoading(true);
      try {
        const loadedQuote = await SupabaseQuotesService.getQuote(quoteId!);
        if (loadedQuote) {
          setQuote(loadedQuote);
          setItems(loadedQuote.items);
          setCustomer(loadedQuote.customer);
          setQuoteNumber(loadedQuote.quoteNumber);
          setCommandNumber(loadedQuote.commandNumber || '');
          setStatus(loadedQuote.status);
          setNotes(loadedQuote.notes || '');
        } else {
          showToast({
            type: 'error',
            title: 'Erreur',
            message: 'Devis non trouvé'
          });
          navigate('/quotes-history');
        }
      } catch (error) {
        console.error('Failed to load quote:', error);
        showToast({
          type: 'error',
          title: 'Erreur de chargement',
          message: 'Erreur lors du chargement du devis'
        });
      } finally {
        setIsLoading(false);
      }
    };

    loadQuote();
  }, [quoteId, isEditing, navigate, cart.items, showToast, currentUser, authenticatedUser]);

  // Load company settings for PDF export
  useEffect(() => {
    CompanySettingsService.getSettings().then(setCompanySettings).catch(console.error);
  }, []);

  // Load available users for sales person dropdown
  useEffect(() => {
    const loadUsers = async () => {
      try {
        const users = await SupabaseUsersService.getAllUsers();
        const quoteEnabledUsers = users
          .filter(user => user.can_create_quote)
          .map(user => ({
            username: user.username,
            displayName: user.username
          }))
          .sort((a, b) => a.username.localeCompare(b.username));
        
        setAvailableUsers(quoteEnabledUsers);
      } catch (error) {
        console.error('Failed to load users:', error);
        // Fallback: if we can't load users, at least include current user
        const currentUsername = currentUser?.username || authenticatedUser?.username;
        if (currentUsername) {
          setAvailableUsers([{ username: currentUsername, displayName: currentUsername }]);
        }
      }
    };

    loadUsers();
  }, [currentUser, authenticatedUser]);

  // Auto-save functionality
  useEffect(() => {
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer);
    }

    // Only auto-save if we have customer info or items
    if (customer.fullName || items.length > 0) {
      const timer = setTimeout(() => {
        handleSave(true); // Auto-save
      }, 5 * 60 * 1000); // 5 minutes

      setAutoSaveTimer(timer);
    }

    return () => {
      if (autoSaveTimer) {
        clearTimeout(autoSaveTimer);
      }
    };
  }, [customer, items]);

  // Product search functionality
  const handleProductSearch = async () => {
    if (searchQuery.trim().length < 3) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const q = searchQuery.toLowerCase();
      const results = state.products.filter(p =>
        p.name.toLowerCase().includes(q) || p.barcode.includes(q) || p.brand.toLowerCase().includes(q)
      );
      setSearchResults(results.slice(0, 20));
    } catch (error) {
      console.error('Search failed:', error);
      showToast({
        type: 'error',
        title: 'Erreur de recherche',
        message: 'Erreur lors de la recherche'
      });
    } finally {
      setIsSearching(false);
    }
  };

  // Add product from search to quote
  const addProductToQuote = (product: Product) => {
    const newItem: QuoteItem = {
      id: `${product.barcode}-${Date.now()}`,
      product,
      priceType: 'normal',
      marginPercentage: 20,
      finalPrice: product.price,
      addedAt: new Date(),
      unitPrice: product.price,
      quantity: 1,
      subtotal: product.price
    };

    setItems(prev => [...prev, newItem]);
    setSearchQuery('');
    setSearchResults([]);
    setShowProductSearch(false);
    
    showToast({
      type: 'success',
      message: `${product.name} ajouté au devis`
    });
  };

  // Enhanced custom product function with barcode and brand
  const addCustomProduct = () => {
    try {
      // Get barcode
      const barcode = prompt('Code-barres du produit:');
      if (!barcode || !barcode.trim()) {
        showToast({
          type: 'warning',
          title: 'Champ requis',
          message: 'Le code-barres est requis'
        });
        return;
      }

      // Get product name
      const productName = prompt('Nom du produit:');
      if (!productName || !productName.trim()) {
        showToast({
          type: 'warning',
          title: 'Champ requis',
          message: 'Le nom du produit est requis'
        });
        return;
      }

      // Get brand
      const brand = prompt('Marque du produit:');
      if (!brand || !brand.trim()) {
        showToast({
          type: 'warning',
          title: 'Champ requis',
          message: 'La marque est requise'
        });
        return;
      }

      // Get unit price
      const unitPriceStr = prompt('Prix unitaire:');
      const unitPrice = parseFloat(unitPriceStr || '0');
      if (isNaN(unitPrice) || unitPrice <= 0) {
        showToast({
          type: 'error',
          title: 'Prix invalide',
          message: 'Le prix unitaire doit être un nombre positif'
        });
        return;
      }

      // Check if barcode already exists in current items
      const existingItem = items.find(item => item.product.barcode === barcode.trim());
      if (existingItem) {
        showToast({
          type: 'warning',
          title: 'Produit existant',
          message: 'Un produit avec ce code-barres existe déjà dans le devis'
        });
        return;
      }

      const customProduct: Product = {
        barcode: barcode.trim(),
        name: productName.trim(),
        brand: brand.trim(),
        techsheet: '',
        price: unitPrice,
        buyprice: unitPrice * 0.8, // Assume 20% margin
        reseller_price: unitPrice * 0.9,
        provider: 'Manuel',
        stock_levels: {}
      };

      const newItem: QuoteItem = {
        id: `custom-${Date.now()}`,
        product: customProduct,
        priceType: 'normal',
        marginPercentage: 20,
        finalPrice: unitPrice,
        addedAt: new Date(),
        unitPrice: unitPrice,
        quantity: 1,
        subtotal: unitPrice
      };

      setItems(prev => [...prev, newItem]);
      
      showToast({
        type: 'success',
        title: 'Produit ajouté',
        message: `${productName} (${brand}) ajouté au devis`
      });
    } catch (error) {
      console.error('Error in addCustomProduct:', error);
      showToast({
        type: 'error',
        title: 'Erreur inattendue',
        message: `Une erreur s'est produite lors de l'ajout du produit: ${error instanceof Error ? error.message : 'Erreur inconnue'}`
      });
    }
  };

  // Calculate totals
  const calculateTotals = useCallback(() => {
    const totalAmount = items.reduce((sum, item) => sum + item.subtotal, 0);
    const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);
    
    return { totalAmount, totalItems };
  }, [items]);

  // Update item quantity
  const updateItemQuantity = (itemId: string, newQuantity: number) => {
    if (newQuantity < 1) return;
    
    setItems(prevItems => 
      prevItems.map(item => 
        item.id === itemId 
          ? { 
              ...item, 
              quantity: newQuantity, 
              subtotal: item.unitPrice * newQuantity 
            }
          : item
      )
    );
  };

  // Update item unit price
  const updateItemUnitPrice = (itemId: string, newUnitPrice: number) => {
    if (newUnitPrice < 0) return;
    
    setItems(prevItems => 
      prevItems.map(item => 
        item.id === itemId 
          ? { 
              ...item, 
              unitPrice: newUnitPrice, 
              subtotal: newUnitPrice * item.quantity 
            }
          : item
      )
    );
  };

  // Update item margin percentage and recalculate price
  const updateItemMargin = (itemId: string, newMarginPercentage: number) => {
    if (newMarginPercentage < 0) return;
    
    setItems(prevItems => 
      prevItems.map(item => {
        if (item.id === itemId) {
          // Calculate new unit price based on buy price and new margin
          const newUnitPrice = item.product.buyprice + (item.product.buyprice * (newMarginPercentage / 100));
          return {
            ...item,
            marginPercentage: newMarginPercentage,
            unitPrice: newUnitPrice,
            subtotal: newUnitPrice * item.quantity
          };
        }
        return item;
      })
    );
  };

  // Remove item
  const removeItem = (itemId: string) => {
    setItems(prevItems => prevItems.filter(item => item.id !== itemId));
  };

  // Validate form
  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};

    // Customer validation
    if (!customer.fullName.trim()) {
      errors.fullName = 'Le nom complet est requis';
    }

    if (!customer.phoneNumber.trim()) {
      errors.phoneNumber = 'Le numéro de téléphone est requis';
    }

    if (!customer.address.trim()) {
      errors.address = 'L\'adresse est requise';
    }

    if (!customer.city.trim()) {
      errors.city = 'La ville est requise';
    }

    if (!customer.salesPerson.trim()) {
      errors.salesPerson = 'Le nom du vendeur est requis';
    }

    // Items validation
    if (items.length === 0) {
      errors.items = 'Au moins un article est requis';
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Save quote
  const handleSave = async (isAutoSave = false) => {
    if (!isAutoSave && !validateForm()) {
      showToast({
        type: 'error',
        title: 'Erreurs de validation',
        message: 'Veuillez corriger les erreurs avant de sauvegarder'
      });
      return;
    }

    setIsSaving(true);
    try {
      const { totalAmount } = calculateTotals();
      const now = new Date();

      const quoteData: Quote = {
        id: quote?.id || `quote-${Date.now()}`,
        quoteNumber,
        commandNumber: commandNumber || undefined,
        createdAt: quote?.createdAt || now,
        updatedAt: now,
        status,
        customer,
        items,
        totalAmount,
        notes
      };

      await SupabaseQuotesService.saveQuote(quoteData);
      await ActivityLogger.log('quote_created', `Quote ${quoteNumber} saved`, 'quote', quoteData.id);
      setQuote(quoteData);
      setLastSaved(now);
      
      if (!isAutoSave) {
        showToast({
          type: 'success',
          title: 'Sauvegarde réussie',
          message: navigator.onLine 
            ? 'Devis sauvegardé localement et synchronisé avec le serveur'
            : 'Devis sauvegardé localement (sera synchronisé quand vous serez en ligne)'
        });
        // Clear cart if this was a new quote created from cart
        if (!isEditing && cart.items.length > 0) {
          emptyCart();
        }
        
        // Force reload of quotes list if we're navigating back
        if (window.location.pathname === '/quotes-history') {
          window.location.reload();
        }
      }
    } catch (error) {
      console.error('Failed to save quote:', error);
      if (!isAutoSave) {
        showToast({
          type: 'error',
          title: 'Erreur de sauvegarde',
          message: 'Erreur lors de la sauvegarde'
        });
      }
    } finally {
      setIsSaving(false);
    }
  };

  // Export to Excel
  const handleExport = async () => {
    if (!validateForm()) {
      showToast({
        type: 'error',
        title: 'Erreurs de validation',
        message: 'Veuillez corriger les erreurs avant d\'exporter'
      });
      return;
    }

    setIsExporting(true);
    try {
      const { totalAmount } = calculateTotals();
      const quoteData: Quote = {
        id: quote?.id || `quote-${Date.now()}`,
        quoteNumber,
        commandNumber: commandNumber || undefined,
        createdAt: quote?.createdAt || new Date(),
        updatedAt: new Date(),
        status,
        customer,
        items,
        totalAmount,
        notes
      };

      console.log('Exporting with template:', activeTemplate?.name || 'default');
      await ExcelExportService.exportQuoteToExcel(quoteData, activeTemplate || undefined);
      showToast({
        type: 'success',
        title: 'Export réussi',
        message: 'Devis exporté avec succès'
      });
    } catch (error) {
      console.error('Export failed:', error);
      showToast({
        type: 'error',
        title: 'Erreur d\'export',
        message: `Erreur lors de l'export Excel: ${error instanceof Error ? error.message : 'Erreur inconnue'}`
      });
    } finally {
      setIsExporting(false);
    }
  };

  // Handle template upload
  const handleTemplateUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      // Validate template
      await ExcelExportService.validateTemplate(file);

      // Convert file to ArrayBuffer
      const fileData = await file.arrayBuffer();

      // Save template
      const template: QuoteTemplate = {
        id: `template-${Date.now()}`,
        name: file.name,
        fileData,
        fileType: file.type,
        uploadedAt: new Date(),
        isActive: templates.length === 0 // First template becomes active
      };

      await SupabaseQuotesService.saveQuoteTemplate(template);
      
      const updatedTemplates = await SupabaseQuotesService.getQuoteTemplates();
      setTemplates(updatedTemplates);
      setTemplates(updatedTemplates);
      
      if (template.isActive) {
        setActiveTemplate(template);
      }

      showToast({
        type: 'success',
        title: 'Template uploadé',
        message: 'Template uploadé avec succès'
      });
      setShowTemplateUpload(false);
    } catch (error) {
      console.error('Template upload failed:', error);
      showToast({
        type: 'error',
        title: 'Erreur d\'upload',
        message: 'Erreur lors de l\'upload du template'
      });
    }

    // Reset file input
    event.target.value = '';
  };

  // Copy items to clipboard
  const handleCopyItems = async () => {
    try {
      const copyText = ExcelExportService.generateCopyText(items);
      await navigator.clipboard.writeText(copyText);
      showToast({
        type: 'success',
        message: 'Articles copiés dans le presse-papiers'
      });
    } catch (error) {
      console.error('Copy failed:', error);
      showToast({
        type: 'error',
        title: 'Erreur de copie',
        message: 'Erreur lors de la copie'
      });
    }
  };

  // Clear form
  const handleClearForm = () => {
    const confirmed = window.confirm('Êtes-vous sûr de vouloir effacer tous les champs ?');
    if (confirmed) {
      setCustomer({ fullName: '', phoneNumber: '', address: '', city: '', salesPerson: '' });
      setCommandNumber('');
      setNotes('');
      setValidationErrors({});
    }
  };

  // Pagination
  const totalPages = Math.ceil(items.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const currentItems = items.slice(startIndex, endIndex);

  const { totalAmount, totalItems } = calculateTotals();

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto">
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="text-muted-foreground mt-4">Chargement du devis...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="glass rounded-2xl shadow-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <div className="p-3 bg-primary rounded-xl">
              <ShoppingCart className="h-6 w-6 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">
                {isEditing ? 'Modifier le Devis' : 'Nouveau Devis'}
              </h1>
              <p className="text-muted-foreground">
                {isEditing ? `Devis ${quoteNumber}` : 'Créer un nouveau devis'}
              </p>
            </div>
          </div>

          {/* Status Badge */}
          <div className="flex items-center space-x-3">
            {lastSaved && (
              <span className="text-sm text-muted-foreground">
                Dernière sauvegarde: {lastSaved.toLocaleTimeString('fr-FR')}
              </span>
            )}
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as 'draft' | 'final')}
              className="px-3 py-1 border border-input rounded-lg bg-secondary text-foreground"
            >
              <option value="draft">Brouillon</option>
              <option value="final">Final</option>
            </select>
          </div>
        </div>

        {/* Quote Details */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="flex items-center space-x-3 p-3 bg-secondary rounded-lg">
            <Hash className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            <div>
              <p className="text-sm text-muted-foreground">Numéro de Devis</p>
              <p className="font-semibold text-foreground">{quoteNumber}</p>
            </div>
          </div>

          <div className="flex items-center space-x-3 p-3 bg-secondary rounded-lg">
            <Calendar className="h-5 w-5 text-green-600 dark:text-green-400" />
            <div>
              <p className="text-sm text-muted-foreground">Date</p>
              <p className="font-semibold text-foreground">
                {ExcelExportService.formatDate(quote?.createdAt || new Date())}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-3 p-3 bg-secondary rounded-lg">
            <DollarSign className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            <div>
              <p className="text-sm text-muted-foreground">Total</p>
              <p className="font-semibold text-foreground">
                {ExcelExportService.formatCurrency(totalAmount)} Dh
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Customer Information */}
      <div className="glass rounded-2xl shadow-xl p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-foreground flex items-center space-x-2">
            <User className="h-5 w-5" />
            <span>Informations Client</span>
          </h2>
          <button
            onClick={handleClearForm}
            className="px-3 py-1 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
          >
            Effacer
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Nom Complet *
            </label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                value={customer.fullName}
                onChange={(e) => setCustomer(prev => ({ ...prev, fullName: e.target.value }))}
                className={`w-full pl-10 pr-4 py-3 border rounded-lg focus:ring-2 focus:ring-ring bg-secondary text-foreground ${
                  validationErrors.fullName ? 'border-red-500' : 'border-input'
                }`}
                placeholder="Nom complet du client"
              />
            </div>
            {validationErrors.fullName && (
              <p className="mt-1 text-sm text-red-600 dark:text-red-400">{validationErrors.fullName}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Numéro de Téléphone *
            </label>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                value={customer.phoneNumber}
                onChange={(e) => setCustomer(prev => ({ ...prev, phoneNumber: e.target.value }))}
                className={`w-full pl-10 pr-4 py-3 border rounded-lg focus:ring-2 focus:ring-ring bg-secondary text-foreground ${
                  validationErrors.phoneNumber ? 'border-red-500' : 'border-input'
                }`}
                placeholder="Numéro de téléphone"
              />
            </div>
            {validationErrors.phoneNumber && (
              <p className="mt-1 text-sm text-red-600 dark:text-red-400">{validationErrors.phoneNumber}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Adresse *
            </label>
            <div className="relative">
              <Building className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                value={customer.address}
                onChange={(e) => setCustomer(prev => ({ ...prev, address: e.target.value }))}
                className={`w-full pl-10 pr-4 py-3 border rounded-lg focus:ring-2 focus:ring-ring bg-secondary text-foreground ${
                  validationErrors.address ? 'border-red-500' : 'border-input'
                }`}
                placeholder="Adresse du client"
              />
            </div>
            {validationErrors.address && (
              <p className="mt-1 text-sm text-red-600 dark:text-red-400">{validationErrors.address}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Ville *
            </label>
            <input
              type="text"
              value={customer.city}
              onChange={(e) => setCustomer(prev => ({ ...prev, city: e.target.value }))}
              className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-ring bg-secondary text-foreground ${
                validationErrors.city ? 'border-red-500' : 'border-input'
              }`}
              placeholder="Ville"
            />
            {validationErrors.city && (
              <p className="mt-1 text-sm text-red-600 dark:text-red-400">{validationErrors.city}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              ICE (Optionnel)
            </label>
            <input
              type="text"
              value={customer.ice || ''}
              onChange={(e) => setCustomer(prev => ({ ...prev, ice: e.target.value }))}
              className="w-full px-4 py-3 border border-input rounded-lg focus:ring-2 focus:ring-ring bg-secondary text-foreground"
              placeholder="Numéro ICE"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Vendeur *
            </label>
            <select
              value={customer.salesPerson}
              onChange={(e) => setCustomer(prev => ({ ...prev, salesPerson: e.target.value }))}
              className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-ring bg-secondary text-foreground ${
                validationErrors.salesPerson ? 'border-red-500' : 'border-input'
              }`}
            >
              <option value="">Sélectionner un vendeur</option>
              {availableUsers.map((user) => (
                <option key={user.username} value={user.username}>
                  {user.displayName}
                </option>
              ))}
            </select>
            {validationErrors.salesPerson && (
              <p className="mt-1 text-sm text-red-600 dark:text-red-400">{validationErrors.salesPerson}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Numéro de Commande
            </label>
            <input
              type="text"
              value={commandNumber}
              onChange={(e) => setCommandNumber(e.target.value)}
              className="w-full px-4 py-3 border border-input rounded-lg focus:ring-2 focus:ring-ring bg-secondary text-foreground"
              placeholder="Numéro de commande (optionnel)"
            />
          </div>
        </div>
      </div>

      {/* Product Search and Add */}
      <div className="glass rounded-2xl shadow-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg sm:text-xl font-semibold text-foreground flex items-center space-x-2">
            <Package className="h-5 w-5" />
            <span>Ajouter des Produits</span>
          </h2>
          <div className="flex flex-col sm:flex-row gap-2 sm:space-x-2">
            <button
              onClick={() => setShowProductSearch(!showProductSearch)}
              className="flex items-center justify-center space-x-1 sm:space-x-2 px-2 py-1.5 sm:px-4 sm:py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg transition-colors text-sm sm:text-base"
            >
              <Search className="h-4 w-4" />
              <span className="hidden xs:inline sm:inline">Rechercher</span>
              <span className="xs:hidden sm:hidden">Rech.</span>
            </button>
            <button
              onClick={addCustomProduct}
              className="flex items-center justify-center space-x-1 sm:space-x-2 px-2 py-1.5 sm:px-4 sm:py-2 bg-green-600 hover:bg-green-700 text-primary-foreground rounded-lg transition-colors text-sm sm:text-base"
            >
              <Plus className="h-4 w-4" />
              <span className="hidden xs:inline sm:inline">Produit Personnalisé</span>
              <span className="xs:hidden sm:hidden">Produit</span>
            </button>
          </div>
        </div>

        {/* Product Search */}
        {showProductSearch && (
          <div className="mb-4 p-4 bg-secondary rounded-lg">
            <div className="flex space-x-2 mb-4">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleProductSearch()}
                className="flex-1 px-4 py-2 border border-input rounded-lg focus:ring-2 focus:ring-ring bg-secondary text-foreground"
                placeholder="Rechercher un produit..."
              />
              <button
                onClick={handleProductSearch}
                disabled={isSearching}
                className="px-4 py-2 bg-primary hover:bg-primary/90 disabled:bg-gray-400 text-primary-foreground rounded-lg transition-colors"
              >
                {isSearching ? <Loader className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              </button>
            </div>

            {searchResults.length > 0 && (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {searchResults.map((product) => (
                  <div
                    key={product.barcode}
                    className="flex items-center justify-between p-3 bg-white dark:bg-slate-600 rounded-lg border border-gray-200 dark:border-gray-500"
                  >
                    <div>
                      <h4 className="font-medium text-foreground">{product.name}</h4>
                      <p className="text-sm text-muted-foreground">
                        {product.brand} • #{product.barcode} • {product.price.toFixed(2)} Dh
                      </p>
                    </div>
                    <button
                      onClick={() => addProductToQuote(product)}
                      className="flex items-center space-x-1 px-3 py-1 bg-green-600 hover:bg-green-700 text-primary-foreground rounded transition-colors"
                    >
                      <Plus className="h-3 w-3" />
                      <span>Ajouter</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Cart Items Table */}
      <div className="glass rounded-2xl shadow-xl overflow-hidden">
        <div className="p-6 border-b border-border">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-foreground flex items-center space-x-2">
              <FileText className="h-5 w-5" />
              <span>Articles du Devis</span>
              <span className="text-sm font-normal text-muted-foreground">
                ({totalItems} article{totalItems !== 1 ? 's' : ''})
              </span>
            </h2>

            <div className="flex items-center space-x-2">
              <button
                onClick={handleCopyItems}
                disabled={items.length === 0}
                className="flex items-center space-x-2 px-3 py-2 bg-primary hover:bg-primary/90 disabled:bg-gray-400 text-primary-foreground rounded-lg transition-colors text-sm"
              >
                <Copy className="h-4 w-4" />
                <span>Copier</span>
              </button>
            </div>
          </div>

          {validationErrors.items && (
            <p className="mt-2 text-sm text-red-600 dark:text-red-400">{validationErrors.items}</p>
          )}
        </div>

        {items.length === 0 ? (
          <div className="p-12 text-center">
            <ShoppingCart className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-medium text-foreground mb-2">
              Aucun Article
            </h3>
            <p className="text-muted-foreground mb-4">
              Ajoutez des produits depuis la recherche ou créez des produits personnalisés
            </p>
            <button
              onClick={() => setShowProductSearch(true)}
              className="px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg transition-colors"
            >
              Rechercher des Produits
            </button>
          </div>
        ) : (
          <>
            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-secondary">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      N°
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Nom du Produit
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Marge %
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Prix Unitaire
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Quantité
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Sous-total
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {currentItems.map((item, index) => (
                    <tr key={item.id} className="hover:bg-gray-50 dark:hover:bg-accent/50">
                      <td className="px-4 py-4 text-sm text-foreground">
                        {startIndex + index + 1}
                      </td>
                      <td className="px-4 py-4">
                        <div>
                          <div className="text-sm font-medium text-foreground">
                            {item.product.name}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {item.product.brand} • #{item.product.barcode}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-center space-x-1">
                          <select
                            value={item.marginPercentage}
                            onChange={(e) => updateItemMargin(item.id, parseInt(e.target.value))}
                            className="w-20 px-2 py-1 text-sm border border-input rounded focus:ring-2 focus:ring-ring bg-secondary text-orange-600 dark:text-orange-400 font-medium"
                          >
                            {marginOptions.map((percentage) => (
                              <option key={percentage} value={percentage}>
                                {percentage}%
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          Base: {item.product.buyprice.toFixed(2)} Dh
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <input
                          type="number"
                          value={item.unitPrice}
                          onChange={(e) => updateItemUnitPrice(item.id, parseFloat(e.target.value) || 0)}
                          className="w-20 px-2 py-1 text-sm border border-input rounded focus:ring-2 focus:ring-ring bg-secondary text-foreground"
                          step="0.01"
                          min="0"
                        />
                        <span className="ml-1 text-sm text-muted-foreground">Dh</span>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-center space-x-2">
                          <button
                            onClick={() => updateItemQuantity(item.id, item.quantity - 1)}
                            disabled={item.quantity <= 1}
                            className="p-1 hover:bg-gray-200 dark:hover:bg-gray-600 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <Minus className="h-3 w-3" />
                          </button>
                          <input
                            type="number"
                            value={item.quantity}
                            onChange={(e) => updateItemQuantity(item.id, parseInt(e.target.value) || 1)}
                            className="w-16 px-2 py-1 text-sm text-center border border-input rounded focus:ring-2 focus:ring-ring bg-secondary text-foreground"
                            min="1"
                          />
                          <button
                            onClick={() => updateItemQuantity(item.id, item.quantity + 1)}
                            className="p-1 hover:bg-gray-200 dark:hover:bg-gray-600 rounded"
                          >
                            <Plus className="h-3 w-3" />
                          </button>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-sm font-medium text-foreground">
                        {ExcelExportService.formatCurrency(item.subtotal)} Dh
                      </td>
                      <td className="px-4 py-4">
                        <button
                          onClick={() => removeItem(item.id)}
                          className="p-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                          title="Supprimer l'article"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="px-6 py-4 border-t border-border">
                <div className="flex items-center justify-between">
                  <div className="text-sm text-foreground">
                    Affichage de {startIndex + 1} à {Math.min(endIndex, items.length)} sur {items.length} articles
                  </div>
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                      disabled={currentPage === 1}
                      className="px-3 py-1 border border-input rounded hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Précédent
                    </button>
                    <span className="px-3 py-1 text-sm text-foreground">
                      Page {currentPage} sur {totalPages}
                    </span>
                    <button
                      onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                      disabled={currentPage === totalPages}
                      className="px-3 py-1 border border-input rounded hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Suivant
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Total */}
            <div className="px-6 py-4 bg-secondary border-t border-border">
              <div className="flex justify-end">
                <div className="text-right">
                  <div className="text-lg font-semibold text-foreground">
                    Total: {ExcelExportService.formatCurrency(totalAmount)} Dh
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {totalItems} article{totalItems !== 1 ? 's' : ''}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Notes Section */}
      <div className="glass rounded-2xl shadow-xl p-6">
        <h2 className="text-xl font-semibold text-foreground mb-4 flex items-center space-x-2">
          <Edit3 className="h-5 w-5" />
          <span>Notes (Optionnel)</span>
        </h2>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full px-4 py-3 border border-input rounded-lg focus:ring-2 focus:ring-ring bg-secondary text-foreground"
          rows={4}
          placeholder="Ajoutez des notes ou commentaires pour ce devis..."
        />
      </div>

      {/* Excel Export Section */}
      <div className="glass rounded-2xl shadow-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-foreground flex items-center space-x-2">
            <FileDown className="h-5 w-5" />
            <span>Export Excel</span>
          </h2>
          <button
            onClick={() => setShowTemplateUpload(!showTemplateUpload)}
            className="flex items-center space-x-2 px-3 py-2 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors text-sm"
          >
            <Upload className="h-4 w-4" />
            <span>Gérer Templates</span>
          </button>
        </div>

        {/* Template Upload */}
        {showTemplateUpload && (
          <div className="mb-4 p-4 bg-secondary rounded-lg">
            <h3 className="font-medium text-foreground mb-2">
              Uploader un Template Excel
            </h3>
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={handleTemplateUpload}
              className="w-full px-3 py-2 border border-input rounded-lg bg-secondary text-foreground"
            />
            <p className="text-sm text-muted-foreground mt-2">
              Formats acceptés: .xlsx, .xls
            </p>
          </div>
        )}

        {/* Active Template Info */}
        {activeTemplate && (
          <div className="mb-4 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
            <p className="text-sm text-green-700 dark:text-green-300">
              Template actif: <strong>{activeTemplate.name}</strong>
            </p>
          </div>
        )}

        <div className="space-y-3">
          <button
            onClick={handleExport}
            disabled={isExporting || items.length === 0}
            className="w-full flex items-center justify-center space-x-2 px-4 py-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-primary-foreground rounded-lg transition-colors"
          >
            {isExporting ? (
              <>
                <Loader className="h-4 w-4 animate-spin" />
                <span>Export en cours...</span>
              </>
            ) : (
              <>
                <FileDown className="h-4 w-4" />
                <span>{activeTemplate ? `Exporter avec ${activeTemplate.name}` : 'Exporter avec Template par Défaut'}</span>
              </>
            )}
          </button>
          
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row gap-4">
        <button
          onClick={() => navigate('/quotes-history')}
          className="flex-1 px-6 py-3 border border-input text-foreground hover:bg-accent rounded-lg transition-colors"
        >
          Retour à l'Historique
        </button>
        
        <button
          onClick={() => navigate('/search')}
          className="flex-1 px-6 py-3 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg transition-colors"
        >
          Ajouter des Produits
        </button>

        <button
          onClick={() => handleSave(false)}
          disabled={isSaving}
          className="flex-1 flex items-center justify-center space-x-2 px-6 py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-400 text-primary-foreground rounded-lg transition-colors"
        >
          {isSaving ? (
            <>
              <Loader className="h-4 w-4 animate-spin" />
              <span>Sauvegarde...</span>
            </>
          ) : (
            <>
              <Save className="h-4 w-4" />
              <span>Sauvegarder</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}