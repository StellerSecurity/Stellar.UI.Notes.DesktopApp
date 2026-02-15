import { Component } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { loginDto } from 'src/app/constants/models/authDto';
import { AuthService } from 'src/app/services/auth.service';
import { SecureStorageService } from 'src/app/services/secure-storage.service';
import { ToastMessageService } from 'src/app/services/toast-message.service';
import {
  createVault,
  exportServerBundleFromHeader,
  extractPlainEAK,
  ServerBundle,
} from '@stellarsecurity/stellar-crypto';
import { NotesService } from 'src/app/services/notes.service';
import { NotesApiV1Service } from 'src/app/services/notes-api-v1.service';
import { DataService } from 'src/app/services/data.service';
import { CryptoService } from 'src/app/services/crypto.service';
import { CryptoKeyService } from 'src/app/services/crypto-key.service';
import { Location } from '@angular/common';

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss'],
})
export class LoginComponent {
  showPassword = false;
  loginForm: FormGroup;
  isSaving = false;

  constructor(
    private router: Router,
    private fb: FormBuilder,
    private authService: AuthService,
    private toastMessageService: ToastMessageService,
    private secureStorageService: SecureStorageService,
    private notesService: NotesService,
    private notesApiV1Service: NotesApiV1Service,
    private dataService: DataService,
    private cryptoService: CryptoService,
    private cryptoKeyService: CryptoKeyService,
    private location: Location
  ) {}

  ngOnInit(): void {
    this.initLoginForm();
  }

  initLoginForm(): void {
    this.loginForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required]],
    });
  }

  togglePasswordVisibility() {
    this.showPassword = !this.showPassword;
  }

  loginOld() {
    if (this.loginForm.valid) {
      this.isSaving = true;
      const loginObj: loginDto = {
        username: this.loginForm.get('email')?.value,
        password: this.loginForm.get('password')?.value,
      };

      this.authService.loginHandling(loginObj).subscribe({
        next: (response: any) => {
          this.isSaving = false;
          if (response.response_code == 200) {
            // this.localStorageService.storeToLocalStorage("ssToken", response.token);
            // this.toastrService.success(this.translatorService.allTranslations.loggedInSuccessfully);
            this.router.navigate(['/']);
          } else {
            this.toastMessageService.showError(response.response_message);
          }
        },
        error: (error) => {
          this.isSaving = false;
          this.toastMessageService.showError(error?.error?.message);
        },
      });
    }
  }

  async login() {
    if (!this.loginForm.valid) return;

    if (this.isSaving) return;

    this.isSaving = true;

    const loginObj: loginDto = {
      username: this.loginForm.get('email')?.value,
      password: this.loginForm.get('password')?.value,
    };

    try {
      let response: any = await firstValueFrom(this.authService.loginHandling(loginObj));

      if (response.response_code === 200) {
        await this.secureStorageService.setItem('ssToken', response.token);

        // the user does not have any eak.. kdf etc, can be for several reasons:
        // user created their stellar id on stellarsecurity.com or other places, so it was not needed.
        // let's do it now using the public SDK.
        if (response.user.eak_b64 == null) {
          // 🔐 Create fresh vault & bundle via SDK
          const { header } = await createVault(loginObj.password);
          const bundle = exportServerBundleFromHeader(header);

          const payload = {
            ...bundle,
          };

          // send bundle to backend so it can patch the user with E2EE data
          await this.authService.updateEak(payload);

          // mirror updated crypto fields locally on response.user
          response.user.crypto_version = payload.crypto_version;
          response.user.kdf_params = payload.kdf_params;
          response.user.kdf_salt_b64 = payload.kdf_salt;
          response.user.eak_b64 = payload.eak;
        }

        const user = response.user;
        await this.secureStorageService.setItem('ssUser', JSON.stringify(user));

        const bundle: ServerBundle = {
          crypto_version: user.crypto_version,
          kdf_params: user.kdf_params, // { algo:'PBKDF2', hash:'SHA-256', iters: 210000 }
          kdf_salt: user.kdf_salt_b64, // base64
          eak: user.eak_b64, // base64(IV||CT)
        };

        // 🔓 Derive plaintext EAK from bundle with SDK
        const { eakB64: derivedEakB64 } = await extractPlainEAK(loginObj.password, bundle);
        let eakB64 = derivedEakB64;

        // Import EAK into runtime crypto (MK in RAM for immediate use)
        await this.cryptoKeyService.importEAK(eakB64);

        // optional app-locker layer
        if (this.notesService.appHasPasswordChallenge()) {
          this.cryptoService.encrypt(eakB64, this.notesService.getNotesAppPassword());
          await this.secureStorageService.setItem('ssEakB64_Encrypted', eakB64);
        } else {
          await this.secureStorageService.setItem('ssEakB64', eakB64);
        }

        let notes = this.notesService.getNotes();

        // user has app-locker enabled.
        if (this.notesService.getDecryptedNotes() !== null) {
          notes = this.notesService.getDecryptedNotes();
        }

        this.dataService.setForceDownloadOnHome(true);

        if (notes.length === 0) {
          await this.router.navigate(['/']);
        } else {
          try {
            await this.notesApiV1Service.upload(0, JSON.parse(notes));
            console.log('Notes sent.');
          } catch (err) {
            console.log('notes error.', err);
          } finally {
            await this.router.navigate(['/']);
          }
        }
      } else {
        await this.toastMessageService.showError(response.response_message);
      }
    } catch (error: any) {
      console.log(error);
      await this.toastMessageService.showError('Something went wrong');
    } finally {
      this.isSaving = false;
      await this.authService.initializeAuthState();
    }
  }

  navigateToRegister() {
    this.router.navigate(['/profile/create-account']);
  }

  forgotPassword() {
    this.router.navigate(['/profile/forgot-password']);
  }

  backToApp() {
    this.router.navigate(['/']);
  }

  goBack() {
    this.location.back();
  }
}
