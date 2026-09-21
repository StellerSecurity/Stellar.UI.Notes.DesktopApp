import { Injectable } from '@angular/core';
import { IPasswordStrengthMeterService } from 'angular-password-strength-meter';
import { zxcvbn } from '@zxcvbn-ts/core';

@Injectable()
export class PsmZxcvbnService extends IPasswordStrengthMeterService {
  score(password: string): number {
    return zxcvbn(password ?? '').score;
  }

  scoreWithFeedback(password: string): { score: number; feedback: { warning: string; suggestions: string[] } } {
    const res = zxcvbn(password ?? '');
    return {
      score: res.score,
      feedback: {
        warning: res.feedback?.warning ?? '',
        suggestions: res.feedback?.suggestions ?? [],
      },
    };
  }

  async scoreAsync(password: string): Promise<number> {
    return this.score(password);
  }

  async scoreWithFeedbackAsync(password: string): Promise<{ score: number; feedback: { warning: string; suggestions: string[] } }> {
    return this.scoreWithFeedback(password);
  }
}
