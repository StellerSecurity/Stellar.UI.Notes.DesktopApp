import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { SettingsNotePageRoutingModule } from './settings-note-routing.module';

import { SettingsNotePage } from './settings-note.page';
import { TranslateModule } from '@ngx-translate/core';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    SettingsNotePageRoutingModule, 
    TranslateModule
  ],
  declarations: [SettingsNotePage]
})
export class SettingsNotePageModule {}
