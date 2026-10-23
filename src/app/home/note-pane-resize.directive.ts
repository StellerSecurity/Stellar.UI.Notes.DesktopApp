import { AfterViewInit, Directive, ElementRef, Input, NgZone, OnDestroy } from '@angular/core';


/** Keep pointer movement outside Angular so resizing never rerenders every note. */
@Directive({ selector: '[appNotePaneResize]', standalone: true })
export class NotePaneResizeDirective implements AfterViewInit, OnDestroy {
  @Input('appNotePaneResize') pane: 'notes' | 'folders' | '' = 'notes';
  private get isFolders(): boolean { return this.pane === 'folders'; }
  private get storageKey(): string { return this.isFolders ? 'stellarNotesFoldersWidth' : 'stellarNotesListWidth'; }
  private get defaultWidth(): number { return this.isFolders ? 220 : 300; }
  private get property(): string { return this.isFolders ? '--folders-pane-width' : '--notes-pane-width'; }
  private root: HTMLElement | null = null;
  private preferred = 300;
  private width = 300;
  private active: { id: number; x: number; width: number; preferred: number } | null = null;
  private cleanup: (() => void)[] = [];
  private resizeObserver?: ResizeObserver;
  private mutationObserver?: MutationObserver;

  constructor(private element: ElementRef<HTMLElement>, private zone: NgZone) {}

  ngAfterViewInit(): void {
    this.root = this.element.nativeElement.closest('.desktop-layout');
    if (!this.root) return;
    this.preferred = this.defaultWidth;
    try {
      const stored = Number(localStorage.getItem(this.storageKey));
      if (Number.isFinite(stored) && stored > 0) this.preferred = Math.max(this.isFolders ? 180 : 220, Math.min(this.isFolders ? 360 : 640, stored));
    } catch { /* Resizing also works when preference storage is unavailable. */ }
    this.zone.runOutsideAngular(() => {
      this.root!.classList.add('pane-resizing');
      this.refresh();
      // Apply a restored width before enabling sidebar transitions.
      void getComputedStyle(this.root!).gridTemplateColumns;
      this.root!.classList.remove('pane-resizing');
      this.listen(this.root!, 'stellar:pane-width-changed', (event: CustomEvent) => {
        if (event.detail !== this.element.nativeElement) this.refresh();
      });
      this.listen(this.element.nativeElement, 'pointerdown', this.start);
      this.listen(this.element.nativeElement, 'lostpointercapture', () => this.finish(true));
      this.listen(this.element.nativeElement, 'keydown', this.keydown);
      this.listen(this.element.nativeElement, 'dblclick', this.reset);
      this.listen(window, 'pointermove', this.move);
      this.listen(window, 'pointerup', this.up);
      this.listen(window, 'pointercancel', this.cancel);
      this.listen(window, 'blur', () => this.finish(true));
      this.resizeObserver = new ResizeObserver(() => this.refresh());
      this.resizeObserver.observe(this.root!);
      this.mutationObserver = new MutationObserver(() => { if (!this.active) this.refresh(); });
      this.mutationObserver.observe(this.root!, { attributes: true, attributeFilter: ['class'] });
    });
  }

  private listen(target: EventTarget, name: string, handler: (event: any) => void): void {
    target.addEventListener(name, handler);
    this.cleanup.push(() => target.removeEventListener(name, handler));
  }

  private limits(): { min: number; max: number } {
    const total = this.root?.clientWidth ?? 0;
    if (this.isFolders) {
      const min = Math.min(180, total / 3);
      return { min, max: Math.max(min, Math.min(360, total - 220 - 320 - 2)) };
    }
    const folders = this.root?.querySelector<HTMLElement>('.desktop-folders-pane');
    const sidebar = this.root?.classList.contains('sidebar-hidden') ? 0 : folders?.getBoundingClientRect().width ?? 0;
    const gutters = this.root?.classList.contains('sidebar-hidden') ? 1 : 2;
    const available = Math.max(0, total - sidebar - gutters);
    // At desktop widths keep 220px for notes and at least 320px for the editor.
    // Embedded/narrow windows share the available space instead of overflowing.
    const min = Math.min(220, available / 2);
    return { min, max: Math.max(min, Math.min(640, available - 320)) };
  }

  private refresh = (): void => {
    if (!this.root) return;
    const { min, max } = this.limits();
    this.width = Math.max(min, Math.min(max, this.preferred));
    const value = `${this.width}px`;
    if (this.root.style.getPropertyValue(this.property) !== value) {
      this.root.style.setProperty(this.property, value);
      this.root.dispatchEvent(new CustomEvent('stellar:pane-width-changed', { detail: this.element.nativeElement }));
    }
    const handle = this.element.nativeElement;
    handle.setAttribute('aria-valuemin', String(Math.round(min)));
    handle.setAttribute('aria-valuemax', String(Math.round(max)));
    handle.setAttribute('aria-valuenow', String(Math.round(this.width)));
  };

  private persist(): void {
    try { localStorage.setItem(this.storageKey, String(this.preferred)); } catch { /* Keep the current width for this session. */ }
  }

  private start = (event: PointerEvent): void => {
    if (event.button !== 0 || !event.isPrimary || this.active) return;
    event.preventDefault(); event.stopPropagation();
    this.refresh();
    this.active = { id: event.pointerId, x: event.clientX, width: this.width, preferred: this.preferred };
    this.root?.classList.add('pane-resizing');
    this.element.nativeElement.focus({ preventScroll: true });
    try { this.element.nativeElement.setPointerCapture(event.pointerId); } catch { /* Window listeners also cover synthetic events. */ }
  };

  private move = (event: PointerEvent): void => {
    if (!this.active || event.pointerId !== this.active.id) return;
    event.preventDefault();
    const { min, max } = this.limits();
    this.preferred = Math.max(min, Math.min(max, this.active.width + event.clientX - this.active.x));
    this.refresh();
  };

  private up = (event: PointerEvent): void => {
    if (event.pointerId !== this.active?.id) return;
    this.move(event); this.finish(true);
  };
  private cancel = (event: PointerEvent): void => { if (event.pointerId === this.active?.id) this.finish(false); };

  private finish(save: boolean): void {
    if (!this.active) return;
    const active = this.active; this.active = null;
    if (save) this.persist(); else this.preferred = active.preferred;
    this.root?.classList.remove('pane-resizing'); this.refresh();
    try { this.element.nativeElement.releasePointerCapture(active.id); } catch { /* Capture may already be lost. */ }
  }

  private keydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && this.active) { event.preventDefault(); event.stopPropagation(); this.finish(false); return; }
    if (this.active || event.altKey || event.metaKey || event.ctrlKey) return;
    const { min, max } = this.limits();
    const step = event.shiftKey ? 30 : 10;
    const next = event.key === 'ArrowLeft' ? this.width - step : event.key === 'ArrowRight' ? this.width + step : event.key === 'Home' ? min : event.key === 'End' ? max : null;
    if (next === null) return;
    event.preventDefault(); event.stopPropagation();
    this.preferred = Math.max(min, Math.min(max, next)); this.refresh(); this.persist();
  };

  private reset = (event: MouseEvent): void => {
    event.preventDefault(); this.finish(false);
    this.preferred = this.defaultWidth; this.refresh(); this.persist();
  };

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect(); this.mutationObserver?.disconnect();
    this.cleanup.forEach(dispose => dispose()); this.cleanup = [];
    this.finish(false); this.root = null;
  }
}
