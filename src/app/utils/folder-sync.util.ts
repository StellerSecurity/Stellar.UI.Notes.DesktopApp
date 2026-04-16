import { Folder } from '../models/Folder';
import { NoteV1 } from '../models/NoteV1';

export const FOLDER_MANIFEST_NOTE_ID = '__stellar_folder_manifest_v1__';
const FOLDER_MANIFEST_NOTE_TITLE = '__stellar_folder_manifest__';

function normalizeFolder(folder: any): Folder | null {
  const name = String(folder?.name ?? '').trim();
  if (!name) return null;
  return {
    id: typeof folder?.id === 'string' && folder.id.trim().length > 0 ? folder.id.trim() : null as any,
    name,
    last_modified: Number(folder?.last_modified ?? Date.now()),
    deleted: !!folder?.deleted,
  };
}

export function normalizeFolders(folders: any[]): Folder[] {
  if (!Array.isArray(folders)) return [];
  return folders.map(normalizeFolder).filter((folder): folder is Folder => !!folder);
}

export function mergeFoldersByName(...folderSets: any[][]): Folder[] {
  const map = new Map<string, Folder>();

  for (const set of folderSets) {
    for (const rawFolder of normalizeFolders(set)) {
      const key = rawFolder.name.toLowerCase();
      const current = map.get(key);
      if (!current || Number(rawFolder.last_modified ?? 0) >= Number(current.last_modified ?? 0)) {
        map.set(key, {
          id: rawFolder.id ?? current?.id ?? null as any,
          name: rawFolder.name,
          last_modified: Number(rawFolder.last_modified ?? Date.now()),
          deleted: !!rawFolder.deleted,
        });
      }
    }
  }

  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function isFolderManifestNote(note: any): boolean {
  return String(note?.id ?? '') === FOLDER_MANIFEST_NOTE_ID
    || String(note?.title ?? '') === FOLDER_MANIFEST_NOTE_TITLE;
}

export function buildFolderManifestNote(folders: Folder[]): NoteV1 {
  const normalized = normalizeFolders(folders);
  const lastModified = normalized.reduce((max, folder) => Math.max(max, Number(folder.last_modified ?? 0)), Date.now());

  return {
    id: FOLDER_MANIFEST_NOTE_ID,
    title: FOLDER_MANIFEST_NOTE_TITLE,
    text: JSON.stringify(normalized),
    favorite: false,
    pinned: false,
    folder: '',
    folder_id: null,
    protected: false,
    auto_wipe: false,
    deleted: false,
    last_modified: lastModified,
  };
}

export function extractFolderManifest(notes: any[]): { notes: NoteV1[]; folders: Folder[] } {
  const visibleNotes: NoteV1[] = [];
  let manifestFolders: Folder[] = [];
  let manifestLastModified = -1;

  for (const note of Array.isArray(notes) ? notes : []) {
    if (!isFolderManifestNote(note)) {
      visibleNotes.push(note);
      continue;
    }

    const candidateLastModified = Number(note?.last_modified ?? 0);
    if (candidateLastModified < manifestLastModified) {
      continue;
    }

    try {
      const parsed = JSON.parse(String(note?.text ?? '[]'));
      manifestFolders = normalizeFolders(parsed);
      manifestLastModified = candidateLastModified;
    } catch {
      // Ignore malformed manifest payloads.
    }
  }

  return { notes: visibleNotes, folders: manifestFolders };
}
