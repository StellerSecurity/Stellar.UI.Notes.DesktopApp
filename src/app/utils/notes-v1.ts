// utils/notes-v1.ts
import {NoteV1} from "../models/NoteV1";

export function normalize(s: string): string {
    return (s ?? "")
        .replace(/\r\n/g, "\n")
        .replace(/\s+\n/g, "\n")
        .trim();
}

export function sameContentAkaV1(a: NoteV1, b: NoteV1): boolean {
    return normalize(a.title) === normalize(b.title)
        && normalize(a.text)  === normalize(b.text)
        && !!a.deleted === !!b.deleted; // optional in V1; keep if you want deletes unique
}
