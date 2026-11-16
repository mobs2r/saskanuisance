'use strict';
const assert = require('node:assert/strict');
const {Adapter, canonical, STATUS} = require('./adapter');

const reply = (body, status = 200) => async () => ({ok: status < 400, status,
  headers: new Map([['content-length', String(Buffer.byteLength(body))]]),
  arrayBuffer: async () => Buffer.from(body)});

(async () => {
  assert.equal(canonical({b: 1, a: [2, {d: 3, c: 4}]}), '{"a":[2,{"c":4,"d":3}],"b":1}');
  let clock = 1_000_000;
  const now = () => clock;
  const a = new Adapter({id: 't', tier: 'A', url: 'https://x.test/a', now, fetcher: reply('{"v":1}')});
  assert.equal(a.snapshot().status, STATUS.UNKNOWN);
  await a.refresh();
  assert.equal(a.snapshot().status, STATUS.LIVE);
  const first = a.hash;
  clock += 6 * 60 * 1000;
  a.policy = {...a.policy, refreshMs: 0};
  await a.refresh();
  assert.equal(a.snapshot().drift, false, 'Identical payload must not raise drift');
  assert.equal(a.hash, first);
  await a.refresh().then(() => {});
  const b = new Adapter({id: 'u', tier: 'A', url: 'https://x.test/b', now, fetcher: reply('{"v":1}')});
  await b.refresh();
  b.fetcher = reply('{"v":2}');
  b.policy = {...b.policy, refreshMs: 0};
  await b.refresh();
  assert.equal(b.snapshot().drift, true, 'Changed payload must raise drift');
  clock += 40 * 60 * 1000;
  assert.equal(b.snapshot().status, STATUS.STALE, 'Aged data must read stale');
  const c = new Adapter({id: 'w', tier: 'C', url: 'https://x.test/c', now, fetcher: async () => { throw new Error('boom'); }});
  await c.refresh();
  assert.equal(c.snapshot().status, STATUS.DOWN, 'Tier C alarms on first miss');
  assert.equal(c.snapshot().data, null);
  console.log('adapter tests passed');
})().catch(error => { console.error(error); process.exit(1); });
