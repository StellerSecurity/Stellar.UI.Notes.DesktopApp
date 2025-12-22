import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { ProfileRoutingModule } from './profile-routing.module';
import { ProfileComponent } from './profile.component';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';
import { LoginComponent } from './login/login.component';
import { CreateAccountComponent } from './create-account/create-account.component';
import { ForgotPasswordComponent } from './forgot-password/forgot-password.component';
import { CreateNewPasswordComponent } from './create-new-password/create-new-password.component';
import { NgOtpInputModule } from 'ng-otp-input';


@NgModule({
  declarations: [ProfileComponent, LoginComponent, CreateAccountComponent, 
    ForgotPasswordComponent, CreateNewPasswordComponent],
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    IonicModule,
    ProfileRoutingModule,
    TranslateModule,
    NgOtpInputModule
  ]
})
export class ProfileModule { }
