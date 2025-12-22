import { NgModule } from '@angular/core';
import { PreloadAllModules, RouterModule, Routes } from '@angular/router';

const routes: Routes = [
  {
    path: '',
    loadChildren: () => import('./home/home.module').then( m => m.HomePageModule)
  },
  // {
  //   path: 'note',
  //   loadChildren: () => import('./add-note/add-note.module').then( m => m.AddNotePageModule)
  // },
  // {
  //   path: 'note/:id',
  //   loadChildren: () => import('./add-note/add-note.module').then( m => m.AddNotePageModule)
  // },
  {
    path: 'settings-note/:id',
    loadChildren: () => import('./settings-note/settings-note.module').then( m => m.SettingsNotePageModule)
  },
  {
    path: 'app-settings',
    loadChildren: () => import('./app-settings/app-settings.module').then( m => m.AppSettingsPageModule)
  },
  {
    path: 'account/login',
    loadChildren: () => import('./app-settings/app-settings.module').then( m => m.AppSettingsPageModule)
  },
  {
    path: 'profile',
    loadChildren: () => import('./profile/profile.module').then( m => m.ProfileModule)
  }
];

@NgModule({
  imports: [
    RouterModule.forRoot(routes, { preloadingStrategy: PreloadAllModules })
  ],
  exports: [RouterModule]
})
export class AppRoutingModule { }
