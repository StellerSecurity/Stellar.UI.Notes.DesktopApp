import { Injectable } from '@angular/core';
import {Router} from "@angular/router";
import {SecureStorageService} from "./secure-storage.service";
import { Preferences } from '@capacitor/preferences';
import { Storage } from '@ionic/storage-angular';
import { Filesystem, Directory } from '@capacitor/filesystem';

@Injectable({
  providedIn: 'root'
})
export class DataService {

    constructor(private secureStorageService: SecureStorageService, private storage: Storage) { }

    private forceDownloadOnHome = false;

    public setForceDownloadOnHome(forceDownloadOnHome: boolean) {
        this.forceDownloadOnHome = forceDownloadOnHome;
    }

    public getForceDownloadOnHome() {
        return this.forceDownloadOnHome;
    }

    public async clearAppData() {
      console.log('Starting nuclear reset…');

      await this.secureStorageService.clear();
      localStorage.clear();
      await Preferences.clear();

      // IndexedDB wipe (no try/catch suppression)
      await new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase('__stellar_notes');
        req.onsuccess = () => resolve();
        req.onblocked = () => resolve();
        req.onerror = () => resolve();
      });

      // Delete all cache + data files
      const wipeDir = async (dir: Directory) => {
        try {
          const list: any = await Filesystem.readdir({ directory: dir, path: '' });
          const files = list.files ?? list;
          for (const e of files) {
            const name = typeof e === 'string' ? e : e.name;
            await Filesystem.deleteFile({ directory: dir, path: name }).catch(() =>
              Filesystem.rmdir({ directory: dir, path: name, recursive: true }).catch(() => {})
            );
          }
        } catch {}
      };

      await wipeDir(Directory.Cache);
      await wipeDir(Directory.Data);

      console.log('Nuke complete.');
    }

}
