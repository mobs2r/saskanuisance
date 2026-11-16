'use strict';
const {EventEmitter} = require('node:events');
const {RANK, STATUS} = require('./adapter');

const WORST = Object.freeze(Object.fromEntries(Object.entries(RANK).map(([key, rank]) => [rank, key])));

class SignalBus extends EventEmitter {
  constructor() { super(); this.adapters = new Map(); }

  register(adapter) {
    if (this.adapters.has(adapter.id)) throw new Error('Duplicate adapter ' + adapter.id + '.');
    this.adapters.set(adapter.id, adapter);
    for (const event of ['sample', 'miss', 'drift']) adapter.on(event, payload => this.emit('change', {event, ...payload}));
    return adapter;
  }

  get(id) { return this.adapters.get(id) || null; }

  summary() {
    const rows = [...this.adapters.values()].map(adapter => {
      const snapshot = adapter.snapshot();
      const {data, ...rest} = snapshot;
      return rest;
    }).sort((a, b) => b.rank - a.rank || a.id.localeCompare(b.id));
    const worst = rows.reduce((top, row) => Math.max(top, row.rank), 0);
    const counts = rows.reduce((tally, row) => { tally[row.status] = (tally[row.status] || 0) + 1; return tally; }, {});
    return Object.freeze({status: WORST[worst] || STATUS.UNKNOWN, worstRank: worst, counts, generatedAt: Date.now(), sources: Object.freeze(rows)});
  }

  stopAll() { for (const adapter of this.adapters.values()) adapter.stop(); this.adapters.clear(); }
}

module.exports = {SignalBus};
