'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {rasterize} = require('./raster');
const {profileFor: roll} = require('./paper-profiles');
const P = {...roll('roll57'), horizontalOffsetDots: 0};
const width = P.width, height = 130;
const white = Buffer.alloc(width * height * 4, 255);
const blank = rasterize(white, width, height, P);
assert.deepEqual(blank.chunks.map(c => c.length), [13, 3592, 3592, 120, 7]);
assert.equal(blank.chunks[1].subarray(8).some(Boolean), false);
white.fill(0, 0, 3);
const black = rasterize(white, width, height, P);
assert.equal(black.chunks[1][8], 192);
assert.equal(black.chunks[1][9], 0);
white[3] = 0;
assert.equal(rasterize(white, width, height, P).chunks[1][8], 0);
assert.throws(() => rasterize(Buffer.alloc(4), width, 10, P));
assert.throws(() => rasterize(Buffer.alloc(4), width - 1, 1, P));
assert.throws(() => rasterize(white, width, height), /paper profile/);
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
assert.match(html, /permits transfers prior/);
assert.match(html, /id="print-time"/);
assert.match(html, /translateX\(calc\(-3 \* var\(--unit\)\)\)/);
assert.match(html, /right: 2mm/);
assert.match(html, /connect-src 'none'/);
assert.equal((html.match(/<script>/g) || []).length, 0);
assert.match(fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8'), /nodeIntegration: false/);
const {parsePrintedAt} = require('./print-time');
const base = new Date('2026-11-11T04:30:00Z');
assert.equal(parsePrintedAt('', base), null);
assert.equal(parsePrintedAt('   ', base), null);
assert.equal(parsePrintedAt('23:42', base).getHours(), 23);
assert.equal(parsePrintedAt('11:42 PM', base).getHours(), 23);
assert.equal(parsePrintedAt('12:05 AM', base).getHours(), 0);
assert.equal(parsePrintedAt('12:05 PM', base).getHours(), 12);
assert.equal(parsePrintedAt('24:00', base), null);
assert.equal(parsePrintedAt('11:75', base), null);
assert.equal(parsePrintedAt('nonsense', base), null);
assert.equal(parsePrintedAt('2026-03-08T18:45:00Z', base).toISOString(), '2026-03-08T18:45:00.000Z');
console.log('PASS: raster bit order, blank/black/transparent pixels, 64-row chunks, dimensions, print-time field and parser, plural footer, logo shift, trim, and offline CSP.');

const {spawnSync} = require('node:child_process');
function wire(chunks) { const header = Buffer.alloc(8); header.writeUInt32LE(0x31504d53); header.writeUInt32LE(chunks.length, 4); return Buffer.concat([header, ...chunks.flatMap(chunk => { const size = Buffer.alloc(4); size.writeUInt32LE(chunk.length); return [size, chunk]; })]); }
const helper = path.join(__dirname, 'ReceiptPrint.exe');
const helperHost = process.platform === 'win32';
function runHelper(args, input) { return spawnSync(helper, args, {input, windowsHide: true, encoding: 'utf8'}); }
if (helperHost) {
const dryRun = runHelper(['--dry-run'], wire(blank.chunks));
if (dryRun.status !== 0) { console.error(dryRun.stdout); console.error(dryRun.stderr); }
assert.equal(dryRun.status, 0);
assert.equal(JSON.parse(dryRun.stdout).printerOpened, false);
assert.equal(JSON.parse(dryRun.stdout).bytes, blank.bytes);
const invalid = runHelper(['--dry-run'], Buffer.from('NOT A RECEIPT'));
assert.equal(invalid.status, 1);
assert.equal(JSON.parse(invalid.stdout).ok, false);
assert.equal(JSON.parse(invalid.stdout).outcomeUncertain, false);
console.log('PASS: compiled native helper dry run and malformed-payload refusal. No printer opened.');
} else console.log('SKIP: ReceiptPrint.exe is a .NET Framework helper and runs on Windows. Raster checks above still ran.');

const {PROFILES,profileFor,savedProfile}=require('./paper-profiles');
assert.equal(savedProfile(null),'roll57');
assert.equal(savedProfile({profile:'not-supported'}),'roll57');
assert.equal(savedProfile({profile:'narrow53'}),'roll57');
assert.throws(()=>profileFor('anything'));
assert.equal(profileFor('roll57').width,448);
assert.throws(()=>rasterize(Buffer.alloc(416*130*4,255),416,130,profileFor('roll57')),/paper profile/);
const style=fs.readFileSync(path.join(__dirname,'app-ui.css'),'utf8');
assert.match(style,/prefers-reduced-motion: reduce/);
assert.match(style,/animation: none !important/);
console.log('PASS: supported paper profile, wrong-width rejection, and reduced-motion stylesheet. No printer opened.');

const single=rasterize(Buffer.alloc(448*130*4,255),448,130,profileFor('roll57'));
if (helperHost) { const singleCheck=runHelper(['--dry-run'],wire(single.chunks));if(singleCheck.status!==0){console.error(singleCheck.stdout);console.error(singleCheck.stderr);}assert.equal(singleCheck.status,0);assert.equal(JSON.parse(singleCheck.stdout).printerOpened,false);console.log('PASS 448-dot single 57 mm native dry run.'); }
else console.log('SKIP: 448-dot native dry run runs on Windows.');
