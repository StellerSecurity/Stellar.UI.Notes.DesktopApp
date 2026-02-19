import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { FormsModule } from '@angular/forms';

import { HomePage } from './home.page';
import { HomePageRoutingModule } from './home-routing.module';
import { DeleteNoteModalModule } from '../delete-note-modal/delete-note-modal.module';
import { RestPassModalModule } from '../restpass-modal/resetpass-modal.module';
import { TranslateModule } from '@ngx-translate/core';
import {AppModule} from "../app.module";
import {StriphtmlPipe} from "../striphtml.pipe";
import { ClickOutsideDirective } from '../directives/click-outside.directive';
import { AddNotePage } from '../add-note/add-note.page';
import { PasswordStrengthMeterModule } from 'angular-password-strength-meter';
import { AngularEditorModule } from '@wfpena/angular-wysiwyg';
import { NoteLockedModalModule } from '../note-locked-modal/note-locked-modal.module';
import { RichTextEditorComponent } from '../add-note/rich-text-editor/rich-text-editor.component';
import { InitialComponent } from '../initial/initial.component';
import { NoteContextMenuComponent } from './note-context-menu/note-context-menu.component';

@NgModule({
    imports: [
        CommonModule,
        FormsModule,
        IonicModule,
        HomePageRoutingModule,
        PasswordStrengthMeterModule,
        NoteLockedModalModule,
        AngularEditorModule,
        DeleteNoteModalModule,
        RestPassModalModule,
        TranslateModule
    ],
    declarations: [HomePage, AddNotePage, RichTextEditorComponent,  StriphtmlPipe, ClickOutsideDirective, InitialComponent, NoteContextMenuComponent]
})
export class HomePageModule {}
