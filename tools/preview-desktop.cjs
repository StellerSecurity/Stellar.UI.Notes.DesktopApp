// Local design preview: isolate test notes from the installed application's data.
const { app } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const previewData = path.resolve(__dirname, '../tmp/design-preview-profile');
fs.mkdirSync(previewData, { recursive: true });
app.setPath('userData', previewData);
app.setName('Stellar Notes Design Preview');
require('../electron-start.js');
