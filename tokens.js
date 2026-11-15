'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const {randomUUID} = require('node:crypto');

let file = null;
const defaults = () => ({version: 1, selected: null, tokens: []});

function init(dir) { file = path.join(dir, 'tokens.json'); }

async function load() {
  if (!file) throw new Error('Token store not initialised.');
  try {
    const data = JSON.parse(await fs.readFile(file, 'utf8'));
    if (!Array.isArray(data.tokens)) return defaults();
    return data;
  } catch { return defaults(); }
}

async function save(data) {
  await fs.mkdir(path.dirname(file), {recursive: true});
  await fs.writeFile(file, JSON.stringify(data, null, 2), 'utf8');
  return data;
}

async function add({label, payload, issuedAt} = {}) {
  const value = String(payload == null ? '' : payload).trim();
  if (!/^\d{8}$/.test(value)) throw new Error('Ticket must be 8 digits.');
  const data = await load();
  if (data.tokens.some(token => token.payload === value)) throw new Error('That ticket is already saved.');
  const token = {
    id: randomUUID(),
    label: String(label || 'Ticket').trim().slice(0, 40) || 'Ticket',
    payload: value,
    issuedAt: Number(issuedAt) || Date.now(),
    used: false
  };
  data.tokens.unshift(token);
  data.selected = token.id;
  await save(data);
  return token;
}

async function remove(id) {
  const data = await load();
  data.tokens = data.tokens.filter(token => token.id !== id);
  if (data.selected === id) data.selected = data.tokens[0] ? data.tokens[0].id : null;
  await save(data);
  return data;
}

async function select(id) {
  const data = await load();
  if (id && !data.tokens.some(token => token.id === id)) throw new Error('Unknown ticket.');
  data.selected = id || null;
  await save(data);
  return data;
}

async function current() {
  const data = await load();
  return data.tokens.find(token => token.id === data.selected) || null;
}

module.exports = {init, load, add, remove, select, current};
