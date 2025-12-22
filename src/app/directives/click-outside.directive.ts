import {
  Directive,
  ElementRef,
  Output,
  EventEmitter,
  HostListener,
  NgZone,
  OnDestroy
} from '@angular/core';

@Directive({
  selector: '[appClickOutside]'
})
export class ClickOutsideDirective implements OnDestroy {
  @Output() appClickOutside = new EventEmitter<void>();
  private isListening = false;

  constructor(private elementRef: ElementRef, private ngZone: NgZone) {
    setTimeout(() => {
      this.isListening = true;
    }, 0);
  }

  @HostListener('document:click', ['$event'])
  @HostListener('document:touchstart', ['$event'])
  onGlobalClick(event: MouseEvent | TouchEvent): void {
    if (!this.isListening) return;

    const target = event.target as HTMLElement;
    if (!target) return;

    // Define elements that should NOT trigger outside click
    const exceptions = ['ion-toolbar', 'ion-header', 'ion-menu', '.non-dismissible'];

    const isException = exceptions.some(selector =>
      target.closest(selector)
    );

    if (isException) return;

    this.ngZone.run(() => {
      const clickedInside = this.elementRef.nativeElement.contains(target);
      if (!clickedInside) {
        setTimeout(() => {
          this.appClickOutside.emit();
        }, 1500)
        
      }
    });
  }

  ngOnDestroy(): void {
    this.appClickOutside.complete();
  }
}
