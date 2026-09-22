import {
  Component, EventEmitter, Input, Output, ViewChild, ElementRef,
  ChangeDetectorRef, Renderer2, SecurityContext, OnChanges, OnDestroy, SimpleChanges,
} from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { AlertController } from '@ionic/angular';
import { bindSafeNotePaste } from './safe-note-paste';
import { preserveNoteLineBreaks } from './preserve-note-line-breaks';
import { bindEditorScroll } from './editor-scroll';

@Component({
  selector: 'app-rich-text-editor',
  templateUrl: './rich-text-editor.component.html',
  styleUrls: ['./rich-text-editor.component.scss'],
})
export class RichTextEditorComponent implements OnChanges, OnDestroy {
  @ViewChild('editorWrapper') editorWrapper!: ElementRef<HTMLElement>;
  @ViewChild('toolbar') toolbar!: ElementRef<HTMLElement>;
  @Input() note_text = '';
  @Input() noteId: string | null = null;
  @Output() noteChange = new EventEmitter<string>();
  @Output() editorFocusChange = new EventEmitter<boolean>();

  quill: any;
  private active = true;
  private destroyed = false;
  private generation = 0;
  private linkPromptOpen = false;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private unlisten: Array<() => void> = [];
  private sanitizedContent?: string;
  private publishedContent?: string;
  private editorHtml?: string;
  private editorSafeHtml?: string;

  readonly editorValueSetter = (quill: any, value: string) => {
    const safe = this.safeHtml(value);
    // Angular encodes e.g. æøå as HTML entities. Its parent echo is still the same
    // edit. Do not re-import the entire document or replace the user's caret node.
    if (safe === this.editorSafeHtml && quill.root.innerHTML === this.editorHtml) return quill.getContents();
    return quill.clipboard.convert(safe);
  };

  // Same importer and undo policy as mobile. HTML remains the wire format.
  readonly quillModules = {
    clipboard: { matchVisual: false, matchers: [[1, preserveNoteLineBreaks]] },
    history: { delay: 0, maxStack: 300, userOnly: true },
  };

  constructor(
    private renderer: Renderer2,
    private cdr: ChangeDetectorRef,
    private alertCtrl: AlertController,
    private sanitizer: DomSanitizer,
  ) {}

