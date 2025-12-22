import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { DeleteNoteModalComponent } from './delete-note-modal.component';
import { TranslateModule } from '@ngx-translate/core';

@NgModule({
  declarations: [DeleteNoteModalComponent],
  imports: [
    CommonModule,
    IonicModule,
    TranslateModule
  ],
  exports: [DeleteNoteModalComponent],
})
export class DeleteNoteModalModule { }