import { UserRole, Meta } from '../types';

const STORAGE_KEYS = {
  ADMIN_PIN: 'inventory_admin_pin',
  VERSION: 'inventory_version',
  ROLE: 'inventory_role',
  HAS_NEW_DATA: 'inventory_has_new_data',
  LAST_SYNC_TIME: 'inventory_last_sync_time'
};

export class StorageManager {
  static setAdminPin(pin: string): void {
    localStorage.setItem(STORAGE_KEYS.ADMIN_PIN, pin);
  }

  static getAdminPin(): string | null {
    return localStorage.getItem(STORAGE_KEYS.ADMIN_PIN);
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
      adminPin: this.getAdminPin(),
      version: this.getVersion(),
      role: this.getRole(),
      hasNewData: this.getHasNewData(),
      lastSyncTime: this.getLastSyncTime()
    };
  }
}