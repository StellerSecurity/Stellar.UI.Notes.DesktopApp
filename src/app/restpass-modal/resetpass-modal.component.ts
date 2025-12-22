import { Component, ViewChild } from '@angular/core';
import { ModalController } from '@ionic/angular';

@Component({
  selector: 'app-resetpass-modal',
  templateUrl: './resetpass-modal.component.html',
  styleUrls: ['./resetpass-modal.component.scss'],
})
export class ResetPassModalComponent {
  constructor(private modalCtrl: ModalController) { }

  // Dismiss the modal with the confirmation result
  public dismiss(confirm: boolean): void {
    this.modalCtrl?.dismiss({ confirm });
  }
}
