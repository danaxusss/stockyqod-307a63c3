import { useMemo } from 'react';
import { useAuth } from './useAuth';
import { computeAccess, buildModules, type Access, type NavModule } from '../lib/navigation';
import { seesPurchaseCosts } from '../utils/productCosts';

/** What the signed-in user may open, and the menu built from it. */
export function useAccess(): { access: Access; modules: NavModule[] } {
  const auth = useAuth();
  const canCreateQuote = auth.canCreateQuote();
  // Optional call: some tests mock useAuth without it.
  const seesCosts = seesPurchaseCosts({ priceDisplayType: auth.getPriceDisplayType?.(), isAdmin: auth.isAdmin, isSuperAdmin: auth.isSuperAdmin });
  const access = useMemo(() => computeAccess({
    canCreateQuote,
    isAdmin: auth.isAdmin,
    isSuperAdmin: auth.isSuperAdmin,
    isFacturation: auth.isFacturation,
    isCompta: auth.isCompta,
    isManager: auth.isManager,
    isSeniorSales: auth.isSeniorSales,
    isJuniorSales: auth.isJuniorSales,
    isPaie: auth.isPaie,
    isStock: auth.isStock,
    isTasks: auth.isTasks,
    isTasksOnly: auth.isTasksOnly,
    tasksRole: auth.tasksRole ?? null,
    seesCosts,
  }), [canCreateQuote, seesCosts, auth.isAdmin, auth.isSuperAdmin, auth.isFacturation, auth.isCompta, auth.isManager,
    auth.isSeniorSales, auth.isJuniorSales, auth.isPaie, auth.isStock, auth.isTasks, auth.isTasksOnly, auth.tasksRole]);
  const modules = useMemo(() => buildModules(access), [access]);
  return { access, modules };
}
