'use strict';
// Pure camera-feed decisions. The renderer cannot read Last-Modified (connect-src is none),
// so the main process records polls and this module decides which source is fresh.
const STALE_POLLS = 4;
const STALE_AGE_MS = 24 * 60 * 60 * 1000;
const HOTLINE_IMAGE = /^https:\/\/hotline\.gov\.sk\.ca\/map\/Cctv\/\d+(?:\?v=\d{10,13})?$/;

function sourcesOf(cam) {
  const raw = Array.isArray(cam && cam.urls) && cam.urls.length ? cam.urls : (cam && typeof cam.url === 'string' ? [cam.url] : []);
  const out = [];
  for (const url of raw) {
    if (typeof url === 'string' && /^https:\/\/\S+$/.test(url) && !out.includes(url)) out.push(url);
  }
  return out;
}

function signatureOf(reading) {
  if (!reading || reading.ok === false) return null;
  if (reading.lastModified) return 'm:' + reading.lastModified;
  if (reading.etag) return 'e:' + reading.etag;
  if (reading.hash) return 'h:' + reading.hash;
  return null;
}

function notePoll(prev, reading, now = Date.now()) {
  const signature = signatureOf(reading);
  const failed = !reading || reading.ok === false || !signature;
  const unchanged = Boolean(signature && prev && prev.signature === signature);
  const streak = signature ? (unchanged ? (prev && prev.streak || 0) + 1 : 1) : 0;
  const failStreak = failed ? ((prev && prev.failStreak) || 0) + 1 : 0;
  const modifiedAt = reading && reading.lastModified ? Date.parse(reading.lastModified) : NaN;
  const old = Number.isFinite(modifiedAt) && (now - modifiedAt) > STALE_AGE_MS;
  const stale = old || (signature ? streak >= STALE_POLLS : failStreak >= STALE_POLLS);
  return {
    signature,
    streak,
    failStreak,
    stale,
    lastModified: reading && reading.lastModified || null,
    at: now
  };
}

function pickFreshest(readings) {
  const dated = (readings || []).filter(reading => reading && typeof reading.url === 'string' && !reading.stale && reading.lastModified && Number.isFinite(Date.parse(reading.lastModified)));
  if (!dated.length) return null;
  dated.sort((a, b) => Date.parse(b.lastModified) - Date.parse(a.lastModified));
  return dated[0];
}

function camIsStale(cam, health) {
  const urls = sourcesOf(cam);
  if (!urls.length) return true;
  const known = urls.map(url => health && health[url]).filter(Boolean);
  if (known.length < urls.length) return false;
  return known.every(state => state.stale);
}

const api = {STALE_POLLS, STALE_AGE_MS, HOTLINE_IMAGE, sourcesOf, signatureOf, notePoll, pickFreshest, camIsStale};
if (typeof module === 'object' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.YXE_CAMERAS = api;
