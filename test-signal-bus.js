'use strict';
const assert = require('node:assert/strict');
const {SignalBus} = require('./signal-bus');
const {Adapter, STATUS} = require('./adapter');

(async () => {
  const bus = new SignalBus();
  const now = () => Date.now();
  const ok = bus.register(new Adapter({id: 'a', tier: 'A', url: 'https://x.test/a', now, fetcher: async () => ({ok: true, status: 200, headers: new Map(), arrayBuffer: async () => Buffer.from('{}')})}));
  const bad = bus.register(new Adapter({id: 'b', tier: 'C', url: 'https://x.test/b', now, fetcher: async () => { throw new Error('boom'); }}));
  await ok.refresh(); await bad.refresh();
  const summary = bus.summary();
  assert.equal(summary.status, STATUS.DOWN, 'Worst source wins');
  assert.equal(summary.sources[0].id, 'b', 'Ranked worst first');
  assert.equal(summary.sources[0].data, undefined, 'Summaries exclude payloads');
  let changes = 0; bus.on('change', () => changes++);
  ok.policy = {...ok.policy, refreshMs: 0};
  await ok.refresh();
  assert.ok(changes >= 1);
  bus.stopAll();
  console.log('signal bus tests passed');
})().catch(error => { console.error(error); process.exit(1); });
