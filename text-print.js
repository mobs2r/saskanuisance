'use strict';
const {rasterize} = require('./raster');

const ESC = 0x1b, GS = 0x1d;
const COLS = 49;                        // font B is 9 dots wide; 448 / 9 = 49

class Stream {
  constructor() { this.parts = []; }
  raw(...bytes) { this.parts.push(Buffer.from(bytes)); return this; }
  ascii(text) { this.parts.push(Buffer.from(text, 'ascii')); return this; }
  line(text = '') { return this.ascii(text).raw(0x0a); }
  init() { return this.raw(ESC, 0x40); }
  fontB() { return this.raw(ESC, 0x4d, 0x01); }
  align(n) { return this.raw(ESC, 0x61, n); }
  size(w, h) { return this.raw(GS, 0x21, ((h & 7) << 4) | (w & 7)); }
  feed(n = 1) { return this.raw(ESC, 0x64, n); }
  barcode(data) {
    if (!/^\d+$/.test(data) || data.length % 2 !== 0) throw new Error('Barcode must be an even number of digits.');
    const payload = Buffer.from(data, 'ascii');
    this.raw(GS, 0x48, 0);                                        // human-readable off
    this.raw(GS, 0x68, 80);                                       // bar height
    this.raw(GS, 0x77, 3);                                        // module width
    this.raw(GS, 0x6b, 73, payload.length + 2, 0x7b, 0x43);       // GS k, Code 128, {C
    this.parts.push(payload);
    return this.raw(0x0a);
  }
}

function wrap(text, cols = COLS) {
  const out = [];
  let line = '';
  for (const word of String(text).split(/\s+/)) {
    if (!word) continue;
    if (line && line.length + 1 + word.length > cols) { out.push(line); line = word; }
    else line = line ? line + ' ' + word : word;
  }
  if (line) out.push(line);
  return out;
}

function compose({time, date, terms, barcode = null, logo = null}) {
  if (!time || !date) throw new Error('Receipt needs a time and a date.');
  if (time.length > 12) throw new Error('Receipt time is too long.');
  if (date.length > 14) throw new Error('Receipt date is too long.');

  const stream = new Stream();
  stream.init().fontB().align(1);

  if (logo) for (const chunk of logo.chunks) stream.parts.push(chunk);

  stream.size(2, 2).line('Proof of Payment');
  stream.size(1, 1).line();
  stream.line('Valid Until:');
  stream.size(3, 3).line(time).line(date);
  stream.size(1, 1).align(0).line();

  for (const line of Array.isArray(terms) ? terms : wrap(terms)) {
    if (line.length > COLS) throw new Error('Terms line too wide for font B: "' + line + '"');
