'use strict';
// Guards the costs that pinned a core on the live map: CSS filters on tiles,
// large backdrop blurs, a frame loop that never stopped, and a 4 Hz clock paint.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const read = name => fs.readFileSync(path.join(__dirname, name), 'utf8');
const guideCss = read('city-guide.css');
const illicit = read('illicit-theme.css');
const guide = read('city-guide.js');
const panels = read('city-panels.js');
const main = read('main.js');
const renderer = read('renderer.js');
const leaflet = read('vendor/leaflet/leaflet.css');
const html = read('index.html');

assert.doesNotMatch(guideCss, /\.leaflet-tile-pane\{[^}]*filter\s*:/);
assert.doesNotMatch(guideCss, /\.tiles-night\{[^}]*filter\s*:/);
assert.doesNotMatch(guideCss, /\.tiles-paper\{[^}]*filter\s*:/);
assert.match(guideCss, /\.map-tone-shade\{display:none/);
assert.doesNotMatch(guideCss, /mix-blend-mode/);
assert.doesNotMatch(illicit, /backdrop-filter:\s*blur\(18px\)/);
assert.match(illicit, /\.controls \{ background: #f7fafc;/);
assert.match(guide, /basemaps\.cartocdn\.com\/dark_all\//);
assert.match(guide, /basemaps\.cartocdn\.com\/light_all\//);
assert.doesNotMatch(guide, /className:'tiles-night'/);
assert.doesNotMatch(guide, /className:'tiles-paper'/);
assert.match(html, /https:\/\/basemaps\.cartocdn\.com/);
assert.match(main, /basemaps\\\.cartocdn\\\.com/);
assert.match(main, /backgroundThrottling: false, offscreen: true/);
assert.match(main, /captureOffscreen \? \{backgroundThrottling: false\} : \{\}/);
assert.doesNotMatch(leaflet, /plus-lighter/);

const animate = panels.slice(panels.indexOf('function animate'));
const sampleAt = animate.indexOf('tracker.sample');
const skipAt = animate.indexOf('offscreen=true;continue');
assert.ok(skipAt !== -1 && sampleAt !== -1 && skipAt < sampleAt, 'off-screen buses must skip tracker.sample');
assert.match(panels, /function startFrames\(\)\{if\(!frame&&!document\.hidden\)frame=requestAnimationFrame\(animate\);\}/);
assert.match(panels, /if\(document\.hidden\)\{if\(frame\)\{cancelAnimationFrame\(frame\);frame=0;\}/);
assert.doesNotMatch(panels, /setInterval\(animate/);
assert.match(renderer, /setInterval\(paintClock,1000\)/);
assert.match(renderer, /setInterval\(checkTime,5000\)/);
assert.doesNotMatch(renderer, /setInterval\(paintClock,250\)/);
assert.match(renderer, /if\(paintKey===lastClockPaint\) return;/);
console.log('PASS: tile filters, backdrop blur, frame loop, and clock paint stay cheap.');
