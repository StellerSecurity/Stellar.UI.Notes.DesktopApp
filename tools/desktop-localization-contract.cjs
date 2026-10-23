// Validate all bundled catalogs and UI translation references without network access.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {languages, resolveLanguage} = require('../desktop-localization.cjs');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root,name),'utf8');
const english = JSON.parse(read('src/assets/i18n/en.json'));
const tokens = value => [...value.matchAll(/{{?\s*(\w+)\s*}}?/g)].map(match=>match[1]).sort();
const keys = new Set();
assert.equal(languages.length,12);
for (const language of languages) {
  const catalog = JSON.parse(read(`src/assets/i18n/${language}.json`));
  assert.deepEqual(Object.keys(catalog).sort(),Object.keys(english).sort(),`${language}: key coverage`);
  for (const [key,value] of Object.entries(english)) {
    assert.equal(typeof catalog[key],'string',`${language}.${key}`);
    assert.ok(catalog[key].trim(),`${language}.${key} must not be blank`);
    assert.deepEqual(tokens(catalog[key]),tokens(value),`${language}.${key}: interpolation tokens`);
  }
  assert.ok(read('src/app/i18n.ts').includes(`i18n/${language}.json`),`${language} must be bundled`);
}
function inspect(directory) {
  for (const entry of fs.readdirSync(directory,{withFileTypes:true})) {
    const file=path.join(directory,entry.name);
    if (entry.isDirectory()) inspect(file);
    else if (/\.(html|ts)$/.test(entry.name) && !entry.name.endsWith('.spec.ts')) {
      const text=fs.readFileSync(file,'utf8');
      for (const pattern of [/['"]([A-Za-z][A-Za-z0-9_.-]*)['"]\s*\|\s*translate/g,/\bt\('([^']+)'/g]) {
        for(const match of text.matchAll(pattern)) {
          keys.add(match[1]); assert.ok(english[match[1]]?.trim(),`Missing ${match[1]} in ${path.relative(root,file)}`);
        }
      }
      if (entry.name.endsWith('.html')) {
        const withoutBindings=text.replace(/<!--[^]*?-->/g,'').replace(/{{[^]*?}}/g,'');
        for(const match of withoutBindings.matchAll(/>\s*([^<>]+?)\s*</g)) {
          const content=match[1].replace(/&[a-z]+;/gi,'').trim();
          if (/[a-zA-Z]{2}/.test(content) && !['Stellar Notes','Stellar ID','Stellar Secret'].includes(content)) {
            assert.fail(`Untranslated visible text in ${path.relative(root,file)}: ${content}`);
          }
        }
      }
    }
  }
}
inspect(path.join(root,'src/app'));
assert.ok(!read('src/app/app-settings/app-settings.page.html').includes('languageFallback'), 'Removed helper text must stay absent');
assert.ok(!read('src/app/app.module.ts').includes('TranslateHttpLoader'),'Catalogs must load locally');
assert.equal(resolveLanguage('nb-NO'),'nb'); assert.equal(resolveLanguage('pt_BR'),'pt-BR');
assert.equal(resolveLanguage('sv-SE'),'sv'); assert.equal(resolveLanguage('se'),'en');
assert.equal(resolveLanguage('../../anything'),'en');
console.log(`PASS: ${languages.length} local catalogs × ${Object.keys(english).length} keys; ${keys.size} UI references; matching placeholders; no static untranslated template copy`);
