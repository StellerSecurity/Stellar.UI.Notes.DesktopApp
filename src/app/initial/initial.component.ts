import { AfterViewInit, Component, OnInit } from "@angular/core";
import { NotesService } from "../services/notes.service";
import { Router } from "@angular/router";

@Component({
  selector: "app-initial",
  templateUrl: "./initial.component.html",
  styleUrls: ["./initial.component.scss"],
})
export class InitialComponent implements OnInit {
  constructor(public noteService: NotesService, private router: Router) {}

  ngOnInit() {
    const notes = JSON.parse(this.noteService.getNotes()) || [];
    const recentOpenedNoteId = localStorage.getItem("recentOpenedNoteId");

    if (recentOpenedNoteId && notes.length > 0) {
      const recentNote = notes?.find(
        (note: any) => String(note.id) === String(recentOpenedNoteId)
      );

      setTimeout(() => {
        if (recentNote?.id) {
          // 🔑 Navigate to note detail
          this.router.navigate(["/note", recentNote.id]);
        }
      }, 300)

     
    }
  }
}
