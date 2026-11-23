'use strict';
// Approximation only. Swap drawWordmark() for the traced path from a clean scan.
function drawLogo(g, width, top, logoWidth) {
  const cx = width / 2;
  g.save();
  g.textAlign = 'center';

  g.font = '20px "Arial Narrow",Arial,sans-serif';
  g.letterSpacing = '7px';
  g.fillText('SASKATOON', cx, top + 22);

  g.letterSpacing = '0px';
  g.font = 'italic bold 74px "Arial Narrow",Arial,sans-serif';
  g.fillText('transit', cx, top + 100);

  // slash through the wordmark with an arrowhead off the final t
  const x0 = cx - logoWidth / 2 + 10, x1 = cx + logoWidth / 2 - 6;
  g.lineWidth = 7;
  g.lineCap = 'butt';
  g.beginPath(); g.moveTo(x0, top + 108); g.lineTo(x1, top + 18); g.stroke();
  g.beginPath();
  g.moveTo(x1, top + 14); g.lineTo(x1 - 17, top + 30); g.lineTo(x1 + 2, top + 36);
  g.closePath(); g.fill();

  g.restore();
}

module.exports = { drawLogo };
