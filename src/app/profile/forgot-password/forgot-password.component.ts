import { translateText as t } from '../../i18n';
import { Component, OnInit } from "@angular/core";
import { FormBuilder, FormGroup, Validators } from "@angular/forms";
import { Router } from "@angular/router";
import { AuthService } from "src/app/services/auth.service";
import { ToastMessageService } from "src/app/services/toast-message.service";
import { Location } from '@angular/common';

@Component({ standalone: false,
  selector: "app-forgot-password",
  templateUrl: "./forgot-password.component.html",
  styleUrls: ["./forgot-password.component.scss"],
})
export class ForgotPasswordComponent implements OnInit {
  email = "email";
  showVerification = false;
  otpValue = "";
  otpConfig = {
    length: 6,
    inputClass: "bottom-border-otp", // must match your CSS class
    allowNumbersOnly: false,
    isPasswordInput: false,
    disableAutoFocus: false,
    placeholder: " ",
  };
  forgotPasswordForm: FormGroup;
  isProcessing = false;
  codeError = '';
  codeNotice = '';
  resendAfter = 0;

  constructor(private router: Router, private fb: FormBuilder, private authService: AuthService,
    private toastMessageService: ToastMessageService, private location: Location) {}

  ngOnInit(): void {
    this.initForgotPasswordForm();
  }

  initForgotPasswordForm(): void {
    this.forgotPasswordForm = this.fb.group({
      email: ["", [Validators.required, Validators.email]],
    });
  }

  sendCode() {
    // Optionally call API to send code to this.email
    if (this.isProcessing) return;

    if (this.forgotPasswordForm.valid) {
      this.email = this.forgotPasswordForm.get('email')?.value;
      this.isProcessing = true;
      this.codeError = ''; this.codeNotice = '';
      this.authService.forgotPassword(this.forgotPasswordForm.get('email')?.value).subscribe({
        next: (response) => {
          this.isProcessing = false;
          if (response.response_code == 200) {
            this.codeNotice = this.showVerification ? t('uiANewCodeHasBeenSent') : '';
            this.showVerification = true;
            this.resendAfter = Date.now() + 30000;
          } else {
            this.codeError = response.response_message || t('uiTheCodeCouldNotBeSentPleaseTry');
          }
        },
        error: (error) => {
          this.isProcessing = false;
          this.codeError = error?.error?.message || t('uiTheCodeCouldNotBeSentPleaseTry');
        }
      })
    }
  }

  resendCode() {
    if (this.isProcessing || Date.now() < this.resendAfter) return;
    this.sendCode();
  }

  useDifferentEmail() {
    this.showVerification = false;
  }

  continueWithCode(): void {
    if (this.otpValue.length !== 6) { this.codeError = t('uiEnterTheSixCharacterCode'); return; }
    // The reset API validates the code. Keep it out of the URL and server request logs.
    void this.router.navigate(['/profile/create-new-password'], { state: { email: this.email, confirmationCode: this.otpValue } });
  }

  onOtpChange(value: string) {
    this.otpValue = value;
  }

  goToBack(): void {
    if (!this.showVerification) {
      // this.router.navigate(["/profile/login"]);
      this.location.back();
    } else {
      this.showVerification = false;
    }
  }
}
