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
} from "@angular/core";
import {
  AngularEditorComponent,
  AngularEditorConfig,
} from "@wfpena/angular-wysiwyg";
import { NotesService } from "src/app/services/notes.service";
import { AlertController } from "@ionic/angular";

@Component({
  selector: "app-rich-text-editor",
  templateUrl: "./rich-text-editor.component.html",
  styleUrls: ["./rich-text-editor.component.scss"],
})
export class RichTextEditorComponent implements AfterViewInit {
  @ViewChild("editorRef") editorComponent!: AngularEditorComponent;
  @ViewChild("editorWrapper") editorWrapper!: ElementRef;
  @Input() note_text: string = "";
  @Output() noteChange = new EventEmitter<string>();
  updateNote: any = "";

  private savedSelection: Range[] = [];

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
    private noteService: NotesService,
    private alertCtrl: AlertController
  ) {
    this.updateNote = JSON.parse(JSON.stringify(this.note_text));
  }

  ngAfterViewInit() {
    this.initializeEditorToolbar();
    this.setupLinkButtonOverride();
    this.interceptEditorLinks();
  
    // 🔥 Auto focus editor
    setTimeout(() => {
      const editorDiv: HTMLElement | null =
        this.editorWrapper.nativeElement.querySelector(".angular-editor-textarea");
  
      if (editorDiv) {
        editorDiv.focus();
  
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
  

  // ---------------------------
  // Toolbar setup
  // ---------------------------
  private initializeEditorToolbar(): void {
    setTimeout(() => {
      document.querySelectorAll(".ae-picker-label").forEach((label) => {
        this.renderer.listen(label, "click", () => {
          const dropdown = label.nextElementSibling as HTMLElement;
          if (dropdown?.classList.contains("ae-picker-options")) {
            this.positionDropdown(label, dropdown);
          }
        });
      });

      document.querySelectorAll(".ae-button").forEach((button) => {
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
      (button as HTMLElement).click();
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
    setTimeout(() => {
      const linkBtn = document.querySelector("#link-") as HTMLButtonElement | null;
      if (!linkBtn) return;

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
    setTimeout(() => {
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
      document.querySelector(".angular-editor-textarea");
    if (!editorDiv) return;

    this.restoreSelection(); // ✅ restore user’s text selection
    editorDiv.focus();

    document.execCommand("createLink", false, url);

    // update model
    setTimeout(() => {
      const html = editorDiv.innerHTML;
      this.note_text = html;
      this.noteChange.emit(html);
      this.noteService.setNoteIsUpdatedSubject(true);
      this.cdr.detectChanges();
    }, 50);

    this.interceptEditorLinks();
  }

  // ---------------------------
  // External link interception
  // ---------------------------
  private interceptEditorLinks(): void {
    setTimeout(() => {
      const editorDiv: HTMLElement | null =
        document.querySelector(".angular-editor-textarea");
      if (!editorDiv) return;

      editorDiv.querySelectorAll("a").forEach((link: HTMLAnchorElement) => {
        link.setAttribute("target", "_blank");
        if (!(link as any)._bound) {
          link.addEventListener("click", (event) => {
            event.preventDefault();
            const href = link.href;
            if ((window as any).electronAPI?.openExternal) {
              (window as any).electronAPI.openExternal(href);
            } else {
              window.open(href, "_blank");
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
    this.note_text = content;
    this.noteChange.emit(content);
    this.noteService.setNoteIsUpdatedSubject(true);
  }

  onClickEditor(): void {
    setTimeout(() => {
      this.cdr.detectChanges();
    }, 100);
  }

  onLeave() {
    // optional cleanup
  }
}
