import { translateText as t } from '../../i18n';
import { unlockLegacyNotesKey, VaultAccessError } from '../../utils/legacy-vault-access';
import { wrapLocalAppKey, unwrapLocalAppKey } from '../../utils/local-app-key';
import { Component } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { IdentitySession } from '../../utils/stellar-id-client';
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
    let identity: IdentitySession | undefined;
    let beforeCommit: Map<string, string | null> | undefined;
    let previousToken: string | null = null;
    let rollbackRoot: string | null = null;
    try {
      const existingToken = await this.secureStorageService.getItem('ssToken');
      previousToken = existingToken;
      let previousUser: any = null;
      if (existingToken) {
        try { previousUser = JSON.parse(await this.secureStorageService.getItem('ssUser') || 'null'); } catch { /* Preserve corrupt local state. */ }
        if (!previousUser?.id) {
          this.vaultErrorKey = 'notesSignOutFirst';
          return;
        }
      }
      const result = await this.authService.signIn(loginObj.username, loginObj.password);
      const response = result.response;
      identity = result.identity;

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
        const eakB64 = identity ? btoa(String.fromCharCode(...identity.rootKey)) : await unlockLegacyNotesKey(user, notesPassword);
        if (existingToken) {
          let previousKey = await this.secureStorageService.getItem('ssEakB64');
          const wrapped = await this.secureStorageService.getItem('ssEakB64_Encrypted');
          if (!previousKey && wrapped && this.notesService.getNotesAppPassword()) {
            previousKey = await unwrapLocalAppKey(wrapped, this.notesService.getNotesAppPassword(),
              (value, password) => this.cryptoService.decrypt(value, password));
          }
          if (!previousKey && !identity) previousKey = await unlockLegacyNotesKey(previousUser, notesPassword);
          if (previousKey !== eakB64) throw new VaultAccessError('notesKeyMissing');
          rollbackRoot = previousKey;
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
        beforeCommit = new Map();
        for (const key of ['ssEakB64', 'ssEakB64_Encrypted', 'ssUser', 'ssIdentitySession', 'ssAuthVersion']) {
          beforeCommit.set(key, await this.secureStorageService.getItem(key));
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
        await this.authService.rememberSession(identity);
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
      if (!loginCompleted && beforeCommit) {
        const current = await this.secureStorageService.getItem('ssToken');
        if (current === previousToken || current === issuedToken) {
          await this.secureStorageService.removeItem('ssToken');
          this.authService.setLoggedInState(false);
          this.cryptoKeyService.clearRuntimeKeys();
          for (const [key, value] of beforeCommit) {
            if (value === null) await this.secureStorageService.removeItem(key);
            else await this.secureStorageService.setItem(key, value);
          }
          if (rollbackRoot) await this.cryptoKeyService.importEAK(rollbackRoot);
          if (previousToken) await this.secureStorageService.setItem('ssToken', previousToken);
        }
      }
      if (error instanceof VaultAccessError) {
        this.vaultErrorKey = error.translationKey;
        this.needsPreviousNotesPassword = error.translationKey === 'notesKeyUnlockFailed';
        return;
      }
      this.formError = t('uiTheRequestCouldNotBeCompletedPleaseTry');
    } finally {
      if (identity) {
        identity.rootKey.fill(0);
        if (!loginCompleted) await this.authService.revokeIdentity(identity.token).catch(() => {});
      }
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
