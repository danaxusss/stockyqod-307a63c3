import React, { useState } from 'react';
import { ShoppingCart, X, Copy, Trash2, Package, FileText, ChevronRight, Minus, Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQuoteCart } from '../hooks/useQuoteCart';
import { useToast } from '../context/ToastContext';
import { QuoteItem } from '../types';
import { useEscapeKey } from '../hooks/useShortcuts';

const marginOptions = Array.from({ length: 20 }, (_, i) => (i + 1) * 5);

function fmt(n: number) {
  return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

export function FloatingQuoteCart() {
  const navigate = useNavigate();
  const { cart, removeFromCart, emptyCart, copyAllItems, copyItem, getCartSummary, updateCartItem } = useQuoteCart();
  const { showToast } = useToast();
  const [isOpen, setIsOpen] = useState(false);

  useEscapeKey(() => setIsOpen(false), isOpen);

  const handleCopyAll = async () => {
    if (await copyAllItems()) showToast({ type: 'success', message: 'Tous les articles copiés' });
  };

  const handleCopyItem = async (item: QuoteItem) => {
    if (await copyItem(item)) showToast({ type: 'success', message: `${item.product.name} copié` });
  };

  const handleEmptyCart = () => {
    if (!window.confirm('Vider le panier de devis ?')) return;
    emptyCart();
    setIsOpen(false);
    showToast({ type: 'info', message: 'Panier vidé' });
  };

  const handleCreateQuote = () => { navigate('/quote-cart'); setIsOpen(false); };

  const summary = getCartSummary();

  return (
    <>
      {/* Trigger button */}
      <div className="fixed bottom-5 right-5 z-40">
        <button
          onClick={() => setIsOpen(v => !v)}
          className="relative flex items-center justify-center w-11 h-11 text-primary-foreground rounded-full transition-all duration-200 hover:scale-105 active:scale-95"
          style={{ background: 'var(--gradient-primary)', boxShadow: 'var(--shadow-glow)' }}
          title="Panier de devis"
        >
          <ShoppingCart className="h-5 w-5" />
          {cart.totalItems > 0 && (
            <div className="absolute -top-1.5 -right-1.5 flex items-center justify-center min-w-[18px] h-[18px] bg-destructive text-destructive-foreground text-[10px] font-bold rounded-full border-2 border-background px-0.5">
              {cart.totalItems > 99 ? '99+' : cart.totalItems}
            </div>
          )}
        </button>
      </div>

      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Slide-in panel */}
      <div className={`
        fixed top-0 right-0 h-screen w-80 z-50 flex flex-col
        bg-card border-l border-border/60
        shadow-[−4px_0_24px_rgba(0,0,0,0.15)] dark:shadow-[-4px_0_24px_rgba(0,0,0,0.5)]
        transition-transform duration-250 ease-in-out
        ${isOpen ? 'translate-x-0' : 'translate-x-full'}
      `}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/60 shrink-0 bg-primary text-primary-foreground">
          <div className="flex items-center gap-2.5">
            <ShoppingCart className="h-4 w-4" />
            <div>
              <p className="text-sm font-semibold leading-none">Panier de devis</p>
              <p className="text-[11px] text-primary-foreground/70 mt-0.5">{cart.totalItems} article{cart.totalItems !== 1 ? 's' : ''}</p>
            </div>
          </div>
          <button onClick={() => setIsOpen(false)} className="p-1.5 rounded-lg hover:bg-primary-foreground/15 transition-colors" title="Fermer (Échap)">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Summary strip */}
        {cart.totalItems > 0 && (
          <div className="grid grid-cols-3 divide-x divide-border border-b border-border/60 bg-secondary/50 shrink-0">
            <div className="py-2 text-center">
              <p className="text-sm font-bold text-foreground">{cart.totalItems}</p>
              <p className="text-[10px] text-muted-foreground">Articles</p>
            </div>
            <div className="py-2 text-center">
              <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{fmt(summary.totalValue)}</p>
              <p className="text-[10px] text-muted-foreground">Total Dh</p>
            </div>
            <div className="py-2 text-center">
              <p className="text-sm font-bold text-amber-600 dark:text-amber-400">{summary.averageMargin.toFixed(1)}%</p>
              <p className="text-[10px] text-muted-foreground">Marge moy.</p>
            </div>
          </div>
        )}

        {/* Items */}
        <div className="flex-1 overflow-y-auto">
          {cart.totalItems === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-6">
              <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center mb-3">
                <Package className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium text-foreground mb-1">Panier vide</p>
              <p className="text-xs text-muted-foreground">Ajoutez des produits depuis la recherche</p>
            </div>
          ) : (
            <div className="p-3 space-y-2">
              {cart.items.map(item => (
                <div key={item.id} className="rounded-xl border border-border/60 bg-secondary/40 overflow-hidden">
                  <div className="flex items-start gap-2 p-2.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground truncate">{item.product.name}</p>
                      <p className="text-[10px] text-muted-foreground font-mono mt-0.5">#{item.product.barcode}</p>
                    </div>
                    <button onClick={() => removeFromCart(item.id)} className="p-1 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors shrink-0">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <div className="border-t border-border/40 px-2.5 py-2 space-y-1.5">
                    {/* Quantity stepper */}
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-muted-foreground">Quantité</span>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => updateCartItem(item.id, { quantity: Math.max(1, (item.quantity || 1) - 1) })}
                          className="w-5 h-5 flex items-center justify-center rounded border border-border hover:bg-accent text-foreground transition-colors"
                        >
                          <Minus className="h-2.5 w-2.5" />
                        </button>
                        <span className="text-[11px] font-semibold text-foreground w-5 text-center">{item.quantity || 1}</span>
                        <button
                          onClick={() => updateCartItem(item.id, { quantity: (item.quantity || 1) + 1 })}
                          className="w-5 h-5 flex items-center justify-center rounded border border-border hover:bg-accent text-foreground transition-colors"
                        >
                          <Plus className="h-2.5 w-2.5" />
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-muted-foreground">Achat (TTC)</span>
                      <span className="text-[10px] font-medium text-muted-foreground">{fmt(item.product.buyprice)} Dh</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-muted-foreground">Marge</span>
                      <select
                        value={item.marginPercentage}
                        onChange={e => updateCartItem(item.id, { marginPercentage: parseInt(e.target.value) })}
                        className="text-[10px] px-1.5 py-0.5 border border-input rounded bg-background text-amber-600 dark:text-amber-400 font-medium"
                      >
                        {marginOptions.map(p => <option key={p} value={p}>{p}%</option>)}
                      </select>
                    </div>
                    <div className="flex items-center justify-between pt-1 border-t border-border/40">
                      <span className="text-[10px] font-semibold text-foreground">Prix final (TTC)</span>
                      <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">{fmt(item.finalPrice)} Dh</span>
                    </div>
                  </div>

                  <div className="border-t border-border/40 px-2.5 py-1.5">
                    <button
                      onClick={() => handleCopyItem(item)}
                      className="w-full flex items-center justify-center gap-1.5 text-[10px] text-primary hover:text-primary/80 font-medium transition-colors"
                    >
                      <Copy className="h-3 w-3" />
                      Copier
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer actions */}
        {cart.totalItems > 0 && (
          <div className="border-t border-border/60 p-3 space-y-2 shrink-0 bg-background/50">
            <button
              onClick={handleCreateQuote}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg text-sm font-medium transition-all hover:scale-[1.01] active:scale-[0.99]"
              style={{ boxShadow: 'var(--shadow-glow)' }}
            >
              <FileText className="h-3.5 w-3.5" />
              <span>Créer le devis</span>
              <ChevronRight className="h-3.5 w-3.5 ml-auto" />
            </button>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={handleCopyAll}
                className="flex items-center justify-center gap-1.5 px-2 py-1.5 border border-border rounded-lg text-xs font-medium text-foreground hover:bg-accent transition-colors"
              >
                <Copy className="h-3.5 w-3.5" />
                Copier tout
              </button>
              <button
                onClick={handleEmptyCart}
                className="flex items-center justify-center gap-1.5 px-2 py-1.5 border border-destructive/30 rounded-lg text-xs font-medium text-destructive hover:bg-destructive/8 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Vider
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
