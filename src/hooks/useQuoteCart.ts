import { useState, useEffect } from 'react';
import { QuoteCart, QuoteItem, Product } from '../types';
import { QuoteManager } from '../utils/quoteManager';

export function useQuoteCart() {
  const [cart, setCart] = useState<QuoteCart>({ items: [], totalItems: 0 });
  const quoteManager = QuoteManager.getInstance();

  useEffect(() => {
    // Load initial cart
    setCart(quoteManager.getCart());

    // Subscribe to cart changes
    const unsubscribe = quoteManager.subscribe((updatedCart) => {
      setCart(updatedCart);
    });

    return unsubscribe;
  }, []);

  const addToCart = (
    product: Product,
    priceType: 'normal' | 'reseller',
    marginPercentage: number,
    initialQty = 1
  ) => {
    quoteManager.addToCart(product, priceType, marginPercentage, initialQty);
  };

  const removeFromCart = (itemId: string) => {
    quoteManager.removeFromCart(itemId);
  };

  const emptyCart = () => {
    quoteManager.emptyCart();
  };

  const copyAllItems = async () => {
    const copyText = quoteManager.generateAllItemsCopyText();
    
    try {
      await navigator.clipboard.writeText(copyText);
      return true;
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = copyText;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      return true;
    }
  };

  const copyItem = async (item: QuoteItem) => {
    const copyText = quoteManager.generateItemCopyText(item);
    
    try {
      await navigator.clipboard.writeText(copyText);
      return true;
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = copyText;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      return true;
    }
  };

  const getCartSummary = () => {
    return quoteManager.getCartSummary();
  };

  const updateCartItem = (itemId: string, updates: Partial<QuoteItem>) => {
    quoteManager.updateCartItem(itemId, updates);
  };

  return {
    cart,
    addToCart,
    removeFromCart,
    emptyCart,
    copyAllItems,
    copyItem,
    getCartSummary,
    updateCartItem
  };
}