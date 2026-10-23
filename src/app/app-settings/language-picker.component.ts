import { CommonModule } from '@angular/common';
import { Component, ElementRef, EventEmitter, Input, Output, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { APP_LANGUAGES } from '../i18n';

const englishNames: Record<string,string> = {en:'English',da:'Danish',de:'German',tr:'Turkish',es:'Spanish',sv:'Swedish',nb:'Norwegian Bokmål no',fr:'French',it:'Italian',nl:'Dutch',pl:'Polish','pt-BR':'Portuguese Brazil Brazilian'};
const normalize = (value: string) => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ı/g,'i').replace(/ł/g,'l');

@Component({
  selector:'app-language-picker', standalone:true,
  imports:[CommonModule, FormsModule, IonicModule, TranslateModule],
  template:`
    <button #trigger class="language-trigger" type="button" (click)="show($event)" (keydown.arrowdown)="show($event); $event.preventDefault()"
      aria-haspopup="dialog" [attr.aria-expanded]="opened" [attr.aria-label]="('language' | translate) + ': ' + selectedLabel">
      <span>{{selectedLabel}}</span><ion-icon name="chevron-expand-outline" aria-hidden="true"></ion-icon>
    </button>
    <ion-popover [isOpen]="opened" [event]="anchor" [showBackdrop]="true" class="language-picker-popover" side="bottom" alignment="start"
      (didPresent)="focusSearch($event)" (didDismiss)="dismissed()">
      <ng-template>
        <section class="language-menu" role="dialog" [attr.aria-label]="'language' | translate">
          <div class="language-search">
            <ion-icon name="search-outline" aria-hidden="true"></ion-icon>
            <input type="text" role="combobox" autocomplete="off" autocapitalize="off" spellcheck="false" aria-autocomplete="list" aria-expanded="true"
              aria-controls="language-options" [attr.aria-activedescendant]="filtered[activeIndex] ? 'language-option-' + filtered[activeIndex].code : null"
              [attr.aria-label]="'searchLanguages' | translate" [placeholder]="'searchLanguages' | translate"
              [ngModel]="query" (ngModelChange)="search($event)" (keydown)="onKeydown($event)" />
          </div>
          <div id="language-options" class="language-options" role="listbox" [attr.aria-label]="'language' | translate">
            <button *ngFor="let item of filtered; let i = index" class="language-option" [class.active]="i === activeIndex" type="button" role="option" tabindex="-1"
              [id]="'language-option-' + item.code" [attr.aria-selected]="value === item.code" (mouseenter)="activeIndex = i" (mousedown)="$event.preventDefault()" (click)="choose(item.code)">
              <span class="language-option-text" [attr.lang]="item.code === 'system' ? null : item.code">{{item.name}}</span>
              <ion-icon *ngIf="value === item.code" name="checkmark-outline" aria-hidden="true"></ion-icon>
            </button>
          </div>
          <p *ngIf="!filtered.length" class="language-no-results" role="status">{{'noLanguagesFound' | translate}}</p>
        </section>
      </ng-template>
    </ion-popover>`,
  styleUrls:['./language-picker.component.scss']
})
export class LanguagePickerComponent {
  @Input() value = 'system';
  @Output() valueChange = new EventEmitter<string>();
  @ViewChild('trigger', {static:true}) trigger!: ElementRef<HTMLButtonElement>;
  opened = false;
  anchor?: Event;
  query = '';
  activeIndex = 0;
  private menu?: HTMLElement;
  constructor(private translate: TranslateService) {}
  get choices() { return [{code:'system', name:this.translate.instant('systemLanguage') as string}, ...APP_LANGUAGES]; }
  get selectedLabel() { return this.choices.find(item => item.code === this.value)?.name || 'English'; }
  get filtered() {
    const query = normalize(this.query.trim());
    return this.choices.filter(item => normalize(`${item.name} ${item.code} ${englishNames[item.code] || 'system automatic'}`).includes(query));
  }
  show(event: Event): void {
    this.anchor = {target:this.trigger.nativeElement} as unknown as Event; this.query = ''; this.opened = true;
    this.activeIndex = Math.max(0,this.choices.findIndex(item => item.code === this.value));
  }
  focusSearch(event: Event): void {
    this.menu = event.target as HTMLElement;
    this.menu.querySelector('input')?.focus(); this.scrollActive();
  }
  search(query: string): void { this.query = query; this.activeIndex = 0; }
  choose(code: string): void {
    if (!this.choices.some(item => item.code === code)) return;
    this.valueChange.emit(code); this.opened = false;
  }
  dismissed(): void {
    this.opened = false; this.menu = undefined;
    // Ionic removes its focus trap after didDismiss; restore focus on the next frame.
    requestAnimationFrame(() => { if (!this.opened && this.trigger.nativeElement.isConnected) this.trigger.nativeElement.focus(); });
  }
  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.opened = false; return; }
    const count = this.filtered.length;
    if (event.key === 'Enter') {
      event.preventDefault(); if (count) this.choose(this.filtered[this.activeIndex].code); return;
    }
    if (!['ArrowDown','ArrowUp','Home','End'].includes(event.key) || !count) return;
    event.preventDefault();
    this.activeIndex = event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : (this.activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + count) % count;
    this.scrollActive();
  }
  private scrollActive(): void { this.menu?.querySelectorAll('.language-option')[this.activeIndex]?.scrollIntoView({block:'nearest'}); }
}
