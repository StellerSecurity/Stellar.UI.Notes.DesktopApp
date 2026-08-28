import { Component, EventEmitter, Input, OnDestroy, Output } from '@angular/core';
import { AlertController } from '@ionic/angular';
import { normalizeNoteBodyForRichTextEditor } from '../../utils/rich-text-content.util';

@Component({
  selector: 'app-rich-text-editor',
  templateUrl: './rich-text-editor.component.html',
  styleUrls: ['./rich-text-editor.component.scss'],
})
export class RichTextEditorComponent implements OnDestroy {
  private normalizedNoteText = '';

  @Input()
  get note_text(): string {
    return this.normalizedNoteText;
  }

  set note_text(value: string) {
    const source = typeof value === 'string' ? value : String(value ?? '');
    const normalized = normalizeNoteBodyForRichTextEditor(source);
    this.normalizedNoteText = normalized;

    if (normalized !== source) {
      Promise.resolve().then(() => {
        if (this.normalizedNoteText === normalized) {
          this.noteChange.emit(normalized);
        }
      });
    }
  }
  @Output() noteChange = new EventEmitter<string>();
  @Output() editorFocusChange = new EventEmitter<boolean>();

  quill: any;
  private savedSelection: { index: number; length: number } | null = null;
  private readonly editorLinkClickHandler = (event: MouseEvent): void => {
    const target = event.target as HTMLElement | null;
    const link = target?.closest?.('a') as HTMLAnchorElement | null;
    if (!link?.href) {
      return;
    }

    event.preventDefault();
    if ((window as any).electronAPI?.openExternal) {
      (window as any).electronAPI.openExternal(link.href);
    } else {
      window.open(link.href, '_blank');
    }
  };

  constructor(private alertCtrl: AlertController) {}

  readonly quillModules = {
    toolbar: {
      container: [
        ['undo', 'redo'],
        ['bold', 'strike'],
        [{ list: 'ordered' }, { list: 'bullet' }],
        [{ header: [1, 2, 3, 4, 5, 6, false] }],
        ['link', 'image'],
      ],
      handlers: {
        undo: () => this.quill?.history.undo(),
        redo: () => this.quill?.history.redo(),
        link: (value: boolean) => this.handleLinkAction(value),
      },
    },
    history: {
      delay: 0,
      maxStack: 300,
      userOnly: true,
    },
  };

  onEditorCreated(quill: any): void {
    this.quill = quill;
    this.quill.root?.addEventListener('click', this.editorLinkClickHandler);
  }

  ngOnDestroy(): void {
    this.quill?.root?.removeEventListener('click', this.editorLinkClickHandler);
  }

  onContentChange(content: string | null): void {
    const html = typeof this.quill?.root?.innerHTML === 'string'
      ? this.quill.root.innerHTML
      : normalizeNoteBodyForRichTextEditor(content ?? '');
    this.normalizedNoteText = html;
    this.noteChange.emit(html);
  }

  onEditorFocusIn(): void {
    this.editorFocusChange.emit(true);
  }

  onEditorFocusOut(): void {
    this.editorFocusChange.emit(false);
  }

  isEditorFocused(): boolean {
    return !!this.quill?.hasFocus?.();
  }

  setExternalContent(content: string): void {
    const html = normalizeNoteBodyForRichTextEditor(content ?? '');
    if (this.note_text === html) {
      return;
    }

    this.note_text = html;
    if (this.quill?.clipboard?.dangerouslyPasteHTML) {
      // Quill's clipboard parser applies its format allow-list. `silent` avoids
      // turning a remote refresh into a local edit/autosave.
      this.quill.clipboard.dangerouslyPasteHTML(html, 'silent');
      this.normalizedNoteText = this.quill.root.innerHTML;
    }
  }

  onLeave(): void {
    this.quill?.blur?.();
  }

  private handleLinkAction(value: boolean): void {
    if (!this.quill) {
      return;
    }

    if (!value) {
      this.quill.format('link', false, 'user');
      return;
    }

    const selection = this.quill.getSelection?.() ?? this.quill.selection?.savedRange;
    this.savedSelection = selection
      ? { index: selection.index, length: selection.length }
      : null;
    void this.openLinkPrompt();
  }

  private async openLinkPrompt(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Insert Link',
      inputs: [{ name: 'url', type: 'url', placeholder: 'https://example.com' }],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Insert',
          handler: (data) => {
            const rawUrl = String(data?.url ?? '').trim();
            if (!rawUrl) {
              return false;
            }
            this.insertLink(this.normalizeUrl(rawUrl));
            return true;
          },
        },
      ],
    });

    await alert.present();
  }

  private normalizeUrl(url: string): string {
    if (/^(mailto:|tel:)/i.test(url)) {
      return url;
    }
    return /^https?:\/\//i.test(url) ? url : `https://${url}`;
  }

  private insertLink(url: string): void {
    if (!this.quill) {
      return;
    }

    const selection = this.savedSelection ?? this.quill.getSelection?.(true);
    if (!selection) {
      return;
    }

    if (selection.length > 0) {
      this.quill.formatText(selection.index, selection.length, 'link', url, 'user');
      this.quill.setSelection(selection.index + selection.length, 0, 'silent');
    } else {
      this.quill.insertText(selection.index, url, 'link', url, 'user');
      this.quill.setSelection(selection.index + url.length, 0, 'silent');
    }
    this.savedSelection = null;
  }
}
