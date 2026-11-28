'use strict';
// A real print is the on-screen ticket, drawn with a hard bitmap font and then rasterized.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {rasterize} = require('./raster');
const {rasterText} = require('./bitmap-font');
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

function assertFlat(text) {
  const drawn = rasterText(text, 2, 1);
  assert.ok(drawn.pixels.every(pixel => pixel === 0 || pixel === 1));
  return drawn;
}
const stem = assertFlat('l');
const columns = new Set();
for (let i = 0; i < stem.pixels.length; i++) if (stem.pixels[i]) columns.add(i % stem.width);
assert.ok(columns.size <= 4, 'l is a straight stem, not a curved outline');
assertFlat('i');
const lines = ['Proof of Payment', 'Valid Until:', '12:48 PM', 'Sep 10,2026', 'Proof of Payment permits transfers prior', 'to time noted above. Present at boarding/', 'on request. Retain to avoid fines/removal.'];
const drawnLines = lines.map((line, index) => rasterText(line, index < 4 ? 2 : 1, index < 4 ? 1 : 0));
const height = 640;
const bgra = Buffer.alloc(paper.width * height * 4, 255);
let y0 = 40;
for (const drawn of drawnLines) {
  const x0 = Math.max(0, Math.floor((paper.width - drawn.width) / 2));
  for (let y = 0; y < drawn.height && y0 + y < height; y++) {
    for (let x = 0; x < drawn.width; x++) {
      if (!drawn.pixels[y * drawn.width + x]) continue;
      const pixel = ((y0 + y) * paper.width + x0 + x) * 4;
      bgra[pixel] = bgra[pixel + 1] = bgra[pixel + 2] = 0;
    }
  }
  y0 += drawn.height + 8;
}
const job = rasterize(bgra, paper.width, height, paper);
validateChunks(job.chunks);
assert.ok(job.chunks.length >= 3 && job.chunks.length <= 41);
assert.ok(job.chunks.every(chunk => chunk.length >= 1 && chunk.length <= 3784));
const rasterChunks = job.chunks.filter(isRaster);
assert.equal(rasterChunks.length, job.chunks.length - 2, 'init and cut wrap the ticket raster');
assert.equal(job.chunks[0][0], 0x1b);
assert.equal(job.chunks.at(-1)[0], 0x1b);
if (process.platform === 'win32') {
  const parsed = dryRun(job.chunks);
  assert.equal(parsed.bytes, job.bytes);
  const plain = rasterize(Buffer.alloc(paper.width * 1200 * 4, 255), paper.width, 1200, paper);
  validateChunks(plain.chunks);
  dryRun(plain.chunks);
}

const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
const handle = main.slice(main.indexOf('async function handlePrint'), main.indexOf('let liveFeedSet'));
assert.match(handle, /sendRaster\(preview\.raster\)/);
assert.doesNotMatch(handle, /compose\(\{/);
assert.match(handle, /internetClock\.now\(\)/);
assert.match(handle, /serviceHours\(\)/);
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const renderer = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8');
assert.match(html, /image-rendering:\s*pixelated/);
assert.match(renderer, /imageSmoothingEnabled = false/);
assert.match(renderer, /paintBitmap\(dateNode, \(parts\.month \+ ' ' \+ parts\.day \+ ',' \+ parts\.year\)\.toUpperCase\(\), 2, 1\)/);
assert.doesNotMatch(renderer, /dateGlyphs/);
assert.doesNotMatch(fs.readFileSync(path.join(__dirname, 'city-guide.js'), 'utf8'), /make\('b','','YXE'\)/);
console.log('PAYLOAD raster chunks ' + rasterChunks.length + ', total ' + job.chunks.length + ', bytes ' + job.bytes + (process.platform === 'win32' ? '. Dry run did not open a printer.' : '. Windows dry run skipped.'));
