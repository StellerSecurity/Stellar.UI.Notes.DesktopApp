import { translateText as t } from '../../i18n';
import { unlockLegacyNotesKey, VaultAccessError } from '../../utils/legacy-vault-access';
import { wrapLocalAppKey } from '../../utils/local-app-key';
import { Component } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { loginDto } from 'src/app/constants/models/authDto';
import { AuthService } from 'src/app/services/auth.service';
import { SecureStorageService } from 'src/app/services/secure-storage.service';
import { ToastMessageService } from 'src/app/services/toast-message.service';
import { NotesService } from 'src/app/services/notes.service';
import { NotesApiV1Service } from 'src/app/services/notes-api-v1.service';
import { DataService } from 'src/app/services/data.service';
import { CryptoService } from 'src/app/services/crypto.service';
import { CryptoKeyService } from 'src/app/services/crypto-key.service';
import { Location } from '@angular/common';

@Component({ standalone: false,
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss'],
})
export class LoginComponent {
  public formError = '';
  showPassword = false;
  loginForm: FormGroup;
  isSaving = false;
  vaultErrorKey = '';
  needsPreviousNotesPassword = false;

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
      notesPassword: [''],
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
            this.formError = (response.response_message) || t('uiTheRequestCouldNotBeCompletedPleaseTry');
          }
        },
        error: (error) => {
          this.isSaving = false;
          this.formError = (error?.error?.message) || t('uiTheRequestCouldNotBeCompletedPleaseTry');
        },
      });
    }
  }

  async login() {
    if (!this.loginForm.valid) return;

    if (this.isSaving) return;
    this.formError = '';

    this.isSaving = true;

    const loginObj: loginDto = {
      username: this.loginForm.get('email')?.value,
      password: this.loginForm.get('password')?.value,
    };

    let issuedToken: string | null = null;
    let loginCompleted = false;
    try {
      const existingToken = await this.secureStorageService.getItem('ssToken');
      let previousUser: any = null;
      if (existingToken) {
        try { previousUser = JSON.parse(await this.secureStorageService.getItem('ssUser') || 'null'); } catch { /* Preserve corrupt local state. */ }
        if (!previousUser?.id) {
          this.vaultErrorKey = 'notesSignOutFirst';
          return;
        }
      }
      let response: any = await firstValueFrom(this.authService.loginHandling(loginObj));

      if (response.response_code === 200) {
        if (typeof response.token !== 'string' || !response.token) throw new Error('Invalid login response');
        const user = response.user;
        if (existingToken && String(previousUser.id) !== String(user?.id)) {
          this.vaultErrorKey = 'notesSignOutFirst';
          return;
        }
        // Authentication and Notes unlocking are separate. The previous Notes
        // password is used locally and is never included in the login request.
        const notesPassword = this.loginForm.get('notesPassword')?.value || loginObj.password;
        const eakB64 = await unlockLegacyNotesKey(user, notesPassword);
        if (existingToken && await unlockLegacyNotesKey(previousUser, notesPassword) !== eakB64) {
          throw new VaultAccessError('notesKeyMissing');
        }
        // Reauthentication must preserve the account/key behind pending offline
        // edits. Refuse an account switch while another session is still present.
        if (await this.secureStorageService.getItem('ssToken') !== existingToken) {
          this.vaultErrorKey = 'notesSignOutFirst';
          return;
        }
        if (this.notesService.appHasPasswordChallenge() && !this.notesService.getNotesAppPassword()) {
          this.vaultErrorKey = 'notesUnlockAppFirst';
          return;
        }
        await this.cryptoKeyService.importEAK(eakB64);

        // optional app-locker layer
        if (this.notesService.appHasPasswordChallenge()) {
          const wrappedEak = await wrapLocalAppKey(eakB64, this.notesService.getNotesAppPassword());
          await this.secureStorageService.setItem('ssEakB64_Encrypted', wrappedEak);
          await this.secureStorageService.removeItem('ssEakB64');
        } else {
          await this.secureStorageService.setItem('ssEakB64', eakB64);
          await this.secureStorageService.removeItem('ssEakB64_Encrypted');
        }

        // Publish the sync session only after its key and account are stored.
        await this.secureStorageService.setItem('ssUser', JSON.stringify(user));
        issuedToken = response.token;
        await this.secureStorageService.setItem('ssToken', response.token);
        loginCompleted = true;
        this.vaultErrorKey = '';
        this.needsPreviousNotesPassword = false;
        this.loginForm.get('notesPassword')?.reset('');
        this.loginForm.get('password')?.reset('');

        let notes = this.notesService.getNotes();

        // user has app-locker enabled.
        if (this.notesService.getDecryptedNotes() !== null) {
          notes = this.notesService.getDecryptedNotes();
        }

        loginCompleted = true;
        this.authService.setLoggedInState(true);
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
        this.formError = (response.response_message) || t('uiTheRequestCouldNotBeCompletedPleaseTry');
      }
    } catch (error: any) {
      if (!loginCompleted && issuedToken && await this.secureStorageService.getItem('ssToken') === issuedToken) {
        await this.secureStorageService.removeItem('ssToken');
        this.cryptoKeyService.clearRuntimeKeys();
        this.authService.setLoggedInState(false);
      }
      if (error instanceof VaultAccessError) {
        this.vaultErrorKey = error.translationKey;
        this.needsPreviousNotesPassword = error.translationKey === 'notesKeyUnlockFailed';
        return;
      }
      this.formError = t('uiTheRequestCouldNotBeCompletedPleaseTry');
    } finally {
      this.isSaving = false;

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
