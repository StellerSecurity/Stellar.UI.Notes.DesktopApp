import { Component, Input } from '@angular/core';
import { LoadingController, ModalController, ToastController } from '@ionic/angular';
import { SecretapiService } from '../services/secretapi.service';
import { Share } from '@capacitor/share';
import { Router } from '@angular/router';
import { TranslatorService } from '../services/translator.service';
import { Capacitor } from '@capacitor/core';

// ✅ Import shell only if running inside Electron
let shell: any = null;
if ((window as any).require) {
  try {
    shell = (window as any).require('electron').shell;
  } catch (e) {
    shell = null;
  }
}

@Component({
  selector: 'app-share-secret-modal',
  templateUrl: './share-secret-modal.component.html',
  styleUrls: ['./share-secret-modal.component.scss']
})
export class ShareSecretModalComponent {
  secretUrl: string = '';
  @Input() addSecretModal: any;
  @Input() secret_id: any;
  expiryText: string = '';
  step = 1;
  isLoading = false;
  createdSecret: any;
  allTranslations: any;
  isDeletingSecret = false;

  constructor(
    private modalCtrl: ModalController,
    private toastController: ToastController,
    private loadingController: LoadingController,
    private secretapi: SecretapiService,
    private router: Router,
    private translatorService: TranslatorService
  ) {}

  ionViewWillEnter() {
    this.step = 1;
    this.allTranslations = this.translatorService.allTranslations;
  }

  ngAfterViewInit(): void {
    setTimeout(() => {
      this.allTranslations = this.translatorService.allTranslations;
    }, 300)
  }

  closeModal() {
    this.modalCtrl.dismiss();
  }

  changeModalClass() {
    const newClass = 'secretshare-copy-modal';
    const modalEl = document.querySelector('ion-modal.secret-modal') as HTMLIonModalElement;
    if (modalEl) {
      modalEl.classList.add(newClass);
    }
  }

  async createSecret() {
    const loading = await this.loadingController.create();
    await loading.present();

    this.secretapi.create(this.addSecretModal).subscribe({
      next: async (response) => {
        this.changeModalClass();
        this.createdSecret = response;
        this.step = 2;
        this.secretUrl = `https://stellarsecret.io/${this.secret_id}`;
        this.expiryText = '';
      },
      error: async () => {
        await loading.dismiss();
        this.isLoading = false;
        alert('Failed to share secret. Please check your internet connection or try again.');
      },
      complete: async () => {
        await loading.dismiss();
        this.isLoading = false;
      },
    });
  }

  burnSecret() {
    this.isDeletingSecret = true;
    this.secretapi.delete(this.createdSecret?.id).subscribe({
      next: async () => {
        this.closeModal();
        const toast = await this.toastController.create({
          message: this.allTranslations.secretDeletedSuccessfully,
          duration: 2500,
          position: 'bottom',
        });

        await toast.present();
      },
      error: async () => {},
      complete: async () => {
        this.isDeletingSecret = false;
      },
    });
  }

  async copyLink() {
    await navigator.clipboard.writeText(this.secretUrl);
    const toast = await this.toastController.create({
      message: 'Link copied.',
      duration: 3000,
      position: 'bottom',
    });
    await toast.present();
  }

  async shareLink() {
    if (Capacitor.getPlatform() === 'android' || Capacitor.getPlatform() === 'ios') {
      // ✅ Native share on mobile
      await Share.share({
        title: 'Stellar Secret',
        text: 'Here is your secret link',
        url: this.secretUrl,
        dialogTitle: 'Stellar Note',
      });
    } else if ((window as any).electronAPI?.openExternal) {
      (window as any).electronAPI.openExternal(this.secretUrl);
      const toast = await this.toastController.create({
        message: 'Link opened in your default browser.',
        duration: 3000,
        position: 'bottom',
      });
      await toast.present();
    } else {
      // ✅ Web fallback
      await this.copyLink();
    }
  }

  private formatDate(dateString: string): string {
    const date = new Date(dateString);

    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();

    return `${hours}:${minutes}, ${day}.${month}.${year}`;
  }
}
