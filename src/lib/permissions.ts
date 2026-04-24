import type { AppUser, AppUserRole } from '../types';

export const Permissions = {
  canAccessSettings: (u: AppUser) => u.new_role === 'super_admin',

  canManageUsers: (u: AppUser) =>
    u.new_role === 'super_admin' || u.new_role === 'admin',

  canViewAllCompanies: (u: AppUser) =>
    u.new_role === 'super_admin' ||
    (u.new_role === 'manager' && u.cross_branch_read === true),

  canAccessCompta: (u: AppUser) =>
    u.new_role === 'super_admin' || u.new_role === 'compta',

  canCreateQuote: (u: AppUser) =>
    u.new_role !== 'super_admin' &&
    u.new_role !== 'compta' &&
    u.can_create_quote !== false,

  canEditQuote: (u: AppUser, quoteCompanyId: string | null | undefined, quoteCreatedBy: string | null | undefined) => {
    if (u.new_role === 'super_admin' || u.new_role === 'admin') return true;
    if (u.company_id !== quoteCompanyId) return false;
    if (u.new_role === 'manager' || u.new_role === 'senior_sales') return true;
    if (u.new_role === 'junior_sales') return quoteCreatedBy === u.username;
    return false;
  },
};

export function deriveRoleFlags(newRole: AppUserRole | null | undefined) {
  const role = newRole ?? null;
  return {
    isSuperAdmin:  role === 'super_admin',
    isAdmin:       role === 'super_admin' || role === 'admin',
    isCompta:      role === 'compta',
    isManager:     role === 'manager',
    isSeniorSales: role === 'senior_sales',
    isJuniorSales: role === 'junior_sales',
  };
}
