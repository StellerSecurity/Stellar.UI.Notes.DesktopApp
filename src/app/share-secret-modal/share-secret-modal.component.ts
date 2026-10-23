import { translateText as t } from '../i18n';
import { Component, Input, OnDestroy } from '@angular/core';
import { ModalController, ToastController } from '@ionic/angular';
import { SecretapiService } from '../services/secretapi.service';
import { Share } from '@capacitor/share';
import { Router } from '@angular/router';
import { TranslatorService } from '../services/translator.service';
import { Capacitor } from '@capacitor/core';
import { Subscription } from 'rxjs';

// ✅ Import shell only if running inside Electron
let shell: any = null;
if ((window as any).require) {
  try {
    shell = (window as any).require('electron').shell;
  } catch (e) {
    shell = null;
  }
}

@Component({ standalone: false,
  selector: 'app-share-secret-modal',
  templateUrl: './share-secret-modal.component.html',
  styleUrls: ['./share-secret-modal.component.scss']
})
export class ShareSecretModalComponent implements OnDestroy {
  errorMessage = '';
  private createRequest?: Subscription;
  ngOnDestroy(): void { this.createRequest?.unsubscribe(); }
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

  async createSecret() {
    if (this.isLoading || this.step !== 1) return;
    this.isLoading = true;
    this.errorMessage = '';
    this.createRequest = this.secretapi.create(this.addSecretModal).subscribe({
      next: (response) => {
        this.createdSecret = response;
        this.secretUrl = `https://stellarsecret.io/${this.secret_id}`;
        this.step = 2;
        this.isLoading = false;
      },
      error: () => {
        this.isLoading = false;
        this.errorMessage = t('failedToShareSecretMsg');
      },
      complete: () => { this.isLoading = false; },
    });
  }

  burnSecret() {
    if (this.isDeletingSecret || !this.createdSecret?.id) return;
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
      error: async () => { this.isDeletingSecret = false; },
      complete: async () => {
        this.isDeletingSecret = false;
      },
    });
  }

  async copyLink() {
    await navigator.clipboard.writeText(this.secretUrl);
    const toast = await this.toastController.create({
      message: this.allTranslations?.linkCopied,
      duration: 3000,
      position: 'bottom',
    });
    await toast.present();
  }

  async shareLinkOld() {
    if (Capacitor.getPlatform() === 'android' || Capacitor.getPlatform() === 'ios') {
      // ✅ Native share on mobile
      await Share.share({
        title: 'Stellar Secret',
        text: t('hereIsYourSecretLink'),
        url: this.secretUrl,
        dialogTitle: 'Stellar Note',
      });
    } else if ((window as any).electronAPI?.openExternal) {
      (window as any).electronAPI.openExternal(this.secretUrl);
      const toast = await this.toastController.create({
        message: t('uiLinkOpenedInYourDefaultBrowser'),
        duration: 3000,
        position: 'bottom',
      });
      await toast.present();
    } else {
      // ✅ Web fallback
      await this.copyLink();
    }
  }

  async shareLink() {
    if (navigator.share) {
      try {
        await navigator.share({
          title: this.allTranslations?.hereIsYourSecretLink,
          text: this.secretUrl
        });
        return;
      } catch (e) {
        console.log('Web share failed');
      }
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
