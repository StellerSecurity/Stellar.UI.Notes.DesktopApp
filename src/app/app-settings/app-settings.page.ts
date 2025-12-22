import { AfterViewInit, Component, OnInit, ViewChild } from "@angular/core";
import {
  AlertController,
  ModalController,
  ToastController,
  NavController,
} from "@ionic/angular";
import { PasswordStrengthMeterModule } from "angular-password-strength-meter";
import { IonModal } from "@ionic/angular";
import { NotesService } from "../services/notes.service";
import { CryptoService } from "../services/crypto.service";
import { AppProtectorService } from "../services/app-protector.service";
import { ConfirmationModalComponent } from "../confirmation-modal/confirmation-modal.component";
import { DeleteNoteModalComponent } from "../delete-note-modal/delete-note-modal.component";
import { TranslatorService } from "../services/translator.service";
import { SecureStorageService } from "../services/secure-storage.service";
@Component({
  selector: "app-app-settings",
  templateUrl: "./app-settings.page.html",
  styleUrls: ["./app-settings.page.scss"],
})
export class AppSettingsPage implements AfterViewInit {
  public appPasswordChallenge: boolean;

  public wipeNotesOnFailedPasswords: boolean = true;

  public notesAppPassword: string;

  public confirmPassword: string;

  public passwordStrengthHelperText = "";

  public passwordStrength = 0;

  public password_enabled = false;
  public showPassword = false;
  public confirmShowPassword = false;
  public upperLower = false;
  public specialChar = false;
  public strongPass = false;
  allTranslations: any;
  shouldShowPasswordOnAppContent: boolean = false;
  useBiometrics = true;

  @ViewChild(IonModal) modal: IonModal;

  constructor(
    public alertController: AlertController,
    private toastController: ToastController,
    private noteService: NotesService,
    private cryptoService: CryptoService,
    private appProtectorService: AppProtectorService,
    private navController: NavController,
    public modalCtrl: ModalController,
    private translatorService: TranslatorService,
    private secureStorageService: SecureStorageService,
  ) {}

  ionViewWillEnter(): void {
    this.allTranslations = this.translatorService.allTranslations;
  }

  ionViewDidEnter() {
    this.passwordStrengthHelperText =
      this.allTranslations.passwordAtLeastLength;
  }

  ngAfterViewInit() {
    if (this.noteService.appHasPasswordChallenge()) {
      this.password_enabled = true;
    }
    this.appPasswordChallenge = this.noteService.appHasPasswordChallenge();

    setTimeout(() => {
      this.allTranslations = this.translatorService.allTranslations;
    }, 300)
  }

  cancel() {
    this.appPasswordChallenge = this.noteService.appHasPasswordChallenge();
    this.modal.dismiss(null, "cancel");
  }

  confirm() {
    this.modal.dismiss("", "confirm");
  }

  public togglePasswordVisibility() {
    this.showPassword = !this.showPassword;
  }
  public toggleConfirmPasswordVisibility() {
    this.confirmShowPassword = !this.confirmShowPassword;
  }

  public async saveOld() {
    if (this.notesAppPassword.length < 3) {
      const toast = await this.toastController.create({
        message:
          this.allTranslations.thePasswordIsWeakPleaseMakeYourPasswordStronger,
        duration: 3000,
        position: "bottom",
      });

      await toast.present();

      return;
    }

    if (this.notesAppPassword !== this.confirmPassword) {
      const toast = await this.toastController.create({
        message: this.allTranslations.theTwoPasswordsDoesNotMatch,
        duration: 3000,
        position: "bottom",
      });

      await toast.present();

      return;
    }

    // can be in encrypted state or decrypted - depends if the app_password_challenge is set.
    let notes = this.noteService.getNotes();

    // the note-service has password-protection, meaning the user wants to remove the password.
    if (this.noteService.appHasPasswordChallenge()) {
      // first, we have to decrypt the notes:
      let decryptedNotes = this.cryptoService.decrypt(
        notes,
        this.notesAppPassword
      );
      this.noteService.setNotes(decryptedNotes);
      this.noteService.setDecryptedNotes(decryptedNotes);
      // await this.modal.dismiss();
      this.notesAppPassword = "";
      this.confirmPassword = "";
      this.noteService.setNotesAppPassword("");
      localStorage.removeItem("app_password_challenge");
      window.location.href = "/app-settings";
      this.password_enabled = false;
    } else {
      if (notes === null) {
        notes = JSON.stringify([]);
      }

      // encrypting notes.
      let encryptedNotes = this.cryptoService.encrypt(
        notes,
        this.notesAppPassword
      );
      this.noteService.setNotes(encryptedNotes);
      // await this.modal.dismiss();
      this.noteService.setNotesAppPassword(this.notesAppPassword);
      this.notesAppPassword = "";
      // init protection
      this.appProtectorService.init();
      // reset failed attempts.
      this.noteService.setFailedPasswordAppAttempts(0);
      localStorage.setItem("app_password_challenge", "1");
      this.password_enabled = true;
      window.location.href = "/home";
      window?.location?.reload();
    }
  }

