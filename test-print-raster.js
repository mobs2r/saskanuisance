'use strict';
// The print job must be the captured ticket raster. compose() inserts a 0-byte
// line and a nested logo init/cut, which ReceiptPrint.exe rejects.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {rasterize} = require('./raster');
const {profileFor} = require('./paper-profiles');
const paper = profileFor('roll57');
const HEADER = Buffer.from([0x1b, 0x40, 0x1b, 0x37, 0x07, 0x78, 0x02, 0x1b, 0x61, 0x00, 0x1b, 0x4a]);
const TAIL = Buffer.from([0x1b, 0x4a, 0x58, 0x1d, 0x56, 0x42, 0x00]);
const ROW_BYTES = 56;

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

function assertHelperFraming(raster, height) {
  const chunks = raster.chunks;
  assert.equal(raster.width, paper.width);
  assert.equal(raster.height, height);
  assert.equal(chunks.length, Math.ceil(height / 64) + 2);
  assert.ok(chunks.length >= 3 && chunks.length <= 41, 'chunk count');
  for (const chunk of chunks) assert.ok(chunk.length >= 1 && chunk.length <= 3784, 'chunk length ' + chunk.length);
  assert.ok(chunks[0].length >= 13 && chunks[0].subarray(0, HEADER.length).equals(HEADER), 'receipt header');
  const tail = chunks.at(-1);
  assert.ok(tail.subarray(tail.length - TAIL.length).equals(TAIL), 'cut');
  for (let i = 1; i < chunks.length - 1; i++) {
    const chunk = chunks[i];
    assert.equal(chunk[0], 0x1d);
    assert.equal(chunk[1], 0x76);
    assert.equal(chunk[2], 0x30);
    assert.equal(chunk[3], 0);
    assert.equal(chunk[4], ROW_BYTES);
    assert.equal(chunk[5], 0);
    const rows = chunk[6] + 256 * chunk[7];
    assert.ok(rows >= 1 && rows <= 64);
    assert.equal(chunk.length, 8 + ROW_BYTES * rows);
  }
}

// Same bytes renderReceipt returns as preview.raster and handlePrint sends.
for (const height of [628, 1200]) {
  const pixels = Buffer.alloc(paper.width * height * 4, 255);
  pixels[0] = pixels[1] = pixels[2] = 0;
  const raster = rasterize(pixels, paper.width, height, paper);
  assertHelperFraming(raster, height);
  if (process.platform === 'win32') {
    const helper = path.join(__dirname, 'ReceiptPrint.exe');
    const dryRun = spawnSync(helper, ['--dry-run'], {input: wire(raster.chunks), windowsHide: true, encoding: 'utf8'});
    if (dryRun.status !== 0) {
      console.error(dryRun.stdout);
      console.error(dryRun.stderr);
    }
    assert.equal(dryRun.status, 0, 'dry-run of the ' + height + '-row ticket raster');
    const parsed = JSON.parse(dryRun.stdout);
    assert.equal(parsed.printerOpened, false);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.bytes, raster.bytes);
  }
}

const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
const handle = main.slice(main.indexOf('async function handlePrint'), main.indexOf('let liveFeedSet'));
assert.match(handle, /sendRaster\(preview\.raster\)/);
assert.doesNotMatch(handle, /compose\(/);
assert.match(main, /function validateChunks\(chunks\)/);
assert.match(main, /if \(mode !== 'Status'\) validateChunks\(raster && raster\.chunks\)/);
assert.match(handle, /internetClock\.now\(\)/);
assert.match(handle, /serviceHours\(\)/);
console.log('PASS: handlePrint sends the captured ticket raster, and 628- and 1200-row payloads match the helper.' + (process.platform === 'win32' ? ' Dry run did not open a printer.' : ' Windows dry run skipped.'));
