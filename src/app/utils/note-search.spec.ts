import { noteSearchText, matchesNoteSearch } from './note-search';
describe('note search', () => {
 it('joins inline formatting and separates paragraphs', () => {
  expect(noteSearchText('<p>hel<strong>lo</strong></p><p>world &amp; café</p>')).toBe('hello world & cafe');
 });
 it('does not index markup, scripts or image URLs', () => {
  expect(noteSearchText('<script>secret</script><img src="secret"><p>visible</p>')).toBe('visible');
 });
 it('matches words in different fields regardless of order', () => {
  expect(matchesNoteSearch(['milk','shop'], 'shopping', '', 'buy milk', false)).toBeTrue();
  expect(matchesNoteSearch(['milk','absent'], 'shopping', '', 'buy milk', false)).toBeFalse();
 });
 it('never matches protected body text', () => {
  expect(matchesNoteSearch(['milk'], 'shopping', '', 'buy milk', true)).toBeFalse();
 });
});
