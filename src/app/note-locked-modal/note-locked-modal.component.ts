import { translateText as t } from '../i18n';
import { Component, Input, ViewChild } from '@angular/core';
import { IonInput, ModalController } from '@ionic/angular';

@Component({ standalone: false,
  selector: 'app-note-locked-modal',
  templateUrl: './note-locked-modal.component.html',
  styleUrls: ['./note-locked-modal.component.scss'],
})
export class NoteLockedModalComponent {
  private focusTimer?: ReturnType<typeof setTimeout>;
  ngOnDestroy(): void { clearTimeout(this.focusTimer); }
  public showPassword: boolean = false;
  public error = '';
  public checking = false;
  @Input() validatePassword?: (password: string) => Promise<boolean>;
  @ViewChild('passwordInput', { static: false }) passwordInput!: IonInput;

  constructor(private modalCtrl: ModalController) { }

  ionViewDidEnter() {
    this.focusTimer = setTimeout(() => {
      this.passwordInput?.setFocus();
    }, 300); 
  }

  // Dismiss the modal with the confirmation result
  public async dismiss(confirm: boolean): Promise<void> {
    if (this.checking) return;
    const inputValue = String(this.passwordInput.value || '');
    if (confirm && this.validatePassword) {
      this.checking = true;
      try {
        if (!await this.validatePassword(inputValue)) {
          this.error = t('uiIncorrectPasswordPleaseTryAgain');
          return;
        }
      } catch { this.error = t('uiTheNoteCouldNotBeUnlockedPleaseTry'); return; }
      finally { this.checking = false; }
    }
    this.ngOnDestroy();
    await this.modalCtrl.dismiss({ confirm, inputValue });
  }

  // Toggle password visibility
  public togglePasswordVisibility(): void {
    this.showPassword = !this.showPassword;
  }

  onEnter() {
    this.dismiss(true);
  }
}