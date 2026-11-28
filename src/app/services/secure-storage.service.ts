// secure-storage.service.ts
import { Injectable } from '@angular/core';
import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin';

@Injectable({
  providedIn: 'root'
})
export class SecureStorageService {
      constructor() {}

      async setItem(key: string, value: string): Promise<void> {
        if (key === 'ssIdentitySession') {
          const session = JSON.parse(value);
          if (session.refreshToken) {
            const bridge = (window as any).electronAPI;
            if (!bridge?.protectSessionCredential) throw new Error('identitySecureStorageUnavailable');
            session.refreshToken = 'os:v1:' + await bridge.protectSessionCredential(session.refreshToken);
            value = JSON.stringify(session);
          }
        }
        await SecureStoragePlugin.set({ key, value });
      }

    async getItem(key: string): Promise<string | null> {
    try {
        const result = await SecureStoragePlugin.get({ key });
        // On some platforms result can be undefined if not found; normalize to null.
        let value = (result && typeof result.value === 'string') ? result.value : null;
        if (key === 'ssIdentitySession' && value) {
          const session = JSON.parse(value);
          if (typeof session.refreshToken === 'string' && session.refreshToken.startsWith('os:v1:')) {
            const bridge = (window as any).electronAPI;
            if (!bridge?.openSessionCredential) throw new Error('identitySecureStorageUnavailable');
            session.refreshToken = await bridge.openSessionCredential(session.refreshToken.slice(6));
            value = JSON.stringify(session);
          }
        }
        return value;
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
        try {
          await SecureStoragePlugin.remove({ key });
        } catch (error: any) {
          const message = String(error?.message || error);
          if (message.includes('Item with given key does not exist') || message.includes('not found')) return;
          throw error;
        }
      }

      async clear(): Promise<void> {
        await SecureStoragePlugin.clear();
      }

      async keys(): Promise<string[]> {
        const result:any = await SecureStoragePlugin.keys();
        return result?.keys || [];
      }
}