  private schedule(action: () => void, delay: number): void {
    const generation = this.generation;
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (!this.destroyed && this.active && generation === this.generation) action();
    }, delay);
    this.timers.add(timer);
  }

  private safeHtml(content: string): string {
    const html = content ?? '';
    if (html === this.sanitizedContent) return html;
    const safe = this.sanitizer.sanitize(SecurityContext.HTML, html) ?? '';
    this.sanitizedContent = safe;
    return safe;
  }

  ngOnChanges(changes?: SimpleChanges): void {
    if (changes?.['noteId']) {
      this.generation++;
      this.quill?.history.clear();
    }
    this.note_text = this.safeHtml(this.note_text);
    this.publishedContent = this.note_text;
  }

  onEditorCreated(quill: any): void {
    this.unlisten.forEach(remove => remove());
    this.quill = quill;
    const root: HTMLElement = quill.root;
    this.editorHtml = root.innerHTML;
    this.editorSafeHtml = this.safeHtml(this.note_text);
    quill.getModule('toolbar').addHandler('link', () => { void this.openLinkPrompt(); });
    root.setAttribute('spellcheck', 'false');
    this.unlisten = [
      bindSafeNotePaste(quill, this.sanitizer),
      bindEditorScroll(quill, root, this.toolbar.nativeElement),
      this.renderer.listen(root, 'click', (event: MouseEvent) => this.openEditorLink(event)),
      this.renderer.listen(root, 'copy', (event: ClipboardEvent) => {
        const range = quill.getSelection();
        if (!event.clipboardData || !range?.length) return;
        if (quill.getContents(range.index, range.length).ops?.some((op: any) => typeof op.insert !== 'string')) return;
        event.preventDefault();
        event.clipboardData.setData('text/plain', quill.getText(range.index, range.length));
      }),
    ];
    this.schedule(() => this.focusEmptyEditor(), 300);
  }

  public onEnter(): void {
    this.active = true;
    this.schedule(() => this.focusEmptyEditor(), 300);
  }

  public onLeave(): void {
    this.active = false;
    this.generation++;
    this.timers.forEach(timer => clearTimeout(timer));
    this.timers.clear();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.onLeave();
    this.unlisten.forEach(remove => remove());
    this.unlisten = [];
  }

  public focusEmptyEditor(): void {
    if (!this.active || this.destroyed || !this.quill || this.quill.getLength() !== 1) return;
    const root: HTMLElement = this.quill.root;
    if (document.activeElement !== document.body && document.activeElement !== root) return;
    root.focus({ preventScroll: true });
    this.quill.setSelection(0, 0, 'silent');
  }

  public isEditorFocused(): boolean {
    return this.linkPromptOpen || !!this.editorWrapper?.nativeElement.contains(document.activeElement);
  }

  public onEditorFocusIn(): void { this.editorFocusChange.emit(true); }

  public onEditorFocusOut(): void {
    this.schedule(() => this.editorFocusChange.emit(this.isEditorFocused()), 0);
  }

  public setExternalContent(content: string): void {
    const safe = this.safeHtml(content);
    if (safe === this.note_text) return;
    this.note_text = safe;
    this.publishedContent = safe;
    if (this.quill) {
      const scrollTop = this.quill.root.scrollTop;
      // Update Quill's model, never only root.innerHTML. Remote changes are not user edits.
      this.quill.setContents(this.quill.clipboard.convert(safe), 'silent');
      this.quill.history.clear();
      this.quill.root.scrollTop = scrollTop;
      this.editorHtml = this.quill.root.innerHTML;
      this.editorSafeHtml = safe;
    }
    this.cdr.detectChanges();
  }

  onContentChange(content: string): void {
    const safe = this.safeHtml(content);
    if (this.quill?.root.innerHTML === content) {
      this.editorHtml = content;
      this.editorSafeHtml = safe;
    }
    this.note_text = safe;
    if (safe === this.publishedContent) return;
    this.publishedContent = safe;
    this.noteChange.emit(safe);
  }

  public undo(): void { this.quill?.history.undo(); }
  public redo(): void { this.quill?.history.redo(); }

  private async openLinkPrompt(): Promise<void> {
    if (!this.active || this.linkPromptOpen) return;
    const quill = this.quill;
    const selection = quill?.getSelection();
    if (!selection) return;
    const range = { ...selection };
    const generation = this.generation;
    this.linkPromptOpen = true;
    try {
      const alert = await this.alertCtrl.create({
        header: 'Insert Link',
        inputs: [{ name: 'url', type: 'url', placeholder: 'https://example.com' }],
        buttons: [
          { text: 'Cancel', role: 'cancel' },
          { text: 'Insert', handler: data => {
            if (!this.active || this.destroyed || generation !== this.generation) return true;
            const value = String(data?.url ?? '').trim();
            if (!value) return false;
            const url = /^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`;
            if (!/^(https?:\/\/|mailto:|tel:)/i.test(url)) return false;
            if (range.length) quill.formatText(range.index, range.length, 'link', url, 'user');
            else quill.insertText(range.index, url, 'link', url, 'user');
            return true;
          } },
        ],
      });
      if (!this.active || this.destroyed || generation !== this.generation) return;
      await alert.present();
      await alert.onDidDismiss();
    } finally {
      this.linkPromptOpen = false;
      if (!this.destroyed && this.active) this.editorFocusChange.emit(this.isEditorFocused());
    }
  }

  private openEditorLink(event: MouseEvent): void {
    const target = event.target instanceof Element ? event.target.closest('a') : null;
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    const href = target.getAttribute('href') ?? '';
    if (!/^(https?:\/\/|mailto:|tel:)/i.test(href)) return;
    if ((window as any).electronAPI?.openExternal) (window as any).electronAPI.openExternal(href);
    else window.open(href, '_blank', 'noopener,noreferrer');
  }
}
