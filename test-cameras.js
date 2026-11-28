'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {STALE_POLLS, STALE_AGE_MS, HOTLINE_IMAGE, sourcesOf, notePoll, pickFreshest, camIsStale} = require('./camera-feeds');
const {createCameraProbe} = require('./camera-probe');

const now = Date.parse('2026-11-28T16:00:00Z');
const fresh = new Date(now - 10_000).toUTCString();
const ancient = new Date(now - STALE_AGE_MS - 60_000).toUTCString();

let state = notePoll(null, {ok: true, lastModified: fresh}, now);
assert.equal(state.stale, false);
assert.equal(state.streak, 1);
for (let i = 1; i < STALE_POLLS; i++) state = notePoll(state, {ok: true, lastModified: fresh}, now + i);
assert.equal(state.stale, true);
assert.equal(state.streak, STALE_POLLS);
state = notePoll(state, {ok: true, lastModified: new Date(now).toUTCString()}, now + 1000);
assert.equal(state.stale, false);
assert.equal(state.streak, 1);

const frozen = notePoll(null, {ok: true, lastModified: ancient}, now);
assert.equal(frozen.stale, true);

let failed = null;
for (let i = 0; i < STALE_POLLS; i++) failed = notePoll(failed, {ok: false}, now);
assert.equal(failed.stale, true);
failed = notePoll(failed, {ok: true, lastModified: fresh, hash: 'abc'}, now);
assert.equal(failed.stale, false);

const older = {url: 'https://hotline.gov.sk.ca/map/Cctv/11', lastModified: new Date(now - 20_000).toUTCString(), stale: false};
const newer = {url: 'https://hotline.gov.sk.ca/map/Cctv/12', lastModified: new Date(now - 1_000).toUTCString(), stale: false};
assert.equal(pickFreshest([older, newer]).url, newer.url);
assert.equal(pickFreshest([{...newer, stale: true}, older]).url, older.url);
assert.equal(pickFreshest([{url: newer.url}, {url: older.url}]), null);

const multi = {urls: ['https://hotline.gov.sk.ca/map/Cctv/11', 'https://hotline.gov.sk.ca/map/Cctv/11', 'https://hotline.gov.sk.ca/map/Cctv/12']};
assert.deepEqual(sourcesOf(multi), ['https://hotline.gov.sk.ca/map/Cctv/11', 'https://hotline.gov.sk.ca/map/Cctv/12']);
assert.equal(camIsStale(multi, {}), false);
assert.equal(camIsStale(multi, {
  'https://hotline.gov.sk.ca/map/Cctv/11': {stale: true},
  'https://hotline.gov.sk.ca/map/Cctv/12': {stale: true}
}), true);
assert.equal(camIsStale(multi, {
  'https://hotline.gov.sk.ca/map/Cctv/11': {stale: true},
  'https://hotline.gov.sk.ca/map/Cctv/12': {stale: false, lastModified: fresh}
}), false);

assert.equal(HOTLINE_IMAGE.test('https://hotline.gov.sk.ca/map/Cctv/11'), true);
assert.equal(HOTLINE_IMAGE.test('https://hotline.gov.sk.ca/map/Cctv/11?v=1700000000000'), true);
assert.equal(HOTLINE_IMAGE.test('https://hotline.gov.sk.ca/map/Cctv/abc'), false);
assert.equal(HOTLINE_IMAGE.test('https://hotline.gov.sk.ca/other/11'), false);
assert.equal(HOTLINE_IMAGE.test('https://www.wagondriver.com/USBCamera.jpg'), false);

const main = fs.readFileSync('main.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const places = fs.readFileSync('data/places-data.js', 'utf8');
const sk = fs.readFileSync('data/hotline-sk.js', 'utf8');
assert.match(main, /HOTLINE_IMAGE/);
assert.doesNotMatch(main, /wagondriver/);
assert.match(html, /https:\/\/hotline\.gov\.sk\.ca/);
assert.doesNotMatch(html, /wagondriver/);
assert.match(html, /PhenoCam Network/);
assert.match(html, /Highway Hotline/);
assert.doesNotMatch(places, /wagondriver/);
assert.doesNotMatch(places, /"id":"east"/);
assert.match(places, /"every":15/);
assert.match(sk, /YXE_HOTLINE_SK/);
assert.match(sk, /map\/Cctv\/11/);
assert.match(sk, /map\/Cctv\/12/);

async function probeCheck() {
  const calls = [];
  const probe = createCameraProbe({
    allowed: url => HOTLINE_IMAGE.test(url),
    now: () => now,
    head: async url => { calls.push(url); return {ok: true, lastModified: ancient}; }
  });
  probe.watch([
    {url: 'https://hotline.gov.sk.ca/map/Cctv/11', every: 15},
    {url: 'https://www.wagondriver.com/USBCamera.jpg', every: 15},
    {url: 'https://hotline.gov.sk.ca/not/a-camera', every: 15}
  ], {immediate: false});
  await probe.once();
  probe.stop();
  assert.deepEqual(calls, ['https://hotline.gov.sk.ca/map/Cctv/11']);
  assert.equal(probe.snapshot()['https://hotline.gov.sk.ca/map/Cctv/11'].stale, true);
}
probeCheck().then(() => console.log('camera feeds ok')).catch(error => { console.error(error); process.exit(1); });
