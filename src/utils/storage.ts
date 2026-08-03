import { UserRole, Meta } from '../types';

const STORAGE_KEYS = {
  ADMIN_PIN: 'inventory_admin_pin',
  VERSION: 'inventory_version',
  ROLE: 'inventory_role',
  HAS_NEW_DATA: 'inventory_has_new_data',
  LAST_SYNC_TIME: 'inventory_last_sync_time'
};

export class StorageManager {
  /**
   * No-op, kept so existing callers (sync) don't break.
   *
   * This used to write the admin PIN into localStorage in plain text, where
   * any script or anyone at the machine could read it — and the login flow
   * trusted it, so writing this key from devtools granted admin access.
   * Authentication is now server-side only; nothing may cache a PIN.
   */
  static setAdminPin(_pin: string): void {
    // Remove any PIN cached by an older build still sitting in this browser.
    try { localStorage.removeItem(STORAGE_KEYS.ADMIN_PIN); } catch { /* */ }
  }

  static getAdminPin(): null {
    return null;
  }

  static setVersion(version: string): void {
    localStorage.setItem(STORAGE_KEYS.VERSION, version);
  }

  static getVersion(): string | null {
    return localStorage.getItem(STORAGE_KEYS.VERSION);
  }

  static setRole(role: UserRole): void {
    localStorage.setItem(STORAGE_KEYS.ROLE, role);
  }

  static getRole(): UserRole {
    return (localStorage.getItem(STORAGE_KEYS.ROLE) as UserRole) || 'sales';
  }

  static setHasNewData(hasNewData: boolean): void {
    localStorage.setItem(STORAGE_KEYS.HAS_NEW_DATA, hasNewData.toString());
  }

  static getHasNewData(): boolean {
    return localStorage.getItem(STORAGE_KEYS.HAS_NEW_DATA) === 'true';
  }

  static setLastSyncTime(time: Date): void {
    localStorage.setItem(STORAGE_KEYS.LAST_SYNC_TIME, time.toISOString());
  }

  static getLastSyncTime(): Date | null {
    const timeStr = localStorage.getItem(STORAGE_KEYS.LAST_SYNC_TIME);
    return timeStr ? new Date(timeStr) : null;
  }

  static broadcastNewData(): void {
    localStorage.setItem('inventory_new_data_event', Date.now().toString());
  }

  static listenForNewData(callback: () => void): () => void {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'inventory_new_data_event') {
        callback();
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }

  // Clear all app data (for debugging/reset)
  static clearAllData(): void {
    Object.values(STORAGE_KEYS).forEach(key => {
      localStorage.removeItem(key);
    });
    localStorage.removeItem('inventory_new_data_event');
  }

  // Get all storage info for debugging
  static getStorageInfo() {
    return {
      version: this.getVersion(),
      role: this.getRole(),
      hasNewData: this.getHasNewData(),
      lastSyncTime: this.getLastSyncTime()
    };
  }
}