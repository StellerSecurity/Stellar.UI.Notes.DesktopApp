import { Injectable } from '@angular/core';
import {NotesService} from "./notes.service";
import { App } from '@capacitor/app';

@Injectable({
  providedIn: 'root'
})
export class AppProtectorService {
  constructor(private noteService: NotesService) { }
  public init() {
    this.checkForInActivity();
  }
  private checkForInActivity() {

    let last_activity_time = this.noteService.getLastActivityTimestamp();

    if(last_activity_time !== 0) {
      let current_timestamp = Date.now();
      // inactive for 60 minutes, close the app. (clearing services for data).
      // 600000 = 1 minute in MS.
      if(last_activity_time <= current_timestamp - (60 * 60000)) {
        this.noteService.setNotesAppPassword("");
        window.location.href = '/';
      }
    }

    App.getState().then(data => {
      if(data.isActive) {
        this.noteService.setLastActivityTimestamp(Date.now());
      }
    });

    setTimeout(() => { this.checkForInActivity() }, 1000);
  }
}
