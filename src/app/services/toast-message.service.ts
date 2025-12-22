import { Injectable } from '@angular/core';
import { ToastController } from '@ionic/angular';

@Injectable({
  providedIn: 'root'
})
export class ToastMessageService {

  constructor(private toastController: ToastController) { }

  async showSuccess(message: string = 'Operation Successful!') {
    const toast = await this.toastController.create({
      message: message,
      duration: 3000,
      position: 'top',
      color: 'success'
    });
    await toast.present();
  }

  async showError(message: string = 'Operation Failed!') {
    const toast = await this.toastController.create({
      message: message,
      duration: 3000,
      position: 'top',
      color: 'danger'
    });
    await toast.present();
  }

}
