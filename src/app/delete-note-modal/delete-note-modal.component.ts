import { Component, ElementRef, Input, ViewChild } from '@angular/core';
import { ModalController } from '@ionic/angular';

@Component({ standalone: false,
  selector: 'app-delete-note-modal',
  templateUrl: './delete-note-modal.component.html',
  styleUrls: ['./delete-note-modal.component.scss'],
})
export class DeleteNoteModalComponent {
  @ViewChild('confirmDeleteButton') confirmDeleteButton?: ElementRef<HTMLButtonElement>;
  private dismissing = false;
  ionViewDidEnter(): void { this.confirmDeleteButton?.nativeElement.focus({preventScroll:true}); }
  @Input() recoverable = false;
  @Input() count = 0;
  @Input() isSingleDelete: boolean = false; 

  constructor(private modalCtrl: ModalController) { }

  // Dismiss the modal with the confirmation result
  public dismiss(confirm: boolean): void {
    if (this.dismissing) return;
    this.dismissing = true;
    void this.modalCtrl.dismiss({ confirm });
  }
  
}