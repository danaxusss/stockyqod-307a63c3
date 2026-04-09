import React, { useState } from 'react';
import { ShoppingCart, X, Copy, Trash2, Package, Calculator, FileText } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQuoteCart } from '../hooks/useQuoteCart';
import { useToast } from '../context/ToastContext';
import { QuoteItem } from '../types';
import { QuoteManager } from '../utils/quoteManager';

export function FloatingQuoteCart() {
  const navigate = useNavigate();
  const { cart, removeFromCart, emptyCart, copyAllItems, copyItem, getCartSummary, updateCartItem } = useQuoteCart();
  const { showToast } = useToast();
  const [isOpen, setIsOpen] = useState(false);

  const handleCopyAll = async () => {
    const success = await copyAllItems();
    if (success) {
      showToast({
        type: 'success',
        message: 'Tous les articles copiés dans le presse-papiers'
      });
    }
  };

  const updateItemMargin = (itemId: string, newMarginPercentage: number) => {
    updateCartItem(itemId, { marginPercentage: newMarginPercentage });
  };

  // Generate margin percentage options
  const marginOptions = [];
  for (let i = 5; i <= 100; i += 5) {
    marginOptions.push(i);
  }

  const handleCopyItem = async (item: QuoteItem) => {
    const success = await copyItem(item);
    if (success) {
      showToast({
        type: 'success',
        message: `${item.product.name} copié dans le presse-papiers`
      });
    }
  };

  const handleEmptyCart = () => {
    const confirmed = window.confirm('Êtes-vous sûr de vouloir vider le panier de devis ?');
    if (confirmed) {
      emptyCart();
      setIsOpen(false);
      showToast({
        type: 'info',
        message: 'Panier de devis vidé'
      });
    }
  };

  const handleCreateQuote = () => {
    navigate('/quote-cart');
    setIsOpen(false);
  };

  const summary = getCartSummary();

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('fr-FR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(price);
  };

  return (
    <>
      {/* Floating Cart Button */}
      <div className="fixed bottom-6 right-6 z-40">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="relative flex items-center justify-center w-12 h-12 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white rounded-full shadow-lg hover:shadow-xl transition-all duration-200 transform hover:scale-105"
        >
          <ShoppingCart className="h-6 w-6" />
          
          {/* Badge */}
          {cart.totalItems > 0 && (
            <div className="absolute -top-2 -right-2 flex items-center justify-center w-6 h-6 bg-red-500 text-white text-xs font-bold rounded-full border-2 border-white">
              {cart.totalItems > 99 ? '99+' : cart.totalItems}
            </div>
          )}
        </button>
      </div>

      {/* Quote Cart Panel */}
      {isOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-end justify-end z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-sm w-full max-h-[80vh] flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between p-3 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-blue-500 to-blue-600 text-white flex-shrink-0">
              <div className="flex items-center space-x-3">
                <ShoppingCart className="h-5 w-5" />
                <div>
                  <h2 className="text-base font-semibold">Panier de Devis</h2>
                  <p className="text-blue-100 text-sm">
                    {cart.totalItems} article{cart.totalItems !== 1 ? 's' : ''}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="p-2 hover:bg-white/20 rounded-lg transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Summary */}
            {cart.totalItems > 0 && (
              <div className="p-3 bg-gray-50 dark:bg-slate-700 border-b border-gray-200 dark:border-gray-600 flex-shrink-0">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <div className="text-sm font-bold text-blue-600 dark:text-blue-400">
                      {cart.totalItems}
                    </div>
                    <div className="text-xs text-gray-600 dark:text-gray-400">Articles</div>
                  </div>
                  <div>
                    <div className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                      {formatPrice(summary.totalValue)} Dh
                    </div>
                    <div className="text-xs text-gray-600 dark:text-gray-400">Total</div>
                  </div>
                  <div>
                    <div className="text-sm font-bold text-orange-600 dark:text-orange-400">
                      {summary.averageMargin.toFixed(1)}%
                    </div>
                    <div className="text-xs text-gray-600 dark:text-gray-400">Marge</div>
                  </div>
                </div>
              </div>
            )}

            {/* Content - Scrollable */}
            <div className="flex-1 overflow-y-auto">
              {cart.totalItems === 0 ? (
                <div className="flex flex-col items-center justify-center p-6 text-center">
                  <Package className="h-10 w-10 text-gray-400 mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                    Panier Vide
                  </h3>
                  <p className="text-gray-600 dark:text-gray-400 text-sm">
                    Ajoutez des produits depuis la page de détails pour créer votre devis
                  </p>
                </div>
              ) : (
                <div className="p-3 space-y-2">
                  {cart.items.map((item) => (
                    <div
                      key={item.id}
                      className="bg-gray-50 dark:bg-slate-700 rounded-lg p-3 border border-gray-200 dark:border-gray-600"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1 min-w-0">
                          <h4 className="font-medium text-gray-900 dark:text-white text-sm truncate">
                            {item.product.name}
                          </h4>
                          <p className="text-xs text-gray-500 dark:text-gray-500 font-mono">
                            #{item.product.barcode}
                          </p>
                        </div>
                        <button
                          onClick={() => removeFromCart(item.id)}
                          className="p-1 hover:bg-red-100 dark:hover:bg-red-900/20 text-red-600 dark:text-red-400 rounded transition-colors"
                          title="Supprimer du panier"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>

                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-gray-600 dark:text-gray-400">Marge:</span>
                          <select
                            value={item.marginPercentage}
                            onChange={(e) => updateItemMargin(item.id, parseInt(e.target.value))}
                            className="text-xs px-1 py-0.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-slate-600 text-orange-600 dark:text-orange-400 font-medium"
                          >
                            {marginOptions.map((percentage) => (
                              <option key={percentage} value={percentage}>
                                {percentage}%
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="flex items-center justify-between text-xs">
                          <span className="text-gray-600 dark:text-gray-400">Base:</span>
                          <span className="font-medium text-gray-600 dark:text-gray-400">
                            {formatPrice(item.product.buyprice)} Dh
                          </span>
                        </div>

                        <div className="flex items-center justify-between text-xs font-semibold border-t border-gray-300 dark:border-gray-600 pt-1">
                          <span className="text-gray-900 dark:text-white">Prix final:</span>
                          <span className="text-emerald-600 dark:text-emerald-400">
                            {formatPrice(item.finalPrice)} Dh
                          </span>
                        </div>
                      </div>

                      <div className="mt-2">
                        <button
                          onClick={() => handleCopyItem(item)}
                          className="w-full flex items-center justify-center space-x-1 px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs transition-colors"
                        >
                          <Copy className="h-3 w-3" />
                          <span>Copier</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Actions - Sticky at bottom */}
            {cart.totalItems > 0 && (
              <div className="p-3 border-t border-gray-200 dark:border-gray-700 space-y-2 flex-shrink-0 bg-white dark:bg-slate-800">
                <button
                  onClick={handleCreateQuote}
                  className="w-full flex items-center justify-center space-x-2 px-3 py-2 bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800 text-white rounded-lg text-sm font-medium transition-all duration-200 shadow-lg hover:shadow-xl transform hover:scale-105"
                >
                  <FileText className="h-4 w-4" />
                  <span>Créer Devis</span>
                </button>

                <button
                  onClick={handleCopyAll}
                  className="w-full flex items-center justify-center space-x-2 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  <Copy className="h-4 w-4" />
                  <span>Copier Tout</span>
                </button>

                <button
                  onClick={handleEmptyCart}
                  className="w-full flex items-center justify-center space-x-2 px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                  <span>Vider le Panier</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}