import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { ProfileComponent } from './profile.component';
import { LoginComponent } from './login/login.component';
import { CreateAccountComponent } from './create-account/create-account.component';
import { ForgotPasswordComponent } from './forgot-password/forgot-password.component';
import { CreateNewPasswordComponent } from './create-new-password/create-new-password.component';

const routes: Routes = [
  {
    path: '',
    component: ProfileComponent
  },
  {
    path: 'login',
    component: LoginComponent
  },
  {
    path: 'create-account',
    component: CreateAccountComponent
  },
  {
    path: 'forgot-password',
    component: ForgotPasswordComponent
  },

  {
    path: 'create-new-password',
    component: CreateNewPasswordComponent
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class ProfileRoutingModule { }
