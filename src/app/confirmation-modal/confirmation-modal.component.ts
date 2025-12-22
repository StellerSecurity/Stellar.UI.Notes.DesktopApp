import { Component, ViewChild } from '@angular/core';
import { ModalController } from '@ionic/angular';

@Component({
  selector: 'app-confirmation-modal',
  templateUrl: './confirmation-modal.component.html',
  styleUrls: ['./confirmation-modal.component.scss'],
})
export class ConfirmationModalComponent {
  public showPassword: boolean = false;
  @ViewChild('passwordInput', { static: false }) passwordInput: { value: any; };

  constructor(private modalCtrl: ModalController) { }

  // Dismiss the modal with the confirmation result
  public dismiss(confirm: boolean): void {
    // Get the input value before dismissing the modal
    const inputValue = this.passwordInput.value;
    this.modalCtrl.dismiss({ confirm, inputValue });
  }

  // Toggle password visibility
  public togglePasswordVisibility(): void {
    this.showPassword = !this.showPassword;
  }
}