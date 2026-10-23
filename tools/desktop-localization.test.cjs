'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {languages, createDesktopLocalization} = require('../desktop-localization.cjs');
test('native dialogs follow the selected language and persist only a validated preference', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'stellar-language-test-'));
  const app = {getPath:()=>directory, getLocale:()=>'ja-JP'};
  try {
    const native = createDesktopLocalization(app);
    const english = require('../src/assets/i18n/en.json');
    assert.equal(native.text('nativeUpdate'),english.nativeUpdate);
    for (const code of languages) {
      const catalog = require(`../src/assets/i18n/${code}.json`);
      assert.equal(native.setPreference(code),true);
      assert.equal(native.text('nativeUpdate'),catalog.nativeUpdate);
      assert.equal(native.text('nativeUpdateAvailable',{from:'1',to:'2'}),catalog.nativeUpdateAvailable.replace('{{from}}','1').replace('{{to}}','2'));
    }
    const saved = fs.readFileSync(path.join(directory,'language-preference.json'),'utf8');
    assert.equal(saved,JSON.stringify('pt-BR'));
    assert.equal(native.setPreference('../../arbitrary-path'),false);
    assert.equal(native.setPreference({language:'de'}),false);
    assert.equal(fs.readFileSync(path.join(directory,'language-preference.json'),'utf8'),saved);
    assert.equal(createDesktopLocalization(app).text('nativeUpdate'),require('../src/assets/i18n/pt-BR.json').nativeUpdate);
    native.setPreference('system');
    assert.equal(native.text('nativeUpdate'),english.nativeUpdate);
    assert.equal(native.text('unknown-key'),'unknown-key');
  } finally { fs.rmSync(directory,{recursive:true,force:true}); }
});
