/**
 * Module-level singleton that tracks the current user's company context.
 * Set on login, cleared on logout. Used by service classes to scope queries.
 */
import type { AppUserRole } from '../types';

let _currentCompanyId: string | null = null;
let _role: AppUserRole | null = null;
let _crossBranchRead = false;

export function setCompanyContext(companyId: string | null, role: AppUserRole | null, crossBranchRead = false): void {
  _currentCompanyId = companyId;
  _role = role;
  _crossBranchRead = crossBranchRead;
}

export function getCompanyContext(): {
  companyId: string | null;
  isSuperAdmin: boolean;
  isCompta: boolean;
  bypassFilter: boolean;
} {
  const isSuperAdmin = _role === 'super_admin';
  const isCompta = _role === 'compta';
  // Only super_admin and manager-with-cross_branch_read bypass company scoping.
  // compta is scoped to own company (was a bug: previously compta bypassed).
  const bypassFilter = _role === 'super_admin' || (_role === 'manager' && _crossBranchRead);
  return { companyId: _currentCompanyId, isSuperAdmin, isCompta, bypassFilter };
}
