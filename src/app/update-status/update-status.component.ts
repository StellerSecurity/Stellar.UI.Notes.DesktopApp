import { CommonModule } from '@angular/common';
import { Component, Injectable, NgZone, OnDestroy } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';
import { BehaviorSubject } from 'rxjs';

type UpdatePhase = 'idle' | 'downloading' | 'verifying' | 'installing' | 'error';
interface UpdateStatus { phase: UpdatePhase; percent: number | null; }
const phases = new Set(['idle', 'downloading', 'verifying', 'installing', 'error']);

@Injectable({ providedIn: 'root' })
export class DesktopUpdateService implements OnDestroy {
  private readonly state = new BehaviorSubject<UpdateStatus>({ phase: 'idle', percent: null });
  readonly status$ = this.state.asObservable();
  private dispose?: () => void;
  private destroyed = false;
  constructor(zone: NgZone) {
    const api = (window as any).electronAPI;
    if (!api?.getUpdateStatus || !api?.onUpdateStatus) return;
    let receivedEvent = false;
    const apply = (value: any) => {
      if (this.destroyed || !value || !phases.has(value.phase)) return;
      const percent = value.phase === 'downloading' && typeof value.percent === 'number' && Number.isFinite(value.percent)
        ? Math.round(Math.max(0, Math.min(100, value.percent))) : null;
      zone.run(() => this.state.next({ phase: value.phase, percent }));
    };
    this.dispose = api.onUpdateStatus((value: unknown) => { receivedEvent = true; apply(value); });
    // Subscribe first; a delayed initial snapshot must not replace newer progress.
    Promise.resolve(api.getUpdateStatus()).then(value => { if (!receivedEvent) apply(value); }).catch(() => {});
  }
  ngOnDestroy(): void { this.destroyed = true; this.dispose?.(); this.state.complete(); }
}

@Component({
  selector: 'app-update-status', standalone: true,
  imports: [CommonModule, IonicModule, TranslateModule],
  template: `
    <ng-container *ngIf="updates.status$ | async as status">
      <section class="update-status" *ngIf="status.phase !== 'idle'" role="status" aria-live="polite">
        <div class="update-heading">
          <ion-icon [name]="status.phase === 'error' ? 'alert-circle-outline' : status.phase === 'downloading' ? 'download-outline' : 'sync-outline'" aria-hidden="true"></ion-icon>
          <strong>{{ (status.phase === 'error' ? 'updateStatusError' : status.phase === 'downloading' ? 'updateStatusDownloading' : status.phase === 'verifying' ? 'updateStatusVerifying' : 'updateStatusInstalling') | translate }}</strong>
          <span class="percentage" *ngIf="status.phase === 'downloading' && status.percent !== null">{{status.percent}} %</span>
        </div>
        <div class="update-track" *ngIf="status.phase === 'downloading'" role="progressbar" [attr.aria-label]="'updateStatusDownloading' | translate" [attr.aria-valuenow]="status.percent" aria-valuemin="0" aria-valuemax="100" [class.indeterminate]="status.percent === null">
          <div [style.width.%]="status.percent === null ? 35 : status.percent"></div>
        </div>
        <p>{{ (status.phase === 'error' ? 'updateStatusErrorHint' : status.phase === 'installing' ? 'updateStatusRestartHint' : 'updateStatusAutomaticHint') | translate }}</p>
      </section>
    </ng-container>`,
  styles: [`
    :host { display:block; flex-shrink:0; }
    .update-status { margin:12px; padding:12px; border-radius:11px; background:#e9edfc; color:#10111e; }
    .update-heading { display:flex; align-items:center; gap:7px; font-size:11px; }
    ion-icon { color:#2d5fff; font-size:16px; flex-shrink:0; }
    strong { flex:1; font-weight:500; overflow-wrap:anywhere; }
    .percentage { font-size:11px; color:#575d76; font-variant-numeric:tabular-nums; white-space:nowrap; }
    .update-track { height:3px; background:#d3dcf5; border-radius:3px; margin:11px 0 9px; overflow:hidden; }
    .update-track > div { height:100%; background:#2d5fff; border-radius:3px; transition:width 160ms linear; }
    .indeterminate > div { animation:update-progress 1.4s ease-in-out infinite; }
    p { font-size:11px; color:#646a80; line-height:1.5; margin:8px 0 0; }
    @keyframes update-progress { from { transform:translateX(-100%); } to { transform:translateX(290%); } }
    @media(prefers-reduced-motion:reduce) { .update-track > div { transition:none; animation:none; } }
  `]
})
export class UpdateStatusComponent {
  constructor(public updates: DesktopUpdateService) {}
}
