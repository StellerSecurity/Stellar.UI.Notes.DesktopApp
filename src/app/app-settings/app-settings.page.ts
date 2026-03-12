import { AfterViewInit, Component, ViewChild } from "@angular/core";
import {
  AlertController,
  ModalController,
  ToastController,
  NavController,
} from "@ionic/angular";
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
  public allTranslations: any;
  public shouldShowPasswordOnAppContent: boolean = false;
  public useBiometrics = true;

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
    }, 300);
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

    let notes = this.noteService.getNotes();

    if (this.noteService.appHasPasswordChallenge()) {
      const decryptedNotes = this.cryptoService.decrypt(
        notes,
        this.notesAppPassword
      );

      this.noteService.setNotes(decryptedNotes);
      this.noteService.setDecryptedNotes(decryptedNotes);
      this.notesAppPassword = "";
      this.confirmPassword = "";
      this.noteService.setNotesAppPassword("");
      localStorage.removeItem("app_password_challenge");
      this.password_enabled = false;

      await this.navController.navigateRoot("/app-settings");
      return;
    }

    if (notes === null) {
      notes = JSON.stringify([]);
    }

    const encryptedNotes = this.cryptoService.encrypt(
      notes,
      this.notesAppPassword
    );

    this.noteService.setNotes(encryptedNotes);
    this.noteService.setNotesAppPassword(this.notesAppPassword);
    this.notesAppPassword = "";
    this.appProtectorService.init();
    this.noteService.setFailedPasswordAppAttempts(0);
    localStorage.setItem("app_password_challenge", "1");
    this.password_enabled = true;

    await this.navController.navigateRoot("/home");
  }

  public async save() {
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
      let notes = this.noteService.getNotes();

      if (!notes) {
        notes = JSON.stringify([]);
      }

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

      const encryptedNotes = this.cryptoService.encrypt(
        notes,
        this.notesAppPassword
      );

      this.noteService.setNotes(encryptedNotes);
      this.noteService.setNotesAppPassword(this.notesAppPassword);

      this.notesAppPassword = "";
      this.confirmPassword = "";
      this.password_enabled = true;
      localStorage.setItem("app_password_challenge", "1");

      if (this.modal) {
        await this.modal.dismiss(null, "confirm");
      }

      await this.navController.navigateRoot("/home");
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
            const notes = this.noteService.getNotes();

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

            await this.navController.navigateRoot("/app-settings");
          } else {
            const toast = await this.toastController.create({
              message: this.allTranslations.enterYourCurrentPassword,
              duration: 3000,
              position: "bottom",
            });
            await toast.present();
          }
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
        const notes = this.noteService.getNotes();

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

        const encEak = await this.secureStorageService.getItem(
          "ssEakB64_Encrypted"
        );

        if (encEak != null) {
          const plainEak = this.cryptoService.decrypt(encEak, inputValue);

          await this.secureStorageService.setItem("ssEakB64", plainEak);
          await this.secureStorageService.removeItem("ssEakB64_Encrypted");
        }

        this.noteService.setNotes(decryptedNotes);
        this.noteService.setDecryptedNotes(decryptedNotes);

        this.notesAppPassword = "";
        this.confirmPassword = "";
        this.noteService.setNotesAppPassword("");
        this.password_enabled = false;
        localStorage.removeItem("app_password_challenge");
        this.noteService.setFailedPasswordAppAttempts(0);

        if (this.modal) {
          await this.modal.dismiss(null, "confirm");
        }

        await this.navController.navigateRoot("/home");
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

    if (this.notesAppPassword.length > 6) {
      this.passwordStrength += 1;
    }

    if (
      this.notesAppPassword.match(/[a-z]/) &&
      this.notesAppPassword.match(/[A-Z]/)
    ) {
      this.passwordStrength += 1;
      this.upperLower = true;
    } else {
      this.upperLower = false;
    }

    if (this.notesAppPassword.match(/\d/)) {
      this.passwordStrength += 1;
    }

    if (this.notesAppPassword.match(/[^a-zA-Z\d]/)) {
      this.passwordStrength += 1;
      this.specialChar = true;
    } else {
      this.specialChar = false;
    }

    if (this.notesAppPassword.length >= 6) {
      this.passwordStrength += 1;
      this.strongPass = true;
    } else {
      this.strongPass = false;
    }

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
        return;
      }

      try {
        localStorage.clear();
        await this.navController.navigateRoot("/home");
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
    console.log("biometrics toggled:", this.useBiometrics);
  }
}
