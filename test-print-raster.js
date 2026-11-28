'use strict';
// A real print is native printer text plus the logo raster, not a screenshot of the screen font.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {compose} = require('./text-print');
const {rasterize} = require('./raster');
const {profileFor} = require('./paper-profiles');
const {validateChunks} = require('./receipt-chunks');
const paper = profileFor('roll57');

function wire(chunks) {
  const header = Buffer.alloc(8);
  header.writeUInt32LE(0x31504d53);
  header.writeUInt32LE(chunks.length, 4);
  return Buffer.concat([header, ...chunks.flatMap(chunk => {
    const size = Buffer.alloc(4);
    size.writeUInt32LE(chunk.length);
    return [size, chunk];
  })]);
}
function isRaster(chunk) {
  return chunk.length >= 8 && chunk[0] === 0x1d && chunk[1] === 0x76 && chunk[2] === 0x30;
}
function dryRun(chunks) {
  const helper = path.join(__dirname, 'ReceiptPrint.exe');
  const run = spawnSync(helper, ['--dry-run'], {input: wire(chunks), windowsHide: true, encoding: 'utf8'});
  if (run.status !== 0) { console.error(run.stdout); console.error(run.stderr); }
  assert.equal(run.status, 0);
  const parsed = JSON.parse(run.stdout);
  assert.equal(parsed.printerOpened, false);
  assert.equal(parsed.ok, true);
  return parsed;
}

const logo = rasterize(Buffer.alloc(paper.width * 64 * 4, 255), paper.width, 64, paper);
const terms = [
  'Proof of Payment permits transfers prior',
  'to time noted above. Present at boarding/',
  'on request. Retain to avoid fines/removal.'
];
const job = compose({time: '12:48 PM', date: 'SEP 10,2026', terms, barcode: null, logo, profile: paper});
validateChunks(job.chunks);
assert.ok(job.chunks.length <= 41);
assert.ok(job.chunks.every(chunk => chunk.length >= 1 && chunk.length <= 3784));
const rasterChunks = job.chunks.filter(isRaster);
const textChunks = job.chunks.length - rasterChunks.length;
assert.equal(rasterChunks.length, 1, 'a 64-row logo is one GS v 0 block');
assert.ok(textChunks >= 1);
assert.ok(Buffer.concat(job.chunks).includes(Buffer.from('Proof of Payment', 'ascii')));
assert.ok(!job.chunks.some(chunk => chunk.length >= 8 && chunk[0] === 0x1b && chunk[1] === 0x40 && chunk !== job.chunks[0] && isRaster(chunk)));
if (process.platform === 'win32') {
  const parsed = dryRun(job.chunks);
  assert.equal(parsed.bytes, job.bytes);
  const plain = rasterize(Buffer.alloc(paper.width * 1200 * 4, 255), paper.width, 1200, paper);
  validateChunks(plain.chunks);
  dryRun(plain.chunks);
}

const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
const handle = main.slice(main.indexOf('async function handlePrint'), main.indexOf('let liveFeedSet'));
assert.match(handle, /compose\(\{/);
assert.match(handle, /logo: preview\.logoRaster/);
assert.match(handle, /sendRaster\(raster\)/);
assert.doesNotMatch(handle, /sendRaster\(preview\.raster\)/);
assert.match(handle, /internetClock\.now\(\)/);
assert.match(handle, /serviceHours\(\)/);
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const renderer = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8');
assert.match(html, /-webkit-font-smoothing:\s*none/);
assert.doesNotMatch(renderer, /dateGlyphs/);
assert.match(renderer, /showReceiptText\(dateNode, \(parts\.month \+ ' ' \+ parts\.day \+ ',' \+ parts\.year\)\.toUpperCase\(\)\)/);
console.log('PAYLOAD text chunks ' + textChunks + ', raster chunks ' + rasterChunks.length + ', total ' + job.chunks.length + ', bytes ' + job.bytes + (process.platform === 'win32' ? '. Dry run did not open a printer.' : '. Windows dry run skipped.'));
