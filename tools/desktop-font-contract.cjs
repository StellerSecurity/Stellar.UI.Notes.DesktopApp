'use strict';
// A build must not introduce network font providers or remote @font-face sources.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
let faces = 0;
function inspect(directory) {
  for (const entry of fs.readdirSync(directory, {withFileTypes:true})) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) inspect(file);
    else if (/\.(?:css|scss|html)$/i.test(entry.name)) {
      const text = fs.readFileSync(file, 'utf8');
      assert.ok(!/(?:fonts\.googleapis\.com|fonts\.gstatic\.com|use\.typekit\.net|fonts\.bunny\.net)/i.test(text), `Remote font provider: ${file}`);
      assert.ok(!/@import\s+(?:url\()?\s*['"]?(?:https?:)?\/\//i.test(text), `Remote stylesheet: ${file}`);
      for (const face of text.matchAll(/@font-face\s*\{([^}]+)\}/gi)) {
        faces++;
        for (const match of face[1].matchAll(/url\(\s*['"]?([^'"\s)]+)/g)) {
          assert.ok(!/^(?:https?:)?\/\//i.test(match[1]), `Remote font: ${file}`);
        }
      }
    }
  }
}
inspect(path.join(root,'src'));
const output = path.join(root,'dist/StellerPhoneNotesApp');
assert.ok(fs.existsSync(output), 'Build the desktop app before checking packaged fonts');
inspect(output);
assert.ok(faces >= 10, 'Expected local font faces in both source and compiled output');
for (const weight of ['Regular','Medium','SemiBold','Bold','Italic']) {
  assert.ok(fs.existsSync(path.join(output,`assets/fonts/poppins/Poppins-${weight}.ttf`)), `Missing bundled ${weight} font`);
}
assert.ok(fs.existsSync(path.join(output,'assets/fonts/poppins/OFL.txt')), 'Missing font license');
console.log(`PASS: ${faces} local font-face rules; no remote font providers or stylesheet imports; fonts and license bundled`);
