'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');

class RingBuffer {
  constructor({dir, id, maxBytes = 2 * 1024 * 1024, maxLines = 20000}) {
    if (typeof dir !== 'string' || !dir) throw new Error('Ring needs a directory.');
    if (!/^[a-z][a-z0-9-]{0,40}$/.test(id || '')) throw new Error('Ring needs a slug id.');
    this.dir = dir; this.id = id; this.maxBytes = maxBytes; this.maxLines = maxLines;
    this.file = path.join(dir, id + '.jsonl'); this.bytes = 0; this.lines = 0; this.chain = Promise.resolve();
  }

  async init() {
    await fs.mkdir(this.dir, {recursive: true});
    try {
      const stat = await fs.stat(this.file);
      this.bytes = stat.size;
      this.lines = (await fs.readFile(this.file, 'utf8')).split('\n').filter(Boolean).length;
      if (this.bytes > this.maxBytes || this.lines > this.maxLines) await this.compact();
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return this;
  }

  append(record) {
    const line = JSON.stringify(record) + '\n';
    this.chain = this.chain.then(async () => {
      await fs.mkdir(this.dir, {recursive: true});
      await fs.appendFile(this.file, line, 'utf8');
      this.bytes += Buffer.byteLength(line); this.lines++;
      if (this.bytes > this.maxBytes || this.lines > this.maxLines) await this.compact();
    });
    return this.chain;
  }

  async compact() {
    let kept = [];
    try { kept = (await fs.readFile(this.file, 'utf8')).split('\n').filter(Boolean).slice(-Math.floor(this.maxLines / 2)); } catch {}
    const trimmed = []; let total = 0;
    for (let i = kept.length - 1; i >= 0; i--) { total += Buffer.byteLength(kept[i]) + 1; if (total > this.maxBytes / 2) break; trimmed.unshift(kept[i]); }
    const text = trimmed.length ? trimmed.join('\n') + '\n' : '';
    await fs.writeFile(this.file + '.tmp', text, 'utf8');
    await fs.rename(this.file + '.tmp', this.file);
    this.bytes = Buffer.byteLength(text); this.lines = trimmed.length;
  }

  async recent(count = 50) {
    const limit = Math.max(1, Math.min(500, Number(count) || 50));
    try {
      const rows = (await fs.readFile(this.file, 'utf8')).split('\n').filter(Boolean).slice(-limit);
      return rows.map(row => { try { return JSON.parse(row); } catch { return null; } }).filter(Boolean);
    } catch { return []; }
  }
}

module.exports = {RingBuffer};
