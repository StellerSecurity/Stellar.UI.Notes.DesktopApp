import { getAppLanguage } from '../i18n';
import { Folder } from '../models/Folder';
export type FolderSort = 'asc' | 'desc' | 'manual';
/** Device preference only: changing order never changes note or folder sync metadata. */
export class FolderOrder {
  mode: FolderSort = 'asc';
  private ids: string[] = [];
  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem('stellarNotesFolderOrder') || 'null');
      if (['asc','desc','manual'].includes(saved?.mode)) this.mode = saved.mode;
      if (Array.isArray(saved?.ids)) this.ids = saved.ids.filter((id: unknown) => typeof id === 'string');
    } catch { /* Use name order if the preference is unreadable. */ }
  }
  sort(folders: Folder[]): Folder[] {
    const rank = new Map(this.ids.map((id,index) => [id,index]));
    return [...folders].sort((a,b) => {
      const name = a.name.localeCompare(b.name,getAppLanguage(),{numeric:true,sensitivity:'base'});
      return this.mode === 'manual' ? (rank.get(a.id || '') ?? Infinity) - (rank.get(b.id || '') ?? Infinity) || name : this.mode === 'desc' ? -name : name;
    });
  }
  select(mode: FolderSort, folders: Folder[]): Folder[] {
    if (mode === 'manual' && !this.ids.length) this.ids = folders.map(f=>f.id).filter((id): id is string => typeof id === 'string');
    this.mode = mode; this.save(); return this.sort(folders);
  }
  move(folders: Folder[], sourceId: string, targetId: string, after: boolean): Folder[] {
    if (sourceId === targetId || !folders.some(f=>f.id===sourceId) || !folders.some(f=>f.id===targetId)) return folders;
    const source = folders.find(f=>f.id===sourceId)!;
    const next = folders.filter(f=>f.id!==sourceId);
    next.splice(next.findIndex(f=>f.id===targetId) + Number(after),0,source);
    this.mode = 'manual'; this.ids = next.map(f=>f.id).filter((id): id is string => typeof id === 'string'); this.save(); return next;
  }
  private save(): void { try { localStorage.setItem('stellarNotesFolderOrder',JSON.stringify({mode:this.mode,ids:this.ids})); } catch { /* Keep the session preference. */ } }
}
