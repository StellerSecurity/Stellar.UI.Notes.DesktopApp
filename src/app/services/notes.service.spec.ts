import { TestBed } from '@angular/core/testing';

import { NotesService } from './notes.service';

describe('NotesService', () => {
  let service: NotesService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(NotesService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('rejects a stale server note while a newer local edit is pending', () => {
    service.markPendingMutation('note-1', 'update', 2000);

    expect(service.shouldIgnoreServerNote({ id: 'note-1', last_modified: 1999 })).toBeTrue();
    expect(service.shouldIgnoreServerNote({ id: 'note-1', last_modified: 2000 })).toBeFalse();
  });

  it('keeps a pending mutation until the server confirms its timestamp', () => {
    service.markPendingMutation('note-1', 'update', 2000);

    service.reconcileServerConfirmation({ id: 'note-1', last_modified: 1999 });
    expect(service.getPendingMutation('note-1')).not.toBeNull();

    service.reconcileServerConfirmation({ id: 'note-1', last_modified: 2000 });
    expect(service.getPendingMutation('note-1')).toBeNull();
  });
});
