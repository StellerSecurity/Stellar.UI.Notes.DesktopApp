import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { HomePage } from './home.page';
import { InitialComponent } from '../initial/initial.component';

const routes: Routes = [
  {
    path: '',
    component: HomePage,
    children: [
      {
        path: 'home',
        component: InitialComponent
      },
      {
        path: 'note',
        loadChildren: () =>
          import('../add-note/add-note.module').then(m => m.AddNotePageModule)
      },
      {
        path: 'note/:id',
        loadChildren: () =>
          import('../add-note/add-note.module').then(m => m.AddNotePageModule)
      },
      {
        path: 'dummy-route',
        component: HomePage,
      },
      {
        path: '',
        redirectTo: 'home',
        pathMatch: 'full'
      }
    ]
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class HomePageRoutingModule {}
