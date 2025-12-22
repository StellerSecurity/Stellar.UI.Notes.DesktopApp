import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { AppSettingsPageRoutingModule } from './app-settings-routing.module';

import { AppSettingsPage } from './app-settings.page';
import {PasswordStrengthMeterModule} from "angular-password-strength-meter";
import { ConfirmationModalModule } from '../confirmation-modal/confirmation-modal.module';
import { DeleteNoteModalModule } from '../delete-note-modal/delete-note-modal.module';
import { TranslateModule } from '@ngx-translate/core';
@NgModule({
    imports: [
        CommonModule,
        FormsModule,
        IonicModule,
        AppSettingsPageRoutingModule,
        PasswordStrengthMeterModule,
        ConfirmationModalModule,
        DeleteNoteModalModule,
        TranslateModule
    ],
  declarations: [AppSettingsPage]
})
export class AppSettingsPageModule {}
