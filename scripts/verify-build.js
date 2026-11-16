'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

const root = path.join(__dirname, '..');
function filesIn(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === 'vendor' || name === '.git') continue;
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) filesIn(full, out);
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}

for (const file of filesIn(root)) {
  const result = spawnSync(process.execPath, ['--check', file], {encoding: 'utf8'});
  if (result.status !== 0) {
    console.error(file);
    console.error(result.stderr || result.stdout);
    process.exit(1);
  }
}

const {SOURCES} = require('../adapters');
const {RingBuffer} = require('../ring-buffer');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
if (SOURCES.length !== 10) throw new Error('Signal catalog changed size.');
for (const name of ['terminal.css', 'terminal.js', 'signal-terminal', 'signal-row', 'signal-grid', 'signal-global', 'crt-scan']) {
  if (!html.includes(name)) throw new Error('index.html is missing ' + name);
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yxe-signals-'));
  const ring = await new RingBuffer({dir, id: 'wx-eccc', maxBytes: 400, maxLines: 4}).init();
  for (let i = 0; i < 8; i++) await ring.append({type: 'sample', id: 'wx-eccc', n: i});
  const recent = await ring.recent(10);
  if (!recent.length || recent.at(-1).n !== 7) throw new Error('Ring buffer did not keep the newest sample.');
  if (recent[0].n === 0) throw new Error('Ring buffer did not rotate.');
  console.log('PASS build: syntax, signal catalog, terminal markup, and ring rotation.');
})().catch(error => { console.error(error); process.exit(1); });
