import {
  Component,
  EventEmitter,
  Input,
  Output,
  ViewChild,
  ElementRef,
  ChangeDetectorRef,
  AfterViewInit,
  Renderer2,
  SecurityContext,
  OnChanges,
  OnDestroy,
} from "@angular/core";
import { DomSanitizer } from "@angular/platform-browser";
import {
  AngularEditorComponent,
  AngularEditorConfig,
} from "@wfpena/angular-wysiwyg";
import { AlertController } from "@ionic/angular";

@Component({
  selector: "app-rich-text-editor",
  templateUrl: "./rich-text-editor.component.html",
  styleUrls: ["./rich-text-editor.component.scss"],
})
export class RichTextEditorComponent implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild("editorRef") editorComponent!: AngularEditorComponent;
  @ViewChild("editorWrapper") editorWrapper!: ElementRef;
  @Input() note_text: string = "";
  @Output() noteChange = new EventEmitter<string>();
  @Output() editorFocusChange = new EventEmitter<boolean>();
  updateNote: any = "";

  private savedSelection: Range[] = [];
  private active = true;
  private toolbarInitialized = false;
  private linkInitialized = false;
  private destroyed = false;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private unlisten: Array<() => void> = [];
  private sanitizedContent?: string;
  private publishedContent?: string;

  private schedule(action: () => void, delay: number): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (!this.destroyed && this.active) action();
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

  ngOnChanges(): void {
    this.note_text = this.safeHtml(this.note_text);
    this.publishedContent = this.note_text;
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.onLeave();
    this.unlisten.forEach(remove => remove());
    this.unlisten = [];
  }

  public onEnter(): void {
    this.active = true;
    this.initializeEditorToolbar();
    this.setupLinkButtonOverride();
  }


  public editorConfig: AngularEditorConfig = {
    editable: true,
    spellcheck: false,
    height: "100vh",
    minHeight: "0",
    maxHeight: "auto",
    textAreaBackgroundColor: "white",
    width: "auto",
    minWidth: "0",
    translate: "no",
    enableToolbar: true,
    showToolbar: true,
    placeholder: "Enter your note here..",
    defaultParagraphSeparator: "",
    defaultFontName: "Poppins",
    defaultFontSize: "3",
    imageResizeSensitivity: 3,
    uploadWithCredentials: false,
    sanitize: true,
    toolbarPosition: "top",
    outline: false,
    toolbarHiddenButtons: [
      ["italic", "underline", "superscript", "subscript"],
      ["fontName", "fontSize", "color"],
      [
        "justifyLeft",
        "justifyCenter",
        "justifyRight",
        "justifyFull",
        "indent",
        "outdent",
      ],
      ["cut", "copy", "delete", "removeFormat"],
      [
        "paragraph",
        "blockquote",
        "removeBlockquote",
        "horizontalLine",
        "unorderedList",
      ],
      [
        "video",
        "insertVideo",
        "horizontalline",
        "insertHorizontalRule",
        "toggleEditorMode",
      ],
      ["backgroundColor", "foregroundColor", "textColor"],
      ["unlink"],
    ],
  };

  constructor(
    private renderer: Renderer2,
    private cdr: ChangeDetectorRef,
    private alertCtrl: AlertController,
    private sanitizer: DomSanitizer
  ) {
    this.updateNote = JSON.parse(JSON.stringify(this.note_text));
  }

  ngAfterViewInit() {
    const root = this.getEditorElement();
    if (root) {
      const paste = (event: ClipboardEvent) => {
        const html = event.clipboardData?.getData('text/html');
        if (!html) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        document.execCommand('insertHTML', false, this.safeHtml(html));
        this.onContentChange(root.innerHTML);
      };
      root.addEventListener('paste', paste, true);
      this.unlisten.push(() => root.removeEventListener('paste', paste, true));
    }
    this.initializeEditorToolbar();
    this.setupLinkButtonOverride();
    this.interceptEditorLinks();
  
    // 🔥 Auto focus editor
    this.schedule(() => {
      const editorDiv: HTMLElement | null =
        this.editorWrapper.nativeElement.querySelector(".angular-editor-textarea");
  
      if (editorDiv && !(editorDiv.textContent ?? '').trim() && !editorDiv.querySelector('img') &&
          (document.activeElement === document.body || document.activeElement === editorDiv)) {
        editorDiv.focus({ preventScroll: true });
  
        // optional: place caret at end of existing content
        const range = document.createRange();
        range.selectNodeContents(editorDiv);
        range.collapse(false);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }, 300); // delay to ensure editor is fully rendered
  }
  


  public isEditorFocused(): boolean {
    const editorDiv = this.getEditorElement();
    if (!editorDiv) return false;

    const active = document.activeElement;
    return !!active && (active === editorDiv || editorDiv.contains(active));
  }

  public setExternalContent(content: string): void {
    const normalized = this.safeHtml(content);
    this.publishedContent = normalized;
    if (this.note_text === normalized) {
      return;
    }

    this.note_text = normalized;

    const editorDiv = this.getEditorElement();
    if (!editorDiv) {
      this.cdr.detectChanges();
      return;
    }

    const previousScrollTop = editorDiv.scrollTop;
    if (editorDiv.innerHTML !== normalized) {
      editorDiv.innerHTML = normalized;
    }
    editorDiv.scrollTop = previousScrollTop;

    this.interceptEditorLinks();
    this.cdr.detectChanges();
  }

  public onEditorFocusIn(): void {
    this.editorFocusChange.emit(true);
  }

  public onEditorFocusOut(): void {
    this.schedule(() => {
      this.editorFocusChange.emit(this.isEditorFocused());
    }, 0);
  }

  private getEditorElement(): HTMLElement | null {
    return this.editorWrapper?.nativeElement?.querySelector?.(".angular-editor-textarea") ?? null;
  }

  // ---------------------------
  // Toolbar setup
  // ---------------------------
  private initializeEditorToolbar(): void {
    this.schedule(() => {
      if (this.toolbarInitialized) return;
      this.toolbarInitialized = true;
      (this.editorWrapper.nativeElement as HTMLElement).querySelectorAll(".ae-picker-label").forEach((label) => {
        this.unlisten.push(this.renderer.listen(label, "click", () => {
          const dropdown = label.nextElementSibling as HTMLElement;
          if (dropdown?.classList.contains("ae-picker-options")) {
            this.positionDropdown(label, dropdown);
          }
        }));
      });

      (this.editorWrapper.nativeElement as HTMLElement).querySelectorAll(".ae-button").forEach((button) => {
        button.removeAttribute("disabled");
        this.setupButtonEvents(button);
      });
    }, 300);
  }

  private positionDropdown(label: Element, dropdown: HTMLElement): void {
    const rect = label.getBoundingClientRect();
    dropdown.style.position = "fixed";
    dropdown.style.top = `${rect.bottom + 4}px`;
    dropdown.style.zIndex = "9999";
    dropdown.style.width = "max-content";
    dropdown.style.minWidth = `${rect.width}px`;
    dropdown.style.background = "white";
    dropdown.style.border = "1px solid #ddd";
    dropdown.style.boxShadow = "0px 4px 8px rgba(0, 0, 0, 0.1)";
    dropdown.style.maxHeight = "350px";
    dropdown.style.overflowY = "auto";
    dropdown.style.borderRadius = "16px";
  }

  private setupButtonEvents(button: Element): void {
    this.renderer.listen(button, "mousedown", (event) => {
      event.preventDefault();
      // Keep the selection; let the single native click execute the command.
    });

    this.renderer.listen(button, "click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.cdr.detectChanges();
    });
  }

  // ---------------------------
  // Save + restore selection
  // ---------------------------
  private saveSelection() {
    const sel = window.getSelection();
    this.savedSelection = [];
    if (sel && sel.rangeCount > 0) {
      for (let i = 0; i < sel.rangeCount; i++) {
        this.savedSelection.push(sel.getRangeAt(i).cloneRange());
      }
    }
  }

  private restoreSelection() {
    const sel = window.getSelection();
    if (sel && this.savedSelection.length) {
      sel.removeAllRanges();
      this.savedSelection.forEach((r) => sel.addRange(r));
    }
  }

  // ---------------------------
  // Override link button
  // ---------------------------
  private setupLinkButtonOverride(): void {
    this.schedule(() => {
      if (this.linkInitialized) return;
      const linkBtn = this.editorWrapper.nativeElement.querySelector("#link-") as HTMLButtonElement | null;
      if (!linkBtn) return;
      this.linkInitialized = true;

      // Replace button to override default prompt()
      const cloned = linkBtn.cloneNode(true) as HTMLButtonElement;
      linkBtn.parentNode?.replaceChild(cloned, linkBtn);

      cloned.disabled = false;
      cloned.classList.remove("disabled");

      cloned.addEventListener("mousedown", () => {
        this.saveSelection(); // ✅ save selection before losing focus
      });

      cloned.addEventListener("click", async (e) => {
        e.preventDefault();
        await this.openLinkPrompt();
      });
    }, 500);
  }

  private async openLinkPrompt() {
    const alert = await this.alertCtrl.create({
      header: "Insert Link",
      inputs: [
        {
          name: "url",
          type: "url",
          placeholder: "https://example.com",
        },
      ],
      buttons: [
        { text: "Cancel", role: "cancel" },
        {
          text: "Insert",
          handler: (data) => {
            const url = (data?.url || "").trim();
            if (!url) return false;
            this.insertLink(this.normalizeUrl(url));
            return true;
          },
        },
      ],
    });
  
    await alert.present();
  
    // Wait a tick so DOM is ready
    this.schedule(() => {
      const input = alert.querySelector("input");
      if (input) {
        // 1) Auto focus
        (input as HTMLInputElement).focus();
  
        // 2) Enter = Insert
        input.addEventListener("keydown", (ev: KeyboardEvent) => {
          if (ev.key === "Enter") {
            ev.preventDefault();
  
            // Find Insert button (the second button in buttons array)
            const buttons = alert.querySelectorAll("button.alert-button");
            const insertBtn = Array.from(buttons).find(
              (btn) => btn.textContent?.trim() === "Insert"
            );
            (insertBtn as HTMLButtonElement)?.click();
          }
        });
      }
    }, 100);
  }  

  private normalizeUrl(u: string): string {
    if (/^(mailto:|tel:)/i.test(u)) return u;
    if (!/^https?:\/\//i.test(u)) return `https://${u}`;
    return u;
  }

  private insertLink(url: string) {
    const editorDiv: HTMLElement | null =
      this.getEditorElement();
    if (!editorDiv) return;

    this.restoreSelection(); // ✅ restore user’s text selection
    editorDiv.focus({ preventScroll: true });

    document.execCommand("createLink", false, url);

    // update model
    this.schedule(() => {
      const html = editorDiv.innerHTML;
      this.onContentChange(html);
    }, 50);

    this.interceptEditorLinks();
  }

  // ---------------------------
  // External link interception
  // ---------------------------
  private interceptEditorLinks(): void {
    this.schedule(() => {
      const editorDiv: HTMLElement | null =
        this.getEditorElement();
      if (!editorDiv) return;

      editorDiv.querySelectorAll("a").forEach((link: HTMLAnchorElement) => {
        link.setAttribute("target", "_blank");
        link.setAttribute("rel", "noopener noreferrer");
        if (!(link as any)._bound) {
          link.addEventListener("click", (event) => {
            event.preventDefault();
            const href = link.href;
            if (!/^(https?:|mailto:|tel:)/i.test(href)) return;
            if ((window as any).electronAPI?.openExternal) {
              (window as any).electronAPI.openExternal(href);
            } else {
              window.open(href, "_blank", "noopener,noreferrer");
            }
          });
          (link as any)._bound = true;
        }
      });
    }, 300);
  }

  // ---------------------------
  // Change detection
  // ---------------------------
  onContentChange(content: string): void {
    const safeContent = this.safeHtml(content);
    this.note_text = safeContent;
    // The underlying editor also reports unchanged content on click and blur.
    if (safeContent === this.publishedContent) return;
    this.publishedContent = safeContent;
    this.noteChange.emit(safeContent);
  }

  onLeave() {
    this.active = false;
    this.timers.forEach(timer => clearTimeout(timer));
    this.timers.clear();
    this.savedSelection = [];
  }
}
