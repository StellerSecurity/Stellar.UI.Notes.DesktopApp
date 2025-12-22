import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { SettingsNotePage } from './settings-note.page';

const routes: Routes = [
  {
    path: '',
    component: SettingsNotePage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class SettingsNotePageRoutingModule {}
