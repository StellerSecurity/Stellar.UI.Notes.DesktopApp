import Quill from 'quill';
import { preserveNoteLineBreaks, preserveNoteSpaces } from './add-note/rich-text-editor/preserve-note-line-breaks';

describe('Seeded editor destruction attempts', () => {
  for (const seed of [4321,98765]) it('keeps text through 1000 random edits, undo/redo and HTML round trips: '+seed, () => {
    const host = document.createElement('div'); document.body.appendChild(host);
    const editor: any = new Quill(host,{modules:{toolbar:false,history:{delay:0,userOnly:true},clipboard:{matchVisual:false,matchers:[[3,preserveNoteSpaces],[1,preserveNoteLineBreaks]]}}});
    let state = seed, expected = '';
    const random = () => { state = (Math.imul(state,1664525)+1013904223) >>> 0; return state >>> 4; };
    const started = performance.now();
    try {
      for (let step = 0; step < 1000; step++) {
        const index = random() % (expected.length+1), before = expected;
        editor.history.clear();
        if (random()%3 !== 0 || !expected.length) {
          const text = ['test\n','æøå','<>&','   ','line\n\n'][random()%5];
          editor.insertText(index,text,'user'); expected = expected.slice(0,index)+text+expected.slice(index);
        } else {
          const count = Math.min(1+random()%8,expected.length-index);
          editor.deleteText(index,count,'user'); expected = expected.slice(0,index)+expected.slice(index+count);
        }
        expect(editor.getText()).withContext('step '+step).toBe(expected+'\n');
        editor.history.undo(); expect(editor.getText()).withContext('undo '+step).toBe(before+'\n');
        editor.history.redo(); expect(editor.getText()).withContext('redo '+step).toBe(expected+'\n');
        if (step%25 === 0) {
          editor.setContents(editor.clipboard.convert(editor.root.innerHTML),'silent');
          if (editor.getText() !== expected+'\n') throw new Error('HTML round trip changed text at seed '+seed+' step '+step+' '+JSON.stringify({actual:editor.getText(),expected:expected+'\n'}));
        }
      }
      console.log('EDITOR_STRESS',JSON.stringify({seed,edits:1000,undoRedo:2000,reopens:40,ms:Math.round(performance.now()-started)}));
    } finally { host.remove(); }
  },120000);
});