  public async save() {
    // 1) Basic validation
    if (!this.notesAppPassword || this.notesAppPassword.length < 3) {
      const toast = await this.toastController.create({
        message: this.allTranslations.thePasswordIsWeakPleaseMakeYourPasswordStronger,
        duration: 3000,
        position: "bottom",
      });
      await toast.present();
      return;
    }

    if (this.notesAppPassword !== this.confirmPassword) {
      const toast = await this.toastController.create({
        message: this.allTranslations.theTwoPasswordsDoesNotMatch,
        duration: 3000,
        position: "bottom",
      });
      await toast.present();
      return;
    }

    try {
      // 2) Get notes (can be encrypted/decrypted depending on previous state)
      let notes = this.noteService.getNotes();

      // In case user creates app-password and there are no notes yet
      if (!notes) {
        notes = JSON.stringify([]);
      }

      // 3) Wrap EAK with notes app password (store encrypted EAK, remove plaintext)
      const existingEak = await this.secureStorageService.getItem("ssEakB64");
      if (existingEak != null) {
        const wrappedEak = this.cryptoService.encrypt(
          existingEak,
          this.notesAppPassword
        );

        await this.secureStorageService.setItem(
          "ssEakB64_Encrypted",
          wrappedEak
        );
        await this.secureStorageService.removeItem("ssEakB64");
      }

      // 4) Encrypt notes with new app password
      const encryptedNotes = this.cryptoService.encrypt(
        notes,
        this.notesAppPassword
      );
      this.noteService.setNotes(encryptedNotes);
      this.noteService.setNotesAppPassword(this.notesAppPassword);

      // 5) Reset local state
      this.notesAppPassword = "";
      this.confirmPassword = "";
      this.password_enabled = true;
      localStorage.setItem("app_password_challenge", "1");

      // 6) Close the settings modal if it exists
      if (this.modal) {
        await this.modal.dismiss(null, "confirm");
      }

      // 7) Navigate to your main screen (change '/home' if needed)
      this.navController.navigateRoot("/home");
      // If you *really* want a full reload instead:
      // window.location.reload();

    } catch (err) {
      console.error("Error while saving app password", err);

      const toast = await this.toastController.create({
        message: "Something went wrong while saving the password.",
        duration: 3000,
        position: "bottom",
      });
      await toast.present();
    }
  }


  public async removePasswordOld() {
    const modal = await this.modalCtrl.create({
      component: ConfirmationModalComponent,
      cssClass: "confirmation-popup",
    });

    modal.onDidDismiss().then(async (data) => {
      if (data && data.data) {
        const { confirm, inputValue } = data.data;
        if (confirm) {
          if (this.noteService.appHasPasswordChallenge() && inputValue) {
            let notes = this.noteService.getNotes();
            // first, we have to decrypt the notes:
            let decryptedNotes = null;
            try {
              decryptedNotes = this.cryptoService.decrypt(notes, inputValue);
            } catch (e) {
              const toast = await this.toastController.create({
                message: "The entered password was not correct.",
                duration: 3000,
                position: "bottom",
              });

              await toast.present();
              return;
            }
            this.noteService.setNotes(decryptedNotes);
            this.noteService.setDecryptedNotes(decryptedNotes);
            await this.modal?.dismiss();
            this.notesAppPassword = "";
            this.confirmPassword = "";
            this.noteService.setNotesAppPassword("");
            localStorage.removeItem("app_password_challenge");
            // window.location.href = "/app-settings";
            window.location.reload();
          } else {
            const toast = await this.toastController.create({
              message: this.allTranslations.enterYourCurrentPassword,
              duration: 3000,
              position: "bottom",
            });
            await toast.present();
          }
        } else {
        }
      }
    });

    return await modal.present();
  }

