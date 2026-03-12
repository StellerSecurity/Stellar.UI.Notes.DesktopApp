import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { App } from '@capacitor/app';
import { NotesService } from './notes.service';

@Injectable({
  providedIn: 'root'
})
export class AppProtectorService {
  constructor(
    private noteService: NotesService,
    private router: Router
  ) {}

  public init() {
    this.checkForInActivity();
  }

  private checkForInActivity() {
    const lastActivityTime = this.noteService.getLastActivityTimestamp();

    if (lastActivityTime !== 0) {
      const currentTimestamp = Date.now();

      // Inactive for 60 minutes.
      if (lastActivityTime <= currentTimestamp - (60 * 60000)) {
        this.noteService.setNotesAppPassword('');
        this.router.navigateByUrl('/');
        return;
      }
    }

    App.getState().then(data => {
      if (data.isActive) {
        this.noteService.setLastActivityTimestamp(Date.now());
      }
    });

    setTimeout(() => {
      this.checkForInActivity();
    }, 1000);
  }
}
