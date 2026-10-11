'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');

// Both supported AppImage builders copy appOutDir over the generated staging
// launcher. Ship our reviewed launcher instead of their no-sandbox fallback.
module.exports = async function linuxAfterPack(context) {
  if (context.electronPlatformName !== 'linux') return;
  const destination = path.join(context.appOutDir, 'AppRun');
  await fs.copyFile(path.join(__dirname, 'linux-apprun.sh'), destination);
  await fs.chmod(destination, 0o755);
};
