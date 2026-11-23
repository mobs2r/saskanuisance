'use strict';
const { PROFILE } = require('./paper-profiles');
const { stamp, validUntil } = require('./print-time');
const { drawLogo } = require('./logo');

const FAMILY = '"Arial Narrow","Liberation Sans Narrow","Helvetica Condensed",Arial,sans-serif';
const FOOTER = [
  'Proof of Payment permits transfers prior to time noted above.',
  'Present at boarding/ on request',
  'to avoid fines/removal.'
];

// issuedAt: Date. Returns raw BGRA for rasterize().
function renderReceipt(issuedAt, canvasFactory = defaultCanvas) {
  const { width, y, height } = PROFILE;
  const s = stamp(validUntil(issuedAt).getTime());
  const c = canvasFactory(width, height);
  const g = c.getContext('2d');

  g.imageSmoothingEnabled = false;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, width, height);
  g.fillStyle = '#1a1a1a';
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';

  drawLogo(g, width, y.logoTop, y.logoWidth);

  g.font = `59px ${FAMILY}`;
  g.fillText('Proof of Payment', width / 2, y.headline);

  g.font = `32px ${FAMILY}`;
  g.fillText('Valid Until:', width / 2, y.label);

  g.font = `bold 50px ${FAMILY}`;
  g.fillText(s.time, width / 2, y.time);
  g.fillText(s.date, width / 2, y.date);   // stamp() already omits the comma space

  g.font = `14px ${FAMILY}`;
  FOOTER.forEach((line, i) => g.fillText(line, width / 2, y.footer + i * 16));

  const { data } = g.getImageData(0, 0, width, height);
  return { bgra: Buffer.from(data.buffer, data.byteOffset, data.byteLength), width, height };
}

function defaultCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

module.exports = { renderReceipt, FOOTER, FAMILY };
