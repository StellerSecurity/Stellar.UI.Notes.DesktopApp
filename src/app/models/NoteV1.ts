export interface NoteV1 {
  id: string;
  title?: string;
  text: string;
  protected?: boolean;
  favorite?: boolean;
  pinned?: boolean;
  folder?: string | null;
  folder_id?: string | null;
  last_modified?: number;
  deleted_at?: number;
  auto_wipe?: boolean;
  deleted?: boolean;
}
