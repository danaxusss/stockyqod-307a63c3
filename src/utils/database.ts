// @ts-nocheck
import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { Product, Meta, Quote, QuoteTemplate } from '../types';

interface InventoryDB extends DBSchema {
  products: {
    key: string;
    value: Product;
  };
  meta: {
    key: string;
    value: Meta;
  };
  quotes: {
    key: string;
    value: Quote;
  };
  quote_templates: {
    key: string;
    value: QuoteTemplate & { isActiveNumeric: number };
  };
}

let db: IDBPDatabase<InventoryDB> | null = null;

export async function initDB(): Promise<IDBPDatabase<InventoryDB>> {
  if (db) return db;

  db = await openDB<InventoryDB>('inventory-db', 8, {
    upgrade(db, oldVersion) {
      // Products store
      if (!db.objectStoreNames.contains('products')) {
        const productStore = db.createObjectStore('products', {
          keyPath: 'barcode'
        });
        productStore.createIndex('name', 'name');
        productStore.createIndex('brand', 'brand');
      }

      // Meta store
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', {
          keyPath: 'version'
        });
      }

      // Quotes store
      if (!db.objectStoreNames.contains('quotes')) {
        const quotesStore = db.createObjectStore('quotes', {
          keyPath: 'id'
        });
        quotesStore.createIndex('quoteNumber', 'quoteNumber', { unique: true });
        quotesStore.createIndex('createdAt', 'createdAt');
        quotesStore.createIndex('status', 'status');
      }

      // Quote templates store - recreate if upgrading from version < 8
      if (oldVersion < 8) {
        // Delete existing quote_templates store if it exists to clear corrupted data
        if (db.objectStoreNames.contains('quote_templates')) {
          db.deleteObjectStore('quote_templates');
        }
        
        // Recreate the quote_templates store with numeric index
        const templatesStore = db.createObjectStore('quote_templates', {
          keyPath: 'id'
        });
        templatesStore.createIndex('isActive', 'isActiveNumeric');
        templatesStore.createIndex('uploadedAt', 'uploadedAt');
      } else if (!db.objectStoreNames.contains('quote_templates')) {
        // Create quote_templates store if it doesn't exist (for fresh installs)
        const templatesStore = db.createObjectStore('quote_templates', {
          keyPath: 'id'
        });
        templatesStore.createIndex('isActive', 'isActiveNumeric');
        templatesStore.createIndex('uploadedAt', 'uploadedAt');
      }
    }
  });

  // Add event listener for database connection closure
  db.addEventListener('close', () => {
    console.warn('IndexedDB connection closed unexpectedly');
    db = null; // Reset the global db variable to force reconnection
  });

  return db;
}

async function ensureDBConnection(): Promise<IDBPDatabase<InventoryDB>> {
  if (!db) {
    return await initDB();
  }
  
  // Check if the connection is still valid by attempting a simple operation
  try {
    await db.count('products');
    return db;
  } catch (error) {
    console.warn('Database connection appears to be invalid, reconnecting...', error);
    db = null;
    return await initDB();
  }
}

