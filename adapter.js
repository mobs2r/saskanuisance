'use strict';
const {createHash} = require('node:crypto');
const {EventEmitter} = require('node:events');

const STATUS = Object.freeze({UNKNOWN:'unknown', LIVE:'live', DEGRADED:'degraded', STALE:'stale', DOWN:'down'});
const RANK = Object.freeze({unknown:0, live:0, degraded:1, stale:2, down:3});
const POLICIES = Object.freeze({
  A: Object.freeze({refreshMs:5*60*1000, staleAfterMs:20*60*1000, missesBeforeAlarm:2, timeoutMs:8000}),
  B: Object.freeze({refreshMs:60*1000,    staleAfterMs:180*1000,   missesBeforeAlarm:2, timeoutMs:8000}),
  C: Object.freeze({refreshMs:5*60*1000,  staleAfterMs:15*60*1000,  missesBeforeAlarm:1, timeoutMs:10000}),
  D: Object.freeze({refreshMs:10*60*1000, staleAfterMs:30*60*1000,  missesBeforeAlarm:1, timeoutMs:12000})
});
const clean = (value, max = 200) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value ?? null);
}

class Adapter extends EventEmitter {
  constructor({id, label, tier = 'B', url, accept = 'application/json', maxBytes = 2 * 1024 * 1024, parse = null, normalise = null, ring = null, now, fetcher = globalThis.fetch}) {
    super();
    if (!/^[a-z][a-z0-9-]{0,40}$/.test(id || '')) throw new Error('Adapter needs a slug id.');
    if (typeof url !== 'string' || !/^https:\/\//.test(url)) throw new Error('Adapter needs an https URL.');
    if (!POLICIES[tier]) throw new Error('Unknown tier ' + tier + '.');
    this.id = id; this.label = label || id; this.tier = tier; this.url = url;
    this.accept = accept; this.maxBytes = maxBytes; this.parse = parse; this.normalise = normalise;
    this.ring = ring; this.now = now; this.fetcher = fetcher; this.policy = POLICIES[tier];
    this.data = null; this.hash = null; this.drift = false; this.driftAt = null;
    this.bytes = 0; this.itemCount = 0; this.fetchedAt = null; this.fetchedMono = null;
    this.attempted = null; this.error = null; this.misses = 0; this.pending = null; this.stopped = false; this.timer = null;
  }

  start() {
    this.stopped = false;
    if (!this.timer) { this.timer = setInterval(() => { this.refresh().catch(() => {}); }, this.policy.refreshMs); this.timer.unref?.(); }
    return this.refresh();
  }

  stop() { this.stopped = true; clearInterval(this.timer); this.timer = null; }

  async probe() {
    const started = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.policy.timeoutMs);
      try {
        const response = await this.fetcher(this.url, {method: 'HEAD', redirect: 'error', signal: controller.signal});
        return {ok: response.ok, status: response.status, latencyMs: Date.now() - started};
      } finally { clearTimeout(timer); }
    } catch (error) { return {ok: false, reason: clean(error?.message || error, 80), latencyMs: Date.now() - started}; }
  }

  async get() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.policy.timeoutMs);
    try {
      const response = await this.fetcher(this.url, {headers: {Accept: this.accept, 'Accept-Encoding': 'identity', 'Cache-Control': 'no-cache'}, redirect: 'error', signal: controller.signal});
      if (!response.ok) throw new Error('HTTP ' + response.status);
      if (Number(response.headers.get('content-length') || 0) > this.maxBytes) throw new Error('Response exceeds ' + this.maxBytes + ' bytes.');
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > this.maxBytes) throw new Error('Response exceeds ' + this.maxBytes + ' bytes.');
      return buffer;
    } finally { clearTimeout(timer); }
  }

  refresh() {
    if (this.stopped) return Promise.resolve(this.snapshot());
    if (this.pending) return this.pending;
    this.pending = this.cycle().finally(() => { this.pending = null; });
    return this.pending;
  }

  async cycle() {
    const at = this.fetchedMono === null ? -Infinity : performance.now();
    if (this.attempted !== null && at - this.attempted >= 0 && at - this.attempted < this.policy.refreshMs) return this.snapshot();
    this.attempted = performance.now();
    const started = Date.now();
    try {
      const body = await this.get();
      const latencyMs = Date.now() - started;
      const parsed = this.parse ? await this.parse(body, this) : {bytes: body.length, text: body.toString('utf8')};
      const normalised = this.normalise ? await this.normalise(parsed) : parsed;
      const hash = createHash('sha256').update(canonical(normalised)).digest('hex');
      const drift = this.hash !== null && this.hash !== hash;
      this.data = normalised; this.hash = hash; this.bytes = body.length;
      this.itemCount = Array.isArray(normalised?.items) ? normalised.items.length : 0;
      this.fetchedAt = this.now(); this.fetchedMono = performance.now();
      this.error = null; this.misses = 0;
      if (drift) { this.drift = true; this.driftAt = this.fetchedAt; this.emit('drift', {id: this.id, hash}); }
      await this.ring?.append({type: 'sample', id: this.id, at: this.fetchedAt, hash, bytes: body.length, latencyMs}).catch(() => {});
      this.emit('sample', this.snapshot());
    } catch (error) {
      this.misses++;
      this.error = clean(error?.message || error);
      await this.ring?.append({type: 'miss', id: this.id, at: this.now(), error: this.error}).catch(() => {});
      this.emit('miss', {id: this.id, error: this.error, misses: this.misses});
    }
    return this.snapshot();
  }

  status() {
    if (!this.data) return this.misses >= this.policy.missesBeforeAlarm ? STATUS.DOWN : STATUS.UNKNOWN;
    const age = this.fetchedAt === null ? null : this.now() - this.fetchedAt;
    if (age !== null && age > this.policy.staleAfterMs) return STATUS.STALE;
    if (this.error) return STATUS.DEGRADED;
    return STATUS.LIVE;
  }

  snapshot() {
    const status = this.status();
    const age = this.fetchedAt === null ? null : Math.max(0, this.now() - this.fetchedAt);
    return Object.freeze({id: this.id, label: this.label, tier: this.tier, status, rank: RANK[status],
      sourceUrl: this.url, fetchedAt: this.fetchedAt, ageMs: age, staleAfterMs: this.policy.staleAfterMs,
      hash: this.hash, drift: this.drift, driftAt: this.driftAt, misses: this.misses,
      bytes: this.bytes, itemCount: this.itemCount, error: this.error, data: this.data});
  }
}

module.exports = {Adapter, STATUS, RANK, POLICIES, canonical, clean};
