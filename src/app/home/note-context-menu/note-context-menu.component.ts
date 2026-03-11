import { Component, Input } from '@angular/core';
import { PopoverController } from '@ionic/angular';

@Component({
  selector: 'app-note-context-menu',
  templateUrl: './note-context-menu.component.html',
  styleUrls: ['./note-context-menu.component.scss'],
})
export class NoteContextMenuComponent {

  @Input() note: any;

  constructor(private popoverController: PopoverController) {}

  dismiss(action: string) {
    this.popoverController.dismiss({ action });
  }
}
