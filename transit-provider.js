'use strict';

const {scheduleState, sortNotices} = require('./service-hours');
const https = require('node:https');
const fs = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');
const {promisify} = require('node:util');
const {performance} = require('node:perf_hooks');
const {createHash} = require('node:crypto');
const inflateRaw = promisify(zlib.inflateRaw);
const immediate = () => new Promise(resolve => setImmediate(resolve));
const ZONE = 'America/Regina';
const POLL_MS = 30000;
const STALE_MS = 90000;
const STATIC_MS = 6 * 60 * 60 * 1000;
const URLS = Object.freeze({
  static: 'https://apps5.saskatoon.ca/data/gtfs/google_transit.zip',
  vehicles: 'https://saskprdtmgtfs.sasktrpcloud.com/TMGTFSRealTimeWebService/Vehicle/VehiclePositions.pb',
  tripUpdates: 'https://saskprdtmgtfs.sasktrpcloud.com/TMGTFSRealTimeWebService/TripUpdate/TripUpdates.pb',

  alerts: 'https://saskprdtmgtfs.sasktrpcloud.com/TMGTFSRealTimeWebService/Alert/Alerts.pb'
});
const SOURCE = 'https://www.saskatoon.ca/moving-around/transit/open-data-saskatoon-transit';
const ATTRIBUTION = 'Data provided by City of Saskatoon / Saskatoon Transit';
const LIMITS = Object.freeze({zip: 25 * 1024 * 1024, entry: 48 * 1024 * 1024,
  inflated: 80 * 1024 * 1024, protobuf: 8 * 1024 * 1024, rows: 1000000,
  entities: 20000, fields: 1000000, text: 8192, shapes: 300000});
const cleanText = (value, max = 256) => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);
const idText = value => cleanText(value, 160);
const errorText = error => cleanText(error?.message || error?.code || 'Transit source unavailable.');
const finite = value => value !== '' && value != null && Number.isFinite(Number(value)) ? Number(value) : null;
const integer = value => /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
const color = value => /^[a-f\d]{6}$/i.test(value || '') ? '#' + value : null;
const hash = buffer => createHash('sha256').update(buffer).digest('hex');
function trustedNow(fn) {
  try { const n = fn(); return typeof n === 'number' && Number.isFinite(n) && n >= Date.UTC(2020, 0, 1) && n < Date.UTC(2100, 0, 1) ? n : null; }
  catch { return null; }
}

function fetchOfficial(url, {etag, signal} = {}) {
  if (!Object.values(URLS).includes(url)) return Promise.reject(new Error('Transit endpoint is not allowlisted.'));
  const max = url === URLS.static ? LIMITS.zip : LIMITS.protobuf;
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? reject(error) : resolve(result);
    };
    const headers = {'User-Agent': 'SampleReceipt-SaskatoonTransit/1.0', 'Accept-Encoding': 'identity', 'Cache-Control': 'no-cache'};
    if (typeof etag === 'string' && etag.length <= 1024 && !/[\r\n]/.test(etag)) headers['If-None-Match'] = etag;
    const request = https.get(url, {headers, signal, agent: false}, response => {
      if (response.statusCode === 304 && url === URLS.static) {
        response.resume(); finish(null, {status: 304, body: null, etag}); return;
      }
      if (response.statusCode !== 200) {
        response.resume(); finish(new Error('Transit source returned HTTP ' + response.statusCode + '.')); return;
      }
      if ((response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') || Number(response.headers['content-length'] || 0) > max) {
        response.destroy(); finish(new Error('Transit response exceeds download limits.')); return;
      }
      const chunks = [];
      let length = 0;
      response.on('data', chunk => {
        length += chunk.length;
        if (length > max) { request.destroy(); finish(new Error('Transit download too large.')); }
        else chunks.push(chunk);
      });
      response.on('error', error => finish(error));
      response.on('aborted', () => finish(new Error('Transit download interrupted.')));
      response.on('end', () => finish(null, {status: 200, body: Buffer.concat(chunks), etag: response.headers.etag || null}));
    });
    timer = setTimeout(() => { request.destroy(); finish(new Error('Transit request timed out.')); }, 20000);
    request.on('error', error => finish(error));
  });
}

const CRC_TABLE = Array.from({length: 256}, (_, n) => {
  for (let j = 0; j < 8; j++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
async function readZip(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22 || buffer.length > LIMITS.zip) throw new Error('Invalid GTFS ZIP size.');
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50 && i + 22 + buffer.readUInt16LE(i + 20) === buffer.length) { end = i; break; }
  }
  if (end < 0) throw new Error('Missing ZIP directory.');
  const entries = buffer.readUInt16LE(end + 10);
  const size = buffer.readUInt32LE(end + 12);
  let pos = buffer.readUInt32LE(end + 16);
  if (buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6) || entries !== buffer.readUInt16LE(end + 8) || entries > 100 || pos + size !== end) throw new Error('Unsupported ZIP directory.');
  const wanted = new Set(['routes.txt', 'stops.txt', 'trips.txt', 'stop_times.txt', 'calendar.txt', 'calendar_dates.txt', 'shapes.txt', 'frequencies.txt']);
  const files = new Map();
  let total = 0;
  for (let i = 0; i < entries; i++) {
    if (pos + 46 > end || buffer.readUInt32LE(pos) !== 0x02014b50) throw new Error('Invalid ZIP entry.');
    const flags = buffer.readUInt16LE(pos + 8), method = buffer.readUInt16LE(pos + 10);
    const crc = buffer.readUInt32LE(pos + 16), compressed = buffer.readUInt32LE(pos + 20), expanded = buffer.readUInt32LE(pos + 24);
    const nameLen = buffer.readUInt16LE(pos + 28), extraLen = buffer.readUInt16LE(pos + 30), commentLen = buffer.readUInt16LE(pos + 32);
    const local = buffer.readUInt32LE(pos + 42);
    const next = pos + 46 + nameLen + extraLen + commentLen;
    if (next > end || (flags & 1) || ![0, 8].includes(method) || expanded > LIMITS.entry || compressed > LIMITS.zip || local + 30 > pos) throw new Error('Unsupported or oversized ZIP entry.');
    total += expanded;
    if (total > LIMITS.inflated) throw new Error('GTFS inflated size limit exceeded.');
    const name = buffer.subarray(pos + 46, pos + 46 + nameLen).toString('utf8');
    if (wanted.has(name)) {
      if (files.has(name) || buffer.readUInt32LE(local) !== 0x04034b50) throw new Error('Invalid or duplicate ZIP file.');
      const localName = buffer.readUInt16LE(local + 26), localExtra = buffer.readUInt16LE(local + 28);
      const start = local + 30 + localName + localExtra;
      if (start + compressed > pos || buffer.readUInt16LE(local + 8) !== method || buffer.readUInt16LE(local + 6) !== flags || buffer.subarray(local + 30, local + 30 + localName).toString('utf8') !== name) throw new Error('ZIP header mismatch.');
      const raw = buffer.subarray(start, start + compressed);
      const bytes = method === 0 ? raw : await inflateRaw(raw, {maxOutputLength: Math.max(1, expanded)});
      if (bytes.length !== expanded || crc32(bytes) !== crc) throw new Error('ZIP integrity check failed.');
      files.set(name, bytes.toString('utf8'));
    }
    pos = next;
  }
  if (pos !== end) throw new Error('ZIP directory size mismatch.');
  for (const name of ['routes.txt', 'stops.txt', 'trips.txt', 'stop_times.txt']) if (!files.has(name)) throw new Error('GTFS is missing ' + name + '.');
  if (!files.has('calendar.txt') && !files.has('calendar_dates.txt')) throw new Error('GTFS has no service calendar.');
  return files;
}

