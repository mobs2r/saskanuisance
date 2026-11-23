'use strict';
const ROWS = 64;
const THRESHOLD = 200;          // high: strips the AA fringe, keeps a hard 1-dot step

function binarize(bgra, width, height) {
  const rowBytes = width / 8;
  const bits = Buffer.alloc(rowBytes * height);
  for (let y = 0; y < height; y++) {
    const src = y * width * 4, dst = y * rowBytes;
    for (let x = 0; x < width; x++) {
      const i = src + x * 4;
      const a = bgra[i + 3] / 255;
      const luma = (0.114 * bgra[i] + 0.587 * bgra[i + 1] + 0.299 * bgra[i + 2]) * a + 255 * (1 - a);
      if (luma < THRESHOLD) bits[dst + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return { bits, rowBytes };
}

// thermal heads bloom horizontally; one dot right restores stem weight and squares terminals
function bloom(bits, rowBytes, height) {
  const out = Buffer.from(bits);
  for (let y = 0; y < height; y++) {
    const row = y * rowBytes;
    for (let x = rowBytes - 1; x >= 0; x--) {
      const b = bits[row + x];
      if (!b) continue;
      const carry = (b & 0x01) ? 0x80 : 0;
      out[row + x] |= b >> 1;
      if (carry && x + 1 < rowBytes) out[row + x + 1] |= carry;
    }
  }
  return out;
}

function init(profile) {
  return Buffer.from([
    0x1b, 0x40,                   // ESC @  reset
    0x1b, 0x37, 0x07, 0x78, 0x02, // ESC 7  max heat, slow feed
    0x1b, 0x61, 0x00,             // ESC a 0 left align
    0x1b, 0x4a, profile.topMarginDots & 0xff
  ]);
}

function cut(profile) {
  return Buffer.from([0x1b, 0x4a, profile.cutterFeedDots & 0xff, 0x1d, 0x56, 0x42, 0x00]);
}

function rasterize(bgra, width, height, profile) {
  if (width !== profile.width) throw new Error('Width does not match the paper profile.');
  if (!Number.isInteger(height) || height < 1 || height > 2400) throw new Error('Invalid receipt height.');
  if (!Buffer.isBuffer(bgra) || bgra.length !== width * height * 4) throw new Error('Invalid pixel data.');

  const { bits, rowBytes } = binarize(bgra, width, height);
  const body = bloom(bits, rowBytes, height);

  const chunks = [init(profile)];
  for (let y = 0; y < height; y += ROWS) {
    const rows = Math.min(ROWS, height - y);
    const header = Buffer.from([0x1d, 0x76, 0x30, 0x00, rowBytes & 255, rowBytes >> 8, rows & 255, rows >> 8]);
    chunks.push(Buffer.concat([header, body.subarray(y * rowBytes, (y + rows) * rowBytes)]));
  }
  chunks.push(cut(profile));

  return { width, height, chunks, bytes: chunks.reduce((n, c) => n + c.length, 0) };
}

module.exports = { rasterize, ROWS, THRESHOLD };
