'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
function verify() {
  const root = path.resolve(__dirname, '../identity-runtime');
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const item = lock.packages?.['node_modules/@serenity-kit/opaque'];
  const folder = path.join(root, 'node_modules/@serenity-kit/opaque');
  const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'package.json'), 'utf8'));
  if (item?.version !== '1.1.0' || item.resolved !== 'https://registry.npmjs.org/@serenity-kit/opaque/-/opaque-1.1.0.tgz'
    || item.integrity !== 'sha512-Y6v/+hRMn0MdMEk5+/ArM0vPIiFfFEbdTZc7oAx+cWyvGODGezAQ/sMjXBVogf7NsS9z9EV0Ve5paZCVULuedw=='
    || manifest.name !== '@serenity-kit/opaque' || manifest.version !== '1.1.0' || manifest.scripts || manifest.dependencies) throw new Error('Identity runtime differs from the security review.');
  for (const [name, expected] of [['esm/index.js', 'Ho1WODp3lI5FMIW21PUty5ZF+L//MjlXOLY9Oi4vy1I='], ['cjs/index.js', 'kDxs+p7gUqBBAuIepPLzbadTVyYYdluyGhpczNGwBEI=']]) {
    if (createHash('sha256').update(fs.readFileSync(path.join(folder, name))).digest('base64') !== expected) throw new Error('Identity runtime source checksum differs from the review.');
  }
}
module.exports = verify;
if (require.main === module) { verify(); console.log('Reviewed OPAQUE client 1.1.0: manifest, lock and browser/runtime checksums match.'); }
