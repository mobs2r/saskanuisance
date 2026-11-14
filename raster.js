'use strict';
const WIDTH = 472;
const ROWS = 64;
function rasterize(bgra, width, height, horizontalOffsetDots = 0) {
  if (![416, 448, WIDTH].includes(width) || !Number.isInteger(height) || height < 1 || height > 2400 || !Number.isInteger(horizontalOffsetDots) || Math.abs(horizontalOffsetDots) >= width) throw new Error('Invalid receipt image dimensions or horizontal offset.');
  if (!Buffer.isBuffer(bgra) || bgra.length !== width * height * 4) throw new Error('Invalid receipt pixel data.');
  const bytesPerRow = width / 8;
  const bitmap = Buffer.alloc(bytesPerRow * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sourceX = x - horizontalOffsetDots;
      if (sourceX < 0 || sourceX >= width) continue;
      const i = (y * width + sourceX) * 4;
      const alpha = bgra[i + 3] / 255;
      const gray = (0.114 * bgra[i] + 0.587 * bgra[i + 1] + 0.299 * bgra[i + 2]) * alpha + 255 * (1 - alpha);
      if (Math.round(gray) < 160) bitmap[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  const chunks = [Buffer.from([0x1b, 0x40, 0x1b, 0x61, 0, 0x1b, 0x4a, 32])];
  for (let y = 0; y < height; y += ROWS) {
    const rows = Math.min(ROWS, height - y);
    const header = Buffer.from([0x1d, 0x76, 0x30, 0, bytesPerRow & 255, bytesPerRow >> 8, rows & 255, rows >> 8]);
    chunks.push(Buffer.concat([header, bitmap.subarray(y * bytesPerRow, (y + rows) * bytesPerRow)]));
  }
  chunks.push(Buffer.from([0x1b, 0x4a, 64]));
  return {width, height, chunks, bytes: chunks.reduce((n, c) => n + c.length, 0)};
}
module.exports = {rasterize, WIDTH, ROWS};
