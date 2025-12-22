import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { ResetPassModalComponent } from './resetpass-modal.component';
import { TranslateModule } from '@ngx-translate/core';

@NgModule({
  declarations: [ResetPassModalComponent],
  imports: [
    CommonModule,
    IonicModule,
    TranslateModule
  ],
  exports: [ResetPassModalComponent],
})
export class RestPassModalModule { }