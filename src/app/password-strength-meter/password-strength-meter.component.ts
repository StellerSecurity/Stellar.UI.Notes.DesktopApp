import { TranslateModule } from '@ngx-translate/core';
import { Component, Input } from '@angular/core';
import { PsmZxcvbnService } from '../services/psm-zxcvbn.service';

/** Local-only score display using the existing password estimator. */
@Component({
  selector: 'password-strength-meter',
  standalone: true,
  imports: [TranslateModule],
  template: `<meter min="0" max="4" low="2" high="3" optimum="4"
    [value]="score" [hidden]="!hasPassword" [attr.aria-label]="'passwordStrength' | translate"></meter>`,
  styles: [`:host { display: block; } meter { width: 100%; height: 0.75rem; }`],
})
export class PasswordStrengthMeterComponent {
  score = 0;
  hasPassword = false;

  constructor(private readonly estimator: PsmZxcvbnService) {}

  @Input() set password(value: string | null | undefined) {
    this.hasPassword = !!value;
    this.score = this.hasPassword ? this.estimator.score(value!) : 0;
  }
}
