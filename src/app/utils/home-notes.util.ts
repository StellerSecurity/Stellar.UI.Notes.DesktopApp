import {NotesService} from "../services/notes.service";
import {CryptoService} from "../services/crypto.service";


/**
 * Mirrors your setData() internals; returns parsed notes & also updates NotesService
 * to keep identical side-effects while keeping the logic in one place.
 */
export function setDecryptedNotesAndParse(
  noteService: NotesService,
  cryptoService: CryptoService,
  appPassword: string
): { parsed: any[] | null; raw: string | null } {
  let decryptedNotes: string | null = null;

  if (noteService.appHasPasswordChallenge()) {
    const notes = noteService.getNotes();
    decryptedNotes = cryptoService.decrypt(notes, appPassword);
  } else {
    noteService.setDecryptedNotes(noteService.getNotes());
    decryptedNotes = noteService.getNotes();
  }

  if (!decryptedNotes || (decryptedNotes.length === 0 && noteService.appHasPasswordChallenge())) {
    return { parsed: null, raw: decryptedNotes };
  }

  noteService.setDecryptedNotes(decryptedNotes);
  try {
    return { parsed: JSON.parse(decryptedNotes), raw: decryptedNotes };
  } catch {
    return { parsed: null, raw: decryptedNotes };
  }
}