export async function saveProducts(products: Product[]): Promise<void> {
  const database = await ensureDBConnection();
  
  console.log(`Starting to save ${products.length} products to IndexedDB`);
  
  // Normalize and validate products
  const normalizedProducts: Product[] = [];
  const skippedProducts: { barcode: string; reason: string }[] = [];
  
  for (const product of products) {
    try {
      // Validate required fields
      if (!product.barcode || typeof product.barcode !== 'string') {
        skippedProducts.push({ barcode: String(product.barcode || 'unknown'), reason: 'Invalid barcode' });
        continue;
      }
      
      if (!product.name || typeof product.name !== 'string') {
        skippedProducts.push({ barcode: String(product.barcode), reason: 'Invalid name' });
        continue;
      }

      // Normalize the product
      const normalizedProduct: Product = {
        barcode: String(product.barcode).trim(),
        name: String(product.name).trim(),
        brand: String(product.brand || '').trim(),
        techsheet: String(product.techsheet || '').trim(),
        price: Number(product.price) || 0,
        buyprice: Number(product.buyprice) || 0,
        reseller_price: Number(product.reseller_price) || 0,
        provider: String(product.provider || '').trim(),
        stock_levels: product.stock_levels || {},
        created_at: product.created_at,
        updated_at: product.updated_at
      };

      // Additional validation
      if (normalizedProduct.barcode.length === 0) {
        skippedProducts.push({ barcode: String(product.barcode), reason: 'Empty barcode after normalization' });
        continue;
      }

      if (normalizedProduct.name.length === 0) {
        skippedProducts.push({ barcode: normalizedProduct.barcode, reason: 'Empty name after normalization' });
        continue;
      }

      normalizedProducts.push(normalizedProduct);
    } catch (error) {
      console.error('Error normalizing product:', product, error);
      skippedProducts.push({ 
        barcode: String(product.barcode || 'unknown'), 
        reason: `Normalization error: ${error instanceof Error ? error.message : 'Unknown error'}` 
      });
    }
  }

  console.log(`Normalized ${normalizedProducts.length} products, skipped ${skippedProducts.length} products`);
  
  if (skippedProducts.length > 0) {
    console.warn('Skipped products:', skippedProducts);
  }

  // Deduplicate products by barcode to prevent count mismatch
  const productMap = new Map<string, Product>();
  const duplicateCount = normalizedProducts.length;
  
  for (const product of normalizedProducts) {
    productMap.set(product.barcode, product);
  }
  
  const uniqueProducts = Array.from(productMap.values());
  const duplicatesRemoved = duplicateCount - uniqueProducts.length;
  
  if (duplicatesRemoved > 0) {
    console.log(`Removed ${duplicatesRemoved} duplicate products (by barcode)`);
  }
  
  console.log(`Processing ${uniqueProducts.length} unique products for IndexedDB`);

  // Use a transaction to ensure atomicity
  const tx = database.transaction('products', 'readwrite');
  
  try {
    // Clear existing products first
    await tx.store.clear();
    console.log('Cleared existing products from IndexedDB');
    
    // Save products in batches to avoid overwhelming the transaction
    const BATCH_SIZE = 100;
    let savedCount = 0;
    let failedCount = 0;
    const failedProducts: { barcode: string; error: string }[] = [];
    
    for (let i = 0; i < uniqueProducts.length; i += BATCH_SIZE) {
      const batch = uniqueProducts.slice(i, i + BATCH_SIZE);
      console.log(`Saving batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(uniqueProducts.length / BATCH_SIZE)} (${batch.length} products)`);
      
      for (const product of batch) {
        try {
          await tx.store.put(product);
          savedCount++;
        } catch (error) {
          failedCount++;
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          failedProducts.push({ barcode: product.barcode, error: errorMessage });
          console.error(`Failed to save product ${product.barcode}:`, errorMessage);
        }
      }
    }
    
    await tx.done;
    
    if (failedCount > 0) {
      console.warn(`Failed to save ${failedCount} products:`, failedProducts);
    }
    
    // Final verification
    const finalCount = await database.count('products');
    console.log(`Final product count in IndexedDB: ${finalCount}`);
    
    if (finalCount !== savedCount) {
      console.error(`Count mismatch! Expected ${savedCount}, but database contains ${finalCount}`);
    }
    
  } catch (error) {
    console.error('Transaction failed:', error);
    throw new Error(`Failed to save products: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function getProducts(): Promise<Product[]> {
  const database = await ensureDBConnection();
  const products = await database.getAll('products');
  
  console.log(`Retrieved ${products.length} products from IndexedDB`);
  
  return products.map(product => ({
    barcode: String(product.barcode),
    name: String(product.name),
    brand: String(product.brand || ''),
    techsheet: String(product.techsheet || ''),
    price: Number(product.price) || 0,
    buyprice: Number(product.buyprice) || 0,
    reseller_price: Number(product.reseller_price) || 0,
    provider: String(product.provider || ''),
    stock_levels: product.stock_levels || {}
  }));
}

export async function getProduct(id: string): Promise<Product | undefined> {
  const database = await ensureDBConnection();
  
  // Try exact match first
  console.log('Looking for product with ID:', id);
  console.log('ID décodé:', decodeURIComponent(id));
  
  let product = await database.get('products', id);
  
  if (!product) {
    // If not found, try to find by searching all products (in case of encoding issues)
    const allProducts = await database.getAll('products');
    console.log('Product not found with exact match, searching through all products...');
    console.log('Available IDs:', allProducts.map(p => p.barcode));
    
    product = allProducts.find(p => 
      String(p.barcode) === String(id) ||
      String(p.barcode).toLowerCase() === String(id).toLowerCase() ||
      encodeURIComponent(String(p.barcode)) === String(id) ||
      String(p.barcode) === decodeURIComponent(String(id))
    );
  }
  
  if (!product) {
    console.log('Product not found for ID:', id);
    return undefined;
  }
  
  console.log('Found product:', product);
  
  return {
    barcode: String(product.barcode),
    name: String(product.name),
    brand: String(product.brand || ''),
    techsheet: String(product.techsheet || ''),
    price: Number(product.price) || 0,
    buyprice: Number(product.buyprice) || 0,
    reseller_price: Number(product.reseller_price) || 0,
    provider: String(product.provider || ''),
    stock_levels: product.stock_levels || {}
  };
}

export interface SearchFilters {
  query?: string;
  brand?: string;
  stockLocation?: string;
}

export async function searchProducts(filters: SearchFilters | string): Promise<Product[]> {
  const database = await ensureDBConnection();
  const products = await database.getAll('products');
  
  // Handle backward compatibility - if a string is passed, treat it as query
  const searchFilters: SearchFilters = typeof filters === 'string' 
    ? { query: filters } 
    : filters;

  const { query = '', brand = '', stockLocation = '' } = searchFilters;
  
  // Apply filters
  const filteredProducts = products.filter(product => {
    // Text search filter (if query is provided)
    const matchesQuery = !query || (() => {
      const queryLower = query.toLowerCase().trim();
      
      // Direct barcode match (exact match for performance)
      if (String(product.barcode).toLowerCase() === queryLower) {
        return true;
      }
      
      // Flexible keyword search - split query into individual words
      const queryTokens = queryLower.split(/\s+/).filter(token => token.length > 0);
      
      if (queryTokens.length === 0) {
        return false;
      }
      
      // Combine product name and brand for searching
      const searchableText = `${String(product.name)} ${String(product.brand || '')}`.toLowerCase();
      
      // Check if ALL query tokens are present in the searchable text
      // This allows for flexible word order and partial matching
      return queryTokens.every(token => searchableText.includes(token));
    })();

    // Brand filter (if brand is provided)
    const matchesBrand = !brand || String(product.brand || '').toLowerCase() === brand.toLowerCase();

    // Stock location filter (if stockLocation is provided)
    const matchesStockLocation = !stockLocation || (
      product.stock_levels && 
      Object.keys(product.stock_levels).some(location => 
        location.toLowerCase() === stockLocation.toLowerCase() && 
        (product.stock_levels[location] || 0) > 0
      )
    );

    return matchesQuery && matchesBrand && matchesStockLocation;
  });
  
  // Sort by price (cheapest first)
  const sortedProducts = filteredProducts.sort((a, b) => {
    const priceA = Number(a.price) || 0;
    const priceB = Number(b.price) || 0;
    return priceA - priceB;
  });
  
  return sortedProducts.map(product => ({
    barcode: String(product.barcode),
    name: String(product.name),
    brand: String(product.brand || ''),
    techsheet: String(product.techsheet || ''),
    price: Number(product.price) || 0,
    buyprice: Number(product.buyprice) || 0,
    reseller_price: Number(product.reseller_price) || 0,
    provider: String(product.provider || ''),
    stock_levels: product.stock_levels || {}
  }));
}

export async function saveMeta(meta: Meta): Promise<void> {
  const database = await ensureDBConnection();
  await database.put('meta', meta);
}

export async function getMeta(): Promise<Meta | undefined> {
  const database = await ensureDBConnection();
  const allMeta = await database.getAll('meta');
  return allMeta[0]; // Get the first (and only) meta record
}

// Quote management functions
export async function saveQuote(quote: Quote): Promise<void> {
  const database = await ensureDBConnection();
  
  // Normalize dates to ensure they're stored as Date objects
  const normalizedQuote = {
    ...quote,
    createdAt: new Date(quote.createdAt),
    updatedAt: new Date(quote.updatedAt),
    items: quote.items.map(item => ({
      ...item,
      addedAt: new Date(item.addedAt)
    }))
  };
  
  // Save to IndexedDB first (for offline capability)
  await database.put('quotes', normalizedQuote);
  console.log(`Quote saved to IndexedDB: ${quote.quoteNumber} (ID: ${quote.id})`);
  
  // Try to sync to Supabase if online
  if (navigator.onLine) {
    try {
      const { SupabaseQuotesService } = await import('./supabaseQuotes');
      await SupabaseQuotesService.saveQuote(normalizedQuote);
      console.log(`Quote synced to Supabase: ${quote.quoteNumber} (ID: ${quote.id})`);
    } catch (error) {
      console.warn(`Failed to sync quote ${quote.quoteNumber} to Supabase (saved locally):`, error);
      // Don't throw error - quote is still saved locally
    }
  }
}

export async function getQuote(id: string): Promise<Quote | undefined> {
  // Try to get from Supabase first if online
  if (navigator.onLine) {
    try {
      const { SupabaseQuotesService } = await import('./supabaseQuotes');
      const supabaseQuote = await SupabaseQuotesService.getQuote(id);
      if (supabaseQuote) {
        // Update local cache with Supabase data
        const database = await ensureDBConnection();
        await database.put('quotes', supabaseQuote);
        return supabaseQuote;
      }
    } catch (error) {
      console.warn('Failed to fetch quote from Supabase, falling back to local:', error);
    }
  }
  
  // Fallback to local IndexedDB
  const database = await ensureDBConnection();
  const quote = await database.get('quotes', id);
  
  if (!quote) return undefined;
  
  // Ensure dates are Date objects
  return {
    ...quote,
    createdAt: new Date(quote.createdAt),
    updatedAt: new Date(quote.updatedAt),
    items: quote.items.map(item => ({
      ...item,
      addedAt: new Date(item.addedAt)
    }))
  };
}

export async function getAllQuotes(): Promise<Quote[]> {
  const { isAdmin, currentUser, authenticatedUser } = await import('../hooks/useAuth').then(m => {
    const { useAuth } = m;
    // We need to get the current auth state
    return {
      isAdmin: localStorage.getItem('inventory_current_user') ? 
        JSON.parse(localStorage.getItem('inventory_current_user')).is_admin : false,
      currentUser: localStorage.getItem('inventory_current_user') ? 
        JSON.parse(localStorage.getItem('inventory_current_user')) : null,
      authenticatedUser: localStorage.getItem('inventory_authenticated_user') ? 
        JSON.parse(localStorage.getItem('inventory_authenticated_user')) : null
    };
  });

  const currentUsername = currentUser?.username || authenticatedUser?.username;

  // Always load from local IndexedDB first for immediate response
  const database = await ensureDBConnection();
  let quotes = await database.getAll('quotes');
  console.log(`Loaded ${quotes.length} quotes from local IndexedDB`);
  
  // Try to sync with Supabase in the background if online
  if (navigator.onLine) {
    try {
      const { SupabaseQuotesService } = await import('./supabaseQuotes');
      const supabaseQuotes = await SupabaseQuotesService.getAllQuotes(isAdmin ? undefined : currentUsername);
      console.log(`Found ${supabaseQuotes.length} quotes in Supabase`);
      
      // Only update local cache if Supabase has more recent data
      if (supabaseQuotes.length > 0) {
        const tx = database.transaction('quotes', 'readwrite');
        
        // Merge quotes instead of clearing all
        for (const supabaseQuote of supabaseQuotes) {
          const existingQuote = await tx.store.get(supabaseQuote.id);
          if (!existingQuote || new Date(supabaseQuote.updatedAt) > new Date(existingQuote.updatedAt)) {
            await tx.store.put(supabaseQuote);
          }
        }
        await tx.done;
        
        // Reload from IndexedDB to get the merged result
        quotes = await database.getAll('quotes');
        console.log(`Synced with Supabase, now have ${quotes.length} quotes locally`);
      }
    } catch (error) {
      console.warn('Failed to sync quotes with Supabase:', error);
    }
  }
  
  // Filter quotes based on user permissions
  let filteredQuotes = quotes;
  if (!isAdmin && currentUsername) {
    filteredQuotes = quotes.filter(quote => 
      quote.customer.salesPerson.toLowerCase() === currentUsername.toLowerCase()
    );
    console.log(`Filtered quotes for user ${currentUsername}: ${filteredQuotes.length} of ${quotes.length} quotes`);
  }
  
  return filteredQuotes
    .map(quote => ({
      ...quote,
      createdAt: new Date(quote.createdAt),
      updatedAt: new Date(quote.updatedAt),
      items: quote.items.map(item => ({
        ...item,
        addedAt: new Date(item.addedAt)
      }))
    }))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export async function deleteQuote(id: string): Promise<void> {
  // Delete from IndexedDB first
  const database = await ensureDBConnection();
  await database.delete('quotes', id);
  console.log('Quote deleted from IndexedDB:', id);
  
  // Try to delete from Supabase if online
  if (navigator.onLine) {
    try {
      const { SupabaseQuotesService } = await import('./supabaseQuotes');
      await SupabaseQuotesService.deleteQuote(id);
      console.log('Quote deleted from Supabase:', id);
    } catch (error) {
      console.warn('Failed to delete quote from Supabase (deleted locally):', error);
      // Don't throw error - quote is still deleted locally
    }
  }
}

export async function searchQuotes(query: string): Promise<Quote[]> {
  const { isAdmin, currentUser, authenticatedUser } = await import('../hooks/useAuth').then(m => {
    return {
      isAdmin: localStorage.getItem('inventory_current_user') ? 
        JSON.parse(localStorage.getItem('inventory_current_user')).is_admin : false,
      currentUser: localStorage.getItem('inventory_current_user') ? 
        JSON.parse(localStorage.getItem('inventory_current_user')) : null,
      authenticatedUser: localStorage.getItem('inventory_authenticated_user') ? 
        JSON.parse(localStorage.getItem('inventory_authenticated_user')) : null
    };
  });

  const currentUsername = currentUser?.username || authenticatedUser?.username;

  let quotes: Quote[] = [];
  
  // Try to search in Supabase first if online
  if (navigator.onLine) {
    try {
      const { SupabaseQuotesService } = await import('./supabaseQuotes');
      quotes = await SupabaseQuotesService.searchQuotes(query, isAdmin ? undefined : currentUsername);
      console.log('Quote search performed on Supabase');
    } catch (error) {
      console.warn('Failed to search quotes in Supabase, falling back to local:', error);
    }
  }
  
  // If no results from Supabase or offline, search locally
  if (quotes.length === 0) {
    const database = await ensureDBConnection();
    const allQuotes = await database.getAll('quotes');
    
    const searchTerm = query.toLowerCase();
    let filteredQuotes = allQuotes.filter(quote => 
      quote.quoteNumber.toLowerCase().includes(searchTerm) ||
      quote.customer.fullName.toLowerCase().includes(searchTerm) ||
      quote.customer.phoneNumber.includes(searchTerm) ||
      quote.customer.city.toLowerCase().includes(searchTerm)
    );
    
    // Apply user permission filter
    if (!isAdmin && currentUsername) {
      filteredQuotes = filteredQuotes.filter(quote => 
        quote.customer.salesPerson.toLowerCase() === currentUsername.toLowerCase()
      );
    }
    
    quotes = filteredQuotes;
    console.log('Quote search performed locally');
  }
  
  return quotes
    .map(quote => ({
      ...quote,
      createdAt: new Date(quote.createdAt),
      updatedAt: new Date(quote.updatedAt),
      items: quote.items.map(item => ({
        ...item,
        addedAt: new Date(item.addedAt)
      }))
    }))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

// Quote template management functions
export async function saveQuoteTemplate(template: QuoteTemplate): Promise<void> {
  // Save to IndexedDB first
  const database = await ensureDBConnection();
  
  // If this template is being set as active, deactivate all others first
  if (template.isActive) {
    const tx = database.transaction('quote_templates', 'readwrite');
    const allTemplates = await tx.store.getAll();
    
    for (const existingTemplate of allTemplates) {
      if (existingTemplate.id !== template.id) {
        await tx.store.put({ 
          ...existingTemplate, 
          isActive: false,
          isActiveNumeric: 0
        });
      }
    }
    
    await tx.done;
  }
  
  // Store template with numeric isActive value
  const templateToStore = {
    ...template,
    isActiveNumeric: template.isActive ? 1 : 0
  };
  
  await database.put('quote_templates', templateToStore);
  console.log('Quote template saved to IndexedDB:', template.name);
  
  // Try to sync to Supabase if online
  if (navigator.onLine) {
    try {
      const { SupabaseQuotesService } = await import('./supabaseQuotes');
      await SupabaseQuotesService.saveQuoteTemplate(template);
      console.log('Quote template synced to Supabase:', template.name);
    } catch (error) {
      console.warn('Failed to sync quote template to Supabase (saved locally):', error);
    }
  }
}

export async function getQuoteTemplates(): Promise<QuoteTemplate[]> {
  let templates: QuoteTemplate[] = [];
  
  // Try to get from Supabase first if online
  if (navigator.onLine) {
    try {
      const { SupabaseQuotesService } = await import('./supabaseQuotes');
      const supabaseTemplates = await SupabaseQuotesService.getQuoteTemplates();
      
      // Update local cache with Supabase data
      const database = await ensureDBConnection();
      const tx = database.transaction('quote_templates', 'readwrite');
      
      // Clear existing templates and replace with Supabase data
      await tx.store.clear();
      for (const template of supabaseTemplates) {
        const templateToStore = {
          ...template,
          isActiveNumeric: template.isActive ? 1 : 0
        };
        await tx.store.put(templateToStore);
      }
      await tx.done;
      
      templates = supabaseTemplates;
      console.log('Quote templates loaded from Supabase and cached locally');
    } catch (error) {
      console.warn('Failed to fetch quote templates from Supabase, falling back to local:', error);
    }
  }
  
  // If no templates from Supabase or offline, get from local IndexedDB
  if (templates.length === 0) {
    const database = await ensureDBConnection();
    const localTemplates = await database.getAll('quote_templates');
    
    templates = localTemplates.map(template => ({
      id: template.id,
      name: template.name,
      fileData: template.fileData,
      fileType: template.fileType,
      uploadedAt: new Date(template.uploadedAt),
      isActive: template.isActiveNumeric === 1
    }));
    console.log('Quote templates loaded from local IndexedDB');
  }
  
  return templates.sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime());
}

export async function getActiveQuoteTemplate(): Promise<QuoteTemplate | undefined> {
  // Try to get from Supabase first if online
  if (navigator.onLine) {
    try {
      const { SupabaseQuotesService } = await import('./supabaseQuotes');
      const activeTemplate = await SupabaseQuotesService.getActiveQuoteTemplate();
      if (activeTemplate) {
        return activeTemplate;
      }
    } catch (error) {
      console.warn('Failed to fetch active quote template from Supabase, falling back to local:', error);
    }
  }
  
  // Fallback to local IndexedDB
  const database = await ensureDBConnection();
  const templates = await database.getAllFromIndex('quote_templates', 'isActive', 1);
  
  if (templates.length === 0) return undefined;
  
  const template = templates[0];
  return {
    id: template.id,
    name: template.name,
    fileData: template.fileData,
    fileType: template.fileType,
    uploadedAt: new Date(template.uploadedAt),
    isActive: template.isActiveNumeric === 1
  };
}

export async function deleteQuoteTemplate(id: string): Promise<void> {
  // Delete from IndexedDB first
  const database = await ensureDBConnection();
  await database.delete('quote_templates', id);
  console.log('Quote template deleted from IndexedDB:', id);
  
  // Try to delete from Supabase if online
  if (navigator.onLine) {
    try {
      const { SupabaseQuotesService } = await import('./supabaseQuotes');
      await SupabaseQuotesService.deleteQuoteTemplate(id);
      console.log('Quote template deleted from Supabase:', id);
    } catch (error) {
      console.warn('Failed to delete quote template from Supabase (deleted locally):', error);
    }
  }
}

// Clear all products from IndexedDB
export async function clearAllProducts(): Promise<void> {
  const database = await ensureDBConnection();
  
  console.log('Clearing all products from IndexedDB...');
  
  const tx = database.transaction('products', 'readwrite');
  await tx.store.clear();
  await tx.done;
  
  const finalCount = await database.count('products');
  console.log(`All products cleared from IndexedDB. Final count: ${finalCount}`);
  
  if (finalCount > 0) {
    throw new Error(`Failed to clear all products. ${finalCount} products still remain.`);
  }
}

// Clear all data from IndexedDB (products and meta)
export async function clearAllData(): Promise<void> {
  const database = await ensureDBConnection();
  
  console.log('Clearing all data from IndexedDB...');
  
  const tx = database.transaction(['products', 'meta'], 'readwrite');
  
  await Promise.all([
    tx.objectStore('products').clear(),
    tx.objectStore('meta').clear()
  ]);
  
  await tx.done;
  
  const [productsCount, metaCount] = await Promise.all([
    database.count('products'),
    database.count('meta')
  ]);
  
  console.log(`All data cleared from IndexedDB. Products: ${productsCount}, Meta: ${metaCount}`);
  
  if (productsCount > 0 || metaCount > 0) {
    throw new Error(`Failed to clear all data. Products: ${productsCount}, Meta: ${metaCount} still remain.`);
  }
}

// Debug function to get detailed database statistics
export async function getDatabaseStats(): Promise<{
  productsCount: number;
  metaCount: number;
  sampleProducts: Product[];
  duplicateBarcodes: string[];
}> {
  const database = await ensureDBConnection();
  
  const [products, meta] = await Promise.all([
    database.getAll('products'),
    database.getAll('meta')
  ]);

  // Check for duplicate barcodes
  const barcodeMap = new Map<string, number>();
  const duplicateBarcodes: string[] = [];
  
  products.forEach(product => {
    const barcode = String(product.barcode);
    const count = barcodeMap.get(barcode) || 0;
    barcodeMap.set(barcode, count + 1);
    
    if (count === 1) { // Second occurrence
      duplicateBarcodes.push(barcode);
    }
  });

  return {
    productsCount: products.length,
    metaCount: meta.length,
    sampleProducts: products.slice(0, 5),
    duplicateBarcodes
  };
}