import { AfterViewInit, Component, OnInit } from "@angular/core";
import { NotesService } from "../services/notes.service";
import { Router } from "@angular/router";

@Component({ standalone: false,
  selector: "app-initial",
  templateUrl: "./initial.component.html",
  styleUrls: ["./initial.component.scss"],
})
export class InitialComponent implements OnInit {
  constructor(public noteService: NotesService, private router: Router) {}

  ngOnInit() {}
  newNote(): void { void this.router.navigate(['/note']); }
}
