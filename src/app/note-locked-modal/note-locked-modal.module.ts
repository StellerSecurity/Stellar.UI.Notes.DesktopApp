import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { NoteLockedModalComponent } from './note-locked-modal.component';
import { TranslateModule } from '@ngx-translate/core';

@NgModule({
  declarations: [NoteLockedModalComponent],
  imports: [
    CommonModule,
    IonicModule,
    TranslateModule
  ],
  exports: [NoteLockedModalComponent],
})
export class NoteLockedModalModule { }