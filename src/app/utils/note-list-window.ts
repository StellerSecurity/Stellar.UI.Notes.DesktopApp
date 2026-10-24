/** Keep list DOM proportional to the viewport, while preserving full-list selection. */
export interface NoteListRow { key: string; note?: any; pinned?: boolean; month?: number | string; index: number; offset: number; height: number; }
export class NoteListWindow {
  private source?: any[];
  private folders = false;
  private rows: NoteListRow[] = [];
  private positions = new Map<string, NoteListRow>();
  private start = -1;
  private end = -1;
  visible: NoteListRow[] = [];
  top = 0;
  bottom = 0;
  height = 0;
  update(notes: any[], showFolders: boolean, scrollTop: number, viewportHeight: number): void {
    if (notes !== this.source || showFolders !== this.folders) {
      this.source = notes; this.folders = showFolders; this.rows = []; this.positions.clear(); this.height = 0;
      let previousMonth = '';
      notes.forEach((note, index) => {
        if (index === 0 && note.pinned) {
          this.rows.push({key:'group:pinned', pinned:true, index, offset:this.height, height:32}); this.height += 32;
        } else if (!note.pinned) {
          const date = new Date(note.last_modified);
          const valid = Number.isFinite(date.getTime());
          const month = valid ? `${date.getFullYear()}-${date.getMonth()}` : 'unknown';
          if (month !== previousMonth) {
            this.rows.push({key:`month:${month}`, month:valid ? note.last_modified : undefined, index, offset:this.height, height:32}); this.height += 32;
            previousMonth = month;
          }
        }
        const row = {key:`note:${note.id}`, note, index, offset:this.height, height:62};
        this.rows.push(row); this.positions.set(note.id,row); this.height += row.height;
      });
      this.start = this.end = -1;
    }
    scrollTop = Math.min(scrollTop,Math.max(0,this.height - viewportHeight));
    const lower = Math.max(0,scrollTop - 300), upper = scrollTop + Math.max(1,viewportHeight) + 300;
    let lo = 0, hi = this.rows.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1, row = this.rows[mid]; if (row.offset + row.height <= lower) lo = mid + 1; else hi = mid; }
    const start = lo;
    while (lo < this.rows.length && this.rows[lo].offset < upper) lo++;
    if (start !== this.start || lo !== this.end) { this.start = start; this.end = lo; this.visible = this.rows.slice(start,lo); }
    this.top = this.rows[start]?.offset ?? this.height;
    const last = this.visible[this.visible.length - 1];
    this.bottom = this.height - (last ? last.offset + last.height : this.top);
  }
  position(id: string): NoteListRow | undefined { return this.positions.get(id); }
}
