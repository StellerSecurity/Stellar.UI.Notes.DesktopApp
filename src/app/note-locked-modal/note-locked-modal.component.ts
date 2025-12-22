import { Component, ViewChild } from '@angular/core';
import { IonInput, ModalController } from '@ionic/angular';

@Component({
  selector: 'app-note-locked-modal',
  templateUrl: './note-locked-modal.component.html',
  styleUrls: ['./note-locked-modal.component.scss'],
})
export class NoteLockedModalComponent {
  public showPassword: boolean = false;
  @ViewChild('passwordInput', { static: false }) passwordInput!: IonInput;

  constructor(private modalCtrl: ModalController) { }

  ionViewDidEnter() {
    setTimeout(() => {
      this.passwordInput?.setFocus();
    }, 300); 
  }

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

  onEnter() {
    this.dismiss(true);
  }
}