  public async removePassword() {
    const modal = await this.modalCtrl.create({
      component: ConfirmationModalComponent,
      cssClass: "confirmation-popup",
    });

    modal.onDidDismiss().then(async (data) => {
      if (!data || !data.data) {
        return;
      }

      const { confirm, inputValue } = data.data;

      if (!confirm) {
        // user cancelled
        return;
      }

      if (!this.noteService.appHasPasswordChallenge() || !inputValue) {
        const toast = await this.toastController.create({
          message: this.allTranslations.enterYourCurrentPassword,
          duration: 3000,
          position: "bottom",
        });
        await toast.present();
        return;
      }

      try {
        let notes = this.noteService.getNotes();

        // 1) Try to decrypt notes with the entered password
        let decryptedNotes: string;
        try {
          decryptedNotes = this.cryptoService.decrypt(notes, inputValue);
        } catch (e) {
          const toast = await this.toastController.create({
            message: "The entered password was not correct.",
            duration: 3000,
            position: "bottom",
          });
          await toast.present();
          return;
        }

        // 2) Decrypt wrapped EAK back to plain EAK
        const encEak = await this.secureStorageService.getItem(
          "ssEakB64_Encrypted"
        );
        if (encEak != null) {
          const plainEak = this.cryptoService.decrypt(encEak, inputValue);

          await this.secureStorageService.setItem("ssEakB64", plainEak);
          await this.secureStorageService.removeItem("ssEakB64_Encrypted");
        }

        // 3) Store decrypted notes in service
        this.noteService.setNotes(decryptedNotes);
        this.noteService.setDecryptedNotes(decryptedNotes);

        // 4) Reset password-related state
        this.notesAppPassword = "";
        this.confirmPassword = "";
        this.noteService.setNotesAppPassword("");
        this.password_enabled = false;
        localStorage.removeItem("app_password_challenge");

        // Optionally reset failed attempts if you track them
        this.noteService.setFailedPasswordAppAttempts(0);

        // 5) Close the settings modal if it exists
        if (this.modal) {
          await this.modal.dismiss(null, "confirm");
        }

        // 6) Navigate back to main screen (adjust route if needed)
        this.navController.navigateRoot("/home");
        // or: window.location.reload();

      } catch (err) {
        console.error("Error while removing password", err);

        const toast = await this.toastController.create({
          message: "Something went wrong while removing the password.",
          duration: 3000,
          position: "bottom",
        });
        await toast.present();
      }
    });

    return await modal.present();
  }


  public notesAppPasswordChange() {
    this.passwordStrength = 0;

    if (this.notesAppPassword.length == 0) {
      this.passwordStrengthHelperText =
        this.allTranslations.passwordAtLeastLength;
      return;
    }

    // Check password length
    if (this.notesAppPassword.length > 6) {
      this.passwordStrength += 1;
    }

    // Check for mixed case
    if (
      this.notesAppPassword.match(/[a-z]/) &&
      this.notesAppPassword.match(/[A-Z]/)
    ) {
      this.passwordStrength += 1;
      this.upperLower = true;
    } else {
      this.upperLower = false;
    }

    // Check for numbers
    if (this.notesAppPassword.match(/\d/)) {
      this.passwordStrength += 1;
    }

    // Check for special characters
    if (this.notesAppPassword.match(/[^a-zA-Z\d]/)) {
      this.passwordStrength += 1;
      this.specialChar = true;
    } else {
      this.specialChar = false;
    }

    // Check password length
    if (this.notesAppPassword.length >= 6) {
      this.passwordStrength += 1;
      this.strongPass = true;
    } else {
      this.strongPass = false;
    }

    // Return results
    if (this.passwordStrength < 2) {
      this.passwordStrengthHelperText = this.allTranslations.weakPassword;
    } else if (this.passwordStrength === 2) {
      this.passwordStrengthHelperText = this.allTranslations.averagePassword;
    } else if (this.passwordStrength === 3) {
      this.passwordStrengthHelperText = this.allTranslations.goodPassword;
    } else {
      this.passwordStrengthHelperText = this.allTranslations.greatPassword;
    }
  }

  public async appPasswordChallengeDialog() {
    // await this.modal.present();
    this.shouldShowPasswordOnAppContent = !this.shouldShowPasswordOnAppContent;
  }

  public async deleteWholeAppStorage() {
    const modal = await this.modalCtrl.create({
      component: DeleteNoteModalComponent,
      cssClass: "confirmation-popup",
    });

    modal.onDidDismiss().then(async (data) => {
      if (!data || !data.data) {
        return;
      }

      const { confirm } = data.data;

      if (!confirm) {
        // user cancelled
        return;
      }

      try {
        // Clear browser storage
        localStorage.clear();

        // If you also want to clear secure storage and you have such a method:
        // await this.secureStorageService.clear();

        // Hard reset / go back to root
        this.navController.navigateRoot("/home");
        // If you truly need a full reload instead:
        // window.location.reload();
      } catch (err) {
        console.error("Error clearing app storage", err);

        const toast = await this.toastController.create({
          message: "Something went wrong while clearing the app data.",
          duration: 3000,
          position: "bottom",
        });
        await toast.present();
      }
    });

    return await modal.present();
  }

  onToggle(event: any) {
    // handle change, persist preference, etc.
    console.log("biometrics toggled:", this.useBiometrics);
  }
}
