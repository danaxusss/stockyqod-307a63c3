import { describe, expect, it } from 'vitest';
import { computeAccess, buildModules, moduleForPath, activeItem, type AccessFlags } from '../lib/navigation';

const none: AccessFlags = {
  canCreateQuote: false, isAdmin: false, isSuperAdmin: false, isFacturation: false, isCompta: false, isManager: false,
  isSeniorSales: false, isJuniorSales: false, isPaie: false, isStock: false, isTasks: false, isTasksOnly: false, tasksRole: null,
};
const menu = (flags: Partial<AccessFlags>) => buildModules(computeAccess({ ...none, ...flags }));
const ids = (flags: Partial<AccessFlags>) => menu(flags).map(m => m.id);
const links = (flags: Partial<AccessFlags>) => menu(flags).flatMap(m => m.items.map(i => i.to));

describe('menu by role', () => {
  it('gives a junior salesperson the sales module only, with their own quotes', () => {
    expect(ids({ canCreateQuote: true, isJuniorSales: true })).toEqual(['ventes']);
    expect(links({ canCreateQuote: true, isJuniorSales: true })).toContain('/quote-cart');
    expect(computeAccess({ ...none, canCreateQuote: true, isJuniorSales: true }).ownQuotesOnly).toBe(true);
    expect(computeAccess({ ...none, canCreateQuote: true, isManager: true }).ownQuotesOnly).toBe(false);
  });

  it('hides quote pages from users who may not create quotes', () => {
    expect(links({})).not.toContain('/quote-cart');
    expect(links({})).not.toContain('/kiosk-admin');
  });

  it('shows accounting to accountants and admins, not to billing staff', () => {
    expect(ids({ isFacturation: true })).toEqual(['ventes', 'documents']);
    expect(ids({ isCompta: true, isPaie: true })).toEqual(['ventes', 'comptabilite', 'paie']);
    expect(ids({ isAdmin: true, isStock: true, isPaie: true })).toEqual(['ventes', 'stock', 'comptabilite', 'paie', 'marketing', 'admin']);
  });

  it('lists the stock module for managers', () => {
    expect(ids({ isManager: true, isStock: true })).toContain('stock');
    expect(links({ isManager: true, isStock: true })).toContain('/inventaire/niveaux');
  });

  it('gives field staff their own tasks and nothing else', () => {
    const flags = { isTasks: true, isTasksOnly: true, tasksRole: 'technician' };
    expect(ids(flags)).toEqual(['taches']);
    expect(links(flags)).toEqual(['/tasks/mine', '/tasks/archive', '/tasks/contacts']);
    expect(computeAccess({ ...none, ...flags }).ownTasksOnly).toBe(true);
  });

  it('gives the super admin every module and the system tools', () => {
    const flags = { isSuperAdmin: true, isAdmin: true, isStock: true, isPaie: true, isTasks: true, tasksRole: 'super_admin' };
    expect(ids(flags)).toEqual(['ventes', 'documents', 'stock', 'comptabilite', 'paie', 'taches', 'marketing', 'admin']);
    expect(links(flags)).toEqual(expect.arrayContaining(['/admin/tools', '/admin/users', '/tasks/dashboard']));
  });
});

describe('current page in the menu', () => {
  const modules = menu({ isSuperAdmin: true, isAdmin: true, isStock: true, canCreateQuote: true });

  it('opens the module of the page and highlights its link', () => {
    expect(moduleForPath(modules, '/inventaire/niveaux')?.id).toBe('stock');
    expect(activeItem(moduleForPath(modules, '/inventaire/niveaux'), '/inventaire/niveaux')).toBe('/inventaire/niveaux');
    expect(moduleForPath(modules, '/product/611000000001')?.id).toBe('ventes');
    expect(moduleForPath(modules, '/compta/invoices/abc')?.id).toBe('documents');
    expect(activeItem(moduleForPath(modules, '/compta/invoices/abc'), '/compta/invoices/abc')).toBe('/compta/invoices');
  });

  it('highlights the quotes list, not "Nouveau devis", for an existing quote', () => {
    expect(activeItem(moduleForPath(modules, '/quote-cart/q1'), '/quote-cart/q1')).toBe('/quotes-history');
    expect(activeItem(moduleForPath(modules, '/quote-cart'), '/quote-cart')).toBe('/quote-cart');
  });
});
