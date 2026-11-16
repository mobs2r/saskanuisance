'use strict';
const path = require('node:path');

function electronApp() {
  try {
    const electron = require('electron');
    if (electron && typeof electron === 'object' && electron.app) return electron.app;
  } catch {
    return null;
  }
  return null;
}

// Native helpers cannot be spawned from inside app.asar. electron-builder
// copies asarUnpack entries to resources/app.asar.unpacked.
function helperPath(filename) {
  const app = electronApp();
  if (app && app.isPackaged) return path.join(process.resourcesPath, 'app.asar.unpacked', filename);
  return path.join(__dirname, filename);
}

module.exports = {helperPath};
