/**
 * "Users see only the documents they created" (companies.restrict_docs_to_creator).
 *
 * The database enforces it (migration 20261119130000_role_company_rules.sql,
 * stocky_own_documents_only); this mirrors that rule so the settings screen
 * can say who it affects. Keep both in step.
 */

/** Roles that keep every document of their company: they supervise, bill or keep the books. */
export const DOCUMENT_SUPERVISOR_ROLES = ['super_admin', 'admin', 'manager', 'facturation', 'compta'] as const;

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super admin',
  admin: 'Administrateur',
  manager: 'Manager',
  facturation: 'Facturation',
  compta: 'Comptabilité',
  senior_sales: 'Commercial senior',
  junior_sales: 'Commercial junior',
};

export const supervisorRoleLabels = (): string[] => DOCUMENT_SUPERVISOR_ROLES.map(role => ROLE_LABELS[role]);

/**
 * True when this user sees only the documents they created or that name them
 * as seller. Resellers always do; others when their company turned the
 * setting on and their role is not a supervising one. A user without a role
 * counts as a salesperson, as in the database.
 */
export function seesOnlyOwnDocuments(user: { role?: string | null; isReseller?: boolean }, companyRestricts: boolean): boolean {
  const role = user.role || 'senior_sales';
  const supervisor = (DOCUMENT_SUPERVISOR_ROLES as readonly string[]).includes(role);
  if (user.isReseller && role !== 'super_admin' && role !== 'admin') return true;
  return companyRestricts && !supervisor;
}
