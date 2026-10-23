import { Component, HostBinding, HostListener, OnDestroy } from '@angular/core';
import { NotesService } from '../services/notes.service';
import { Router } from '@angular/router';
import { readNoteImageHtml } from '../add-note/rich-text-editor/note-image-drop';
import { translateText as t } from '../i18n';

@Component({ standalone: false,
  selector: 'app-initial',
  templateUrl: './initial.component.html',
  styleUrls: ['./initial.component.scss'],
})
export class InitialComponent implements OnDestroy {
  @HostBinding('class.image-drop-target') draggingImage = false;
  imageDropError = '';
  importing = false;
  private destroyed = false;
  constructor(public noteService: NotesService, private router: Router) {}
  newNote(): void { void this.router.navigate(['/note']); }
  ngOnDestroy(): void { this.destroyed = true; }

  @HostListener('dragover', ['$event'])
  onImageDragOver(event: DragEvent): void {
    if (!Array.from(event.dataTransfer?.types || []).includes('Files')) return;
    event.preventDefault();
    this.draggingImage = !this.importing && !this.noteService.shouldAskForPassword();
    if (event.dataTransfer) event.dataTransfer.dropEffect = this.draggingImage ? 'copy' : 'none';
  }
  @HostListener('dragleave', ['$event'])
  onImageDragLeave(event: DragEvent): void {
    if (!(event.relatedTarget instanceof Element) || !event.currentTarget || !(event.currentTarget as HTMLElement).contains(event.relatedTarget)) this.draggingImage = false;
  }
  @HostListener('drop', ['$event'])
  async onImageDrop(event: DragEvent): Promise<void> {
    if (!Array.from(event.dataTransfer?.types || []).includes('Files')) return;
    event.preventDefault(); event.stopPropagation(); this.draggingImage = false;
    const files = Array.from(event.dataTransfer?.files || []);
    if (this.importing || !files.length || this.noteService.shouldAskForPassword()) return;
    this.importing = true; this.imageDropError = '';
    let draft: {html:string} | null = null;
    try {
      const html = await readNoteImageHtml(files);
      if (this.destroyed || this.noteService.shouldAskForPassword()) return;
      draft = {html}; this.noteService.pendingImageNote = draft;
      if (!await this.router.navigate(['/note'])) throw new Error(t('uiTheImageCouldNotBeReadPleaseTry'));
    } catch (error) {
      if (draft && this.noteService.pendingImageNote === draft) this.noteService.pendingImageNote = null;
      if (!this.destroyed) this.imageDropError = error instanceof Error ? error.message : t('uiTheImageCouldNotBeReadPleaseTry');
    } finally { this.importing = false; }
  }
}
