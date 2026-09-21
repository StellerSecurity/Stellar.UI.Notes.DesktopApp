/** Keep local revisions increasing even when the device clock moves backwards. */
export function nextNoteVersion(notes: ReadonlyArray<{ last_modified?: number }> = [], now = Date.now()): number {
  return notes.reduce((version, note) => {
    const previous = Number(note?.last_modified);
    return Number.isSafeInteger(previous) && previous >= 0 ? Math.max(version, previous + 1) : version;
  }, now);
}
