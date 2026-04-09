import { QuoteItem, QuoteCart, Product } from '../types';

const QUOTE_STORAGE_KEY = 'inventory_quote_cart';

export class QuoteManager {
  private static instance: QuoteManager;
  private listeners: Set<(cart: QuoteCart) => void> = new Set();

  static getInstance(): QuoteManager {
    if (!QuoteManager.instance) {
      QuoteManager.instance = new QuoteManager();
    }
    return QuoteManager.instance;
  }

  // Subscribe to cart changes
  subscribe(listener: (cart: QuoteCart) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(cart: QuoteCart) {
    this.listeners.forEach(listener => listener(cart));
  }

  // Get current cart
  getCart(): QuoteCart {
    try {
      const stored = localStorage.getItem(QUOTE_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        return {
          items: parsed.items.map((item: any) => ({
            ...item,
            addedAt: new Date(item.addedAt)
          })),
          totalItems: parsed.totalItems
        };
      }
    } catch (error) {
      console.warn('Failed to load quote cart:', error);
    }

    return { items: [], totalItems: 0 };
  }

  // Save cart to localStorage
  private saveCart(cart: QuoteCart): void {
    try {
      localStorage.setItem(QUOTE_STORAGE_KEY, JSON.stringify(cart));
      this.notifyListeners(cart);
    } catch (error) {
      console.error('Failed to save quote cart:', error);
    }
  }

  // Calculate final price based on purchase price and margin percentage
  calculateFinalPrice(purchasePrice: number, marginPercentage: number): number {
    return purchasePrice + (purchasePrice * (marginPercentage / 100));
  }

  // Add item to cart
  addToCart(
    product: Product, 
    priceType: 'normal' | 'reseller', 
    marginPercentage: number
  ): void {
    const cart = this.getCart();
    const finalPrice = this.calculateFinalPrice(product.buyprice, marginPercentage);
    
    const newItem: QuoteItem = {
      id: `${product.barcode}-${Date.now()}`,
      product,
      priceType,
      marginPercentage,
      finalPrice,
      addedAt: new Date(),
      // Initialize quote-specific editable fields
      unitPrice: finalPrice,
      quantity: 1,
      subtotal: finalPrice
    };

    cart.items.push(newItem);
    cart.totalItems = cart.items.length;

    this.saveCart(cart);
  }

  // Remove item from cart
  removeFromCart(itemId: string): void {
    const cart = this.getCart();
    cart.items = cart.items.filter(item => item.id !== itemId);
    cart.totalItems = cart.items.length;

    this.saveCart(cart);
  }

  // Empty entire cart
  emptyCart(): void {
    const emptyCart: QuoteCart = { items: [], totalItems: 0 };
    this.saveCart(emptyCart);
  }

  // Generate copy text for single item
  generateItemCopyText(item: QuoteItem): string {
    return `${item.product.brand}\t${item.product.barcode}\t${item.product.name}\t0\t${item.finalPrice.toFixed(2)}`;
  }

  // Generate copy text for all items
  generateAllItemsCopyText(): string {
    const cart = this.getCart();
    return cart.items.map(item => this.generateItemCopyText(item)).join('\n');
  }

  // Get cart summary
  getCartSummary(): {
    totalItems: number;
    totalValue: number;
    averageMargin: number;
  } {
    const cart = this.getCart();
    
    if (cart.items.length === 0) {
      return { totalItems: 0, totalValue: 0, averageMargin: 0 };
    }

    const totalValue = cart.items.reduce((sum, item) => sum + item.finalPrice, 0);
    const averageMargin = cart.items.reduce((sum, item) => sum + item.marginPercentage, 0) / cart.items.length;

    return {
      totalItems: cart.totalItems,
      totalValue,
      averageMargin
    };
  }

  // Update a specific cart item
  updateCartItem(itemId: string, updates: Partial<QuoteItem>): void {
    const cart = this.getCart();
    
    cart.items = cart.items.map(item => {
      if (item.id === itemId) {
        const updatedItem = { ...item, ...updates };
        
        // If margin percentage is updated, recalculate unit price and subtotal
        if (updates.marginPercentage !== undefined) {
          updatedItem.finalPrice = this.calculateFinalPrice(item.product.buyprice, updates.marginPercentage);
          updatedItem.unitPrice = updatedItem.finalPrice;
          updatedItem.subtotal = updatedItem.unitPrice * updatedItem.quantity;
        }
        
        // If unit price is updated, recalculate subtotal
        if (updates.unitPrice !== undefined) {
          updatedItem.subtotal = updatedItem.unitPrice * updatedItem.quantity;
        }
        
        // If quantity is updated, recalculate subtotal
        if (updates.quantity !== undefined) {
          updatedItem.subtotal = updatedItem.unitPrice * updatedItem.quantity;
        }
        
        return updatedItem;
      }
      return item;
    });

    this.saveCart(cart);
  }
}