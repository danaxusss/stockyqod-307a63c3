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
          className="relative flex items-center justify-center w-12 h-12 text-primary-foreground rounded-full transition-all duration-200 hover:scale-105"
          style={{ background: 'var(--gradient-primary)', boxShadow: 'var(--shadow-glow)' }}
        >
          <ShoppingCart className="h-6 w-6" />
          {cart.totalItems > 0 && (
            <div className="absolute -top-2 -right-2 flex items-center justify-center w-6 h-6 bg-destructive text-destructive-foreground text-xs font-bold rounded-full border-2 border-background">
              {cart.totalItems > 99 ? '99+' : cart.totalItems}
            </div>
          )}
        </button>
      </div>

      {/* Quote Cart Panel */}
      {isOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-end justify-end z-50 p-4">
          <div className="glass rounded-2xl max-w-sm w-full max-h-[80vh] flex flex-col overflow-hidden"
            style={{ boxShadow: 'var(--shadow-elevated)' }}>

            {/* Header */}
            <div className="flex items-center justify-between p-3 border-b border-border bg-primary text-primary-foreground flex-shrink-0">
              <div className="flex items-center space-x-3">
                <div className="p-1.5 bg-primary-foreground/20 rounded-lg">
                  <ShoppingCart className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-base font-semibold">Panier de Devis</h2>
                  <p className="text-primary-foreground/70 text-xs">
                    {cart.totalItems} article{cart.totalItems !== 1 ? 's' : ''}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1.5 hover:bg-primary-foreground/20 rounded-lg transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Summary */}
            {cart.totalItems > 0 && (
              <div className="p-3 bg-secondary border-b border-border flex-shrink-0">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <div className="text-sm font-bold text-primary">{cart.totalItems}</div>
                    <div className="text-xs text-muted-foreground">Articles</div>
                  </div>
                  <div>
                    <div className="text-sm font-bold text-emerald-500">{formatPrice(summary.totalValue)} Dh</div>
                    <div className="text-xs text-muted-foreground">Total</div>
                  </div>
                  <div>
                    <div className="text-sm font-bold text-orange-500">{summary.averageMargin.toFixed(1)}%</div>
                    <div className="text-xs text-muted-foreground">Marge</div>
                  </div>
                </div>
              </div>
            )}

            {/* Content - Scrollable */}
            <div className="flex-1 overflow-y-auto">
              {cart.totalItems === 0 ? (
                <div className="flex flex-col items-center justify-center p-6 text-center">
                  <div className="p-3 bg-secondary rounded-full mb-3">
                    <Package className="h-8 w-8 text-muted-foreground" />
                  </div>
                  <h3 className="text-base font-semibold text-foreground mb-1">Panier Vide</h3>
                  <p className="text-muted-foreground text-xs">
                    Ajoutez des produits depuis la recherche pour créer votre devis
                  </p>
                </div>
              ) : (
                <div className="p-3 space-y-2">
                  {cart.items.map((item) => (
                    <div key={item.id} className="bg-secondary/60 rounded-lg p-3 border border-border">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1 min-w-0">
                          <h4 className="font-medium text-foreground text-sm truncate">
                            {item.product.name}
                          </h4>
                          <p className="text-xs text-muted-foreground font-mono">
                            #{item.product.barcode}
                          </p>
                        </div>
                        <button
                          onClick={() => removeFromCart(item.id)}
                          className="p-1 hover:bg-destructive/10 text-destructive rounded transition-colors"
                          title="Supprimer du panier"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>

                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">Marge:</span>
                          <select
                            value={item.marginPercentage}
                            onChange={(e) => updateItemMargin(item.id, parseInt(e.target.value))}
                            className="text-xs px-1 py-0.5 border border-input rounded bg-background text-orange-500 font-medium"
                          >
                            {marginOptions.map((percentage) => (
                              <option key={percentage} value={percentage}>{percentage}%</option>
                            ))}
                          </select>
                        </div>

                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">Base:</span>
                          <span className="font-medium text-muted-foreground">
                            {formatPrice(item.product.buyprice)} Dh
                          </span>
                        </div>

                        <div className="flex items-center justify-between text-xs font-semibold border-t border-border pt-1">
                          <span className="text-foreground">Prix final:</span>
                          <span className="text-emerald-500">{formatPrice(item.finalPrice)} Dh</span>
                        </div>
                      </div>

                      <div className="mt-2">
                        <button
                          onClick={() => handleCopyItem(item)}
                          className="w-full flex items-center justify-center space-x-1 px-2 py-1.5 bg-primary/10 hover:bg-primary/20 text-primary rounded-lg text-xs font-medium transition-colors"
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

            {/* Actions */}
            {cart.totalItems > 0 && (
              <div className="p-3 border-t border-border space-y-2 flex-shrink-0">
                <button
                  onClick={handleCreateQuote}
                  className="w-full flex items-center justify-center space-x-2 px-3 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg text-sm font-medium transition-all hover:scale-[1.02]"
                  style={{ boxShadow: 'var(--shadow-glow)' }}
                >
                  <FileText className="h-4 w-4" />
                  <span>Créer Devis</span>
                </button>

                <button
                  onClick={handleCopyAll}
                  className="w-full flex items-center justify-center space-x-2 px-3 py-2 bg-secondary hover:bg-accent text-foreground rounded-lg text-sm font-medium transition-colors border border-border"
                >
                  <Copy className="h-4 w-4" />
                  <span>Copier Tout</span>
                </button>

                <button
                  onClick={handleEmptyCart}
                  className="w-full flex items-center justify-center space-x-2 px-3 py-2 bg-destructive/10 hover:bg-destructive/20 text-destructive rounded-lg text-sm font-medium transition-colors"
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