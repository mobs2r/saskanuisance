'use strict';
const assert = require('node:assert/strict');
const {compose, wrap, COLS} = require('./text-print');
const {PROFILE} = require('./paper-profiles');

const ESC = 0x1b, GS = 0x1d;
const sample = {
  time: '12:48 PM',
  date: 'SEP 10,2026',
  terms: ['Proof of Payment permits transfers prior', 'to time noted above. Present at boarding/', 'on request to avoid fines/removal.'],
  profile: PROFILE
};

// --- wrap ---------------------------------------------------------------
assert.deepEqual(wrap('one two three', 7), ['one two', 'three'], 'wrap must break before overflow.');
assert.deepEqual(wrap('exactly', 7), ['exactly'], 'wrap must keep a word that fits exactly.');
assert.deepEqual(wrap('   '), [], 'blank input wraps to nothing.');
assert.equal(COLS, 49, 'font B gives 49 columns at 448 dots.');

// --- header -------------------------------------------------------------
const composed = compose(sample);
assert.ok(composed.chunks.every(chunk => chunk.length >= 1), 'blank lines must be a newline, not a zero-length block.');
const flat = Buffer.concat(composed.chunks);
assert.deepEqual([...flat.subarray(0, 2)], [ESC, 0x40], 'stream must open with ESC @.');
assert.deepEqual([...flat.subarray(2, 7)], [ESC, 0x37, 0x07, 0x78, 0x02], 'stream must set max heat and slow feed.');
assert.deepEqual([...flat.subarray(7, 13)], [ESC, 0x61, 0, ESC, 0x4a, 0x60], 'stream must set left align and a 96-dot top margin.');
assert.ok(flat.includes(Buffer.from([ESC, 0x4d, 0x01])), 'stream must select font B.');
assert.ok(flat.includes(Buffer.from('Proof of Payment', 'ascii')), 'heading must be plain ASCII.');

// --- tail ---------------------------------------------------------------
assert.deepEqual([...flat.subarray(flat.length - 7)], [ESC, 0x4a, 0x58, GS, 0x56, 0x42, 0x00], 'stream must end with an 88-dot feed and a partial cut.');

// --- no barcode by default ---------------------------------------------
assert.equal(flat.indexOf(Buffer.from([GS, 0x6b, 73])), -1, 'no barcode must mean no GS k.');

// --- barcode still available -------------------------------------------
const withBarcode = Buffer.concat(compose({...sample, barcode: '11332648'}).chunks);
const gsK = withBarcode.indexOf(Buffer.from([GS, 0x6b, 73]));
assert.ok(gsK > 0, 'barcode must emit GS k when supplied.');
assert.equal(withBarcode[gsK + 3], 10, 'barcode length must be selector plus eight digits.');
assert.deepEqual([...withBarcode.subarray(gsK + 4, gsK + 6)], [0x7b, 0x43], 'barcode must select code set C.');

// --- logo splice --------------------------------------------------------
const logo = {chunks: [Buffer.from([GS, 0x76, 0x30, 0])]};
assert.ok(Buffer.concat(compose({...sample, logo}).chunks).includes(Buffer.from([GS, 0x76, 0x30, 0])), 'logo chunks must be spliced in.');

// --- rejections ---------------------------------------------------------
assert.throws(() => compose({time: '1:00 PM', date: 'X'}), /paper profile/, 'missing profile must throw.');
assert.throws(() => compose({...sample, time: ''}), /needs a time and a date/, 'empty time must throw.');
assert.throws(() => compose({...sample, date: 'x'.repeat(15)}), /date is too long/, 'overlong date must throw.');
assert.throws(() => compose({...sample, terms: ['y'.repeat(50)]}), /too wide for font B/, 'overwide term line must throw.');
assert.throws(() => compose({...sample, barcode: '123'}), /even number of digits/, 'odd barcode must throw.');
assert.throws(() => compose({...sample, barcode: '12a4'}), /even number of digits/, 'non-numeric barcode must throw.');

console.log('composed ' + flat.length + ' bytes');
console.log(flat.toString('hex').replace(/(.{64})/g, '$1\n'));
