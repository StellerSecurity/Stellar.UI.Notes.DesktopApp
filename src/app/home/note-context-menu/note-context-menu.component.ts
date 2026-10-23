import { Component, Input } from '@angular/core';
import { PopoverController } from '@ionic/angular';

@Component({ standalone: false,
  selector: 'app-note-context-menu',
  templateUrl: './note-context-menu.component.html',
  styleUrls: ['./note-context-menu.component.scss'],
})
export class NoteContextMenuComponent {

  @Input() note: any;
  @Input() multiple = false;
  @Input() locked = false;
  @Input() allFavorite = false;

  constructor(private popoverController: PopoverController) {}

  onMenuKey(event: KeyboardEvent): void {
    const buttons = Array.from((event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); buttons[(index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus();
    }
  }

  dismiss(action: string) {
    this.popoverController.dismiss({ action });
  }
}
