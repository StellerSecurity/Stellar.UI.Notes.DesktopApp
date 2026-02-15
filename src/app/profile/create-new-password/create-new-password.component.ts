import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { AuthService } from 'src/app/services/auth.service';
import { ToastMessageService } from 'src/app/services/toast-message.service';
import { Location } from '@angular/common';

@Component({
  selector: 'app-create-new-password',
  templateUrl: './create-new-password.component.html',
  styleUrls: ['./create-new-password.component.scss'],
})
export class CreateNewPasswordComponent implements OnInit, OnDestroy {
  newPassword = '';
  confirmPassword = '';
  showNewPassword = false;
  showConfirmPassword = false;
  passwordForm: FormGroup;
  isSaving = false;
  confirmationCode = '';
  email = '';
  subscriptions: Subscription[] = [];

  constructor(private router: Router, private fb: FormBuilder,
    private authService: AuthService, private activatedRoute: ActivatedRoute,
    private toastMessageService: ToastMessageService, private location: Location) {}

    ngOnInit(): void {
      this.initPasswordForm();
      this.getQueryParams();
    }

    getQueryParams(): void {
      this.subscriptions.push(
        this.activatedRoute.queryParamMap.subscribe((queryParams: any) => {
          if (queryParams.has("confirmationCode")) {
            this.confirmationCode = queryParams.get("confirmationCode");
          }
          if (queryParams.has("email")) {
            this.email = queryParams.get("email");
          }
        })
      );
    }

    initPasswordForm(): void {
      this.passwordForm = this.fb.group(
        {
          password: ["", [Validators.required, Validators.minLength(6)]],
          confirmPassword: ["", Validators.required],
        },
        { validator: this.passwordMatchValidator }
      );
    }

    passwordMatchValidator(form: FormGroup) {
      const password = form.get("password")?.value;
      const confirmPassword = form.get("confirmPassword")?.value;

      if (password !== confirmPassword) {
        form.get("confirmPassword")?.setErrors({ mismatch: true });
      } else {
        form.get("confirmPassword")?.setErrors(null);
      }
    }

  toggleNewPasswordVisibility() {
    this.showNewPassword = !this.showNewPassword;
  }

  toggleConfirmPasswordVisibility() {
    this.showConfirmPassword = !this.showConfirmPassword;
  }

  confirm() {
    if (this.isSaving) return;
    if (this.passwordForm.valid) {
      this.isSaving = true;
      this.authService
        .resetPassword({
          new_password: this.passwordForm.get("password")?.value,
          confirmation_code: this.confirmationCode,
          email: this.email,
        })
        .subscribe({
          next: (response: any) => {
            this.isSaving = false;
            if (response.response_code == 200) {
              this.backToLogin();
            } else {
              this.toastMessageService.showError(response.response_message);
            }
          },
          error: (error: any) => {
            this.isSaving = false;
            this.toastMessageService.showError(error?.error?.message);
          },
        });
    }
  }

  backToLogin() {
    this.router.navigate(['/profile/login']);
  }

  goBack() {
    this.location.back();
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }
}
