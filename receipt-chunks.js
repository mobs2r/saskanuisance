'use strict';
// Same rules as ReceiptPrint.cs: no empty blocks, 3784-byte cap, and only the
// printer's text commands plus GS v 0 raster. Anything else is refused
// before the helper is started.
const MAX_CHUNKS = 41;
const MAX_CHUNK = 3784;
const ROW_BYTES = 56;

function fail(message) { throw new Error(message); }

function validateChunks(chunks) {
  if (!Array.isArray(chunks) || chunks.length < 1 || chunks.length > MAX_CHUNKS) fail('Invalid chunk count.');
  for (const chunk of chunks) {
    if (!Buffer.isBuffer(chunk) || chunk.length < 1 || chunk.length > MAX_CHUNK) fail('Invalid block length.');
  }
  const all = Buffer.concat(chunks);
  if (all.length < 2 || all[0] !== 0x1b || all[1] !== 0x40) fail('Invalid receipt header.');
  let p = 0;
  let cut = false;
  const need = n => { if (p + n > all.length) fail('Invalid receipt command.'); };
  while (p < all.length) {
    const b = all[p];
    if (b === 0x0a) { p++; continue; }
    if (b >= 0x20 && b <= 0x7e) { p++; continue; }
    if (b === 0x1b) {
      need(2);
      const cmd = all[p + 1];
      if (cmd === 0x40) { p += 2; continue; }
      if (cmd === 0x61 || cmd === 0x21 || cmd === 0x45 || cmd === 0x4a || cmd === 0x4d || cmd === 0x64) {
        need(3);
        const n = all[p + 2];
        if ((cmd === 0x61 && n > 2) || (cmd === 0x45 && n > 1) || (cmd === 0x4d && n > 1)) fail('Invalid receipt command.');
        p += 3; continue;
      }
      if (cmd === 0x37) { need(5); p += 5; continue; }
      fail('Invalid receipt command.');
    }
    if (b === 0x1d) {
      need(2);
      const cmd = all[p + 1];
      if (cmd === 0x21 || cmd === 0x48 || cmd === 0x68 || cmd === 0x77) { need(3); p += 3; continue; }
      if (cmd === 0x56) {
        need(3);
        const m = all[p + 2];
        if (m === 0 || m === 1 || m === 48 || m === 49) { cut = true; p += 3; continue; }
        if (m === 65 || m === 66) { need(4); cut = true; p += 4; continue; }
        fail('Invalid receipt command.');
      }
      if (cmd === 0x76) {
        need(8);
        if (all[p + 2] !== 0x30 || all[p + 3] !== 0) fail('Invalid raster header.');
        const x = all[p + 4] + all[p + 5] * 256;
        const y = all[p + 6] + all[p + 7] * 256;
        if (x !== ROW_BYTES || y < 1 || y > 64) fail('Invalid raster block.');
        const data = x * y;
        need(8 + data);
        p += 8 + data; continue;
      }
      if (cmd === 0x6b) {
        need(4);
        if (all[p + 2] !== 73) fail('Invalid receipt command.');
        const len = all[p + 3];
        if (len < 2) fail('Invalid receipt command.');
        need(4 + len);
        p += 4 + len; continue;
      }
      fail('Invalid receipt command.');
    }
    fail('Invalid receipt command.');
  }
  if (!cut) fail('Receipt is missing its cut.');
}

module.exports = { validateChunks, MAX_CHUNKS, MAX_CHUNK, ROW_BYTES };
