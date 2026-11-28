'use strict';
const https = require('node:https');
const crypto = require('node:crypto');
const {notePoll} = require('./camera-feeds');

function defaultHead(url) {
  return new Promise(resolve => {
    let settled = false;
    const done = value => { if (!settled) { settled = true; resolve(value); } };
    const req = https.request(url, {method: 'HEAD', timeout: 4000, headers: {'User-Agent': 'IllicitSampleReceipt/1.6'}}, res => {
      res.resume();
      const reading = {
        ok: res.statusCode >= 200 && res.statusCode < 400,
        lastModified: res.headers['last-modified'] || null,
        etag: res.headers.etag || null,
        hash: null
      };
      if (reading.ok && !reading.lastModified && !reading.etag) {
        hashBody(url).then(done, () => done(reading));
        return;
      }
      done(reading);
    });
    req.on('timeout', () => { req.destroy(); done({ok: false}); });
    req.on('error', () => done({ok: false}));
    req.end();
  });
}

function hashBody(url) {
  return new Promise(resolve => {
    const hash = crypto.createHash('sha256');
    let size = 0;
    const req = https.request(url, {method: 'GET', timeout: 4000, headers: {'User-Agent': 'IllicitSampleReceipt/1.6'}}, res => {
      if (res.statusCode < 200 || res.statusCode >= 400) { res.resume(); resolve({ok: false}); return; }
      res.on('data', chunk => {
        size += chunk.length;
        if (size <= 262144) hash.update(chunk);
        if (size > 262144) res.destroy();
      });
      res.on('end', () => resolve({ok: true, lastModified: res.headers['last-modified'] || null, etag: res.headers.etag || null, hash: hash.digest('hex')}));
      res.on('error', () => resolve({ok: false}));
    });
    req.on('timeout', () => { req.destroy(); resolve({ok: false}); });
    req.on('error', () => resolve({ok: false}));
    req.end();
  });
}

function createCameraProbe({allowed = () => true, head = defaultHead, now = () => Date.now(), intervalMs = 15000} = {}) {
  const state = new Map();
  let urls = [];
  let timer = null;
  let running = false;
  function sanitize(items) {
    const out = [];
    const seen = new Set();
    for (const item of Array.isArray(items) ? items : []) {
      if (!item || typeof item.url !== 'string' || item.url.length > 180 || seen.has(item.url) || !allowed(item.url)) continue;
      const every = Number(item.every);
      seen.add(item.url);
      out.push({url: item.url, every: Number.isFinite(every) ? Math.min(3600, Math.max(15, every)) : 60});
      if (out.length >= 24) break;
    }
    return out;
  }
  async function once() {
    if (running) return;
    running = true;
    try {
      const at = now();
      for (const item of urls) {
        const prev = state.get(item.url);
        if (prev && prev.nextAt && at < prev.nextAt) continue;
        let reading;
        try { reading = await head(item.url); } catch { reading = {ok: false}; }
        const noted = notePoll(prev, reading, at);
        noted.nextAt = at + item.every * 1000;
        state.set(item.url, noted);
      }
    } finally { running = false; }
  }
  function arm(delay) {
    if (timer) clearTimeout(timer);
    if (!urls.length) return;
    timer = setTimeout(() => { once().finally(() => { if (urls.length) arm(intervalMs); }); }, delay);
    if (timer.unref) timer.unref();
  }
  function watch(items, options = {}) {
    urls = sanitize(items);
    if (!urls.length) { stop(); return; }
    arm(options.immediate === false ? intervalMs : 0);
  }
  function snapshot() {
    const out = {};
    for (const [url, value] of state) out[url] = {stale: Boolean(value.stale), streak: value.streak || 0, lastModified: value.lastModified || null};
    return out;
  }
  function stop() {
    if (timer) clearTimeout(timer);
    timer = null;
    urls = [];
  }
  return {watch, snapshot, stop, once};
}

module.exports = {createCameraProbe};
