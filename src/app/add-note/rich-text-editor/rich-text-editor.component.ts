import { translateText as t, formatAppDate } from '../../i18n';
import {
  Component, EventEmitter, Input, Output, ViewChild, ElementRef,
  ChangeDetectorRef, Renderer2, SecurityContext, OnChanges, OnDestroy, SimpleChanges,
} from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { AlertController } from '@ionic/angular';
import { bindSafeNotePaste } from './safe-note-paste';
import { bindSafeNoteCopy } from './safe-note-copy';
import { preserveNoteLineBreaks, preserveNoteSpaces } from './preserve-note-line-breaks';
import { bindEditorScroll } from './editor-scroll';
import { legacyNoteHtml } from './legacy-note-html';
import { bindNoteImageDrop } from './note-image-drop';
import { CompactImageExport } from './compact-image-export';

@Component({ standalone: false,
  selector: 'app-rich-text-editor',
  templateUrl: './rich-text-editor.component.html',
  styleUrls: ['./rich-text-editor.component.scss'],
})
export class RichTextEditorComponent implements OnChanges, OnDestroy {
  @ViewChild('editorWrapper') editorWrapper!: ElementRef<HTMLElement>;
  @ViewChild('toolbar') toolbar!: ElementRef<HTMLElement>;
  @ViewChild('imagePreviewClose') imagePreviewClose?: ElementRef<HTMLButtonElement>;
  @ViewChild('previewImage') previewImage?: ElementRef<HTMLImageElement>;
  @ViewChild('previewStage') previewStage?: ElementRef<HTMLElement>;
  @ViewChild('previewSurface') set previewSurface(ref: ElementRef<HTMLElement> | undefined) {
    this.removePreviewListeners?.();
    this.removePreviewListeners = undefined;
    if (!ref) return;
    const surface = ref.nativeElement;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      this.zoomPreview(this.previewZoom * Math.exp(-event.deltaY * .01), event.clientX, event.clientY, false);
    };
    // WebKit uses gesture events for a trackpad pinch; Chromium uses ctrl+wheel.
    let gestureZoom = 1;
    const gestureStart = (event: Event) => { event.preventDefault(); gestureZoom = this.previewZoom; };
    const gestureChange = (event: Event) => {
      event.preventDefault();
      const gesture = event as Event & {scale: number; clientX: number; clientY: number};
      this.zoomPreview(gestureZoom * gesture.scale, gesture.clientX, gesture.clientY, false);
    };
    let touchPinch: {distance:number; zoom:number} | undefined;
    const touchStart = (event: TouchEvent) => {
      if (event.touches.length !== 2) return;
      event.preventDefault();
      const [a,b] = Array.from(event.touches);
      touchPinch = {distance:Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY), zoom:this.previewZoom};
      this.previewPointer = undefined; this.previewPanning = false; this.previewDragged = true;
    };
    const touchMove = (event: TouchEvent) => {
      if (!touchPinch || event.touches.length !== 2) return;
      event.preventDefault(); event.stopPropagation();
      const [a,b] = Array.from(event.touches);
      if (touchPinch.distance > 0) this.zoomPreview(touchPinch.zoom * Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY) / touchPinch.distance, (a.clientX+b.clientX)/2, (a.clientY+b.clientY)/2, false);
    };
    const touchEnd = (event: TouchEvent) => { if (touchPinch) event.preventDefault(); touchPinch = undefined; };
    surface.addEventListener('touchstart', touchStart, {passive:false});
    surface.addEventListener('touchmove', touchMove, {passive:false});
    surface.addEventListener('touchend', touchEnd, {passive:false});
    surface.addEventListener('touchcancel', touchEnd);
    surface.addEventListener('wheel', wheel, {passive: false, capture:true});
    surface.addEventListener('gesturestart', gestureStart, {passive: false});
    surface.addEventListener('gesturechange', gestureChange, {passive: false});
    const resize = new ResizeObserver(() => { this.clampPreviewPan(); this.cdr.markForCheck(); });
    resize.observe(surface);
    this.removePreviewListeners = () => {
      surface.removeEventListener('wheel', wheel, true);
      surface.removeEventListener('touchstart', touchStart);
      surface.removeEventListener('touchmove', touchMove);
      surface.removeEventListener('touchend', touchEnd);
      surface.removeEventListener('touchcancel', touchEnd);
      surface.removeEventListener('gesturestart', gestureStart);
      surface.removeEventListener('gesturechange', gestureChange);
      resize.disconnect();
    };
  }
  @Input() note_text = '';
  @Input() noteId: string | null = null;
  @Input() noteTitle = '';
  @Input() autoFocusNewNote = false;
  @Input() focusBodyRequested = false;
  @Output() bodyFocusHandled = new EventEmitter<void>();
  private didAutoFocus = false;
  @Input() modifiedAt: number | null = null;
  @Output() titleChange = new EventEmitter<string>();
  @Output() noteChange = new EventEmitter<string>();
  @Output() editorFocusChange = new EventEmitter<boolean>();

  quill: any;
  public imageDropError = '';
  public previewImageSrc: string | null = null;
  public previewImageAlt = '';
  public previewZoom = 1;
  public previewPanX = 0;
  public previewPanY = 0;
  public previewPanning = false;
  public previewAnimateZoom = false;
  private previewDragged = false;
  private previewPointer?: {id: number; x: number; y: number; panX: number; panY: number};
  private removePreviewListeners?: () => void;
  private previewSelection?: {index: number; length: number};
  private previewSourceImage?: HTMLImageElement;
  private active = true;
  private destroyed = false;
  private generation = 0;
  private linkPromptOpen = false;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private unlisten: Array<() => void> = [];
  private sanitizedContent?: string;
  private publishedContent?: string;
  private contentRevision = 0;
  private exportedRevision = -1;
  private imageExport = new CompactImageExport();
  private editorSafeHtml?: string;

  readonly editorValueSetter = (quill: any, value: string) => {
    const safe = this.safeHtml(value);
    // Angular encodes e.g. æøå as HTML entities. Its parent echo is still the same
    // edit. Do not re-import the entire document or replace the user's caret node.
    if (safe === this.editorSafeHtml && this.exportedRevision === this.contentRevision) return quill.getContents();
    return quill.clipboard.convert({ html: safe });
  };

  // Never use Quill 2's interpolated semantic exporter. Serialize the DOM,
  // restore legacy list markup, then sanitize before publishing or parent echoes.
  readonly editorValueGetter = (quill: any): string => {
    const compact = this.imageExport.prepare(quill.root);
    const html = legacyNoteHtml(compact.root);
    const safe = compact.restore(this.safeHtml(html === '<p><br></p>' ? '' : html));
    this.sanitizedContent = safe;
    this.exportedRevision = this.contentRevision;
    this.editorSafeHtml = safe;
    return safe;
  };

  // HTML remains the wire format used by existing mobile and desktop clients.
  readonly quillModules = {
    clipboard: { matchers: [[3, preserveNoteSpaces], [1, preserveNoteLineBreaks]] },
    history: { delay: 0, maxStack: 300, userOnly: true },
    // Keep typed notes literal. Quill's default "list autofill" turns "- " or "1. "
    // at the start of a line into lists; users should use the toolbar when they want a list.
    keyboard: { bindings: { 'list autofill': false } },
  };

  constructor(
    private renderer: Renderer2,
    private cdr: ChangeDetectorRef,
    private alertCtrl: AlertController,
    private sanitizer: DomSanitizer,
  ) {}

  editorPlaceholder(translation: string): string {
    return translation?.trim() && translation !== 'enterYourNoteHere'
      ? translation : t('enterYourNoteHere');
  }

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
    if (!/data-checked|stellar-task-state-/i.test(html)) {
      const safe = this.sanitizer.sanitize(SecurityContext.HTML, html) ?? '';
      this.sanitizedContent = safe;
      return safe;
    }
    // Angular removes data attributes. Carry only Quill's boolean task state
    // through its sanitizer using inert classes, then restore that one attribute.
    const input = document.createElement('template');
    input.innerHTML = html;
    const marker = 'stellar-task-state-';
    input.content.querySelectorAll('ul[data-checked]').forEach(list => {
      const state = list.getAttribute('data-checked');
      if (state === 'true' || state === 'false') list.classList.add(marker + state);
    });
    const clean = this.sanitizer.sanitize(SecurityContext.HTML, input.innerHTML) ?? '';
    const output = document.createElement('template');
    output.innerHTML = clean;
    output.content.querySelectorAll('ul').forEach(list => {
      for (const state of ['true', 'false']) {
        if (list.classList.contains(marker + state)) {
          list.setAttribute('data-checked', state);
          list.classList.remove(marker + state);
        }
      }
      if (!list.className) list.removeAttribute('class');
    });
    const safe = output.innerHTML;
    this.sanitizedContent = safe;
    return safe;
  }

  ngOnChanges(changes?: SimpleChanges): void {
    if (changes?.['noteId']) {
      this.generation++;
      this.imageDropError = '';
      this.resetImagePreview();
      this.didAutoFocus = false;
      this.quill?.history.clear();
    }
    this.note_text = this.safeHtml(this.note_text);
    this.publishedContent = this.note_text;
    if (this.focusBodyRequested) this.schedule(() => this.focusRequestedBody(),0);
  }

  onEditorCreated(quill: any): void {
    this.unlisten.forEach(remove => remove());
    this.quill = quill;
    const root: HTMLElement = quill.root;
    // Quill is still empty here. The first valueSetter must import the saved note;
    // an echo cache based on this blank DOM would suppress that initial import.
    this.contentRevision = 0;
    this.exportedRevision = -1;
    this.imageExport = new CompactImageExport();
    this.editorSafeHtml = undefined;
    const revisionChanged = (type:string) => { if (type==='text-change') this.contentRevision++; };
    quill.on('editor-change',revisionChanged);
    quill.getModule('toolbar').addHandler('link', () => { void this.openLinkPrompt(); });
    root.setAttribute('spellcheck', 'false');
    this.unlisten = [
      () => quill.off('editor-change',revisionChanged),
      bindNoteImageDrop(quill, quill.container, {
        generation: () => this.active && !this.destroyed ? this.generation : null,
        reportError: message => { this.imageDropError = message; this.cdr.markForCheck(); },
      }),
      bindSafeNotePaste(quill, this.sanitizer),
      bindSafeNoteCopy(quill, this.sanitizer),
      bindEditorScroll(quill, this.editorWrapper.nativeElement.querySelector('quill-editor') as HTMLElement, this.toolbar.nativeElement),
      this.renderer.listen(root, 'click', (event: MouseEvent) => this.openEditorLink(event)),
    ];
    this.schedule(() => { this.focusEmptyEditor(); this.focusRequestedBody(); }, 0);
  }

  public onEnter(): void {
    this.active = true;
    this.schedule(() => this.focusEmptyEditor(), 300);
  }

  public onLeave(): void {
    this.active = false;
    this.resetImagePreview();
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

  public focusRequestedBody(): void {
    if (!this.focusBodyRequested || !this.active || this.destroyed || !this.quill) return;
    const active = document.activeElement as HTMLElement | null;
    if (!active?.closest('input, textarea, ion-input, ion-modal, ion-alert')) {
      const selection = this.quill.getSelection();
      this.quill.root.focus({preventScroll:true});
      if (!selection) this.quill.setSelection(Math.max(0,this.quill.getLength() - 1),0,'silent');
    }
    this.bodyFocusHandled.emit();
  }

  public focusEmptyEditor(): void {
    if (!this.active || this.destroyed || !this.quill || this.quill.getLength() !== 1) return;
    const root: HTMLElement = this.quill.root;
    const active = document.activeElement as HTMLElement | null;
    const requested = this.autoFocusNewNote && !this.didAutoFocus;
    if (requested) {
      this.didAutoFocus = true;
      // A quick, deliberate click into the title or a dialog wins over autofocus.
      if (active?.closest('input, textarea, ion-input, ion-modal, ion-alert')) return;
    } else if (active !== document.body && active !== root) return;
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
      this.quill.setContents(this.quill.clipboard.convert({ html: safe }), 'silent');
      this.quill.history.clear();
      this.quill.root.scrollTop = scrollTop;
      this.exportedRevision = this.contentRevision;
      this.editorSafeHtml = safe;
    }
    this.cdr.detectChanges();
  }

  onContentChange(content: string): void {
    const safe = this.safeHtml(content);
    this.note_text = safe;
    if (safe === this.publishedContent) return;
    this.publishedContent = safe;
    this.noteChange.emit(safe);
  }

  public headingStyle(level = 0): string { return JSON.stringify(level ? t('headingLevel', {level}) : t('uiStandard')); }
  public modifiedDate(): string { return this.modifiedAt == null ? '' : formatAppDate(this.modifiedAt, {weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit'}); }

  public focusBody(): void { this.quill?.focus(); }

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
        header: t('uiInsertLink'),
        inputs: [{ name: 'url', type: 'url', placeholder: 'https://example.com' }],
        buttons: [
          { text: t('cancel'), role: 'cancel' },
          { text: t('uiInsert'), handler: data => {
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
    const image = event.target instanceof Element ? event.target.closest('img') : null;
    if (image && this.active && !this.destroyed) {
      event.preventDefault();
      event.stopPropagation();
      const src = this.sanitizer.sanitize(SecurityContext.URL, image.getAttribute('src') || '');
      if (!src || src.startsWith('unsafe:')) return;
      this.resetImagePreview();
      this.previewSelection = this.quill.getSelection() || undefined;
      this.previewSourceImage = image as HTMLImageElement;
      this.previewImageSrc = src;
      this.previewImageAlt = image.getAttribute('alt') || t('uiEnlargedNoteImage');
      this.cdr.detectChanges();
      this.imagePreviewClose?.nativeElement.focus();
      return;
    }
    const target = event.target instanceof Element ? event.target.closest('a') : null;
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    const href = target.getAttribute('href') ?? '';
    if (!/^(https?:\/\/|mailto:|tel:)/i.test(href)) return;
    if ((window as any).electronAPI?.openExternal) (window as any).electronAPI.openExternal(href);
    else window.open(href, '_blank', 'noopener,noreferrer');
  }

  public closeImagePreview(): void {
    const selection = this.previewSelection;
    this.resetImagePreview();
    if (this.active && !this.destroyed) {
      if (selection) this.quill.setSelection(selection.index, selection.length, 'silent');
      else this.quill?.focus();
    }
  }

  public removePreviewImage(): void {
    const image = this.previewSourceImage;
    const quill = this.quill;
    if (!this.active || this.destroyed || !this.previewImageSrc) return;
    // Track the actual embed, not its URL or an old index: duplicate images and
    // edits received while previewing must never remove a different image/text.
    if (!image || !quill?.isEnabled() || !quill.root.contains(image) || image.getAttribute('src') !== this.previewImageSrc) {
      this.closeImagePreview(); return;
    }
    const blot = quill.constructor.find(image);
    if (!blot) { this.closeImagePreview(); return; }
    const index = quill.getIndex(blot);
    const embed = quill.getContents(index, 1).ops?.[0]?.insert;
    if (!embed || typeof embed !== 'object' || embed.image !== this.previewImageSrc) {
      this.closeImagePreview(); return;
    }
    quill.history.cutoff();
    quill.deleteText(index, 1, 'user');
    quill.history.cutoff();
    this.previewSelection = { index: Math.min(index, quill.getLength() - 1), length: 0 };
    this.closeImagePreview();
  }

  private resetImagePreview(): void {
    this.removePreviewListeners?.();
    this.removePreviewListeners = undefined;
    this.previewImageSrc = null;
    this.previewSourceImage = undefined;
    this.previewSelection = undefined;
    this.previewZoom = 1;
    this.previewPanX = this.previewPanY = 0;
    this.previewPointer = undefined;
    this.previewPanning = false;
    this.previewAnimateZoom = false;
    this.previewDragged = false;
  }

  public zoomPreview(zoom: number, clientX?: number, clientY?: number, animate = true): void {
    if (!this.previewImageSrc || !Number.isFinite(zoom)) return;
    const next = Math.max(1, Math.min(5, zoom));
    const bounds = this.previewStage?.nativeElement.getBoundingClientRect();
    if (bounds) {
      const x = !Number.isFinite(clientX) ? 0 : clientX! - bounds.left - bounds.width / 2;
      const y = !Number.isFinite(clientY) ? 0 : clientY! - bounds.top - bounds.height / 2;
      const ratio = next / this.previewZoom;
      this.previewPanX = x - (x - this.previewPanX) * ratio;
      this.previewPanY = y - (y - this.previewPanY) * ratio;
    }
    this.previewZoom = next;
    this.previewAnimateZoom = animate;
    this.clampPreviewPan();
    // Quill can open the preview outside Angular's zone. Native gesture listeners
    // inherit that zone, so marking dirty alone can leave the image unchanged.
    if (!this.destroyed) this.cdr.detectChanges();
  }

  public togglePreviewZoom(event: MouseEvent): void {
    event.preventDefault(); event.stopPropagation();
    // A release after panning is a click too. It must not undo the user's zoom.
    if (this.previewDragged) { this.previewDragged = false; return; }
    if (event.detail > 1) return;
    this.zoomPreview(this.previewZoom > 1 ? 1 : 2, event.clientX, event.clientY);
  }

  private clampPreviewPan(): void {
    const stage = this.previewStage?.nativeElement;
    const image = this.previewImage?.nativeElement;
    if (!stage || !image) return;
    const maxX = Math.max(0, (image.offsetWidth * this.previewZoom - stage.clientWidth) / 2);
    const maxY = Math.max(0, (image.offsetHeight * this.previewZoom - stage.clientHeight) / 2);
    this.previewPanX = Math.max(-maxX, Math.min(maxX, this.previewPanX));
    this.previewPanY = Math.max(-maxY, Math.min(maxY, this.previewPanY));
  }

  public startPreviewPan(event: PointerEvent): void {
    this.previewDragged = false;
    if (this.previewZoom <= 1 || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    this.previewPointer = {id: event.pointerId, x: event.clientX, y: event.clientY, panX: this.previewPanX, panY: this.previewPanY};
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  public movePreviewPan(event: PointerEvent): void {
    const pointer = this.previewPointer;
    if (!pointer || pointer.id !== event.pointerId) return;
    if (!this.previewDragged && Math.hypot(event.clientX-pointer.x, event.clientY-pointer.y) < 4) return;
    this.previewDragged = true;
    this.previewPanning = true;
    this.previewAnimateZoom = false;
    this.previewPanX = pointer.panX + event.clientX - pointer.x;
    this.previewPanY = pointer.panY + event.clientY - pointer.y;
    this.clampPreviewPan();
  }

  public endPreviewPan(event: PointerEvent): void {
    if (event.pointerId !== this.previewPointer?.id) return;
    const image = event.currentTarget as HTMLElement;
    if (image.hasPointerCapture(event.pointerId)) image.releasePointerCapture(event.pointerId);
    this.previewPointer = undefined;
    this.previewPanning = false;
  }

  public onPreviewKeydown(event: KeyboardEvent): void {
    if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault(); event.stopPropagation();
      if (!event.repeat && !event.isComposing && !event.metaKey && !event.ctrlKey && !event.altKey) this.removePreviewImage();
      return;
    }
    if (event.key === 'Escape') this.closeImagePreview();
    else if (event.key === '+' || event.key === '=') this.zoomPreview(this.previewZoom * 1.25);
    else if (event.key === '-') this.zoomPreview(this.previewZoom / 1.25);
    else if (event.key === '0') this.zoomPreview(1);
    else return;
    event.preventDefault(); event.stopPropagation();
  }
}
