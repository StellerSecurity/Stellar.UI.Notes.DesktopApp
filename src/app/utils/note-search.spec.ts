import { noteSearchText, matchesNoteSearch } from './note-search';
import { normalize } from './home-normalize.util';
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
 it('keeps active markup detached and ignores hidden executable content', () => {
  const marker = 'stellar-search-injection';
  const before = document.querySelectorAll('iframe,img').length;
  expect(noteSearchText('<p>'+marker+'</p><script>hidden</script><iframe>hidden</iframe><object>hidden</object>')).toBe(marker);
  expect(document.querySelectorAll('iframe,img').length).toBe(before);
 });
});

describe('Search text extraction without active markup', () => {
 it('preserves inline text, quoted attributes, entities and comparison signs', () => {
  expect(noteSearchText('<p title="a > b">hel<b>lo</b> &lt; 3</p><div>next<br>line</div>')).toBe('hello < 3 next line');
 });
 it('ignores comments and nested inert template contents', () => {
  expect(noteSearchText('before<!-- hidden --><template>hidden<template>hidden</template>hidden</template>after')).toBe('beforeafter');
 });
 it('does not turn encoded or malformed HTML into elements while decoding', () => {
  const original = document.querySelectorAll('img').length;
  const input = '</textarea><img src=x onerror=alert(1)>';
  expect(normalize(input)).toBe(input);
  expect(noteSearchText('&lt;img src=x onerror=alert(1)&gt;')).toContain('<img');
  expect(document.querySelectorAll('img').length).toBe(original);
 });
});

describe('Search malformed input resilience', () => {
 it('handles incomplete quoted tags and many comparison signs as text', () => {
  expect(noteSearchText('<p title="unfinished')).toBe('<p title="unfinished');
  expect(noteSearchText('<p broken<div>visible</div>')).toBe('<p broken visible');
  expect(noteSearchText(('1 < 3 ').repeat(20000))).toBe(('1 < 3 ').repeat(20000).trim());
 });
});