function* csvRows(input) {
  if (typeof input !== 'string' || input.length > LIMITS.entry) throw new Error('CSV size limit exceeded.');
  const text = input.replace(/^\ufeff/, '');
  let row = [], value = '', quoted = false, closed = false, count = 0;
  for (let i = 0; i <= text.length; i++) {
    const c = i === text.length ? '\n' : text[i];
    if (quoted) {
      if (i === text.length) throw new Error('Unterminated CSV quote.');
      if (c === '"') { if (text[i + 1] === '"') { value += '"'; i++; } else { quoted = false; closed = true; } }
      else value += c;
    } else if (c === '"') {
      if (value.trim() || closed) throw new Error('Unexpected CSV quote.');
      value = ''; quoted = true;
    } else if (c === ',' || c === '\n' || c === '\r') {
      row.push(value.trim()); value = ''; closed = false;
      if (row.length > 80) throw new Error('Too many CSV columns.');
      if (c !== ',') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        if (row.some(cell => cell !== '')) { if (++count > LIMITS.rows) throw new Error('CSV row limit exceeded.'); yield row; }
        row = [];
      }
    } else {
      if (closed && !/\s/.test(c)) throw new Error('Text after CSV quote.');
      value += c;
    }
    if (value.length > LIMITS.text) throw new Error('CSV field too long.');
  }
}
async function readTable(files, name, required, visit) {
  if (!files.has(name)) return;
  let headers = null, count = 0;
  for (const cells of csvRows(files.get(name))) {
    if (!headers) {
      headers = cells;
      if (new Set(headers).size !== headers.length || required.some(key => !headers.includes(key))) throw new Error('Invalid GTFS columns in ' + name + '.');
      continue;
    }
    if (cells.length > headers.length) throw new Error('GTFS column mismatch in ' + name + '.');
    const row = Object.create(null);
    headers.forEach((header, i) => { row[header] = cells[i] || ''; });
    visit(row);
    if (++count % 4096 === 0) await immediate();
  }
  if (!headers) throw new Error('Empty GTFS table: ' + name + '.');
}
function dateNumber(key) {
  if (!/^\d{8}$/.test(key || '')) return null;
  const y = Number(key.slice(0, 4)), m = Number(key.slice(4, 6)), d = Number(key.slice(6));
  const n = Date.UTC(y, m - 1, d);
  return y >= 2000 && y <= 2100 && new Date(n).toISOString().slice(0, 10).replaceAll('-', '') === key ? n : null;
}
function addDate(key, days) { return new Date(dateNumber(key) + days * 86400000).toISOString().slice(0, 10).replaceAll('-', ''); }
const dateFormatter = new Intl.DateTimeFormat('en-CA', {timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit'});
function serviceDate(epoch) {
  const p = Object.fromEntries(dateFormatter.formatToParts(epoch).map(x => [x.type, x.value]));
  return p.year + p.month + p.day;
}

function serviceMidnight(key) { return dateNumber(key) + 6 * 3600000; }
function gtfsSeconds(value) {
  const m = /^(\d{1,2}):([0-5]\d):([0-5]\d)$/.exec(value || '');
  return m && Number(m[1]) < 72 ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}
async function parseStatic(files) {
  const data = {routes: new Map(), stops: new Map(), trips: new Map(), times: new Map(), tripStops: new Map(), calendar: new Map(), exceptions: new Map(), shapes: new Map(), stopTimes: 0, maxSeconds: 86400, warnings: 0, coverage: {startDate: null, endDate: null}};
  data.hasFrequencies = files.has('frequencies.txt') && [...csvRows(files.get('frequencies.txt'))].length > 1;
  const cover = key => { if (!data.coverage.startDate || key < data.coverage.startDate) data.coverage.startDate = key; if (!data.coverage.endDate || key > data.coverage.endDate) data.coverage.endDate = key; };
  await readTable(files, 'routes.txt', ['route_id'], r => {
    const id = idText(r.route_id); if (!id) return;
    data.routes.set(id, {id, shortName: cleanText(r.route_short_name, 32), longName: cleanText(r.route_long_name), color: color(r.route_color), textColor: color(r.route_text_color), colorSource: color(r.route_color) ? 'GTFS routes.route_color' : null, routeType: integer(r.route_type), agencyId: idText(r.agency_id) || null});
  });
  await readTable(files, 'stops.txt', ['stop_id', 'stop_name', 'stop_lat', 'stop_lon'], r => {
    const id = idText(r.stop_id), latitude = finite(r.stop_lat), longitude = finite(r.stop_lon);
    if (!id || latitude === null || longitude === null || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) { data.warnings++; return; }
    const locationType = r.location_type === '' || r.location_type === undefined ? 0 : integer(r.location_type);
    data.stops.set(id, {id, code: cleanText(r.stop_code, 32), name: cleanText(r.stop_name), latitude, longitude, routeIds: new Set(), locationType: locationType !== null && locationType <= 4 ? locationType : null, locationTypeSource: r.location_type ? 'GTFS stops.location_type' : 'GTFS default location_type=0', parentStation: idText(r.parent_station) || null, classification: 'unknown', classificationSource: null, classificationLabel: 'Stop type unconfirmed',wheelchairBoarding:({'1':'yes','2':'no'})[cleanText(r.wheelchair_boarding)]||'unknown'});
  });
  await readTable(files, 'trips.txt', ['route_id', 'service_id', 'trip_id'], r => {
    const id = idText(r.trip_id), routeId = idText(r.route_id), serviceId = idText(r.service_id);
    if (!id || !serviceId || !data.routes.has(routeId)) { data.warnings++; return; }
    data.trips.set(id, {id, routeId, serviceId, headsign: cleanText(r.trip_headsign), directionId: ['0', '1'].includes(r.direction_id) ? Number(r.direction_id) : null, shapeId: idText(r.shape_id), firstSeconds: Infinity, lastSeconds: 0});
  });
  await readTable(files, 'calendar.txt', ['service_id', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'start_date', 'end_date'], r => {
    if (dateNumber(r.start_date) === null || dateNumber(r.end_date) === null || r.end_date < r.start_date) throw new Error('Invalid GTFS calendar date.');
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].map(k => r[k] === '1');
    data.calendar.set(idText(r.service_id), {start: r.start_date, end: r.end_date, days}); cover(r.start_date); cover(r.end_date);
  });
  await readTable(files, 'calendar_dates.txt', ['service_id', 'date', 'exception_type'], r => {
    if (dateNumber(r.date) === null || !['1', '2'].includes(r.exception_type)) throw new Error('Invalid GTFS calendar exception.');
    const id = idText(r.service_id);
    if (!data.exceptions.has(id)) data.exceptions.set(id, new Map());
    data.exceptions.get(id).set(r.date, Number(r.exception_type));
    if (r.exception_type === '1') cover(r.date);
  });
  await readTable(files, 'stop_times.txt', ['trip_id', 'arrival_time', 'departure_time', 'stop_id', 'stop_sequence'], r => {
    const trip = data.trips.get(idText(r.trip_id)), stop = data.stops.get(idText(r.stop_id));
    const departure = gtfsSeconds(r.departure_time || r.arrival_time), arrival = gtfsSeconds(r.arrival_time || r.departure_time), sequence = integer(r.stop_sequence);
    if (!trip || !stop || departure === null || arrival === null || sequence === null) { data.warnings++; return; }
    if (!data.times.has(stop.id)) data.times.set(stop.id, []);
    const time = {tripId: trip.id, stopId: stop.id, sequence, departure, arrival, pickup: r.pickup_type !== '1'};
    data.times.get(stop.id).push(time);
    if (!data.tripStops.has(trip.id)) data.tripStops.set(trip.id, []);
    data.tripStops.get(trip.id).push(time);
    stop.routeIds.add(trip.routeId); data.stopTimes++; data.maxSeconds = Math.max(data.maxSeconds, departure);
    trip.firstSeconds = Math.min(trip.firstSeconds, arrival, departure); trip.lastSeconds = Math.max(trip.lastSeconds, arrival, departure);
  });
  let points = 0;
  await readTable(files, 'shapes.txt', ['shape_id', 'shape_pt_lat', 'shape_pt_lon', 'shape_pt_sequence'], r => {
    if (++points > LIMITS.shapes) throw new Error('GTFS shape point limit exceeded.');
    const id = idText(r.shape_id), lat = finite(r.shape_pt_lat), lon = finite(r.shape_pt_lon), seq = integer(r.shape_pt_sequence);
    if (!id || lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180 || seq === null) return;
    if (!data.shapes.has(id)) data.shapes.set(id, []);
    data.shapes.get(id).push([lat, lon, seq]);
  });
  for (const points of data.shapes.values()) points.sort((a, b) => a[2] - b[2]);
  for (const stops of data.tripStops.values()) stops.sort((a, b) => a.sequence - b.sequence);
  for (const stop of data.stops.values()) {

    const parent = stop.parentStation ? data.stops.get(stop.parentStation) : null;
    if (stop.locationType === 1) {
      stop.classification = 'station'; stop.classificationSource = 'GTFS stops.location_type=1'; stop.classificationLabel = 'Terminal';
    } else if (stop.locationType === 0 && parent?.locationType === 1) {
      stop.classification = 'stop'; stop.classificationSource = 'GTFS stops.location_type=0 and parent_station'; stop.classificationLabel = 'Platform at ' + parent.name;
      for (const routeId of stop.routeIds) parent.routeIds.add(routeId);
    } else if (/\bterminal\b/i.test(stop.name) && !/\bterminal\s+(?:street|st|avenue|ave|road|rd|drive|dr)\b/i.test(stop.name)) {
      stop.classification = 'terminal'; stop.classificationSource = 'GTFS stops.stop_name (explicit terminal name)'; stop.classificationLabel = 'Named terminal (official stop name)';
    } else if (stop.locationType === 0 || stop.locationType === 4) {
      stop.classification = 'stop'; stop.classificationSource = stop.locationTypeSource; stop.classificationLabel = stop.locationType === 4 ? 'Boarding area (official GTFS)' : 'Stop / platform (official GTFS; terminal designation unconfirmed)';
    }
  }
  for (const stop of data.stops.values()) stop.routeIds = [...stop.routeIds];
  if (!data.routes.size || !data.stops.size || !data.trips.size || !data.stopTimes) throw new Error('GTFS lacks usable routes, stops or trips.');
  return data;
}
function serviceActive(data, id, date) {
  const exception = data.exceptions.get(id)?.get(date);
  if (exception) return exception === 1;
  const c = data.calendar.get(id);
  return Boolean(c && date >= c.start && date <= c.end && c.days[new Date(dateNumber(date)).getUTCDay()]);
}

const SCHEMA = {
  feed: {1: ['header', 'header'], 2: ['entities', 'entity', true]},
  header: {1: ['version', 's'], 2: ['incrementality', 'u'], 3: ['timestamp', 'u']},
  entity: {1: ['id', 's'], 2: ['deleted', 'u'], 3: ['tripUpdate', 'update'], 4: ['vehicle', 'vehicle'], 5: ['alert', 'alert']},
  trip: {1: ['tripId', 's'], 2: ['startTime', 's'], 3: ['startDate', 's'], 4: ['relationship', 'u'], 5: ['routeId', 's'], 6: ['directionId', 'u']},
  descriptor: {1: ['id', 's'], 2: ['label', 's']},
  position: {1: ['latitude', 'f'], 2: ['longitude', 'f'], 3: ['bearing', 'f'], 5: ['speed', 'f']},
  vehicle: {1: ['trip', 'trip'], 2: ['position', 'position'], 3: ['stopSequence', 'u'], 4: ['status', 'u'], 5: ['timestamp', 'u'], 7: ['stopId', 's'], 8: ['descriptor', 'descriptor'], 9: ['occupancyStatus', 'u'], 10: ['occupancyPercentage', 'u']},
  update: {1: ['trip', 'trip'], 2: ['stops', 'stopUpdate', true], 3: ['descriptor', 'descriptor'], 4: ['timestamp', 'u'], 5: ['delay', 'i']},
  stopUpdate: {1: ['sequence', 'u'], 2: ['arrival', 'event'], 3: ['departure', 'event'], 4: ['stopId', 's'], 5: ['relationship', 'u']},
  event: {1: ['delay', 'i'], 2: ['time', 'u'], 3: ['uncertainty', 'u']},
  alert: {1: ['periods', 'period', true], 5: ['selectors', 'selector', true], 6: ['cause', 'u'], 7: ['effect', 'u'], 10: ['header', 'translated'], 11: ['description', 'translated']},
  period: {1: ['start', 'u'], 2: ['end', 'u']},
  selector: {1: ['agencyId', 's'], 2: ['routeId', 's'], 3: ['routeType', 'u'], 4: ['trip', 'trip'], 5: ['stopId', 's'], 6: ['directionId', 'u']},
  translated: {1: ['translations', 'translation', true]},
  translation: {1: ['text', 'text'], 2: ['language', 's']}
};
function decodeFeed(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > LIMITS.protobuf) throw new Error('Invalid GTFS-Realtime size.');
  let fieldCount = 0;
  function message(buffer, schema, depth = 0) {
    if (depth > 8) throw new Error('Protobuf nesting too deep.');
    let pos = 0;
    const result = {};
    const varint = () => {
      let n = 0n;
      for (let i = 0; i < 10; i++) {
        if (pos >= buffer.length) throw new Error('Truncated protobuf varint.');
        const b = buffer[pos++];
        if (i === 9 && b > 1) throw new Error('Protobuf varint overflow.');
        n |= BigInt(b & 127) << BigInt(i * 7);
        if (!(b & 128)) return n;
      }
      throw new Error('Invalid protobuf varint.');
    };
    while (pos < buffer.length) {
      if (++fieldCount > LIMITS.fields) throw new Error('Too many protobuf fields.');
      const tag = varint();
      if (tag > 0xffffffffn) throw new Error('Invalid protobuf tag.');
      const number = Number(tag >> 3n), wire = Number(tag & 7n);
      if (!number) throw new Error('Invalid protobuf field number.');
      let value;
      if (wire === 0) value = varint();
      else {
        let length;
        if (wire === 1) length = 8;
        else if (wire === 5) length = 4;
        else if (wire === 2) { const n = varint(); if (n > BigInt(buffer.length)) throw new Error('Protobuf length too large.'); length = Number(n); }
        else throw new Error('Unsupported protobuf wire type.');
        if (pos + length > buffer.length) throw new Error('Truncated protobuf field.');
        value = buffer.subarray(pos, pos + length); pos += length;
      }
      const field = SCHEMA[schema][number];
      if (!field) continue;
      const [key, type, repeated] = field;
      const expected = type === 'u' || type === 'i' ? 0 : type === 'f' ? 5 : 2;
      if (wire !== expected) throw new Error('Protobuf field has wrong wire type.');
      if (type === 'u') { if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Protobuf integer too large.'); value = Number(value); }
      else if (type === 'i') value = Number(BigInt.asIntN(32, value));
      else if (type === 'f') { value = value.readFloatLE(0); if (!Number.isFinite(value)) throw new Error('Invalid protobuf coordinate.'); }
      else if (type === 's' || type === 'text') { if (value.length > LIMITS.text) throw new Error('Protobuf string too long.'); value = cleanText(value.toString('utf8'), type === 'text' ? LIMITS.text : 256); }
      else value = message(value, type, depth + 1);
      if (repeated) { if (!result[key]) result[key] = []; if (result[key].length >= LIMITS.entities) throw new Error('Protobuf repeated field limit exceeded.'); result[key].push(value); }
      else result[key] = value;
    }
    return result;
  }
  const feed = message(bytes, 'feed');
  if (!feed.header || !/^2(?:\.|$)/.test(feed.header.version || '')) throw new Error('Unsupported GTFS-Realtime version.');
  if ((feed.header.incrementality || 0) !== 0) throw new Error('Differential GTFS-Realtime is not supported.');
  feed.entities ||= [];
  return feed;
}

function freshTime(epoch, now, fetchAge, failed = false) {
  if (now === null) return 'clock-unavailable';
  if (!Number.isFinite(epoch) || epoch <= 0) return 'timestamp-missing';
  if (epoch - now > 30000) return 'future-timestamp';
  if (failed || fetchAge === null || fetchAge < 0 || fetchAge > STALE_MS || now - epoch > STALE_MS) return 'stale';
  return 'live';
}
function newFeed() { return {data: null, fetchedMono: null, attemptedMono: null, error: null}; }
const copyStop = stop => stop ? {...stop, routeIds: [...stop.routeIds]} : null;
const ALERT_EFFECTS = Object.freeze({1: 'no-service', 2: 'reduced-service', 3: 'significant-delays', 4: 'detour', 5: 'additional-service', 6: 'modified-service', 7: 'other-effect', 8: 'unknown-effect', 9: 'stop-moved', 10: 'no-effect', 11: 'accessibility-issue'});
function translatedText(value) {
  const translations = value?.translations || [];
  return (translations.find(t => /^en(?:-|$)/i.test(t.language || '')) || translations.find(t => !t.language) || translations[0])?.text || '';
}
function alertActivity(periods, now) {
  if (now === null) return 'unknown';
  if (!periods.length) return 'active';
  const valid = periods.filter(p => (p.start === null || Number.isFinite(p.start)) && (p.end === null || Number.isFinite(p.end)) && (p.start === null || p.end === null || p.start < p.end));
  if (!valid.length) return 'unknown';
  if (valid.some(p => (p.start === null || now >= p.start) && (p.end === null || now < p.end))) return 'active';
  return valid.some(p => p.start !== null && now < p.start) ? 'upcoming' : 'expired';
}
function alertMatches(alert, context) {

  return alert.informedEntities.some(s => {
    let checked = 0;
    for (const [key, expected] of Object.entries(s)) {
      if (expected === null || expected === '') continue;
      checked++;
      if (key === 'stopId') { if (!context.stopIds.includes(expected)) return false; }
      else if (context[key] === undefined || context[key] === null || context[key] !== expected) return false;
    }
    return checked > 0;
  });
}
class TransitProvider {
  constructor({cacheDir = null, now = () => null, monotonic = () => performance.now(), fetcher = fetchOfficial} = {}) {
    this.cacheDir = cacheDir; this.now = now; this.monotonic = monotonic; this.fetcher = fetcher;
    this.data = null; this.etag = null; this.cacheLoaded = false; this.staticAttempt = null; this.staticFetched = null; this.staticError = null; this.cacheError = null; this.staticSource = null;
    this.feeds = {vehicles: newFeed(), tripUpdates: newFeed(), alerts: newFeed()};
    this.timer = null; this.pending = null; this.stopped = false; this.generation = 0; this.controllers = new Set();
  }
  start() {
    this.stopped = false;
    if (!this.timer) { this.timer = setInterval(() => { this.refresh().catch(() => {}); }, POLL_MS); this.timer.unref?.(); }
    return this.refresh();
  }
  stop() {
    this.stopped = true; this.generation++;
    clearInterval(this.timer); this.timer = null;
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
  }
  async request(url, options = {}) {
    const controller = new AbortController(); this.controllers.add(controller);
    try { return await this.fetcher(url, {...options, signal: controller.signal}); }
    finally { this.controllers.delete(controller); }
  }
  async loadCache() {
    if (this.cacheLoaded) return;
    this.cacheLoaded = true;
    if (!this.cacheDir) return;
    try {
      const zipPath = path.join(this.cacheDir, 'saskatoon-gtfs.zip');
      const stat = await fs.stat(zipPath);
      if (stat.size > LIMITS.zip) throw new Error('GTFS cache too large.');
      const bytes = await fs.readFile(zipPath);
      const data = await parseStatic(await readZip(bytes));
      if (this.stopped) return;
      this.data = data; this.staticSource = 'cache';
      try {
        const metaPath = path.join(this.cacheDir, 'saskatoon-gtfs.json');
        if ((await fs.stat(metaPath)).size > 4096) throw new Error('GTFS metadata too large.');
        const meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
        if (meta.sha256 === hash(bytes) && typeof meta.etag === 'string' && meta.etag.length <= 1024 && !/[\r\n]/.test(meta.etag)) this.etag = meta.etag;
      } catch {                                                         }
    } catch (error) { if (error.code !== 'ENOENT') this.cacheError = 'Cached schedule could not be read: ' + errorText(error); }
  }
  async saveCache(bytes) {
    if (!this.cacheDir) return;
    try {
      await fs.mkdir(this.cacheDir, {recursive: true});
      const zip = path.join(this.cacheDir, 'saskatoon-gtfs.zip'), meta = path.join(this.cacheDir, 'saskatoon-gtfs.json');
      await fs.writeFile(zip + '.tmp', bytes); await fs.rename(zip + '.tmp', zip);
      await fs.writeFile(meta + '.tmp', JSON.stringify({etag: this.etag, sha256: hash(bytes)})); await fs.rename(meta + '.tmp', meta);
      this.cacheError = null;
    } catch (error) { this.cacheError = 'Schedule cache could not be saved: ' + errorText(error); }
  }
  async refreshStatic(generation) {
    const at = this.monotonic(), interval = this.staticError ? 5 * 60000 : STATIC_MS;
    if (this.staticAttempt !== null && at - this.staticAttempt >= 0 && at - this.staticAttempt < interval) return;
    this.staticAttempt = at;
    try {
      const result = await this.request(URLS.static, {etag: this.data ? this.etag : null});
      if (result.status === 304 && !this.data) throw new Error('Schedule cache is missing.');
      const data = result.status === 304 ? this.data : await parseStatic(await readZip(result.body));
      if (this.stopped || generation !== this.generation) return;
      this.data = data; this.staticFetched = this.monotonic(); this.staticError = null; this.staticSource = result.status === 304 ? 'cache-validated' : 'network';
      if (result.status !== 304) { this.etag = result.etag || null; await this.saveCache(result.body); }
    } catch (error) { if (!this.stopped && generation === this.generation) this.staticError = errorText(error); }
  }
  async refreshFeed(name, generation) {
    const feed = this.feeds[name], at = this.monotonic();
    if (feed.attemptedMono !== null && at - feed.attemptedMono >= 0 && at - feed.attemptedMono < POLL_MS) return;
    feed.attemptedMono = at;
    try {
      const result = await this.request(URLS[name]);
      const data = decodeFeed(result.body);
      if (this.stopped || generation !== this.generation) return;

      feed.data = data; feed.fetchedMono = this.monotonic(); feed.error = null;
    } catch (error) { if (!this.stopped && generation === this.generation) feed.error = errorText(error); }
  }
  refresh() {
    if (this.stopped) return Promise.resolve(this.snapshot());
    if (this.pending) return this.pending;
    const generation = this.generation;
    this.pending = (async () => {
      await this.loadCache();
      if (!this.stopped && generation === this.generation) await Promise.all([this.refreshStatic(generation), this.refreshFeed('vehicles', generation), this.refreshFeed('tripUpdates', generation), this.refreshFeed('alerts', generation)]);
      return this.snapshot();
    })().finally(() => { this.pending = null; });
    return this.pending;
  }
  feedState(name, now = trustedNow(this.now)) {
    const feed = this.feeds[name];
    const lastFetchAgeMs = feed.fetchedMono === null ? null : Math.max(0, this.monotonic() - feed.fetchedMono);
    const feedTimestamp = feed.data?.header.timestamp ? feed.data.header.timestamp * 1000 : null;
    return {status: !feed.data ? 'unavailable' : freshTime(feedTimestamp, now, lastFetchAgeMs, Boolean(feed.error) || this.stopped), feedTimestamp, lastFetchAgeMs, error: feed.error, count: feed.data?.entities.filter(e => !e.deleted && e[name === 'vehicles' ? 'vehicle' : name === 'alerts' ? 'alert' : 'tripUpdate']).length || 0};
  }
  serviceHours() { return scheduleState(this.data, trustedNow(this.now), {ageMs:this.staticFetched===null?null:this.monotonic()-this.staticFetched,error:!!this.staticError,stopped:this.stopped}); }
  snapshot() {
    const now = trustedNow(this.now), vehicleFeed = this.feedState('vehicles', now), updateFeed = this.feedState('tripUpdates', now);
    const vehicles = [];
    for (const entity of this.feeds.vehicles.data?.entities || []) {
      const v = entity.vehicle, p = v?.position;
      if (entity.deleted || !v || !p || !Number.isFinite(p.latitude) || !Number.isFinite(p.longitude) || Math.abs(p.latitude) > 90 || Math.abs(p.longitude) > 180) continue;
      const tripId = v.trip?.tripId || null, trip = tripId ? this.data?.trips.get(tripId) : null;
      const routeId = trip?.routeId || v.trip?.routeId || null, route = this.data?.routes.get(routeId);
      const updatedAt = v.timestamp ? v.timestamp * 1000 : null;
      const freshness = freshTime(updatedAt, now, vehicleFeed.lastFetchAgeMs, Boolean(vehicleFeed.error) || this.stopped);
      vehicles.push({id: v.descriptor?.id || entity.id || '', label: v.descriptor?.label || v.descriptor?.id || entity.id || '', tripId, routeId, routeShortName: route?.shortName || '', routeLongName: route?.longName || '', headsign: trip?.headsign || '', directionId: trip?.directionId ?? null, latitude: p.latitude, longitude: p.longitude, bearing: Number.isFinite(p.bearing) && p.bearing >= 0 && p.bearing <= 360 ? p.bearing : null, speedMetersPerSecond: Number.isFinite(p.speed) && p.speed >= 0 ? p.speed : null, stopId: v.stopId || null, updatedAt, ageSeconds: now !== null && updatedAt ? Math.max(0, Math.round((now - updatedAt) / 1000)) : null, stale: freshness !== 'live', freshness,occupancyStatus:Number.isInteger(v.occupancyStatus)&&v.occupancyStatus>=0&&v.occupancyStatus<=8?v.occupancyStatus:null,occupancySource:'GTFS-Realtime VehiclePosition.occupancy_status'});
    }
    const ready = Boolean(this.data);
    return {status: !ready ? 'unavailable' : now === null || this.staticError || vehicleFeed.status !== 'live' || updateFeed.status !== 'live' ? 'degraded' : 'ready', clockAvailable: now !== null, generatedAt: now, timeZone: ZONE, attribution: ATTRIBUTION, sourceUrl: SOURCE, pollIntervalMs: POLL_MS, freshnessMs: STALE_MS,
      static: {ready, source: this.staticSource, error: this.staticError, cacheError: this.cacheError, lastFetchAgeMs: this.staticFetched === null ? null : Math.max(0, this.monotonic() - this.staticFetched), counts: {routes: this.data?.routes.size || 0, stops: this.data?.stops.size || 0, trips: this.data?.trips.size || 0, stopTimes: this.data?.stopTimes || 0}, coverage: this.data ? {...this.data.coverage} : null, warnings: this.data?.warnings || 0}, feeds: {vehicles: vehicleFeed, tripUpdates: updateFeed, alerts: this.feedState('alerts', now)}, vehicles, alerts: this.alertsSnapshot(now)};
  }
  alertsSnapshot(now = trustedNow(this.now)) {
    const state = this.feedState('alerts', now);
    const items = [];
    for (const entity of this.feeds.alerts.data?.entities || []) {
      const a = entity.alert;
      if (entity.deleted || !a) continue;
      const periods = (a.periods || []).map(p => ({start: p.start === undefined ? null : p.start * 1000, end: p.end === undefined ? null : p.end * 1000}));
      const activity = alertActivity(periods, now);
      items.push({id: entity.id || '', header: translatedText(a.header) || 'Official transit notice', description: translatedText(a.description), effect: ALERT_EFFECTS[a.effect] || 'unknown-effect', effectCode: a.effect ?? 8, causeCode: a.cause ?? null, activity, confirmed: state.status === 'live' && activity === 'active', periods,
        informedEntities: (a.selectors || []).map(s => ({agencyId: s.agencyId || null, routeId: s.routeId || null, routeType: s.routeType ?? null, tripId: s.trip?.tripId || null, stopId: s.stopId || null, directionId: s.directionId ?? null, tripStartDate: s.trip?.startDate || null, tripStartTime: s.trip?.startTime || null, tripRouteId: s.trip?.routeId || null, tripDirectionId: s.trip?.directionId ?? null})), sourceUrl: URLS.alerts});
    }
    return {...state, sourceUrl: URLS.alerts, attribution: ATTRIBUTION, sortBasis: 'Newest effective start first; publication dates are not supplied by GTFS. Undated notices last.', items: sortNotices(items)};
  }
  planningSnapshot() {
    const now = trustedNow(this.now), delays = new Map();
    if (this.data && now !== null && this.feedState('tripUpdates', now).status === 'live') for (const entity of this.feeds.tripUpdates.data.entities) {
      const u = entity.tripUpdate, id = u?.trip?.tripId;
      if (entity.deleted || !id || !this.data.trips.has(id)) continue;
      if (u.trip.relationship === 3) { delays.set(id, {cancelled: true, startDate: u.trip.startDate || null}); continue; }
      const points = [];
      for (const s of u.stops || []) { const event = s.departure || s.arrival; if (Number.isFinite(s.sequence) && s.relationship !== 1 && s.relationship !== 2 && Number.isFinite(event?.delay) && Math.abs(event.delay) <= 4 * 3600) points.push([s.sequence, event.delay]); }
      if (!points.length && Number.isFinite(u.delay) && Math.abs(u.delay) <= 4 * 3600) points.push([0, u.delay]);
      if (points.length) delays.set(id, {startDate: u.trip.startDate || null, points: points.sort((a, b) => a[0] - b[0])});
    }
    return {data: this.data, now, delays};
  }
  mapStops() { return this.data ? [...this.data.stops.values()].map(copyStop) : []; }
  vehicleDetails(id) {
    const state = this.snapshot();
    const vehicle = typeof id === 'string' ? state.vehicles.find(v => v.id === id) : null;
    const result = {vehicle: vehicle || null, status: vehicle ? vehicle.stale ? 'stale' : 'live' : 'unavailable', positionStatus: 'unknown', reportedStop: null, currentStop: null,currentStopSequence:null,currentStopStatus:'unknown', nextStop: null, nextStopStatus: 'unknown', nextStopReason: 'Vehicle data is unavailable.', nextStopSequence: null, nextStopSource: null,
      serviceStatus: {status: 'unknown', label: 'Service status unconfirmed', source: null, alertIds: []}, alerts: []};
    if (!vehicle) return result;
    const raw = this.feeds.vehicles.data.entities.find(e => !e.deleted && e.vehicle && (e.vehicle.descriptor?.id || e.id || '') === vehicle.id)?.vehicle;
    const trip = vehicle.tripId ? this.data?.trips.get(vehicle.tripId) : null;
    const route = trip ? this.data.routes.get(trip.routeId) : this.data?.routes.get(vehicle.routeId);
    const status = raw?.status ?? 2;
    result.positionStatus = ({0: 'incoming', 1: 'stopped-at', 2: 'in-transit-to'})[status] || 'unknown';
    result.reportedStop = copyStop(this.data?.stops.get(raw?.stopId));
    if (vehicle.stale) result.nextStopReason = 'The vehicle position is not fresh enough to confirm its next stop.';
    else if (!trip) result.nextStopReason = 'No matching static trip is available for this vehicle.';
    else if (![0, 1, 2].includes(status)) result.nextStopReason = 'The vehicle reported an unknown stop status.';
    else {
      const rows = this.data.tripStops.get(trip.id) || [];
      const matches = raw.stopSequence !== undefined ? rows.filter(r => r.sequence === raw.stopSequence) : raw.stopId ? rows.filter(r => r.stopId === raw.stopId) : [];
      if (matches.length !== 1) result.nextStopReason = 'The reported stop cannot be uniquely matched to this trip.';
      else if (raw.stopId && matches[0].stopId !== raw.stopId) result.nextStopReason = 'The reported stop ID and sequence disagree.';
      else {
        const reported = matches[0], current = this.data.stops.get(reported.stopId);
        result.reportedStop = copyStop(current);
        if (status === 1) {result.currentStop=copyStop(current);result.currentStopSequence=reported.sequence;result.currentStopStatus='confirmed';}
        const next = status === 1 ? rows.find(r => r.sequence > reported.sequence) : reported;
        if (!next) result.nextStopReason = 'At the final scheduled stop for this trip. Onward service is unconfirmed.';
        else {
          result.nextStop = copyStop(this.data.stops.get(next.stopId)); result.nextStopSequence = next.sequence; result.nextStopStatus = 'confirmed';
          result.nextStopReason = status === 1 ? 'Next scheduled stop after the stop where the vehicle reports it is stopped.' : 'The stop the vehicle reports it is approaching or travelling toward.';
          result.nextStopSource = 'GTFS-Realtime VehiclePosition ' + (raw.stopSequence !== undefined ? 'current_stop_sequence' : 'stop_id') + ' + current_status' + (raw.status === undefined ? ' (GTFS default IN_TRANSIT_TO)' : '') + ' + static GTFS stop_times';
        }
      }
    }
    const context = {agencyId: route?.agencyId, routeId: route?.id, routeType: route?.routeType, tripId: trip?.id, directionId: trip?.directionId, tripStartDate: raw?.trip?.startDate, tripStartTime: raw?.trip?.startTime, tripRouteId: route?.id, tripDirectionId: trip?.directionId,
      stopIds: [...new Set([result.reportedStop?.id, result.currentStop?.id, result.nextStop?.id].filter(Boolean))]};
    result.alerts = state.alerts.items.filter(a => a.activity !== 'expired' && alertMatches(a, context));
    const noService = result.alerts.filter(a => a.confirmed && a.effectCode === 1);
    if (!vehicle.stale && noService.length) result.serviceStatus = {status: 'no-service-alert', label: 'Official no-service alert affects this trip or stop', source: 'GTFS-Realtime Alert.effect=NO_SERVICE with matching informed_entity and active_period', alertIds: noService.map(a => a.id)};
    return result;
  }
  routes() { return this.data ? [...this.data.routes.values()].map(r => ({...r})).sort((a, b) => a.shortName.localeCompare(b.shortName, undefined, {numeric: true})) : []; }
  searchStops(query = '') {
    if (!this.data) return [];
    const q = cleanText(query, 80).toLocaleLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    return [...this.data.stops.values()].map(stop => {
      const haystack = (stop.id + ' ' + stop.code + ' ' + stop.name).toLocaleLowerCase();
      return {stop, score: q && (stop.id.toLocaleLowerCase() === q || stop.code.toLocaleLowerCase() === q) ? 0 : 1, matches: words.every(w => haystack.includes(w))};
    }).filter(x => x.matches).sort((a, b) => a.score - b.score || a.stop.name.localeCompare(b.stop.name)).slice(0, 60).map(({stop}) => ({...stop, routeIds: [...stop.routeIds]}));
  }
  vehicleShape(id) {
    const vehicle=this.snapshot().vehicles.find(v=>v.id===id),trip=vehicle?.tripId?this.data?.trips.get(vehicle.tripId):null;
    if(!trip?.shapeId)return {tripId:vehicle?.tripId||null,routeId:vehicle?.routeId||null,shapes:[],status:'unavailable'};
    const points=(this.data.shapes.get(trip.shapeId)||[]).map(p=>[p[0],p[1]]);
    return {tripId:trip.id,routeId:trip.routeId,shapes:points.length>1?[{id:trip.shapeId,tripId:trip.id,routeId:trip.routeId,points}]:[],status:points.length>1?'matched':'unavailable'};
  }
  routeShapes(routeId) {
    if (!this.data || typeof routeId !== 'string') return [];
    const ids = new Set([...this.data.trips.values()].filter(t => t.routeId === routeId && t.shapeId).map(t => t.shapeId));
    return [...ids].slice(0, 40).map(id => { const p = this.data.shapes.get(id) || [], step = Math.max(1, Math.ceil(p.length / 2000)); return {id, points: p.filter((_, i) => i % step === 0 || i === p.length - 1).map(x => [x[0], x[1]])}; }).filter(s => s.points.length > 1);
  }
  departures(stopId, {limit = 12, horizonHours = 36} = {}) {
    const now = trustedNow(this.now), stop = this.data?.stops.get(typeof stopId === 'string' ? stopId : '');
    const result = {stop: stop ? {...stop, routeIds: [...stop.routeIds]} : null, status: 'unavailable', clockAvailable: now !== null, generatedAt: now, timeZone: ZONE, error: null, departures: []};
    if (!this.data) { result.error = this.staticError || 'Schedules have not loaded yet.'; return result; }
    if (!stop) { result.error = 'Choose a valid stop.'; return result; }
    if (now === null) { result.error = 'Waiting for trusted internet time.'; return result; }
    limit = Number.isFinite(limit) ? Math.max(1, Math.min(40, Math.floor(limit))) : 12;
    horizonHours = Number.isFinite(horizonHours) ? Math.max(1, Math.min(48, horizonHours)) : 36;
    const today = serviceDate(now), horizon = now + horizonHours * 3600000;
    const candidates = [], updates = new Map();
    const feed = this.feeds.tripUpdates, state = this.feedState('tripUpdates', now);
    if (state.status === 'live') for (const entity of feed.data.entities) {
      const u = entity.tripUpdate, id = u?.trip?.tripId;
      if (entity.deleted || !id || !this.data.trips.has(id)) continue;
      if (freshTime((u.timestamp || feed.data.header.timestamp) * 1000, now, state.lastFetchAgeMs, Boolean(feed.error)) !== 'live') continue;
      if (!updates.has(id)) updates.set(id, []);
      updates.get(id).push(u);
    }
    for (let offset = -Math.ceil(this.data.maxSeconds / 86400); offset <= Math.ceil(horizonHours / 24); offset++) {
      const date = addDate(today, offset), midnight = serviceMidnight(date);
      for (const time of this.data.times.get(stop.id) || []) {
        if (!time.pickup) continue;
        const trip = this.data.trips.get(time.tripId);
        if (!serviceActive(this.data, trip.serviceId, date)) continue;
        const scheduledTime = midnight + time.departure * 1000;
        if (scheduledTime < now - 4 * 3600000 || scheduledTime > horizon + 4 * 3600000) continue;
        const route = this.data.routes.get(trip.routeId);
        let expectedTime = scheduledTime, delaySeconds = null, realtime = false, status = 'scheduled';
        const update = (updates.get(trip.id) || []).find(u => {
          if (u.trip.startDate) return u.trip.startDate === date;

          const stamp = (u.timestamp || feed.data.header.timestamp) * 1000;
          return stamp >= midnight + trip.firstSeconds * 1000 - 3 * 3600000 && stamp <= midnight + trip.lastSeconds * 1000 + 3 * 3600000;
        });
        if (update) {
          if (update.trip.relationship === 3) { status = 'cancelled'; realtime = true; expectedTime = null; }
          else if ((update.trip.relationship || 0) === 0) {
            const exact = (update.stops || []).find(s => s.sequence === time.sequence) || (update.stops || []).find(s => s.sequence === undefined && s.stopId === stop.id);
            if (exact?.relationship === 1) { status = 'skipped'; realtime = true; expectedTime = null; }
            else if (exact?.relationship !== 2) {
              const event = exact?.departure || exact?.arrival;
              if (event?.time && Math.abs(event.time * 1000 - scheduledTime) <= 4 * 3600000) expectedTime = event.time * 1000;
              else if (Number.isFinite(event?.delay) && Math.abs(event.delay) <= 4 * 3600) expectedTime += event.delay * 1000;
              else if (Number.isFinite(update.delay) && Math.abs(update.delay) <= 4 * 3600) expectedTime += update.delay * 1000;
              else {

                const prior = (update.stops || []).filter(s => Number.isFinite(s.sequence) && s.sequence < time.sequence).sort((a, b) => b.sequence - a.sequence)[0];
                const event = prior?.departure || prior?.arrival;
                if (prior?.relationship !== 2 && Number.isFinite(event?.delay) && Math.abs(event.delay) <= 4 * 3600) expectedTime += event.delay * 1000;
                else { candidates.push({trip, time, date, route, scheduledTime, expectedTime, delaySeconds, realtime, status}); continue; }
              }
              realtime = true; status = 'predicted'; delaySeconds = Math.round((expectedTime - scheduledTime) / 1000);
            }
          }
        }
        candidates.push({trip, time, date, route, scheduledTime, expectedTime, delaySeconds, realtime, status});
      }
    }
    result.departures = candidates.filter(x => (x.expectedTime ?? x.scheduledTime) >= now - 30000 && (x.expectedTime ?? x.scheduledTime) <= horizon).sort((a, b) => (a.expectedTime ?? a.scheduledTime) - (b.expectedTime ?? b.scheduledTime)).slice(0, limit).map(x => ({tripId: x.trip.id, routeId: x.trip.routeId, routeShortName: x.route.shortName, routeLongName: x.route.longName, headsign: x.trip.headsign, directionId: x.trip.directionId, scheduledTime: x.scheduledTime, expectedTime: x.expectedTime, delaySeconds: x.delaySeconds, realtime: x.realtime, status: x.status, serviceDate: x.date, stopSequence: x.time.sequence, minutesAway: x.expectedTime === null ? null : Math.max(0, Math.ceil((x.expectedTime - now) / 60000))}));
    result.status = this.staticError ? 'cached' : state.status === 'live' ? 'ready' : 'scheduled';
    if (this.staticError) result.error = 'Using cached schedules. ' + this.staticError;
    else if (today > this.data.coverage.endDate && !result.departures.length) { result.status = 'unavailable'; result.error = 'The published schedule does not cover this date.'; }
    return result;
  }
}
module.exports = {TransitProvider, URLS, ZONE, POLL_MS, STALE_MS, ATTRIBUTION, SOURCE,
  _test: {readZip, crc32, csvRows, parseStatic, decodeFeed, gtfsSeconds, dateNumber, serviceDate, serviceMidnight, serviceActive, freshTime, fetchOfficial, alertActivity, alertMatches, LIMITS}};
