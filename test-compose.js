'use strict';
const assert = require('node:assert/strict');
const {compose, wrap, COLS} = require('./text-print');

const ESC = 0x1b, GS = 0x1d;
const sample = {
  time: '10:51 AM',
  date: 'NOV 15, 2026',
  terms: ['Proof of Payment permits transfers prior', 'to time noted above. Present at boarding/', 'on request. Retain to avoid fines/removal.'],
  barcode: '11332648'
};

// --- wrap ---------------------------------------------------------------
assert.deepEqual(wrap('one two three', 7), ['one two', 'three'], 'wrap must break before overflow.');
assert.deepEqual(wrap('exactly', 7), ['exactly'], 'wrap must keep a word that fits exactly.');
assert.deepEqual(wrap('   '), [], 'blank input wraps to nothing.');
assert.equal(COLS, 49, 'font B gives 49 columns at 448 dots.');

// --- init and font ------------------------------------------------------
const stream = compose(sample);
const flat = Buffer.concat(stream.chunks);
assert.deepEqual([...flat.subarray(0, 3)], [ESC, 0x40, ESC], 'stream must open with ESC @.');
assert.ok(flat.includes(Buffer.from([ESC, 0x4d, 0x01])), 'stream must select font B.');

// --- no vector text, no raster text ------------------------------------
assert.ok(flat.includes(Buffer.from('Proof of Payment', 'ascii')), 'heading must be plain ASCII.');

// --- barcode ------------------------------------------------------------
const gsK = flat.indexOf(Buffer.from([GS, 0x6b, 73]));
assert.ok(gsK > 0, 'stream must contain a GS k Code 128 command.');
assert.equal(flat[gsK + 3], 10, 'barcode length must be selector plus eight digits.');
assert.deepEqual([...flat.subarray(gsK + 4, gsK + 6)], [0x7b, 0x43], 'barcode must select code set C.');
assert.equal(flat.subarray(gsK + 6, gsK + 14).toString('ascii'), '11332648', 'barcode payload must be the digits verbatim.');
assert.ok(flat.includes(Buffer.from([GS, 0x77, 3])), 'module width must be set.');
assert.ok(flat.includes(Buffer.from([GS, 0x68, 80])), 'bar height must be set.');

// --- tail ---------------------------------------------------------------
assert.deepEqual([...flat.subarray(flat.length - 3)], [ESC, 0x64, 4], 'stream must end with a four-line feed.');

// --- logo splice --------------------------------------------------------
const logo = {chunks: [Buffer.from([GS, 0x76, 0x30, 0])]};
const withLogo = compose({...sample, logo});
assert.ok(Buffer.concat(withLogo.chunks).includes(Buffer.from([GS, 0x76, 0x30, 0])), 'logo chunks must be spliced in.');

// --- no barcode ---------------------------------------------------------
const bare = Buffer.concat(compose({...sample, barcode: null}).chunks);
assert.equal(bare.indexOf(Buffer.from([GS, 0x6b, 73])), -1, 'no barcode must mean no GS k.');

// --- rejections ---------------------------------------------------------
assert.throws(() => compose({...sample, time: ''}), /needs a time and a date/, 'empty time must throw.');
assert.throws(() => compose({...sample, date: 'x'.repeat(15)}), /date is too long/, 'overlong date must throw.');
assert.throws(() => compose({...sample, terms: ['y'.repeat(50)]}), /too wide for font B/, 'overwide term line must throw.');
assert.throws(() => compose({...sample, barcode: '123'}), /even number of digits/, 'odd barcode must throw.');
assert.throws(() => compose({...sample, barcode: '12a4'}), /even number of digits/, 'non-numeric barcode must throw.');

// --- hex dump for eyeballing -------------------------------------------
const hex = flat.toString('hex').replace(/(.{64})/g, '$1\n');
console.log('composed ' + flat.length + ' bytes');
console.log(hex);
