/**
 * Module-level singleton that tracks the current user's company context.
 * Set on login, cleared on logout. Used by service classes to scope queries.
 */

let _currentCompanyId: string | null = null;
let _isSuperAdmin = false;
let _isCompta = false;

export function setCompanyContext(companyId: string | null, isSuperAdmin: boolean, isCompta = false): void {
  _currentCompanyId = companyId;
  _isSuperAdmin = isSuperAdmin;
  _isCompta = isCompta;
}

export function getCompanyContext(): { companyId: string | null; isSuperAdmin: boolean; isCompta: boolean; bypassFilter: boolean } {
  return {
    companyId: _currentCompanyId,
    isSuperAdmin: _isSuperAdmin,
    isCompta: _isCompta,
    bypassFilter: _isSuperAdmin || _isCompta,
  };
}
