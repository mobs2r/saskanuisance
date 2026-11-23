'use strict';
// 57 mm direct-thermal stock, 203 dpi (8 dots/mm), 448-dot print area.
// Every value is an integer dot count. No mm arithmetic at draw time.
const WIDTH = 448;

const PROFILE = Object.freeze({
  id: 'roll57',
  label: '57 mm',
  width: WIDTH,
  dotsPerMm: 8,
  paperMm: 57,
  printMm: 56,
  horizontalOffsetDots: -32,
  topMarginDots: 96,        // ~12 mm blank above the mark
  cutterFeedDots: 88,
  height: 628,
  // baselines, dots from the first printable row
  y: Object.freeze({
    logoTop: 0,
    logoWidth: 300,
    headline: 326,
    label: 382,
    time: 448,
    date: 500,
    footer: 556
  })
});

function profileFor(id) {
  if (id !== 'roll57') throw new Error('Unsupported paper layout.');
  return PROFILE;
}
function savedProfile() { return 'roll57'; }

module.exports = { PROFILE, WIDTH, profileFor, savedProfile };
