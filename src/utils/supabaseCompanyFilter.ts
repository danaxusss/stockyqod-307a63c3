/**
 * Module-level singleton that tracks the current user's company context.
 * Set on login, cleared on logout. Used by service classes to scope queries.
 */

let _currentCompanyId: string | null = null;
let _isSuperAdmin = false;

export function setCompanyContext(companyId: string | null, isSuperAdmin: boolean): void {
  _currentCompanyId = companyId;
  _isSuperAdmin = isSuperAdmin;
}

export function getCompanyContext(): { companyId: string | null; isSuperAdmin: boolean } {
  return { companyId: _currentCompanyId, isSuperAdmin: _isSuperAdmin };
}
