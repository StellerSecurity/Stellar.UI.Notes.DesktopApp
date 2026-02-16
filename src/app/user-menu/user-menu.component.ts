import { AfterViewInit, Component, OnInit } from "@angular/core";
import { AlertController, ModalController, PopoverController } from "@ionic/angular";
import { AppSettingsPage } from "../app-settings/app-settings.page";
import { Router } from "@angular/router";
import { SecureStorageService } from "../services/secure-storage.service";
import { DataService } from "../services/data.service";
import { AuthService } from "../services/auth.service";
import { TranslatorService } from "../services/translator.service";

@Component({
  selector: "app-user-menu",
  templateUrl: "./user-menu.component.html",
  styleUrls: ["./user-menu.component.scss"],
})
export class UserMenuComponent implements OnInit, AfterViewInit {
  isUserIsLoggedIn = false;
  user: any = {};
  allTranslations: any;

  constructor(
    public popoverController: PopoverController,
    private modalController: ModalController,
    private router: Router,
    private alertController: AlertController,
    private secureStorageService: SecureStorageService,
    private dataService: DataService,
    public authService: AuthService,
    private translatorService: TranslatorService,
  ) {}

  ngOnInit() {
    this.loadUserData();
  }

  ionViewWillEnter() {
    this.loadUserData();
    this.allTranslations = this.translatorService.allTranslations;
  }

  ngAfterViewInit(): void {
    setTimeout(() => {
      this.allTranslations = this.translatorService.allTranslations;
    }, 300)
  }

  private async loadUserData() {
    const user = await this.secureStorageService.getItem('ssUser');
    if (user) {
      this.user = JSON.parse(user);
    }
    const token = await this.secureStorageService.getItem('ssToken');
    this.isUserIsLoggedIn = !!token;
  }

  async confirmLogout() {
    const alert = await this.alertController.create({
      header: this.allTranslations?.confirmLogout,
      message: this.allTranslations?.areYoSureYouWantToLogout,
      buttons: [
        {
          text: this.allTranslations?.cancel,
          role: 'cancel',
          cssClass: 'secondary',
        },
        {
          text: this.allTranslations?.logout,
          handler: () => {
            this.logout();
          },
        },
      ],
    });

    await alert.present();
  }

  private async logout() {
    this.popoverController.dismiss();
    await this.dataService.clearAppData();
    this.showMessageAfterLogout();
  }

  async showMessageAfterLogout() {
    const alert = await this.alertController.create({
    header:  this.allTranslations?.youAreLoggedOut,
      message: this.allTranslations?.youAreLogoutMsg,
      buttons: [
        {
          text: this.allTranslations?.ok,
          handler: () => {

          },
        },
      ],
    });

    await alert.present();
  }

  logoutOld() {
    this.popoverController.dismiss();
    // perform logout
  }

  async openSettingsModal() {
    this.popoverController.dismiss();

    const modal = await this.modalController.create({
      component: AppSettingsPage,
      cssClass: "centered-modal",
      backdropDismiss: true,
      showBackdrop: true,
      animated: true,
    });

    await modal.present();

    const { data } = await modal.onWillDismiss();
    console.log("Modal data:", data);
  }

  goToLogin(): void {
    this.popoverController.dismiss();
    this.router.navigate(["/profile/login"]);
  }
}
