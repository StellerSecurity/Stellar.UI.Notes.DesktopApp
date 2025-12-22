export interface NoteV1 {
  id: string;
  title?: string;
  text: string;
  protected?: boolean;
  last_modified?: number;
  deleted_at?: number;
  auto_wipe?: boolean;
  deleted?: boolean;
}
