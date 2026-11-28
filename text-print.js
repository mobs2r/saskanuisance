'use strict';
const {init: initStream, cut: cutStream} = require('./raster');

const ESC = 0x1b, GS = 0x1d;
const COLS = 49;                        // font B is 9 dots wide; 448 / 9 = 49

class Stream {
  constructor() { this.parts = []; }
  add(part) { if (part && part.length) this.parts.push(part); return this; }
  raw(...bytes) { return this.add(Buffer.from(bytes)); }
  ascii(text) { if (text) this.add(Buffer.from(text, 'ascii')); return this; }
  line(text = '') { if (text) this.ascii(text); return this.raw(0x0a); }
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
    this.add(payload);
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

function compose({time, date, terms, barcode = null, logo = null, profile}) {
  if (!profile) throw new Error('Receipt needs a paper profile.');
  if (!time || !date) throw new Error('Receipt needs a time and a date.');
  if (time.length > 12) throw new Error('Receipt time is too long.');
  if (date.length > 14) throw new Error('Receipt date is too long.');

  const stream = new Stream();
  stream.add(initStream(profile));
  stream.fontB().align(1);

  if (logo) for (const chunk of logo.chunks || []) {
    if (chunk.length >= 8 && chunk[0] === GS && chunk[1] === 0x76 && chunk[2] === 0x30) stream.add(chunk);
  }

  stream.size(2, 2).line('Proof of Payment');
  stream.size(1, 1).line();
  stream.line('Valid Until:');
  stream.size(3, 3).line(time).line(date);
  stream.size(1, 1).align(0).line();

  for (const line of Array.isArray(terms) ? terms : wrap(terms)) {
    if (line.length > COLS) throw new Error('Terms line too wide for font B: "' + line + '"');
    stream.line(line);
  }
  if (barcode) stream.align(1).barcode(String(barcode));
  stream.feed(4);
  stream.add(cutStream(profile));
  const chunks = pack(stream.parts);
  return {chunks, bytes: chunks.reduce((total, chunk) => total + chunk.length, 0)};
}

function isRaster(part) {
  return part.length >= 8 && part[0] === GS && part[1] === 0x76 && part[2] === 0x30;
}
// Keep text together and raster blocks separate so a receipt stays under the helper's chunk cap.
function pack(parts) {
  const chunks = [];
  const text = [];
  const flush = () => {
    if (!text.length) return;
    const buf = Buffer.concat(text);
    text.length = 0;
    if (buf.length) chunks.push(buf);
  };
  for (const part of parts) {
    if (isRaster(part)) { flush(); chunks.push(part); }
    else text.push(part);
  }
  flush();
  return chunks;
}

module.exports = {compose, wrap, COLS};
