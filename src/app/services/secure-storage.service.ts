// secure-storage.service.ts
import { Injectable } from '@angular/core';
import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin';

@Injectable({
  providedIn: 'root'
})
export class SecureStorageService {
      constructor() {}

      async setItem(key: string, value: string): Promise<void> {
        await SecureStoragePlugin.set({ key, value });
      }

    async getItem(key: string): Promise<string | null> {
    try {
        const result = await SecureStoragePlugin.get({ key });
        // On some platforms result can be undefined if not found; normalize to null.
        return (result && typeof result.value === 'string') ? result.value : null;
    } catch (err: any) {
        // Capacitor Secure Storage typically throws on missing key
        const msg = String(err?.message || err);
        if (msg.includes('Item with given key does not exist') || msg.includes('not found')) {
            return null;
        }
        // For any other error, rethrow (or return null if you prefer)
        throw err;
        }
    }

      async removeItem(key: string): Promise<void> {
        await SecureStoragePlugin.remove({ key });
      }

      async clear(): Promise<void> {
        await SecureStoragePlugin.clear();
      }

      async keys(): Promise<string[]> {
        const result:any = await SecureStoragePlugin.keys();
        return result?.keys || [];
      }
}
