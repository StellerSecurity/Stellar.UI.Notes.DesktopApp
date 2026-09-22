import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { AddNotePageRoutingModule } from './add-note-routing.module';

import { AddNotePage } from './add-note.page';
import {PasswordStrengthMeterModule} from "angular-password-strength-meter";
import { NoteLockedModalModule } from '../note-locked-modal/note-locked-modal.module';
import { DeleteNoteModalModule } from '../delete-note-modal/delete-note-modal.module';
import { QuillModule } from 'ngx-quill';
import { TranslateModule } from '@ngx-translate/core';
import { RichTextEditorComponent } from './rich-text-editor/rich-text-editor.component';
@NgModule({
    imports: [
        CommonModule,
        FormsModule,
        IonicModule,
        AddNotePageRoutingModule,
        PasswordStrengthMeterModule,
        NoteLockedModalModule,
        DeleteNoteModalModule,
        QuillModule,
        TranslateModule
    ],
  // declarations: [AddNotePage, RichTextEditorComponent]
})
export class AddNotePageModule {}
