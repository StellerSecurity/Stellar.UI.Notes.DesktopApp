// Inspect application templates and the bundled default catalog without loading app code.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const english = JSON.parse(fs.readFileSync(path.join(root, 'src/assets/i18n/en.json'), 'utf8'));
const keys = new Set();

function inspect(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) inspect(file);
    else if (entry.isFile() && entry.name.endsWith('.html')) {
      const template = fs.readFileSync(file, 'utf8');
      for (const match of template.matchAll(/['"]([A-Za-z][A-Za-z0-9_.-]*)['"]\s*\|\s*translate/g)) {
        keys.add(match[1]);
        assert.equal(typeof english[match[1]], 'string', `Missing translation ${match[1]} in ${path.relative(root, file)}`);
        assert.ok(english[match[1]].trim(), `Empty translation ${match[1]}`);
      }
    }
  }
}

inspect(path.join(root, 'src/app'));
assert.ok(keys.size > 0, 'No translated templates inspected');
console.log(`PASS: ${keys.size} template translation keys exist in the bundled default catalog`);
