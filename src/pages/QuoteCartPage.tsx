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
  Info,
  Paperclip,
  Send,
  MessageCircle,
  Mail
} from 'lucide-react';
import { Quote, QuoteItem, CustomerInfo, Product } from '../types';
import { ExcelExportService } from '../utils/excelExport';
import { PdfExportService } from '../utils/pdfExport';
import { CompanySettingsService, CompanySettings, DEFAULT_SHARE_TEMPLATES } from '../utils/companySettings';
import { SupabaseQuotesService } from '../utils/supabaseQuotes';
import { ActivityLogger } from '../utils/activityLogger';
import { useAppContext } from '../context/AppContext';
import { SupabaseUsersService } from '../utils/supabaseUsers';
import { SupabaseClientsService, Client } from '../utils/supabaseClients';
import { useQuoteCart } from '../hooks/useQuoteCart';
import { searchProductsLocally } from '../hooks/useSearchState';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useProductOverrides } from '../hooks/useProductOverrides';

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
  const { getOriginalName, overrides } = useProductOverrides();

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
  const [globalMargin, setGlobalMargin] = useState<number>(20);

  // UI state
  const [currentPage, setCurrentPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [isDirty, setIsDirty] = useState(false);

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
  const [customSellerName, setCustomSellerName] = useState('');
  const [useCustomSeller, setUseCustomSeller] = useState(false);
  const { currentUser, authenticatedUser, isAdmin, canAccessStockLocation, getDisplayPrice } = useAuth();

  // Client autocomplete
  const [clientSuggestions, setClientSuggestions] = useState<Client[]>([]);
  const [showClientSuggestions, setShowClientSuggestions] = useState(false);
  const [clientSearchTimeout, setClientSearchTimeout] = useState<NodeJS.Timeout | null>(null);

  // Tech sheets link state
  const [attachTechSheets, setAttachTechSheets] = useState(false);
  const [techSheetsExpiry, setTechSheetsExpiry] = useState<string>('30');
  const [linkedSheetIds, setLinkedSheetIds] = useState<string[]>([]);

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
        // Set default sales person
        const loggedUser = currentUser || authenticatedUser;
        const sellerName = loggedUser?.custom_seller_name || loggedUser?.username || '';
        if (sellerName) {
          setCustomer(prev => ({ ...prev, salesPerson: sellerName }));
          if (loggedUser?.custom_seller_name) {
            setUseCustomSeller(false);
            setCustomSellerName(loggedUser.custom_seller_name);
          }
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

  // Check linked tech sheets when items change
  useEffect(() => {
    const checkLinkedSheets = async () => {
      const barcodes = items.map(i => i.product.barcode).filter(Boolean);
      if (barcodes.length === 0) { setLinkedSheetIds([]); setAttachTechSheets(false); return; }
      try {
        const { data } = await supabase
          .from('technical_sheet_products')
          .select('sheet_id')
          .in('product_barcode', barcodes);
        const uniqueIds = [...new Set((data || []).map(r => r.sheet_id))];
        setLinkedSheetIds(uniqueIds);
        setAttachTechSheets(uniqueIds.length > 0);
      } catch { setLinkedSheetIds([]); }
    };
    checkLinkedSheets();
  }, [items]);

  // Load available users for sales person dropdown
  useEffect(() => {
    const loadUsers = async () => {
      try {
        const users = await SupabaseUsersService.getAllUsers();
        const quoteEnabledUsers = users
          .filter(user => user.can_create_quote)
          .map(user => ({
            username: user.username,
            displayName: user.custom_seller_name || user.username
          }))
          .sort((a, b) => a.displayName.localeCompare(b.displayName));
        
        setAvailableUsers(quoteEnabledUsers);
      } catch (error) {
        console.error('Failed to load users:', error);
        const currentUsername = currentUser?.username || authenticatedUser?.username;
        if (currentUsername) {
          setAvailableUsers([{ username: currentUsername, displayName: currentUsername }]);
        }
      }
    };

    loadUsers();
  }, [currentUser, authenticatedUser]);

  // Client autocomplete handler
  const handleClientSearch = useCallback((query: string) => {
    if (clientSearchTimeout) clearTimeout(clientSearchTimeout);
    if (query.trim().length < 2) { setClientSuggestions([]); setShowClientSuggestions(false); return; }
    const timeout = setTimeout(async () => {
      try {
        const results = await SupabaseClientsService.searchClients(query);
        setClientSuggestions(results);
        setShowClientSuggestions(results.length > 0);
      } catch { setClientSuggestions([]); }
    }, 300);
    setClientSearchTimeout(timeout);
  }, [clientSearchTimeout]);

  const selectClient = (client: Client) => {
    setCustomer(prev => ({
      ...prev,
      fullName: client.full_name,
      phoneNumber: client.phone_number,
      address: client.address || prev.address,
      city: client.city || prev.city,
      ice: client.ice || prev.ice,
    }));
    setShowClientSuggestions(false);
    setClientSuggestions([]);
  };


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

  // Product search functionality - live/ajax
  const [productSearchTimeout, setProductSearchTimeout] = useState<NodeJS.Timeout | null>(null);
  const [searchSheetCounts, setSearchSheetCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    if (productSearchTimeout) clearTimeout(productSearchTimeout);
    if (searchQuery.trim().length < 2) {
      setSearchResults([]);
      return;
    }

    const timeout = setTimeout(() => {
      const results = searchProductsLocally(state.products, { query: searchQuery }, overrides);
      setSearchResults(results.slice(0, 20));
    }, 200);
    setProductSearchTimeout(timeout);

    return () => { if (timeout) clearTimeout(timeout); };
  }, [searchQuery, state.products, overrides]);

  // Load sheet counts for search results
  useEffect(() => {
    const loadSearchSheetCounts = async () => {
      if (searchResults.length === 0) { setSearchSheetCounts({}); return; }
      const barcodes = searchResults.map(p => p.barcode);
      try {
        const { data } = await supabase
          .from('technical_sheet_products')
          .select('product_barcode')
          .in('product_barcode', barcodes);
        const counts: Record<string, number> = {};
        (data || []).forEach((row: any) => {
          counts[row.product_barcode] = (counts[row.product_barcode] || 0) + 1;
        });
        setSearchSheetCounts(counts);
      } catch { setSearchSheetCounts({}); }
    };
    loadSearchSheetCounts();
  }, [searchResults]);

  // Add product from search to quote
  const addProductToQuote = (product: Product) => {
    const newItem: QuoteItem = {
      id: `${product.barcode}-${Date.now()}`,
      product,
      priceType: 'normal',
      marginPercentage: globalMargin,
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
        marginPercentage: globalMargin,
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
    const totalAmount = items.reduce((sum, item) => {
      const discount = item.discount ?? 0;
      const discountedPrice = item.unitPrice * (1 - discount / 100);
      return sum + discountedPrice * item.quantity;
    }, 0);
    const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);
    
    return { totalAmount, totalItems };
  }, [items]);

  // Update item quantity
  const updateItemQuantity = (itemId: string, newQuantity: number) => {
    if (newQuantity < 1) return;
    
    setItems(prevItems => 
      prevItems.map(item => {
        if (item.id !== itemId) return item;
        const discount = item.discount ?? 0;
        const discountedPrice = item.unitPrice * (1 - discount / 100);
        return { 
          ...item, 
          quantity: newQuantity, 
          subtotal: discountedPrice * newQuantity 
        };
      })
    );
  };

  // Update item unit price
  const updateItemUnitPrice = (itemId: string, newUnitPrice: number) => {
    if (newUnitPrice < 0) return;
    
    setItems(prevItems => 
      prevItems.map(item => {
        if (item.id !== itemId) return item;
        const discount = item.discount ?? 0;
        const discountedPrice = newUnitPrice * (1 - discount / 100);
        return { 
          ...item, 
          unitPrice: newUnitPrice, 
          subtotal: discountedPrice * item.quantity 
        };
      })
    );
  };

  // Update item discount percentage
  const updateItemDiscount = (itemId: string, newDiscount: number) => {
    if (newDiscount < 0 || newDiscount > 100) return;
    
    setItems(prevItems => 
      prevItems.map(item => {
        if (item.id !== itemId) return item;
        const discountedPrice = item.unitPrice * (1 - newDiscount / 100);
        return { 
          ...item, 
          discount: newDiscount, 
          subtotal: discountedPrice * item.quantity 
        };
      })
    );
  };

  // Update item margin percentage and recalculate price
  const updateItemMargin = (itemId: string, newMarginPercentage: number) => {
    if (newMarginPercentage < 0) return;
    
    setItems(prevItems => 
      prevItems.map(item => {
        if (item.id === itemId) {
          const newUnitPrice = item.product.buyprice + (item.product.buyprice * (newMarginPercentage / 100));
          const discount = item.discount ?? 0;
          const discountedPrice = newUnitPrice * (1 - discount / 100);
          return {
            ...item,
            marginPercentage: newMarginPercentage,
            unitPrice: newUnitPrice,
            subtotal: discountedPrice * item.quantity
          };
        }
        return item;
      })
    );
  };

  // Apply global margin to all items
  const applyGlobalMargin = (newMargin: number) => {
    setGlobalMargin(newMargin);
    setItems(prevItems =>
      prevItems.map(item => {
        const newUnitPrice = item.product.buyprice + (item.product.buyprice * (newMargin / 100));
        const discount = item.discount ?? 0;
        const discountedPrice = newUnitPrice * (1 - discount / 100);
        return {
          ...item,
          marginPercentage: newMargin,
          unitPrice: newUnitPrice,
          subtotal: discountedPrice * item.quantity
        };
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

    // address and city are optional now

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

      // Save custom seller name to admin profile if using "Autre"
      if (useCustomSeller && isAdmin && customer.salesPerson.trim()) {
        const adminUser = currentUser || authenticatedUser;
        if (adminUser && adminUser.custom_seller_name !== customer.salesPerson.trim()) {
          try {
            await SupabaseUsersService.updateUser(adminUser.id, {
              custom_seller_name: customer.salesPerson.trim(),
            } as any);
          } catch (e) {
            console.error('Failed to save custom seller name:', e);
          }
        }
      }

      // Upsert client record if phone number provided
      if (customer.phoneNumber.trim()) {
        try {
          await SupabaseClientsService.upsertClient({
            full_name: customer.fullName.trim(),
            phone_number: customer.phoneNumber.trim(),
            address: customer.address?.trim() || '',
            city: customer.city?.trim() || '',
            ice: customer.ice?.trim() || '',
          });
        } catch (e) {
          console.error('Failed to upsert client:', e);
        }
      }

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

  // Export to PDF
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
      const freshSettings = await CompanySettingsService.getSettings().catch(() => companySettings);
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

      // Generate tech sheets share link if enabled
      let techSheetsUrl: string | undefined;
      let techSheetsExpiryLabel: string | undefined;
      if (attachTechSheets && linkedSheetIds.length > 0) {
        const token = crypto.randomUUID();
        const expiresAt = techSheetsExpiry === 'never' ? null : new Date(Date.now() + parseInt(techSheetsExpiry) * 86400000).toISOString();
        await supabase.from('sheet_share_links').insert({
          token,
          sheet_ids: linkedSheetIds,
          title: `Devis ${quoteNumber}`,
          expires_at: expiresAt,
        });
        techSheetsUrl = `${window.location.origin}/share/${token}`;
        techSheetsExpiryLabel = techSheetsExpiry === 'never' ? 'permanent' : `${techSheetsExpiry} jours`;
      }

      await PdfExportService.exportQuoteToPdf(quoteData, freshSettings || companySettings, techSheetsUrl, techSheetsExpiryLabel);
      showToast({
        type: 'success',
        title: 'Export réussi',
        message: 'Devis exporté en PDF avec succès'
      });
    } catch (error) {
      console.error('Export failed:', error);
      showToast({
        type: 'error',
        title: 'Erreur d\'export',
        message: `Erreur lors de l'export PDF: ${error instanceof Error ? error.message : 'Erreur inconnue'}`
      });
    } finally {
      setIsExporting(false);
    }
  };

  // (Template upload removed - using PDF export now)

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
    <div className="max-w-7xl mx-auto space-y-3">
      {/* Header */}
      <div className="glass rounded-xl shadow-lg p-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-primary rounded-lg">
              <ShoppingCart className="h-4 w-4 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-base font-bold text-foreground">
                {isEditing ? 'Modifier le Devis' : 'Nouveau Devis'}
              </h1>
              <p className="text-xs text-muted-foreground">
                {isEditing ? `Devis ${quoteNumber}` : 'Créer un nouveau devis'}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {lastSaved && (
              <span className="text-xs text-muted-foreground hidden sm:inline">
                Sauvé: {lastSaved.toLocaleTimeString('fr-FR')}
              </span>
            )}
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as 'draft' | 'final')}
              className="px-2 py-1 text-sm border border-input rounded-lg bg-secondary text-foreground"
            >
              <option value="draft">En attente</option>
              <option value="pending">Envoyé</option>
              <option value="final">Confirmé</option>
            </select>
          </div>
        </div>

        {/* Quote Details */}
        <div className="grid grid-cols-3 gap-2">
          <div className="flex items-center space-x-2 p-2 bg-secondary rounded-lg">
            <Hash className="h-4 w-4 text-primary" />
            <div>
              <p className="text-[10px] text-muted-foreground">N° Devis</p>
              <p className="text-xs font-semibold text-foreground">{quoteNumber}</p>
            </div>
          </div>
          <div className="flex items-center space-x-2 p-2 bg-secondary rounded-lg">
            <Calendar className="h-4 w-4 text-primary" />
            <div>
              <p className="text-[10px] text-muted-foreground">Date</p>
              <p className="text-xs font-semibold text-foreground">
                {ExcelExportService.formatDate(quote?.createdAt || new Date())}
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2 p-2 bg-secondary rounded-lg">
            <DollarSign className="h-4 w-4 text-primary" />
            <div>
              <p className="text-[10px] text-muted-foreground">Total</p>
              <p className="text-xs font-semibold text-foreground">
                {ExcelExportService.formatCurrency(totalAmount)} Dh
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Customer Information */}
      <div className="glass rounded-xl shadow-lg p-3">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-foreground flex items-center space-x-2">
            <User className="h-4 w-4" />
            <span>Informations Client</span>
          </h2>
          <button
            onClick={handleClearForm}
            className="px-2 py-1 text-xs text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
          >
            Effacer
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">
              Nom Complet *
            </label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="text"
                value={customer.fullName}
                onChange={(e) => {
                  setCustomer(prev => ({ ...prev, fullName: e.target.value }));
                  handleClientSearch(e.target.value);
                }}
                onFocus={() => { if (clientSuggestions.length > 0) setShowClientSuggestions(true); }}
                onBlur={() => setTimeout(() => setShowClientSuggestions(false), 200)}
                className={`w-full pl-9 pr-3 py-1.5 text-sm border rounded-lg focus:ring-2 focus:ring-ring bg-secondary text-foreground ${
                  validationErrors.fullName ? 'border-destructive' : 'border-input'
                }`}
                placeholder="Nom complet du client"
              />
              {showClientSuggestions && clientSuggestions.length > 0 && (
                <div className="absolute z-20 left-0 right-0 top-full mt-1 bg-card border border-border rounded-lg shadow-lg max-h-40 overflow-y-auto">
                  {clientSuggestions.map(client => (
                    <button key={client.id} type="button"
                      onMouseDown={() => selectClient(client)}
                      className="w-full text-left px-3 py-2 hover:bg-accent text-sm text-foreground border-b border-border last:border-0">
                      <div className="font-medium">{client.full_name}</div>
                      <div className="text-xs text-muted-foreground">{client.phone_number} {client.city ? `• ${client.city}` : ''}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {validationErrors.fullName && (
              <p className="mt-0.5 text-xs text-destructive">{validationErrors.fullName}</p>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-foreground mb-1">Téléphone *</label>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input type="text" value={customer.phoneNumber}
                onChange={(e) => setCustomer(prev => ({ ...prev, phoneNumber: e.target.value }))}
                className={`w-full pl-9 pr-3 py-1.5 text-sm border rounded-lg focus:ring-2 focus:ring-ring bg-secondary text-foreground ${validationErrors.phoneNumber ? 'border-destructive' : 'border-input'}`}
                placeholder="Numéro de téléphone" />
            </div>
            {validationErrors.phoneNumber && <p className="mt-0.5 text-xs text-destructive">{validationErrors.phoneNumber}</p>}
          </div>

          <div>
            <label className="block text-xs font-medium text-foreground mb-1">Adresse / Ville</label>
            <div className="relative">
              <Building className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input type="text" value={customer.address}
                onChange={(e) => setCustomer(prev => ({ ...prev, address: e.target.value }))}
                className="w-full pl-9 pr-3 py-1.5 text-sm border border-input rounded-lg focus:ring-2 focus:ring-ring bg-secondary text-foreground"
                placeholder="Adresse, Ville" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-foreground mb-1">ICE</label>
            <input type="text" value={customer.ice || ''}
              onChange={(e) => setCustomer(prev => ({ ...prev, ice: e.target.value }))}
              className="w-full px-3 py-1.5 text-sm border border-input rounded-lg focus:ring-2 focus:ring-ring bg-secondary text-foreground"
              placeholder="Numéro ICE" />
          </div>

          <div>
            <label className="block text-xs font-medium text-foreground mb-1">Vendeur *</label>
            {isAdmin && useCustomSeller ? (
              <div className="flex gap-2">
                <input type="text" value={customer.salesPerson}
                  onChange={(e) => setCustomer(prev => ({ ...prev, salesPerson: e.target.value }))}
                  className={`flex-1 px-3 py-1.5 text-sm border rounded-lg focus:ring-2 focus:ring-ring bg-secondary text-foreground ${validationErrors.salesPerson ? 'border-destructive' : 'border-input'}`}
                  placeholder="Nom du vendeur" />
                <button type="button" onClick={() => { setUseCustomSeller(false); setCustomer(prev => ({ ...prev, salesPerson: '' })); }}
                  className="px-2 py-1.5 text-xs border border-input rounded-lg hover:bg-accent text-foreground">Liste</button>
              </div>
            ) : (
              <div className="flex gap-2">
                <select value={customer.salesPerson}
                  onChange={(e) => setCustomer(prev => ({ ...prev, salesPerson: e.target.value }))}
                  className={`flex-1 px-3 py-1.5 text-sm border rounded-lg focus:ring-2 focus:ring-ring bg-secondary text-foreground ${validationErrors.salesPerson ? 'border-destructive' : 'border-input'}`}>
                  <option value="">Sélectionner un vendeur</option>
                  {availableUsers.map((user) => (
                    <option key={user.username} value={user.displayName}>{user.displayName}</option>
                  ))}
                </select>
                {isAdmin && (
                  <button type="button" onClick={() => { setUseCustomSeller(true); setCustomer(prev => ({ ...prev, salesPerson: '' })); }}
                    className="px-2 py-1.5 text-xs border border-input rounded-lg hover:bg-accent text-foreground whitespace-nowrap">Autre</button>
                )}
              </div>
            )}
            {validationErrors.salesPerson && <p className="mt-0.5 text-xs text-destructive">{validationErrors.salesPerson}</p>}
          </div>

          <div>
            <label className="block text-xs font-medium text-foreground mb-1">N° Commande</label>
            <input type="text" value={commandNumber} onChange={(e) => setCommandNumber(e.target.value)}
              className="w-full px-3 py-1.5 text-sm border border-input rounded-lg focus:ring-2 focus:ring-ring bg-secondary text-foreground"
              placeholder="Optionnel" />
          </div>
        </div>
      </div>

      {/* Product Search and Add */}
      <div className="glass rounded-xl shadow-lg p-3">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-foreground flex items-center space-x-2">
            <Package className="h-4 w-4" />
            <span>Ajouter des Produits</span>
          </h2>
          <button
            onClick={addCustomProduct}
            className="flex items-center space-x-1 px-2.5 py-1.5 bg-green-600 hover:bg-green-700 text-primary-foreground rounded-lg transition-colors text-xs"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Produit Manuel</span>
          </button>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm border border-input rounded-lg focus:ring-2 focus:ring-ring bg-secondary text-foreground"
            placeholder="Rechercher par nom, code-barres ou marque..."
          />
        </div>

        {searchResults.length > 0 && (
          <div className="mt-2 space-y-1 max-h-60 overflow-y-auto">
            {searchResults.map((product) => {
              const accessibleStockLevels = Object.entries(product.stock_levels || {}).filter(([location]) => canAccessStockLocation(location));
              const totalStock = accessibleStockLevels.reduce((sum, [, level]) => sum + level, 0);
              const displayPrice = getDisplayPrice(product);
              return (
                <div
                  key={product.barcode}
                  className="flex items-center justify-between p-2 bg-card rounded-lg border border-border hover:bg-accent/50 transition-colors gap-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-medium text-foreground truncate">{product.name}</h4>
                      {(searchSheetCounts[product.barcode] || 0) > 0 && (
                        <span title={`${searchSheetCounts[product.barcode]} fiche(s) technique(s)`} className="shrink-0 text-primary">
                          <Paperclip className="h-3.5 w-3.5" />
                        </span>
                      )}
                      {product.brand && (
                        <span className="px-1.5 py-0.5 bg-primary/10 text-primary text-[11px] rounded font-medium shrink-0">
                          {product.brand}
                          {getOriginalName('brand', product.brand) && (
                            <span className="text-muted-foreground text-[10px] ml-1">(ex: {getOriginalName('brand', product.brand)})</span>
                          )}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                      <span>#{product.barcode}</span>
                      <span className="font-semibold text-emerald-500">{displayPrice.toFixed(2)} Dh</span>
                      <span>Stock: {totalStock}</span>
                      {accessibleStockLevels.map(([location, level]) => (
                        <span key={location} className="px-1.5 py-0.5 bg-secondary text-secondary-foreground rounded capitalize hidden md:inline">
                          {location.replace(/_/g, ' ')}: {level}
                        </span>
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={() => addProductToQuote(product)}
                    className="ml-2 p-1.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg transition-all duration-200 shadow-sm shrink-0"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Cart Items Table */}
      <div className="glass rounded-xl shadow-lg overflow-hidden">
        <div className="p-4 border-b border-border">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-foreground flex items-center space-x-2">
              <FileText className="h-5 w-5" />
              <span>Articles du Devis</span>
              <span className="text-sm font-normal text-muted-foreground">
                ({totalItems} article{totalItems !== 1 ? 's' : ''})
              </span>
            </h2>

            <div className="flex items-center space-x-2">
              <div className="flex items-center space-x-1.5 px-2 py-1 bg-secondary rounded-lg border border-input">
                <span className="text-xs text-muted-foreground whitespace-nowrap">Marge globale</span>
                <select
                  value={globalMargin}
                  onChange={(e) => applyGlobalMargin(parseInt(e.target.value))}
                  className="w-16 px-1 py-0.5 text-sm border border-input rounded bg-background text-orange-600 dark:text-orange-400 font-medium"
                >
                  {marginOptions.map((p) => (
                    <option key={p} value={p}>{p}%</option>
                  ))}
                </select>
              </div>
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
                    <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      N°
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Nom du Produit
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Marge %
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      PU HT
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Quantité
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Remise %
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Total HT
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
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
                            {item.product.brand}
                            {getOriginalName('brand', item.product.brand) && (
                              <span className="text-[10px] ml-1">(ex: {getOriginalName('brand', item.product.brand)})</span>
                            )}
                            {' '}• #{item.product.barcode}
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
                          value={parseFloat((item.unitPrice / (1 + (companySettings?.tva_rate ?? 20) / 100)).toFixed(2))}
                          onChange={(e) => {
                            const htValue = parseFloat(e.target.value) || 0;
                            const ttcValue = htValue * (1 + (companySettings?.tva_rate ?? 20) / 100);
                            updateItemUnitPrice(item.id, ttcValue);
                          }}
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
                      <td className="px-4 py-4">
                        <div className="flex items-center space-x-1">
                          <input
                            type="number"
                            value={item.discount ?? 0}
                            onChange={(e) => updateItemDiscount(item.id, parseFloat(e.target.value) || 0)}
                            className="w-16 px-2 py-1 text-sm border border-input rounded focus:ring-2 focus:ring-ring bg-secondary text-foreground"
                            step="1"
                            min="0"
                            max="100"
                          />
                          <span className="text-sm text-muted-foreground">%</span>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-sm font-medium text-foreground">
                        {ExcelExportService.formatCurrency(item.subtotal / (1 + (companySettings?.tva_rate ?? 20) / 100))} Dh
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
              <div className="px-4 py-2 border-t border-border">
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

            {/* Totals */}
            <div className="px-4 py-2 bg-secondary border-t border-border">
              <div className="flex justify-end">
                <div className="text-right space-y-1">
                  {(() => {
                    const tvaRate = companySettings?.tva_rate ?? 20;
                    const totalHT = totalAmount / (1 + tvaRate / 100);
                    const totalTVA = totalAmount - totalHT;
                    return (
                      <>
                        <div className="text-sm text-muted-foreground">
                          Total HT: {ExcelExportService.formatCurrency(totalHT)} Dh
                        </div>
                        <div className="text-sm text-muted-foreground">
                          TVA {tvaRate}%: {ExcelExportService.formatCurrency(totalTVA)} Dh
                        </div>
                        <div className="text-lg font-semibold text-foreground">
                          Total TTC: {ExcelExportService.formatCurrency(totalAmount)} Dh
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {totalItems} article{totalItems !== 1 ? 's' : ''}
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Notes & Actions */}
      <div className="glass rounded-xl shadow-lg p-3">
        <h2 className="text-sm font-semibold text-foreground mb-2 flex items-center space-x-2">
          <Edit3 className="h-4 w-4" />
          <span>Notes</span>
        </h2>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full px-3 py-1.5 text-sm border border-input rounded-lg focus:ring-2 focus:ring-ring bg-secondary text-foreground"
          rows={2}
          placeholder="Notes ou commentaires..."
        />
      </div>

      {/* Tech Sheets Attachment */}
      {linkedSheetIds.length > 0 && (
        <div className="glass rounded-xl shadow-lg p-3">
          <div className="flex items-center justify-between">
            <label className="flex items-center space-x-2 text-sm text-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={attachTechSheets}
                onChange={(e) => setAttachTechSheets(e.target.checked)}
                className="rounded border-input"
              />
              <span>📎 Joindre fiches techniques ({linkedSheetIds.length} fiche{linkedSheetIds.length > 1 ? 's' : ''})</span>
            </label>
            {attachTechSheets && (
              <div className="flex items-center space-x-2">
                <span className="text-xs text-muted-foreground">Expiration :</span>
                <select
                  value={techSheetsExpiry}
                  onChange={(e) => setTechSheetsExpiry(e.target.value)}
                  className="px-2 py-1 text-xs border border-input rounded-lg bg-secondary text-foreground"
                >
                  <option value="7">7 jours</option>
                  <option value="30">30 jours</option>
                  <option value="90">90 jours</option>
                  <option value="never">Jamais</option>
                </select>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row gap-2">
        <button onClick={() => navigate('/quotes-history')}
          className="flex-1 px-4 py-2 text-sm border border-input text-foreground hover:bg-accent rounded-lg transition-colors">
          Historique
        </button>
        <button onClick={handleExport} disabled={isExporting || items.length === 0}
          className="flex-1 flex items-center justify-center space-x-1.5 px-4 py-2 text-sm bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground rounded-lg transition-colors">
          {isExporting ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />}
          <span>Export PDF</span>
        </button>
        <button onClick={() => handleSave(false)} disabled={isSaving}
          className="flex-1 flex items-center justify-center space-x-1.5 px-4 py-2 text-sm bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground rounded-lg transition-colors">
          {isSaving ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          <span>Sauvegarder</span>
        </button>
      </div>

      {/* Sharing Options - always visible */}
      {items.length > 0 && (
        <div className="glass rounded-xl shadow-lg p-3">
          <div className="flex items-center justify-between mb-1.5">
            <h2 className="text-xs font-semibold text-foreground flex items-center space-x-1.5">
              <Send className="h-3.5 w-3.5" />
              <span>Exporter & Partager</span>
            </h2>
            {isDirty && (
              <span className="text-[10px] text-amber-500 flex items-center space-x-1">
                <Info className="h-3 w-3" />
                <span>Sauvegardez avant d'envoyer</span>
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={async () => {
                if (isDirty) {
                  showToast({ type: 'warning', title: 'Modifications non sauvegardées', message: 'Veuillez sauvegarder le devis avant de le partager.' });
                  return;
                }
                // Export PDF first
                setIsExporting(true);
                try {
                  const freshSettings = await CompanySettingsService.getSettings().catch(() => companySettings);
                  const quoteData: Quote = { id: quote?.id || `quote-${Date.now()}`, quoteNumber, commandNumber: commandNumber || undefined, createdAt: quote?.createdAt || new Date(), updatedAt: new Date(), status, customer, items, totalAmount, notes };
                  await PdfExportService.exportQuoteToPdf(quoteData, freshSettings || companySettings);
                } catch { /* PDF export failed, continue to share anyway */ }
                setIsExporting(false);

                // Build message from template
                const tvaRate = companySettings?.tva_rate ?? 20;
                const totalHT = totalAmount / (1 + tvaRate / 100);
                const totalTVA = totalAmount - totalHT;
                const tpl = companySettings?.share_templates?.whatsapp || DEFAULT_SHARE_TEMPLATES.whatsapp;
                const companyName = companySettings?.company_name?.trim() || 'Restonet';
                const msg = tpl
                  .replace(/{client}/g, customer.fullName || '')
                  .replace(/{entreprise}/g, companyName)
                  .replace(/{numero}/g, quoteNumber)
                  .replace(/{montant_ht}/g, ExcelExportService.formatCurrency(totalHT))
                  .replace(/{montant_ttc}/g, ExcelExportService.formatCurrency(totalAmount))
                  .replace(/{montant_tva}/g, ExcelExportService.formatCurrency(totalTVA))
                  .replace(/{tva}/g, String(tvaRate))
                  .replace(/{nb_articles}/g, String(totalItems))
                  .replace(/{date}/g, ExcelExportService.formatDate(quote?.createdAt || new Date()))
                  .replace(/{telephone}/g, companySettings?.phone || '')
                  .replace(/{email}/g, companySettings?.email || '')
                  .replace(/{adresse}/g, companySettings?.address || '');

                const phone = (customer.phoneNumber || '').replace(/\D/g, '');
                const normalizedPhone = phone.startsWith('00') ? phone.slice(2) : phone.startsWith('0') ? `212${phone.slice(1)}` : phone;
                const url = normalizedPhone
                  ? `https://api.whatsapp.com/send?phone=${normalizedPhone}&text=${encodeURIComponent(msg)}`
                  : `https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`;
                try {
                  const popup = window.open('about:blank', '_blank', 'noopener,noreferrer');
                  if (popup) { popup.location.href = url; }
                  else { throw new Error('blocked'); }
                } catch {
                  navigator.clipboard.writeText(msg).then(() => {
                    showToast({ type: 'success', title: 'Copié', message: 'Message copié — ouvrez WhatsApp et collez-le.' });
                  }).catch(() => {
                    showToast({ type: 'error', title: 'Erreur', message: 'Impossible d\'ouvrir WhatsApp.' });
                  });
                }

                // Auto-update status to "pending" (Envoyé)
                if (quote?.id && status !== 'final') {
                  try {
                    await SupabaseQuotesService.updateQuoteStatus(quote.id, 'pending');
                    setStatus('pending' as any);
                    showToast({ type: 'success', title: 'Statut mis à jour', message: 'Le devis est maintenant marqué comme "Envoyé".' });
                  } catch {}
                }
              }}
              disabled={isExporting}
              className="flex-1 flex items-center justify-center space-x-1.5 px-3 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg transition-colors"
            >
              {isExporting ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <><FileDown className="h-3 w-3" /><MessageCircle className="h-3.5 w-3.5" /></>}
              <span>PDF + WhatsApp</span>
            </button>
            <button
              onClick={async () => {
                if (!lastSaved) {
                  showToast({ type: 'warning', title: 'Devis non sauvegardé', message: 'Veuillez sauvegarder le devis avant de le partager.' });
                  return;
                }
                // Export PDF first
                setIsExporting(true);
                try {
                  const freshSettings = await CompanySettingsService.getSettings().catch(() => companySettings);
                  const quoteData: Quote = { id: quote?.id || `quote-${Date.now()}`, quoteNumber, commandNumber: commandNumber || undefined, createdAt: quote?.createdAt || new Date(), updatedAt: new Date(), status, customer, items, totalAmount, notes };
                  await PdfExportService.exportQuoteToPdf(quoteData, freshSettings || companySettings);
                } catch { /* continue */ }
                setIsExporting(false);

                // Build email from template
                const tvaRate = companySettings?.tva_rate ?? 20;
                const totalHT = totalAmount / (1 + tvaRate / 100);
                const totalTVA = totalAmount - totalHT;
                const companyName = companySettings?.company_name?.trim() || 'Restonet';
                const subjectTpl = companySettings?.share_templates?.email_subject || DEFAULT_SHARE_TEMPLATES.email_subject;
                const bodyTpl = companySettings?.share_templates?.email_body || DEFAULT_SHARE_TEMPLATES.email_body;
                const replacer = (t: string) => t
                  .replace(/{client}/g, customer.fullName || '')
                  .replace(/{entreprise}/g, companyName)
                  .replace(/{numero}/g, quoteNumber)
                  .replace(/{montant_ht}/g, ExcelExportService.formatCurrency(totalHT))
                  .replace(/{montant_ttc}/g, ExcelExportService.formatCurrency(totalAmount))
                  .replace(/{montant_tva}/g, ExcelExportService.formatCurrency(totalTVA))
                  .replace(/{tva}/g, String(tvaRate))
                  .replace(/{nb_articles}/g, String(totalItems))
                  .replace(/{date}/g, ExcelExportService.formatDate(quote?.createdAt || new Date()))
                  .replace(/{telephone}/g, companySettings?.phone || '')
                  .replace(/{email}/g, companySettings?.email || '')
                  .replace(/{adresse}/g, companySettings?.address || '');

                window.location.href = `mailto:?subject=${encodeURIComponent(replacer(subjectTpl))}&body=${encodeURIComponent(replacer(bodyTpl))}`;

                // Auto-update status to "pending" (Envoyé)
                if (quote?.id && status !== 'final') {
                  try {
                    await SupabaseQuotesService.updateQuoteStatus(quote.id, 'pending');
                    setStatus('pending' as any);
                  } catch {}
                }
              }}
              disabled={isExporting}
              className="flex-1 flex items-center justify-center space-x-1.5 px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg transition-colors"
            >
              {isExporting ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <><FileDown className="h-3 w-3" /><Mail className="h-3.5 w-3.5" /></>}
              <span>PDF + Email</span>
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1.5">📎 Le PDF sera téléchargé — joignez-le à votre message. Templates personnalisables dans Paramètres.</p>
        </div>
      )}
    </div>
  );
}