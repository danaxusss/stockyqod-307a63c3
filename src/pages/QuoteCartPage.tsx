// @ts-nocheck
import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  Edit3,
  Check,
  X,
  Loader,
  Copy,
  Search,
  Package,
  Info,
  Paperclip,
  MessageCircle,
  Mail,
  Truck,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  ChevronRight
} from 'lucide-react';
import { Quote, QuoteItem, CustomerInfo, Product, Provider } from '../types';
import { StockLocationsService } from '../utils/supabaseStockLocations';
import { ExcelExportService } from '../utils/excelExport';
import { PdfExportService } from '../utils/pdfExport';
import { CompanySettingsService, CompanySettings, DEFAULT_SHARE_TEMPLATES } from '../utils/companySettings';
import { quoteCompanyId, SupabaseQuotesService } from '../utils/supabaseQuotes';
import { attachmentsSummary, createAttachmentsLink, findQuoteAttachments, NO_ATTACHMENTS, type QuoteAttachments } from '../utils/quoteAttachments';
import { ActivityLogger } from '../utils/activityLogger';
import { useAppContext } from '../context/AppContext';
import { SupabaseUsersService } from '../utils/supabaseUsers';
import { SupabaseClientsService, Client } from '../utils/supabaseClients';
import { useQuoteCart } from '../hooks/useQuoteCart';
import { searchProductsLocally } from '../hooks/useSearchState';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../hooks/useAuth';
import { useKeyboardSave } from '../hooks/useShortcuts';
import { useAccess } from '../hooks/useAccess';
import { isQuoteOwnedBy, quoteOwnerOf } from '../utils/quoteOwnership';
import { quoteMarginHT } from '../utils/quoteMargin';
import { QuoteReadOnlyView } from '../components/QuoteReadOnlyView';
import { supabase } from '@/integrations/supabase/client';
import { useProductOverrides } from '../hooks/useProductOverrides';
import { applyQuoteItemDisplayOverride, getQuoteItemBarcode, getQuoteItemBrand, getQuoteItemName } from '../utils/quoteItemDisplay';
import { buildWhatsAppShareUrl, canSharePdfFile, downloadPdfFile, openPreparingWhatsAppWindow, redirectPreparingWindowToWhatsApp, openWhatsAppShare, sharePdfFile } from '../utils/whatsappShare';
import { SupabaseDocumentsService } from '../utils/supabaseDocuments';
import { formatMoney } from '../utils/format';
import { resolveProductImageUrl } from '../utils/productImages';

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
  const [notes2, setNotes2] = useState('');
  const [quoteDate, setQuoteDate] = useState('');
  const [globalMargin, setGlobalMargin] = useState<number>(20);
  const [globalDiscount, setGlobalDiscount] = useState<number>(0);

  // Custom product inline form state
  const [showCustomProductForm, setShowCustomProductForm] = useState(false);
  const [customFormData, setCustomFormData] = useState({ barcode: '', name: '', brand: '', unitPrice: '', provider_id: '', provider_name: '' });
  const [providers, setProviders] = useState<Provider[]>([]);
  const [showNewProviderInput, setShowNewProviderInput] = useState(false);
  const [newProviderName, setNewProviderName] = useState('');

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
  const [useStamp, setUseStamp] = useState(false);
  const [printTTCOnly, setPrintTTCOnly] = useState(false);
  const [includeProductImages, setIncludeProductImages] = useState(false);

  // Product search state
  const [searchQuery, setSearchQuery] = useState('');
  const productSearchRef = useRef<HTMLInputElement>(null);
  // Client card: a summary once filled, the form while editing.
  const [clientEditing, setClientEditing] = useState(true);
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<Product[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showProductSearch, setShowProductSearch] = useState(false);

  // Auto-save timer
  const [autoSaveTimer, setAutoSaveTimer] = useState<NodeJS.Timeout | null>(null);

  // Users state for sales person dropdown
  const [availableUsers, setAvailableUsers] = useState<{ username: string; displayName: string }[]>([]);
  const [customSellerName, setCustomSellerName] = useState('');
  const [useCustomSeller, setUseCustomSeller] = useState(false);
  const { currentUser, authenticatedUser, isAdmin, companyId, canAccessStockLocation, getDisplayPrice, isCompta, isSuperAdmin } = useAuth();
  const { access } = useAccess();

  // Client autocomplete
  const [clientSuggestions, setClientSuggestions] = useState<Client[]>([]);
  const [showClientSuggestions, setShowClientSuggestions] = useState(false);
  const [clientSearchTimeout, setClientSearchTimeout] = useState<NodeJS.Timeout | null>(null);

  // Duplicate client detection
  const [duplicateModal, setDuplicateModal] = useState<{
    existing: Client[];
    pending: { full_name: string; phone_number: string; address: string; city: string; ice: string };
    resolve: (client: Client | 'create') => void;
  } | null>(null);

  // Tech sheets link state
  const [attachTechSheets, setAttachTechSheets] = useState(false);
  const [techSheetsExpiry, setTechSheetsExpiry] = useState<string>('30');
  const [attachments, setAttachments] = useState<QuoteAttachments>(NO_ATTACHMENTS);
  const hasAttachments = attachments.sheetIds.length + attachments.images.length > 0;

  // BL creation state
  const [isCreatingBL, setIsCreatingBL] = useState(false);
  const [blCreated, setBlCreated] = useState<{ id: string; number: string } | null>(null);
  // WhatsApp recipient popup
  const [showWaRecipientModal, setShowWaRecipientModal] = useState(false);
  const [waCustomPhone, setWaCustomPhone] = useState('');
  const [isPreparingWaPdf, setIsPreparingWaPdf] = useState(false);
  const [waPdfError, setWaPdfError] = useState('');
  const [waPdfShare, setWaPdfShare] = useState<{ blob: Blob; filename: string; message: string } | null>(null);

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
          setNotes2(loadedQuote.notes2 || '');
          setQuoteDate(loadedQuote.quote_date || '');
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

  // Track dirty state — mark as dirty when user edits data after initial load
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const suppressDirtyRef = useRef(false);
  useEffect(() => {
    if (!isLoading && !initialLoadDone) {
      const t = setTimeout(() => setInitialLoadDone(true), 500);
      return () => clearTimeout(t);
    }
  }, [isLoading, initialLoadDone]);

  // An existing quote opens on the client summary, a new one on the form.
  useEffect(() => {
    if (initialLoadDone && customer.fullName.trim()) setClientEditing(false);
    // Only once, when loading ends: later edits keep the card as the user left it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialLoadDone]);

  useEffect(() => {
    if (initialLoadDone && !suppressDirtyRef.current) setIsDirty(true);
  }, [items, customer, notes, commandNumber, status, globalMargin]);

  // Letterhead for PDFs: the company of the quote being edited, else the
  // user's own company.
  const letterheadCompanyId = quoteCompanyId(quote);
  useEffect(() => {
    CompanySettingsService.getSettings(letterheadCompanyId).then(s => {
      setCompanySettings(s);
      if (s?.use_stamp !== undefined) setUseStamp(s.use_stamp);
      setIncludeProductImages(s?.quote_visible_fields?.printColumns?.showImage === true);
    }).catch(console.error);
  }, [letterheadCompanyId]);

  useEffect(() => {
    StockLocationsService.getProviders().then(setProviders).catch(() => {});
  }, []);

  // Sheets of the quoted products, and photos for those without a sheet.
  const attachmentBarcodes = items.map(i => i.product?.barcode || '').join('|');
  useEffect(() => {
    let cancelled = false;
    findQuoteAttachments(items)
      .then(found => {
        if (cancelled) return;
        setAttachments(found);
        setAttachTechSheets(found.sheetIds.length + found.images.length > 0);
      })
      .catch(() => { if (!cancelled) setAttachments(NO_ATTACHMENTS); });
    return () => { cancelled = true; };
    // Only a change of products matters, not quantities or prices.
  }, [attachmentBarcodes]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Share link for the joined sheets and photos, when the option is on. */
  const attachmentsLink = async () => {
    if (!attachTechSheets || !hasAttachments) return null;
    const link = await createAttachmentsLink(quoteNumber, attachments, techSheetsExpiry === 'never' ? null : parseInt(techSheetsExpiry, 10));
    if (link.imagesDropped) {
      showToast({ type: 'warning', title: 'Photos non jointes', message: 'Exécutez la migration 20261109120000_share_link_product_images.sql pour partager aussi les photos.' });
    }
    return link;
  };

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
      clientCode: client.client_code || prev.clientCode,
    }));
    setShowClientSuggestions(false);
    setClientSuggestions([]);
    // A known client with a seller already chosen needs nothing more here.
    if (customer.salesPerson) setClientEditing(false);
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
    // Respect the user's configured price display type
    const initialPrice = getDisplayPrice(product);
    const newItem: QuoteItem = {
      id: `${product.barcode}-${Date.now()}`,
      product,
      priceType: 'normal',
      marginPercentage: globalMargin,
      finalPrice: initialPrice,
      addedAt: new Date(),
      unitPrice: initialPrice,
      quantity: 1,
      subtotal: initialPrice
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

  // Toggle inline custom product form
  const openCustomProductForm = () => {
    if (!showCustomProductForm) {
      setCustomFormData({ barcode: '', name: '', brand: '', unitPrice: '', provider_id: '', provider_name: '' });
      setShowNewProviderInput(false);
      setNewProviderName('');
    }
    setShowCustomProductForm(v => !v);
  };

  // Submit the inline custom product form
  const submitCustomProduct = () => {
    const { barcode, name, brand, unitPrice: unitPriceStr } = customFormData;
    if (!name.trim()) {
      showToast({ type: 'warning', title: 'Champ requis', message: 'Le nom du produit est requis' });
      return;
    }
    const unitPrice = parseFloat(unitPriceStr) || 0;
    const { provider_id, provider_name } = customFormData;
    const customProduct: Product = {
      barcode: barcode.trim(),
      name: name.trim(),
      brand: brand.trim(),
      techsheet: '',
      price: unitPrice,
      buyprice: unitPrice > 0 ? unitPrice * 0.8 : 0,
      reseller_price: unitPrice > 0 ? unitPrice * 0.9 : 0,
      provider: provider_name || 'Manuel',
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
      subtotal: unitPrice,
      provider_id: provider_id || undefined,
      provider_name: provider_name || undefined,
    };
    setItems(prev => [...prev, newItem]);
    setShowCustomProductForm(false);
    setCustomFormData({ barcode: '', name: '', brand: '', unitPrice: '', provider_id: '', provider_name: '' });
    showToast({ type: 'success', title: 'Produit ajouté', message: `${name.trim()} (${brand.trim()}) ajouté au devis` });
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

  const updateItemDisplayField = (
    itemId: string,
    field: 'quoteName' | 'quoteBrand' | 'quoteBarcode',
    value: string,
  ) => {
    setItems(prevItems =>
      prevItems.map(item => {
        if (item.id !== itemId) return item;
        return applyQuoteItemDisplayOverride(item, field, value);
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

  // Apply global discount to all items
  const applyGlobalDiscount = (newDiscount: number) => {
    setGlobalDiscount(newDiscount);
    setItems(prevItems =>
      prevItems.map(item => {
        const discountedPrice = item.unitPrice * (1 - newDiscount / 100);
        return {
          ...item,
          discount: newDiscount,
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

    // address, city and phone are optional
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
  // A salesperson opening another salesperson's quote gets it read-only (PDF
  // only). The ref also stops autosave and Ctrl+S, whose callbacks may date
  // from an earlier render.
  const readOnly = access.ownQuotesOnly && isEditing && !!quote
    && !isQuoteOwnedBy(quote, quoteOwnerOf(currentUser?.username ? currentUser : authenticatedUser));
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;

  const handleSave = async (isAutoSave = false) => {
    if (readOnlyRef.current) return;
    if (!isAutoSave && !validateForm()) {
      showToast({
        type: 'error',
        title: 'Erreurs de validation',
        message: 'Veuillez corriger les erreurs avant de sauvegarder'
      });
      return;
    }

    suppressDirtyRef.current = true;
    setIsSaving(true);
    try {
      const { totalAmount } = calculateTotals();
      const now = new Date();

      const quoteData: Quote = {
        id: quote?.id || crypto.randomUUID(), company_id: quote?.company_id || companyId || undefined, issuing_company_id: quote?.issuing_company_id,
        createdBy: quote?.createdBy,
        quoteNumber,
        commandNumber: commandNumber || undefined,
        createdAt: quote?.createdAt || now,
        updatedAt: now,
        status,
        customer,
        items,
        totalAmount,
        notes,
        notes2: notes2 || undefined,
        quote_date: quoteDate || undefined,
      };

      await SupabaseQuotesService.saveQuote(quoteData);
      await ActivityLogger.log('quote_created', `Quote ${quoteNumber} saved`, 'quote', quoteData.id);
      setQuote(quoteData);

      // Save custom seller name to admin profile if using "Autre"
      if (useCustomSeller && isAdmin && customer.salesPerson.trim()) {
        const adminUser = currentUser || authenticatedUser;
        if (adminUser && adminUser.custom_seller_name !== customer.salesPerson.trim()) {
          try {
            await SupabaseUsersService.updateOwnSellerName(customer.salesPerson.trim());
          } catch (e) {
            console.error('Failed to save custom seller name:', e);
          }
        }
      }

      // Upsert client record if phone number provided
      if (customer.phoneNumber.trim()) {
        try {
          const phone = customer.phoneNumber.trim();
          const name = customer.fullName.trim();
          // Check if phone already exists (known client) — if not, look for similar names
          const existingByPhone = await SupabaseClientsService.getClientByPhone(phone);
          let clientRequest = { full_name: name, phone_number: phone, address: customer.address?.trim() || '', city: customer.city?.trim() || '', ice: customer.ice?.trim() || '' };
          if (!existingByPhone && name.length >= 3) {
            const similar = await SupabaseClientsService.findSimilarByName(name, phone);
            if (similar.length > 0) {
              // Pause save flow — ask user what to do
              const choice = await new Promise<import('../utils/supabaseClients').Client | 'create'>((resolve) => {
                setDuplicateModal({ existing: similar, pending: clientRequest, resolve });
              });
              if (choice !== 'create') {
                // User picked an existing client — use it
                setCustomer(prev => ({ ...prev, clientCode: choice.client_code || prev.clientCode }));
                // No need to create a new client; just continue saving
                setIsSaving(false);
                return;
              }
            }
          }
          const savedClient = await SupabaseClientsService.smartUpsertClient(clientRequest);
          if (savedClient?.client_code && savedClient.client_code !== customer.clientCode) {
            setCustomer(prev => ({ ...prev, clientCode: savedClient.client_code }));
          }
        } catch (e) {
          console.error('Failed to upsert client:', e);
        }
      }

      setLastSaved(now);
      setIsDirty(false);
      
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
          message: error instanceof Error ? error.message : 'Erreur lors de la sauvegarde'
        });
      }
    } finally {
      setIsSaving(false);
      setTimeout(() => { suppressDirtyRef.current = false; }, 300);
    }
  };

  useKeyboardSave(() => handleSave(false));

  // Convert quote to BL: save quote then create BL from it
  const handleCreateBL = async () => {
    if (!validateForm()) {
      showToast({ type: 'error', title: 'Erreurs de validation', message: 'Veuillez corriger les erreurs avant de continuer' });
      return;
    }
    setIsCreatingBL(true);
    try {
      const { totalAmount } = calculateTotals();
      const now = new Date();
      // Determine a stable ID so we can pass it to createBLFromQuote right after saving
      const savedId = quote?.id || crypto.randomUUID();
      const quoteData: Quote = {
        id: savedId,
        company_id: quote?.company_id || companyId || undefined,
        issuing_company_id: quote?.issuing_company_id,
        createdBy: quote?.createdBy,
        quoteNumber,
        commandNumber: commandNumber || undefined,
        createdAt: quote?.createdAt || now,
        updatedAt: now,
        status,
        customer,
        items,
        totalAmount,
        notes,
      };
      await SupabaseQuotesService.saveQuote(quoteData);
      setQuote(quoteData);
      setIsDirty(false);

      const bl = await SupabaseDocumentsService.createBLFromQuote(savedId);
      setBlCreated({ id: bl.id, number: bl.quoteNumber });
    } catch (error) {
      showToast({ type: 'error', title: 'Erreur création BL', message: error instanceof Error ? error.message : 'Erreur inconnue' });
    } finally {
      setIsCreatingBL(false);
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
      const freshSettings = await CompanySettingsService.getSettings(quoteCompanyId(quote)).catch(() => companySettings);
      const { totalAmount } = calculateTotals();
      const quoteData: Quote = {
        id: quote?.id || crypto.randomUUID(), company_id: quote?.company_id || companyId || undefined, issuing_company_id: quote?.issuing_company_id,
        createdBy: quote?.createdBy,
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

      // Sheets (and photos of products without one) shared through a link.
      const link = await attachmentsLink();
      await PdfExportService.exportQuoteToPdf(quoteData, freshSettings || companySettings, link?.url, link?.expiryLabel, useStamp, 'quote', undefined, printTTCOnly, includeProductImages, false, link?.label);
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
      setNotes2('');
      setQuoteDate('');
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

  if (readOnly) {
    const { totalAmount: readOnlyTotal } = calculateTotals();
    return (
      <QuoteReadOnlyView
        quoteNumber={quoteNumber}
        quoteDate={quoteDate || (quote?.createdAt ? new Date(quote.createdAt).toISOString() : '')}
        status={status}
        customer={customer}
        lines={items.map(item => ({
          id: item.id, name: getQuoteItemName(item), brand: getQuoteItemBrand(item), barcode: getQuoteItemBarcode(item),
          quantity: item.quantity, unitPriceTTC: item.unitPrice, totalTTC: item.subtotal,
        }))}
        totalTTC={readOnlyTotal}
        tvaRate={companySettings?.tva_rate ?? 20}
        isExporting={isExporting}
        onExport={handleExport}
      />
    );
  }

  const markQuoteAsSent = async () => {
    if (!quote?.id || status === 'final') return;
    try {
      await SupabaseQuotesService.updateQuoteStatus(quote.id, 'pending');
      setStatus('pending' as any);
      showToast({ type: 'success', title: 'Statut mis à jour', message: 'Le devis est maintenant marqué comme "Envoyé".' });
    } catch { /* ignore */ }
  };

  const buildQuoteWhatsAppMessage = (settings: CompanySettings | null) => {
    const tvaRate = settings?.tva_rate ?? companySettings?.tva_rate ?? 20;
    const totalHT = totalAmount / (1 + tvaRate / 100);
    const totalTVA = totalAmount - totalHT;
    const tpl = settings?.share_templates?.whatsapp || companySettings?.share_templates?.whatsapp || DEFAULT_SHARE_TEMPLATES.whatsapp;
    const companyName = settings?.company_name?.trim() || companySettings?.company_name?.trim() || 'Restonet';
    return tpl
      .replace(/{client}/g, customer.fullName || '')
      .replace(/{entreprise}/g, companyName)
      .replace(/{numero}/g, quoteNumber)
      .replace(/{montant_ht}/g, ExcelExportService.formatCurrency(totalHT))
      .replace(/{montant_ttc}/g, ExcelExportService.formatCurrency(totalAmount))
      .replace(/{montant_tva}/g, ExcelExportService.formatCurrency(totalTVA))
      .replace(/{tva}/g, String(tvaRate))
      .replace(/{nb_articles}/g, String(totalItems))
      .replace(/{date}/g, ExcelExportService.formatDate(quote?.createdAt || new Date()))
      .replace(/{telephone}/g, settings?.phone || companySettings?.phone || '')
      .replace(/{email}/g, settings?.email || companySettings?.email || '')
      .replace(/{adresse}/g, settings?.address || companySettings?.address || '');
  };

  const prepareWhatsAppPdf = async () => {
    setWaCustomPhone('');
    setWaPdfShare(null);
    setWaPdfError('');
    setShowWaRecipientModal(true);
    setIsPreparingWaPdf(true);
    try {
      const freshSettings = await CompanySettingsService.getSettings(quoteCompanyId(quote)).catch(() => companySettings);
      const quoteData: Quote = { id: quote?.id || crypto.randomUUID(), company_id: quote?.company_id || companyId || undefined, issuing_company_id: quote?.issuing_company_id, quoteNumber, commandNumber: commandNumber || undefined, createdAt: quote?.createdAt || new Date(), updatedAt: new Date(), status, customer, items, totalAmount, notes, notes2: notes2 || undefined, quote_date: quoteDate || undefined };
      const link = await attachmentsLink();
      const { blob, filename } = await PdfExportService.generatePdfBlob(quoteData, freshSettings || companySettings, link?.url, link?.expiryLabel, useStamp, 'quote', undefined, printTTCOnly, includeProductImages, link?.label);
      setWaPdfShare({ blob, filename, message: buildQuoteWhatsAppMessage(freshSettings || companySettings) });
    } catch (error) {
      setWaPdfError(error instanceof Error ? error.message : 'Impossible de préparer le PDF');
    } finally {
      setIsPreparingWaPdf(false);
    }
  };

  const sharePreparedPdf = async () => {
    if (!waPdfShare) return;
    try {
      const shared = await sharePdfFile(waPdfShare.blob, waPdfShare.filename, waPdfShare.message);
      if (!shared) return;
      setShowWaRecipientModal(false);
      await markQuoteAsSent();
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      showToast({ type: 'error', title: 'Partage impossible', message: error instanceof Error ? error.message : 'Impossible de partager le PDF' });
    }
  };

  const sendWhatsAppToPhonenumber = async (phone: string) => {
    if (!waPdfShare) return;
    const waPopup = openPreparingWhatsAppWindow();
    downloadPdfFile(waPdfShare.blob, waPdfShare.filename);
    const waUrl = buildWhatsAppShareUrl(phone, waPdfShare.message);
    const redirected = redirectPreparingWindowToWhatsApp(waUrl, waPopup);
    if (!redirected) {
      if (!openWhatsAppShare(waUrl)) {
        navigator.clipboard.writeText(waPdfShare.message).then(() =>
          showToast({ type: 'success', title: 'Copié', message: 'Message copié — ouvrez WhatsApp et collez-le.' })
        ).catch(() =>
          showToast({ type: 'error', title: 'Erreur', message: 'Impossible d\'ouvrir WhatsApp.' })
        );
      }
    }
    setShowWaRecipientModal(false);
    await markQuoteAsSent();
  };

  const tvaRate = companySettings?.tva_rate ?? 20;
  const totalHT = totalAmount / (1 + tvaRate / 100);
  const totalTVA = totalAmount - totalHT;
  const lineHT = (item: QuoteItem) => item.subtotal / (1 + tvaRate / 100);
  // Margin over the purchase price, when every line has one.
  const purchaseCost = items.reduce((sum, item) => sum + (Number(item.product?.buyprice) || 0) * item.quantity, 0);
  // Purchase prices include TVA, like sale prices: both are compared without it.
  const estimatedMargin = items.length > 0 && items.every(item => Number(item.product?.buyprice) > 0)
    ? quoteMarginHT({ totalTTC: totalAmount, purchaseTTC: purchaseCost, tvaRate }) : null;
  const statusTone = status === 'final' ? 'bg-emerald-500/10 text-emerald-700 ring-emerald-600/20 dark:text-emerald-300'
    : status === 'pending' ? 'bg-blue-500/10 text-blue-700 ring-blue-600/20 dark:text-blue-300'
    : 'bg-amber-500/10 text-amber-800 ring-amber-600/20 dark:text-amber-300';
  const showClientForm = clientEditing || !customer.fullName.trim() || !!validationErrors.fullName || !!validationErrors.salesPerson;
  const field = 'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:ring-2 focus:ring-ring';
  const panel = 'rounded-xl border border-border bg-card shadow-sm';

  const guardDirty = () => {
    if (!isDirty) return true;
    showToast({ type: 'warning', title: 'Modifications non sauvegardées', message: 'Veuillez sauvegarder le devis avant de le partager.' });
    return false;
  };
  const handleWhatsAppShare = () => { if (guardDirty()) prepareWhatsAppPdf(); };
  const handleEmailShare = async () => {
    if (!guardDirty()) return;
    // Export PDF first
    setIsExporting(true);
    try {
      const freshSettings = await CompanySettingsService.getSettings(quoteCompanyId(quote)).catch(() => companySettings);
      const quoteData: Quote = { id: quote?.id || crypto.randomUUID(), company_id: quote?.company_id || companyId || undefined, issuing_company_id: quote?.issuing_company_id, quoteNumber, commandNumber: commandNumber || undefined, createdAt: quote?.createdAt || new Date(), updatedAt: new Date(), status, customer, items, totalAmount, notes, notes2: notes2 || undefined, quote_date: quoteDate || undefined };
      const link = await attachmentsLink();
      await PdfExportService.exportQuoteToPdf(quoteData, freshSettings || companySettings, link?.url, link?.expiryLabel, useStamp, 'quote', undefined, printTTCOnly, includeProductImages, false, link?.label);
    } catch { /* continue */ }
    setIsExporting(false);

    // Build email from template
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
        console.log('[Email] Updating quote status to pending, id:', quote.id);
        await SupabaseQuotesService.updateQuoteStatus(quote.id, 'pending');
        setStatus('pending' as any);
        showToast({ type: 'success', title: 'Statut mis à jour', message: 'Le devis est maintenant marqué comme "Envoyé".' });
      } catch (err) {
        console.error('[Email] Failed to update quote status:', err);
      }
    }
  };

  const pdfOption = (checked: boolean, onChange: (value: boolean) => void, title: string, hint: string) => (
    // `relative` keeps the visually hidden checkbox inside the label: otherwise
    // focusing it scrolls the whole app frame and hides the top of the quote.
    <label className="relative flex cursor-pointer items-center gap-3 py-2">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="peer sr-only" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground">{title}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
      <span aria-hidden="true" className={`relative h-5 w-9 shrink-0 rounded-full transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring ${checked ? 'bg-primary' : 'bg-muted-foreground/30'}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${checked ? 'left-[1.125rem]' : 'left-0.5'}`} />
      </span>
    </label>
  );

  return (
    <div className="mx-auto max-w-7xl pb-28 md:pb-0">
      {/* Title */}
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0">
          <nav aria-label="Fil d’Ariane" className="hidden items-center gap-1.5 text-sm text-muted-foreground sm:flex">
            <button type="button" onClick={() => navigate('/quotes-history')} className="hover:text-foreground">Devis</button>
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="text-foreground">{isEditing ? quoteNumber : 'Nouveau devis'}</span>
          </nav>
          <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">{isEditing ? `Devis ${quoteNumber}` : 'Nouveau devis'}</h1>
        </div>
        <select value={status} onChange={e => setStatus(e.target.value as 'draft' | 'final')} aria-label="Statut du devis"
          className={`rounded-full border-0 py-1 pl-3 pr-8 text-xs font-semibold ring-1 ring-inset ${statusTone}`}>
          <option value="draft">En attente</option>
          <option value="pending">Envoyé</option>
          <option value="final">Confirmé</option>
        </select>
        <span className="text-sm text-muted-foreground" aria-live="polite">
          {isSaving ? 'Enregistrement…' : isDirty ? 'Modifications non enregistrées' : lastSaved ? `Enregistré à ${lastSaved.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : ''}
        </span>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-4">
          {/* Client */}
          <section className={`${panel} p-4 sm:p-5`} aria-labelledby="quote-client-title">
            <h2 id="quote-client-title" className="sr-only">Client</h2>
            {showClientForm ? (
              <>
                <div className="mb-3 flex items-center justify-between">
                  <p className="font-semibold text-foreground">Client</p>
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={handleClearForm} className="rounded-lg px-2.5 py-1.5 text-sm text-destructive hover:bg-destructive/10">Effacer</button>
                    {customer.fullName.trim() && (
                      <button type="button" onClick={() => setClientEditing(false)} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-semibold text-foreground hover:bg-secondary">
                        <Check className="h-4 w-4" aria-hidden="true" />Terminé
                      </button>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <div>
                    <label htmlFor="quote-client-name" className="mb-1 block text-xs font-medium text-foreground">Nom complet *</label>
                    <div className="relative">
                      <input id="quote-client-name" type="text" value={customer.fullName}
                        onChange={(e) => { setCustomer(prev => ({ ...prev, fullName: e.target.value })); handleClientSearch(e.target.value); }}
                        onFocus={() => { if (clientSuggestions.length > 0) setShowClientSuggestions(true); }}
                        onBlur={() => setTimeout(() => setShowClientSuggestions(false), 200)}
                        aria-invalid={!!validationErrors.fullName}
                        className={`${field} ${validationErrors.fullName ? 'border-destructive' : ''}`}
                        placeholder="Nom ou société du client" autoComplete="off" />
                      {showClientSuggestions && clientSuggestions.length > 0 && (
                        <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-48 overflow-y-auto rounded-lg border border-border bg-popover shadow-lg">
                          {clientSuggestions.map(client => (
                            <button key={client.id} type="button" onMouseDown={() => selectClient(client)}
                              className="w-full border-b border-border px-3 py-2 text-left text-sm text-foreground last:border-0 hover:bg-secondary">
                              <span className="block font-medium">{client.full_name}</span>
                              <span className="block text-xs text-muted-foreground">{client.phone_number} {client.city ? `· ${client.city}` : ''}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    {validationErrors.fullName && <p className="mt-1 text-xs text-destructive">{validationErrors.fullName}</p>}
                  </div>
                  <div>
                    <label htmlFor="quote-client-phone" className="mb-1 block text-xs font-medium text-foreground">Téléphone</label>
                    <input id="quote-client-phone" type="tel" value={customer.phoneNumber} onChange={(e) => setCustomer(prev => ({ ...prev, phoneNumber: e.target.value }))} className={field} placeholder="Optionnel" />
                  </div>
                  <div>
                    <label htmlFor="quote-client-address" className="mb-1 block text-xs font-medium text-foreground">Adresse / ville</label>
                    <input id="quote-client-address" type="text" value={customer.address} onChange={(e) => setCustomer(prev => ({ ...prev, address: e.target.value }))} className={field} placeholder="Adresse, ville" />
                  </div>
                  <div>
                    <label htmlFor="quote-client-ice" className="mb-1 block text-xs font-medium text-foreground">ICE</label>
                    <input id="quote-client-ice" type="text" value={customer.ice || ''} onChange={(e) => setCustomer(prev => ({ ...prev, ice: e.target.value }))} className={field} placeholder="Numéro ICE" />
                  </div>
                  <div>
                    <label htmlFor="quote-seller" className="mb-1 block text-xs font-medium text-foreground">Vendeur *</label>
                    <div className="flex gap-2">
                      {isAdmin && useCustomSeller ? (
                        <input id="quote-seller" type="text" value={customer.salesPerson} onChange={(e) => setCustomer(prev => ({ ...prev, salesPerson: e.target.value }))}
                          className={`${field} ${validationErrors.salesPerson ? 'border-destructive' : ''}`} placeholder="Nom du vendeur" />
                      ) : (
                        <select id="quote-seller" value={customer.salesPerson} onChange={(e) => setCustomer(prev => ({ ...prev, salesPerson: e.target.value }))}
                          className={`${field} ${validationErrors.salesPerson ? 'border-destructive' : ''}`}>
                          <option value="">Sélectionner un vendeur</option>
                          {availableUsers.map((user) => <option key={user.username} value={user.displayName}>{user.displayName}</option>)}
                        </select>
                      )}
                      {isAdmin && (
                        <button type="button" onClick={() => { setUseCustomSeller(!useCustomSeller); setCustomer(prev => ({ ...prev, salesPerson: '' })); }}
                          className="shrink-0 rounded-lg border border-input px-3 text-sm text-foreground hover:bg-secondary">{useCustomSeller ? 'Liste' : 'Autre'}</button>
                      )}
                    </div>
                    {validationErrors.salesPerson && <p className="mt-1 text-xs text-destructive">{validationErrors.salesPerson}</p>}
                  </div>
                  <div>
                    <label htmlFor="quote-command" className="mb-1 block text-xs font-medium text-foreground">N° commande client</label>
                    <input id="quote-command" type="text" value={commandNumber} onChange={(e) => setCommandNumber(e.target.value)} className={field} placeholder="Optionnel" />
                  </div>
                </div>
              </>
            ) : (
              <div className="flex items-start gap-3 sm:gap-4">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold uppercase text-primary" aria-hidden="true">
                  {customer.fullName.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('')}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-lg font-semibold leading-tight text-foreground">{customer.fullName}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {[customer.phoneNumber, customer.address, customer.ice ? `ICE ${customer.ice}` : '', customer.salesPerson ? `vendeur ${customer.salesPerson}` : '', commandNumber ? `commande ${commandNumber}` : ''].filter(Boolean).join(' · ') || 'Aucune coordonnée'}
                  </p>
                </div>
                <button type="button" onClick={() => setClientEditing(true)} className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-sm font-semibold text-foreground hover:bg-secondary">Modifier</button>
              </div>
            )}
            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-4 sm:max-w-md">
              <div>
                <label htmlFor="quote-number" className="block text-xs text-muted-foreground">N° devis</label>
                <input id="quote-number" type="text" value={quoteNumber} onChange={e => setQuoteNumber(e.target.value)}
                  className="mt-0.5 w-full rounded-md border border-transparent bg-transparent px-1 py-1 -ml-1 text-sm font-medium tabular-nums text-foreground hover:border-input focus:border-input focus:ring-2 focus:ring-ring" />
              </div>
              <div>
                <label htmlFor="quote-date" className="block text-xs text-muted-foreground">Date du devis</label>
                <input id="quote-date" type="date" value={quoteDate} onChange={e => setQuoteDate(e.target.value)}
                  className="mt-0.5 w-full rounded-md border border-transparent bg-transparent px-1 py-1 -ml-1 text-sm font-medium text-foreground hover:border-input focus:border-input focus:ring-2 focus:ring-ring" />
              </div>
            </div>
          </section>

          {/* Lines */}
          <section className={panel} aria-labelledby="quote-lines-title">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-3 sm:px-5">
              <h2 id="quote-lines-title" className="font-semibold text-foreground">Articles</h2>
              <span className="text-sm text-muted-foreground">{items.length} ligne{items.length !== 1 ? 's' : ''} · {totalItems} unité{totalItems !== 1 ? 's' : ''}</span>
              <span className="flex-1" />
              <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
                Marge
                <select value={globalMargin} onChange={(e) => applyGlobalMargin(parseInt(e.target.value))} className="rounded-md border border-input bg-background px-2 py-1 text-sm font-semibold text-foreground">
                  {marginOptions.map(p => <option key={p} value={p}>{p} %</option>)}
                </select>
              </label>
              <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
                Remise
                <select value={globalDiscount} onChange={(e) => applyGlobalDiscount(parseInt(e.target.value))} className="rounded-md border border-input bg-background px-2 py-1 text-sm font-semibold text-foreground">
                  {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50].map(d => <option key={d} value={d}>{d} %</option>)}
                </select>
              </label>
              <button type="button" onClick={handleCopyItems} disabled={items.length === 0} aria-label="Copier les articles" title="Copier les articles"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-40">
                <Copy className="h-4 w-4" />
              </button>
            </div>
            {validationErrors.items && <p className="px-5 pt-3 text-sm text-destructive" role="alert">{validationErrors.items}</p>}

            {items.length === 0 ? (
              <div className="px-5 py-10 text-center">
                <ShoppingCart className="mx-auto h-10 w-10 text-muted-foreground" aria-hidden="true" />
                <p className="mt-3 font-medium text-foreground">Aucun article pour le moment</p>
                <p className="mt-1 text-sm text-muted-foreground">Cherchez un produit ci-dessous, ou ajoutez un produit hors catalogue.</p>
              </div>
            ) : (
              <>
                <div className="hidden grid-cols-[3rem_minmax(0,1fr)_7.5rem_9rem_8rem_2.5rem] gap-x-4 border-b border-border bg-secondary/40 px-5 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground md:grid">
                  <span /><span>Produit</span><span className="text-center">Quantité</span><span className="text-right">Prix HT</span><span className="text-right">Total HT</span><span />
                </div>
                <ul className="divide-y divide-border">
                  {currentItems.map((item) => {
                    const img = resolveProductImageUrl(item.product?.image);
                    const editingText = editingLineId === item.id;
                    return (
                      <li key={item.id} className="grid grid-cols-[3rem_minmax(0,1fr)_2.5rem] gap-x-3 gap-y-3 px-4 py-3 sm:px-5 md:grid-cols-[3rem_minmax(0,1fr)_7.5rem_9rem_8rem_2.5rem] md:items-center md:gap-x-4">
                        <span className="row-span-2 flex h-[3.75rem] w-12 items-center justify-center overflow-hidden rounded-md border border-border bg-white md:row-span-1">
                          {img ? <img src={img} alt="" className="h-full w-full object-contain" loading="lazy" /> : <Package className="h-5 w-5 text-muted-foreground" aria-hidden="true" />}
                        </span>
                        <div className="min-w-0">
                          {editingText ? (
                            <div className="space-y-2">
                              <input type="text" value={getQuoteItemName(item)} onChange={(e) => updateItemDisplayField(item.id, 'quoteName', e.target.value)} className={field} aria-label="Nom du produit sur le devis" autoFocus />
                              <div className="grid grid-cols-2 gap-2">
                                <input type="text" value={getQuoteItemBrand(item)} onChange={(e) => updateItemDisplayField(item.id, 'quoteBrand', e.target.value)} className={field} placeholder="Marque" aria-label="Marque sur le devis" />
                                <input type="text" value={getQuoteItemBarcode(item)} onChange={(e) => updateItemDisplayField(item.id, 'quoteBarcode', e.target.value)} className={field} placeholder="Code" aria-label="Code sur le devis" />
                              </div>
                              <button type="button" onClick={() => setEditingLineId(null)} className="flex items-center gap-1.5 text-sm font-semibold text-primary"><Check className="h-4 w-4" aria-hidden="true" />Terminé</button>
                            </div>
                          ) : (
                            <>
                              <button type="button" onClick={() => setEditingLineId(item.id)} className="group flex max-w-full items-start gap-1.5 text-left" title="Modifier le libellé sur le devis">
                                <span className="font-semibold leading-snug text-foreground">{getQuoteItemName(item)}</span>
                                <Edit3 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden="true" />
                              </button>
                              <p className="truncate text-sm text-muted-foreground">{[getQuoteItemBrand(item), getQuoteItemBarcode(item)].filter(Boolean).join(' · ')}</p>
                              <p className="mt-0.5 flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
                                <label className="flex items-center gap-1">Marge
                                  <select value={item.marginPercentage} onChange={(e) => updateItemMargin(item.id, parseInt(e.target.value))} className="w-[4.75rem] rounded border border-transparent bg-transparent py-0 pl-0.5 pr-5 text-xs font-semibold text-emerald-700 hover:border-input dark:text-emerald-300">
                                    {marginOptions.map(p => <option key={p} value={p}>+{p} %</option>)}
                                  </select>
                                </label>
                                {Number(item.product?.buyprice) > 0 && <span>· achat {formatMoney(item.product.buyprice)}</span>}
                              </p>
                            </>
                          )}
                        </div>
                        <button type="button" onClick={() => removeItem(item.id)} aria-label={`Retirer ${getQuoteItemName(item)}`}
                          className="flex h-10 w-10 items-center justify-center self-start rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive md:order-last md:self-center">
                          <Trash2 className="h-4 w-4" />
                        </button>
                        <div className="col-span-3 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 md:contents">
                          <div className="flex items-center rounded-lg border border-input md:justify-self-center">
                            <button type="button" onClick={() => updateItemQuantity(item.id, item.quantity - 1)} disabled={item.quantity <= 1} aria-label="Diminuer la quantité"
                              className="flex h-9 w-9 items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40"><Minus className="h-3.5 w-3.5" /></button>
                            <input type="number" value={item.quantity} onChange={(e) => updateItemQuantity(item.id, parseInt(e.target.value) || 1)} onFocus={(e) => e.target.select()} min="1"
                              aria-label="Quantité" className="h-9 w-10 border-0 bg-transparent p-0 text-center text-sm font-semibold tabular-nums text-foreground [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" />
                            <button type="button" onClick={() => updateItemQuantity(item.id, item.quantity + 1)} aria-label="Augmenter la quantité"
                              className="flex h-9 w-9 items-center justify-center text-muted-foreground hover:text-foreground"><Plus className="h-3.5 w-3.5" /></button>
                          </div>
                          <div className="text-right">
                            <label className="flex items-center justify-end gap-1">
                              <span className="sr-only">Prix unitaire HT</span>
                              <input type="number" step="0.01" min="0"
                                value={parseFloat((item.unitPrice / (1 + tvaRate / 100)).toFixed(2))}
                                onChange={(e) => updateItemUnitPrice(item.id, (parseFloat(e.target.value) || 0) * (1 + tvaRate / 100))}
                                onFocus={(e) => e.target.select()}
                                className="w-24 rounded-md border border-transparent bg-transparent px-1 py-0.5 text-right text-sm font-medium tabular-nums text-foreground underline decoration-dotted decoration-muted-foreground/40 underline-offset-4 hover:border-input focus:border-input focus:no-underline focus:ring-2 focus:ring-ring" />
                              <span className="text-sm text-muted-foreground">Dh</span>
                            </label>
                            <label className="mt-0.5 flex items-center justify-end gap-1 text-xs text-muted-foreground">
                              Remise
                              <input type="number" step="1" min="0" max="100" value={item.discount ?? 0} onChange={(e) => updateItemDiscount(item.id, parseFloat(e.target.value) || 0)} onFocus={(e) => e.target.select()}
                                className={`w-10 rounded border border-transparent bg-transparent px-0.5 text-right tabular-nums hover:border-input focus:border-input ${(item.discount ?? 0) > 0 ? 'font-semibold text-amber-700 dark:text-amber-300' : ''}`} />
                              %
                            </label>
                          </div>
                          <p className="text-right font-semibold tabular-nums text-foreground">{formatMoney(lineHT(item))}</p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {totalPages > 1 && (
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-2 text-sm text-foreground">
                    <span>Lignes {startIndex + 1} à {Math.min(endIndex, items.length)} sur {items.length}</span>
                    <span className="flex items-center gap-2">
                      <button type="button" onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))} disabled={currentPage === 1} className="rounded-lg border border-input px-3 py-1 hover:bg-secondary disabled:opacity-50">Précédent</button>
                      <span>Page {currentPage} / {totalPages}</span>
                      <button type="button" onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))} disabled={currentPage === totalPages} className="rounded-lg border border-input px-3 py-1 hover:bg-secondary disabled:opacity-50">Suivant</button>
                    </span>
                  </div>
                )}
              </>
            )}

            {/* Add a product */}
            <div className="border-t border-border p-4">
              <div className="flex items-center gap-2 rounded-lg border border-dashed border-primary/40 bg-primary/5 px-3 focus-within:border-solid focus-within:border-primary">
                <Search className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <input ref={productSearchRef} type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                  aria-label="Ajouter un produit : nom, marque ou code-barres"
                  className="h-11 min-w-0 flex-1 border-0 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground focus:ring-0"
                  placeholder="Ajouter un produit — nom, marque ou code-barres" />
                <button type="button" onClick={openCustomProductForm} aria-expanded={showCustomProductForm}
                  className="hidden shrink-0 items-center gap-1 text-sm font-semibold text-primary hover:underline sm:flex">
                  Produit hors catalogue {showCustomProductForm ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                </button>
              </div>
              <button type="button" onClick={openCustomProductForm} className="mt-2 text-sm font-semibold text-primary sm:hidden">Produit hors catalogue</button>

              {searchResults.length > 0 && (
                <ul className="mt-2 max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border">
                  {searchResults.map((product) => {
                    const accessibleStockLevels = Object.entries(product.stock_levels || {}).filter(([location]) => canAccessStockLocation(location));
                    const totalStock = accessibleStockLevels.reduce((sum, [, level]) => sum + level, 0);
                    const img = resolveProductImageUrl(product.image);
                    return (
                      <li key={product.barcode} className="flex items-center gap-3 px-3 py-2">
                        <span className="flex h-11 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-white">
                          {img ? <img src={img} alt="" className="h-full w-full object-contain" loading="lazy" /> : <Package className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                            <span className="truncate">{product.name}</span>
                            {(searchSheetCounts[product.barcode] || 0) > 0 && <Paperclip className="h-3.5 w-3.5 shrink-0 text-primary" aria-label={`${searchSheetCounts[product.barcode]} fiche(s) technique(s)`} />}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {[product.brand + (getOriginalName('brand', product.brand) ? ` (ex : ${getOriginalName('brand', product.brand)})` : ''), product.barcode].filter(Boolean).join(' · ')}
                          </p>
                        </div>
                        <span className="hidden text-right sm:block">
                          <span className="block text-sm font-semibold tabular-nums text-foreground">{formatMoney(getDisplayPrice(product))}</span>
                          <span className={`block text-xs ${totalStock > 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-muted-foreground'}`}>{totalStock > 0 ? `${totalStock} en stock` : 'Sur commande'}</span>
                        </span>
                        <button type="button" onClick={() => addProductToQuote(product)} aria-label={`Ajouter ${product.name}`}
                          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90">
                          <Plus className="h-4 w-4" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}

              {showCustomProductForm && (
                <div className="mt-3 space-y-3 rounded-lg border border-border bg-secondary/40 p-3">
                  <p className="text-sm font-semibold text-foreground">Produit hors catalogue</p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <label className="text-xs text-muted-foreground">Désignation *
                      <input value={customFormData.name} onChange={e => setCustomFormData(prev => ({ ...prev, name: e.target.value }))} className={`${field} mt-0.5`} placeholder="Nom du produit" autoFocus />
                    </label>
                    <label className="text-xs text-muted-foreground">Marque
                      <input value={customFormData.brand} onChange={e => setCustomFormData(prev => ({ ...prev, brand: e.target.value }))} className={`${field} mt-0.5`} placeholder="Marque" />
                    </label>
                    <label className="text-xs text-muted-foreground">Code-barres
                      <input value={customFormData.barcode} onChange={e => setCustomFormData(prev => ({ ...prev, barcode: e.target.value }))} className={`${field} mt-0.5`} placeholder="Optionnel" />
                    </label>
                    <label className="text-xs text-muted-foreground">Prix unitaire
                      <input type="number" min={0} step="0.01" value={customFormData.unitPrice} onChange={e => setCustomFormData(prev => ({ ...prev, unitPrice: e.target.value }))} className={`${field} mt-0.5`} placeholder="0,00" onKeyDown={e => e.key === 'Enter' && submitCustomProduct()} />
                    </label>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Fournisseur</p>
                    {showNewProviderInput ? (
                      <div className="mt-0.5 flex gap-2">
                        <input type="text" value={newProviderName} onChange={e => setNewProviderName(e.target.value)} className={field} placeholder="Nom du fournisseur" aria-label="Nom du nouveau fournisseur" />
                        <button type="button" onClick={async () => {
                          if (!newProviderName.trim()) return;
                          try {
                            const created = await StockLocationsService.upsertProvider({ name: newProviderName.trim(), is_custom: true });
                            setProviders(prev => [...prev, created]);
                            setCustomFormData(prev => ({ ...prev, provider_id: created.id, provider_name: created.name }));
                            setNewProviderName('');
                            setShowNewProviderInput(false);
                          } catch {
                            showToast({ type: 'error', message: 'Erreur lors de la création du fournisseur' });
                          }
                        }} className="rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90">OK</button>
                        <button type="button" onClick={() => setShowNewProviderInput(false)} aria-label="Annuler" className="rounded-lg px-2 hover:bg-secondary"><X className="h-4 w-4" /></button>
                      </div>
                    ) : (
                      <div className="mt-0.5 flex gap-2">
                        <select value={customFormData.provider_id} aria-label="Fournisseur" onChange={e => {
                          const sel = providers.find(p => p.id === e.target.value);
                          setCustomFormData(prev => ({ ...prev, provider_id: e.target.value, provider_name: sel?.name || '' }));
                        }} className={field}>
                          <option value="">— Aucun —</option>
                          {providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                        <button type="button" onClick={() => setShowNewProviderInput(true)} className="whitespace-nowrap rounded-lg border border-input px-3 text-sm text-foreground hover:bg-secondary">+ Nouveau</button>
                      </div>
                    )}
                  </div>
                  <button type="button" onClick={submitCustomProduct} disabled={!customFormData.name.trim()}
                    className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-40">
                    <Plus className="h-4 w-4" />Ajouter au devis
                  </button>
                </div>
              )}
            </div>
          </section>

          {/* Notes */}
          <section className={`${panel} space-y-3 p-4 sm:p-5`} aria-labelledby="quote-notes-title">
            <h2 id="quote-notes-title" className="font-semibold text-foreground">Notes</h2>
            <label className="block text-xs text-muted-foreground">Visible sur le devis
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={`${field} mt-1`} placeholder="Conditions, délai de livraison, validité…" />
            </label>
            <label className="block text-xs text-muted-foreground">Note interne (n’apparaît pas sur le PDF)
              <textarea value={notes2} onChange={(e) => setNotes2(e.target.value)} rows={2} className={`${field} mt-1`} placeholder="Optionnel" />
            </label>
          </section>
        </div>

        {/* Summary and actions: stays in view while the lines scroll */}
        <aside className="space-y-4 lg:sticky lg:top-4" aria-label="Récapitulatif et actions">
          <section className={`${panel} p-5`}>
            <h2 className="font-semibold text-foreground">Récapitulatif</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-muted-foreground">Total HT</dt><dd className="font-medium tabular-nums text-foreground">{formatMoney(totalHT)}</dd></div>
              {globalDiscount > 0 && <div className="flex justify-between"><dt className="text-muted-foreground">Remise globale</dt><dd className="font-medium tabular-nums text-foreground">{globalDiscount} %</dd></div>}
              <div className="flex justify-between"><dt className="text-muted-foreground">TVA {tvaRate} %</dt><dd className="font-medium tabular-nums text-foreground">{formatMoney(totalTVA)}</dd></div>
            </dl>
            <div className="mt-3 flex items-baseline justify-between gap-2 border-t border-border pt-3">
              <span className="font-semibold text-foreground">Total TTC</span>
              <span className="text-2xl font-bold tabular-nums tracking-tight text-foreground">{formatMoney(totalAmount)}</span>
            </div>
            {estimatedMargin !== null && (
              <p className={`mt-1 text-right text-sm ${estimatedMargin >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-destructive'}`}>Marge estimée {formatMoney(estimatedMargin)}</p>
            )}
            <button type="button" onClick={() => handleSave(false)} disabled={isSaving}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-60">
              {isSaving ? <Loader className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Enregistrer
            </button>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <button type="button" onClick={handleExport} disabled={isExporting || items.length === 0}
                className="flex flex-col items-center gap-1 rounded-lg border border-border py-2 text-xs font-semibold text-foreground hover:bg-secondary disabled:opacity-50">
                {isExporting ? <Loader className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4 text-primary" />}PDF
              </button>
              <button type="button" onClick={handleWhatsAppShare} disabled={isExporting || isPreparingWaPdf || items.length === 0}
                className="flex flex-col items-center gap-1 rounded-lg border border-border py-2 text-xs font-semibold text-foreground hover:bg-secondary disabled:opacity-50">
                {isPreparingWaPdf ? <Loader className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4 text-emerald-600" />}WhatsApp
              </button>
              <button type="button" onClick={handleEmailShare} disabled={isExporting || items.length === 0}
                className="flex flex-col items-center gap-1 rounded-lg border border-border py-2 text-xs font-semibold text-foreground hover:bg-secondary disabled:opacity-50">
                <Mail className="h-4 w-4 text-primary" />E-mail
              </button>
            </div>
            {isDirty && items.length > 0 && <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-300"><Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Enregistrez avant d’envoyer le devis.</p>}
            {(isCompta || isSuperAdmin) && (
              <button type="button" onClick={handleCreateBL} disabled={isCreatingBL || isSaving || items.length === 0}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-border py-2 text-sm font-semibold text-foreground hover:bg-secondary disabled:opacity-50">
                {isCreatingBL ? <Loader className="h-4 w-4 animate-spin" /> : <Truck className="h-4 w-4" />}Convertir en bon de livraison
              </button>
            )}
            <p className="mt-3 text-center text-xs text-muted-foreground">Sur mobile, le PDF est partagé comme fichier ; sur ordinateur il est téléchargé pour être joint.</p>
          </section>

          <section className={`${panel} px-5 py-3`}>
            <h2 className="pt-1 text-sm font-semibold text-foreground">Options du PDF</h2>
            {pdfOption(includeProductImages, setIncludeProductImages, 'Photos des produits', 'Une image par ligne')}
            {companySettings?.stamp_url ? pdfOption(useStamp, setUseStamp, 'Tampon', 'Apposer le tampon de la société') : null}
            {pdfOption(printTTCOnly, setPrintTTCOnly, 'Prix TTC uniquement', 'Masquer le détail HT et TVA')}
            {hasAttachments && (
              <>
                {pdfOption(attachTechSheets, setAttachTechSheets, 'Fiches techniques', `Lien vers ${attachmentsSummary(attachments)}`)}
                {attachTechSheets && (
                  <label className="flex items-center justify-between gap-2 pb-2 text-xs text-muted-foreground">Le lien expire après
                    <select value={techSheetsExpiry} onChange={(e) => setTechSheetsExpiry(e.target.value)} className="rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground">
                      <option value="7">7 jours</option>
                      <option value="30">30 jours</option>
                      <option value="90">90 jours</option>
                      <option value="never">jamais</option>
                    </select>
                  </label>
                )}
              </>
            )}
          </section>
        </aside>
      </div>

      {/* Phone: total and save stay at hand, above the tab bar */}
      <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-20 border-t border-border bg-card px-4 py-2.5 shadow-[0_-4px_16px_rgba(17,24,39,0.06)] md:hidden">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground">Total TTC</p>
            <p className="whitespace-nowrap text-lg font-bold tabular-nums leading-tight text-foreground">{formatMoney(totalAmount)}</p>
          </div>
          <button type="button" onClick={handleWhatsAppShare} disabled={isPreparingWaPdf || items.length === 0} aria-label="Envoyer sur WhatsApp"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border text-emerald-600 disabled:opacity-50">
            {isPreparingWaPdf ? <Loader className="h-5 w-5 animate-spin" /> : <MessageCircle className="h-5 w-5" />}
          </button>
          <button type="button" onClick={() => handleSave(false)} disabled={isSaving}
            className="flex h-11 shrink-0 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60">
            {isSaving ? <Loader className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Enregistrer
          </button>
        </div>
      </div>

      {/* WhatsApp Recipient Modal */}
      {showWaRecipientModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="glass rounded-xl shadow-2xl w-full max-w-sm p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-foreground flex items-center gap-2">
                <MessageCircle className="h-4 w-4 text-emerald-400" />Envoyer sur WhatsApp
              </h2>
              <button onClick={() => setShowWaRecipientModal(false)} className="p-1 hover:bg-accent rounded-lg">
                <X className="h-4 w-4" />
              </button>
            </div>
            {isPreparingWaPdf && <div className="flex items-center justify-center gap-2 rounded-lg bg-secondary/60 px-3 py-4 text-sm text-muted-foreground"><Loader className="h-4 w-4 animate-spin" />Préparation du PDF…</div>}
            {waPdfError && <div className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">{waPdfError}</div>}
            {waPdfShare && canSharePdfFile(waPdfShare.blob, waPdfShare.filename) ? (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">Le partage système va s’ouvrir. Choisissez WhatsApp puis le destinataire.</p>
                <button onClick={sharePreparedPdf} className="w-full flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 py-3 text-sm font-semibold text-white hover:bg-emerald-700">
                  <MessageCircle className="h-4 w-4" />Partager le PDF sans lien
                </button>
              </div>
            ) : waPdfShare ? <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Choisissez le destinataire. Le PDF sera téléchargé : joignez le fichier téléchargé dans WhatsApp.</p>
              {customer.phoneNumber && (
                <button
                  onClick={() => sendWhatsAppToPhonenumber(customer.phoneNumber)}
                  className="w-full flex items-center justify-between px-3 py-2.5 border border-border rounded-lg hover:bg-accent text-sm text-left"
                >
                  <span className="font-medium text-foreground">Client</span>
                  <span className="text-muted-foreground text-xs font-mono">{customer.phoneNumber}</span>
                </button>
              )}
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-foreground">Numéro personnalisé</label>
                <div className="flex gap-2">
                  <input
                    type="tel"
                    value={waCustomPhone}
                    onChange={e => setWaCustomPhone(e.target.value)}
                    placeholder="Ex: 0661234567"
                    className="flex-1 px-3 py-2 text-sm border border-input rounded-lg bg-background text-foreground focus:ring-2 focus:ring-ring"
                    onKeyDown={e => { if (e.key === 'Enter' && waCustomPhone.trim()) sendWhatsAppToPhonenumber(waCustomPhone.trim()); }}
                  />
                  <button
                    onClick={() => { if (waCustomPhone.trim()) sendWhatsAppToPhonenumber(waCustomPhone.trim()); }}
                    disabled={!waCustomPhone.trim()}
                    className="px-3 py-2 text-sm bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg"
                  >
                    <MessageCircle className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div> : null}
            <button onClick={() => setShowWaRecipientModal(false)} className="w-full px-3 py-1.5 text-sm border border-input rounded-lg hover:bg-accent text-foreground">
              Annuler
            </button>
          </div>
        </div>
      )}

      {/* BL Created Success Modal */}
      {blCreated && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="glass rounded-xl shadow-2xl w-full max-w-sm p-6 space-y-4 text-center">
            <div className="flex items-center justify-center w-12 h-12 mx-auto rounded-full bg-emerald-500/10">
              <Truck className="h-6 w-6 text-emerald-500" />
            </div>
            <div>
              <p className="text-base font-bold text-foreground">BL créé avec succès</p>
              <p className="text-sm text-muted-foreground mt-1">
                Le bon de livraison <span className="font-semibold text-foreground">{blCreated.number}</span> a été créé.
                Le devis est maintenant confirmé.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => navigate(`/compta/bls/${blCreated.id}`)}
                className="w-full flex items-center justify-center space-x-2 px-4 py-2.5 text-sm bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors font-medium"
              >
                <Truck className="h-4 w-4" />
                <span>Ouvrir le BL {blCreated.number}</span>
              </button>
              <button
                onClick={() => setBlCreated(null)}
                className="w-full px-4 py-2 text-sm border border-input text-foreground hover:bg-accent rounded-lg transition-colors"
              >
                Rester sur le devis
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Duplicate Client Detection Modal */}
      {duplicateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="glass rounded-xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center space-x-3">
              <div className="p-2 rounded-full bg-amber-500/10">
                <AlertCircle className="h-5 w-5 text-amber-500" />
              </div>
              <div>
                <p className="text-base font-bold text-foreground">Client similaire détecté</p>
                <p className="text-xs text-muted-foreground">Un ou plusieurs clients avec un nom similaire existent déjà</p>
              </div>
            </div>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {duplicateModal.existing.map(c => (
                <button
                  key={c.id}
                  onClick={() => { duplicateModal.resolve(c); setDuplicateModal(null); }}
                  className="w-full text-left p-3 rounded-lg border border-input hover:bg-accent transition-colors"
                >
                  <p className="text-sm font-medium text-foreground">{c.full_name}</p>
                  <p className="text-xs text-muted-foreground">{c.phone_number} {c.client_code ? `· ${c.client_code}` : ''}</p>
                </button>
              ))}
            </div>
            <div className="pt-2 border-t border-border space-y-2">
              <p className="text-xs text-muted-foreground">Vous pouvez utiliser un client existant ou créer un nouveau client distinct.</p>
              <div className="flex gap-2">
                <button
                  onClick={() => { duplicateModal.resolve('create'); setDuplicateModal(null); }}
                  className="flex-1 px-4 py-2 text-sm bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg transition-colors font-medium"
                >
                  Créer nouveau client
                </button>
                <button
                  onClick={() => setDuplicateModal(null)}
                  className="px-4 py-2 text-sm border border-input text-foreground hover:bg-accent rounded-lg transition-colors"
                >
                  Annuler
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
