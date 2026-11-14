'use strict';

const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const fs = require('node:fs/promises');
const path = require('node:path');
const {TransitProvider, URLS, POLL_MS, _test: t} = require('./transit-provider');
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('PASS ' + name); }
function varint(n) {
  n = BigInt(n); if (n < 0n) n = BigInt.asUintN(64, n);
  const a = []; do { let b = Number(n & 127n); n >>= 7n; if (n) b |= 128; a.push(b); } while (n);
  return Buffer.from(a);
}
const uint = (tag, n) => Buffer.concat([varint(tag << 3), varint(n)]);
const msg = (tag, b) => Buffer.concat([varint((tag << 3) | 2), varint(b.length), b]);
const str = (tag, s) => msg(tag, Buffer.from(s));
const float = (tag, n) => { const b = Buffer.alloc(4); b.writeFloatLE(n); return Buffer.concat([varint((tag << 3) | 5), b]); };
const fields = (...a) => Buffer.concat(a);
function feed(now, entities = [], incrementality = 0) {
  return fields(msg(1, fields(str(1, '2.0'), uint(2, incrementality), uint(3, Math.floor(now / 1000)))), ...entities.map(e => msg(2, e)));
}
function vehicle(now, {id = 'v1', tripId = 'TN', timestamp = now, deleted = false, sequence, stopId, status} = {}) {
  const v = fields(tripId ? msg(1, fields(str(1, tripId), str(5, 'R1'), uint(6, 105))) : Buffer.alloc(0), msg(2, fields(float(1, 52.13), float(2, -106.67), float(3, 45))), sequence === undefined ? Buffer.alloc(0) : uint(3, sequence), status === undefined ? Buffer.alloc(0) : uint(4, status), timestamp === null ? Buffer.alloc(0) : uint(5, Math.floor(timestamp / 1000)), stopId ? str(7, stopId) : Buffer.alloc(0), msg(8, fields(str(1, id), str(2, 'Bus ' + id))));
  return fields(str(1, id), deleted ? uint(2, 1) : Buffer.alloc(0), msg(4, v));
}
function alert(now, {id = 'a1', selectors = [{routeId: 'R1'}], periods = [{start: now - 1000, end: now + 60000}], effect = 1, deleted = false, header = 'Official test alert', description = 'Test description'} = {}) {
  const selector = s => fields(s.agencyId ? str(1, s.agencyId) : Buffer.alloc(0), s.routeId ? str(2, s.routeId) : Buffer.alloc(0), s.routeType === undefined ? Buffer.alloc(0) : uint(3, s.routeType), s.tripId ? msg(4, str(1, s.tripId)) : Buffer.alloc(0), s.stopId ? str(5, s.stopId) : Buffer.alloc(0), s.directionId === undefined ? Buffer.alloc(0) : uint(6, s.directionId));
  const translated = text => fields(msg(1, fields(str(1, 'Texte francais'), str(2, 'fr'))), msg(1, fields(str(1, text), str(2, 'en'))));
  return fields(str(1, id), deleted ? uint(2, 1) : Buffer.alloc(0), msg(5, fields(...periods.map(p => msg(1, fields(p.start == null ? Buffer.alloc(0) : uint(1, Math.floor(p.start / 1000)), p.end == null ? Buffer.alloc(0) : uint(2, Math.floor(p.end / 1000))))), ...selectors.map(s => msg(5, selector(s))), uint(7, effect), msg(10, translated(header)), msg(11, translated(description)))));
}
function update(now, {tripId = 'TN', date = '20261111', delay = 120, relationship = 0, stopRelationship = 0, eventTime = null, sequence = 1} = {}) {
  const event = eventTime === null ? uint(1, delay) : uint(2, Math.floor(eventTime / 1000));
  const trip = fields(tripId ? str(1, tripId) : Buffer.alloc(0), date ? str(3, date) : Buffer.alloc(0), uint(4, relationship));
  return fields(str(1, 'u1'), msg(3, fields(msg(1, trip), msg(2, fields(uint(1, sequence), str(4, 'S1'), msg(3, event), uint(5, stopRelationship))), uint(4, Math.floor(now / 1000)))));
}
const FIXTURES = new Map([
  ['routes.txt', '\ufeffroute_id,route_short_name,route_long_name,route_color,route_text_color\r\nR1, 1 ,"University, Downtown",006633,FFFFFF\r\n'],
  ['stops.txt', 'stop_id,stop_code,stop_name,stop_lat,stop_lon,location_type,parent_station\nS1,1001,"College & University",52.13,-106.67,0,H1\nS2,1002,"Main, South",52.12,-106.66,,\nH1,,University Hub,52.131,-106.671,1,\nNT,,Example Terminal,52.11,-106.65,0,\nST,,Terminal Avenue,52.1,-106.64,0,\n'],
  ['trips.txt', 'route_id,service_id,trip_id,trip_headsign,direction_id,shape_id\nR1,WEEK,T1,Downtown,0,SH1\nR1,EXTRA,T2,Special,1,SH1\nR1,NIGHT,TN,Night,0,SH1\n'],
  ['calendar.txt', 'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nWEEK,1,1,1,1,1,1,1,20261101,20261130\n'],
  ['calendar_dates.txt', 'service_id,date,exception_type\nWEEK,20261111,2\nEXTRA,20261111,1\nNIGHT,20261111,1\n'],
  ['stop_times.txt', 'trip_id,arrival_time,departure_time,stop_id,stop_sequence\nT1,08:00:00,08:00:00,S1,1\nT2,08:05:00,08:05:00,S1,1\nTN,24:10:00,24:10:00,S1,1\nTN,24:20:00,24:20:00,S2,2\nMISSING,08:00:00,08:00:00,S1,1\n'],
  ['shapes.txt', 'shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\nSH1,52.12,-106.66,2\nSH1,52.13,-106.67,1\n']
]);
function zip(files = FIXTURES) {
  const locals = [], central = []; let offset = 0;
  for (const [name, text] of files) {
    const filename = Buffer.from(name), raw = Buffer.from(text), compressed = zlib.deflateRawSync(raw);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8); local.writeUInt32LE(t.crc32(raw), 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(filename.length, 26);
    locals.push(local, filename, compressed);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(8, 10); c.writeUInt32LE(t.crc32(raw), 16); c.writeUInt32LE(compressed.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(filename.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, filename); offset += local.length + filename.length + compressed.length;
  }
  const c = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.size, 8); end.writeUInt16LE(files.size, 10); end.writeUInt32LE(c.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, c, end]);
}
const NIGHT = Date.UTC(2026, 10, 12, 6, 5);
async function main() {
  await test('CSV whitespace, BOM, quotes, embedded newlines and bounds', () => {
    assert.deepEqual([...t.csvRows('\ufeffa,b\r\n " hello, " , "say ""hi""\nnext" \r\n')], [['a', 'b'], ['hello,', 'say "hi"\nnext']]);
    assert.throws(() => [...t.csvRows('a\n"broken')], /Unterminated/);
    assert.throws(() => [...t.csvRows('a\n' + 'x'.repeat(8193))], /too long/);
    assert.throws(() => [...t.csvRows('a\n"x"bad')], /after CSV/);
  });
  await test('ZIP CRC, extraction and corrupt/oversized rejection', async () => {
    assert.equal(t.crc32(Buffer.from('123456789')), 0xcbf43926);
    assert.deepEqual(await t.readZip(zip()), FIXTURES);
    await assert.rejects(t.readZip(Buffer.alloc(30)), /directory/);
    const bad = zip(), end = bad.length - 22, central = bad.readUInt32LE(end + 16);
    bad.writeUInt32LE(0xffffffff, central + 24); await assert.rejects(t.readZip(bad), /oversized/);
    const corrupt = zip(); corrupt[42] ^= 255; await assert.rejects(t.readZip(corrupt));
    const traversal = new Map(FIXTURES); traversal.delete('routes.txt'); traversal.set('../routes.txt', FIXTURES.get('routes.txt'));
    await assert.rejects(t.readZip(zip(traversal)), /missing routes/);
  });
  const data = await t.parseStatic(FIXTURES);
  await test('Static joins, route shapes, calendar removal/addition and unknown trips', () => {
    assert.equal(data.stopTimes, 4); assert.equal(data.warnings, 1);
    assert.equal(t.serviceActive(data, 'WEEK', '20261111'), false);
    assert.equal(t.serviceActive(data, 'EXTRA', '20261111'), true);
    assert.equal(t.serviceActive(data, 'WEEK', '20261112'), true);
    assert.equal(t.serviceActive(data, 'EXTRA', '20261112'), false);
    assert.equal(t.gtfsSeconds('24:10:00'), 87000); assert.equal(t.gtfsSeconds('72:00:00'), null);
    assert.equal(t.dateNumber('20260230'), null); assert.equal(t.serviceDate(NIGHT), '20261112');
  });
  await test('Protobuf boundaries, unknown fields, signed delay and FULL_DATASET only', () => {
    const parsed = t.decodeFeed(feed(NIGHT, [update(NIGHT, {delay: -90})]));
    assert.equal(parsed.entities[0].tripUpdate.stops[0].departure.delay, -90);
    assert.equal(t.decodeFeed(fields(feed(NIGHT), uint(20, 123))).entities.length, 0);
    for (const bytes of [Buffer.from([10, 255]), Buffer.from([0]), Buffer.from([11]), fields(Buffer.from([8]), Buffer.alloc(10, 255))]) assert.throws(() => t.decodeFeed(bytes));
    assert.throws(() => t.decodeFeed(feed(NIGHT, [], 1)), /Differential/);
    assert.throws(() => t.decodeFeed(msg(1, str(1, '1.0'))), /version/);
    assert.throws(() => t.decodeFeed(fields(feed(NIGHT), msg(2, str(1, 'x'.repeat(8193))))), /too long/);
    assert.throws(() => t.decodeFeed(Buffer.alloc(t.LIMITS.protobuf + 1)), /size/);
  });
  let now = NIGHT, mono = 0, calls = [], failure = false, v = [vehicle(NIGHT)], u = [update(NIGHT)], a = [];
  const fetcher = async (url, options) => {
    calls.push({url, options}); if (failure && url !== URLS.static) throw new Error(failure === 'empty' ? '' : 'Offline fixture');
    return {status: 200, etag: '"test-etag"', body: url === URLS.static ? zip() : feed(now ?? NIGHT, url === URLS.vehicles ? v : url === URLS.alerts ? a : u)};
  };
  const p = new TransitProvider({now: () => now, monotonic: () => mono, fetcher});
  await test('Provider refresh, plain serializable API, exact stop search and shapes', async () => {
    await p.refresh(); assert.equal(p.snapshot().static.ready, true); assert.equal(p.snapshot().status, 'ready');
    assert.equal(calls.length, 4); assert.equal(p.routes()[0].shortName, '1');
    assert.equal(p.searchStops('1001')[0].id, 'S1'); assert.equal(p.searchStops('college university')[0].id, 'S1');
    assert.deepEqual(p.routeShapes('R1')[0].points, [[52.13, -106.67], [52.12, -106.66]]);
    assert.doesNotThrow(() => JSON.stringify(p.snapshot()));
    const route = p.routes()[0]; route.longName = 'MUTATED'; assert.notEqual(p.routes()[0].longName, 'MUTATED');
  });
  await test('Previous service day, >24 hour departures and realtime prediction', () => {
    const d = p.departures('S1').departures[0]; assert.equal(d.tripId, 'TN'); assert.equal(d.serviceDate, '20261111');
    assert.equal(d.scheduledTime, NIGHT + 5 * 60000); assert.equal(d.expectedTime, NIGHT + 7 * 60000); assert.equal(d.minutesAway, 7); assert.equal(d.status, 'predicted');
    assert.equal(p.snapshot().vehicles[0].directionId, 0);
  });
  await test('Poll throttling, including failed requests', async () => {
    await p.refresh(); mono += POLL_MS - 1; await p.refresh(); assert.equal(calls.length, 4);
    mono++; now += POLL_MS; failure = true; await p.refresh(); const attempted = calls.length; await p.refresh(); assert.equal(calls.length, attempted);
    assert.equal(p.snapshot().vehicles[0].stale, true); assert.equal(p.departures('S1').departures[0].status, 'scheduled');
    failure = false;
  });
  await test('Successful FULL_DATASET removes absent vehicles and predictions', async () => {
    mono += POLL_MS; now += POLL_MS; v = []; u = []; await p.refresh();
    assert.equal(p.snapshot().vehicles.length, 0); assert.equal(p.snapshot().feeds.tripUpdates.count, 0); assert.equal(p.departures('S1').departures[0].realtime, false);
  });
  await test('Actual vehicle timestamp, missing timestamp and missing trip ID guards', async () => {
    mono += POLL_MS; now += POLL_MS;
    v = [vehicle(now, {id: 'old', timestamp: now - 91000}), vehicle(now, {id: 'missing-time', timestamp: null}), vehicle(now, {id: 'missing-trip', tripId: null}), vehicle(now, {id: 'deleted', deleted: true})];
    u = [update(now, {tripId: null})]; await p.refresh();
    const s = p.snapshot(); assert.equal(s.vehicles.length, 3); assert.equal(s.vehicles[0].stale, true); assert.equal(s.vehicles[1].freshness, 'timestamp-missing');
    assert.equal(s.vehicles[2].tripId, null); assert.equal(s.vehicles[2].directionId, null); assert.equal(s.vehicles[2].stale, false);
    assert.equal(p.departures('S1').departures[0].realtime, false);
  });
  await test('Monotonic fetch age makes stale data stale even when trusted time stands still', () => {
    mono += 90001; assert.equal(p.snapshot().vehicles[2].stale, true); assert.equal(p.snapshot().feeds.tripUpdates.status, 'stale');
  });
  await test('No trusted time means no live claim or dated departures; OS clock is unused', () => {
    const old = Date.now;
    try { Date.now = () => { throw new Error('OS clock must not be consulted'); }; now = null;
      assert.equal(p.snapshot().vehicles[2].freshness, 'clock-unavailable'); assert.deepEqual(p.departures('S1').departures, []);
      assert.equal(p.departures('S1').clockAvailable, false); assert.equal(p.routes().length, 1);
    } finally { Date.now = old; now = NIGHT; }
  });
  await test('Calendar exceptions affect actual upcoming results', () => {
    now = Date.UTC(2026, 10, 11, 13, 0); const rows = p.departures('S1', {horizonHours: 2}).departures;
    assert.deepEqual(rows.map(r => r.tripId), ['T2']); now = NIGHT;
  });
  await test('Cancellations, skipped stops, NO_DATA, and wrong service dates', async () => {
    for (const [options, expected] of [[{relationship: 3}, 'cancelled'], [{stopRelationship: 1}, 'skipped'], [{stopRelationship: 2}, 'scheduled'], [{date: '20261112'}, 'scheduled']]) {
      mono += POLL_MS; u = [update(now, options)]; await p.refresh(); assert.equal(p.departures('S1').departures[0].status, expected);
    }
  });
  await test('Delay propagation and service-date inference across midnight', async () => {
    mono += POLL_MS; u = [update(now, {date: ''})]; await p.refresh();
    assert.equal(p.departures('S1').departures[0].status, 'predicted');
    assert.equal(p.departures('S2').departures[0].delaySeconds, 120);
  });
  await test('Empty-message transport errors still mark old data stale', async () => {
    mono += POLL_MS; failure = 'empty'; await p.refresh();
    assert.ok(p.snapshot().feeds.tripUpdates.error);
    assert.equal(p.snapshot().feeds.tripUpdates.status, 'stale');
    assert.equal(p.departures('S1').departures[0].realtime, false);
    failure = false;
  });
  await test('Reject arbitrary network destinations before making a request', async () => {
    await assert.rejects(t.fetchOfficial('https://example.com/'), /not allowlisted/);
    await assert.rejects(t.fetchOfficial(URLS.vehicles + '?url=other'), /not allowlisted/);
  });
  await test('All map stops, explicit hub/terminal evidence, platforms and official colors', () => {
    const stops = p.mapStops(); assert.equal(stops.length, 5); assert.equal(stops.find(s=>s.id==='H1').classificationLabel,'Terminal'); assert.equal(stops.find(s=>s.id==='H1').classification,'station');
    assert.equal(stops.find(s => s.id === 'H1').classification, 'station');
    assert.deepEqual(stops.find(s => s.id === 'H1').routeIds, ['R1']);
    assert.equal(stops.find(s => s.id === 'S1').classification, 'stop');
    assert.equal(stops.find(s => s.id === 'S1').parentStation, 'H1');
    assert.equal(stops.find(s => s.id === 'NT').classification, 'terminal');
    assert.equal(stops.find(s => s.id === 'ST').classification, 'stop');
    assert.equal(stops.find(s => s.id === 'S2').locationType, 0);
    assert.equal(p.routes()[0].color, '#006633'); assert.equal(p.routes()[0].colorSource, 'GTFS routes.route_color');
    stops[0].routeIds.push('MUTATED'); assert.ok(!p.mapStops()[0].routeIds.includes('MUTATED'));
  });
  const mapProvider = async (vehicles, alerts = [], {alertTimestamp = NIGHT, files = FIXTURES} = {}) => {
    const provider = new TransitProvider({now: () => NIGHT, monotonic: () => 0, fetcher: async url => ({status: 200, body: url === URLS.static ? zip(files) : feed(url === URLS.alerts ? alertTimestamp : NIGHT, url === URLS.vehicles ? vehicles : url === URLS.alerts ? alerts : [])})});
    await provider.refresh(); return provider;
  };
  await test('Next stop uses GTFS incoming/in-transit/stopped semantics and default status', async () => {
    const q = await mapProvider([vehicle(NIGHT, {id: 'incoming', sequence: 1, stopId: 'S1', status: 0}), vehicle(NIGHT, {id: 'moving', sequence: 1, stopId: 'S1', status: 2}), vehicle(NIGHT, {id: 'stopped', sequence: 1, stopId: 'S1', status: 1}), vehicle(NIGHT, {id: 'default', sequence: 1}), vehicle(NIGHT, {id: 'id-only', stopId: 'S1', status: 2})]);
    try {
      for (const id of ['incoming', 'moving', 'default', 'id-only']) { assert.equal(q.vehicleDetails(id).nextStop.id, 'S1'); assert.equal(q.vehicleDetails(id).nextStopStatus, 'confirmed'); }
      assert.equal(q.vehicleDetails('stopped').currentStop.id, 'S1'); assert.equal(q.vehicleDetails('stopped').nextStop.id, 'S2');
      assert.equal(q.vehicleDetails('stopped').serviceStatus.status, 'unknown'); assert.equal(q.vehicleDetails('missing').nextStop, null);
    } finally { q.stop(); }
  });
  await test('Stale/missing/conflicting next-stop evidence remains unknown; final stop is not service ended', async () => {
    const q = await mapProvider([vehicle(NIGHT, {id: 'stale', sequence: 1, timestamp: NIGHT - 91000}), vehicle(NIGHT, {id: 'no-trip', tripId: null, stopId: 'S1'}), vehicle(NIGHT, {id: 'conflict', sequence: 1, stopId: 'S2'}), vehicle(NIGHT, {id: 'no-stop'}), vehicle(NIGHT, {id: 'last', sequence: 2, stopId: 'S2', status: 1})]);
    try {
      for (const id of ['stale', 'no-trip', 'conflict', 'no-stop', 'last']) { const d = q.vehicleDetails(id); assert.equal(d.nextStop, null); assert.equal(d.nextStopStatus, 'unknown'); assert.equal(d.serviceStatus.status, 'unknown'); }
      assert.match(q.vehicleDetails('last').nextStopReason, /final scheduled stop/);
    } finally { q.stop(); }
    const loop = new Map(FIXTURES); loop.set('stop_times.txt', loop.get('stop_times.txt') + 'TN,24:30:00,24:30:00,S1,3\n');
    const r = await mapProvider([vehicle(NIGHT, {stopId: 'S1'})], [], {files: loop});
    try { assert.equal(r.vehicleDetails('v1').nextStop, null); assert.match(r.vehicleDetails('v1').nextStopReason, /uniquely/); } finally { r.stop(); }
  });
  await test('Official alert decode, English translations, full text and time boundaries', async () => {
    const description = '<untrusted>' + 'x'.repeat(400);
    const q = await mapProvider([], [alert(NIGHT, {id: 'active', description}), alert(NIGHT, {id: 'end-exclusive', periods: [{end: NIGHT}]}), alert(NIGHT, {id: 'future', periods: [{start: NIGHT + 1000}]}), alert(NIGHT, {id: 'unbounded', periods: []}), alert(NIGHT, {id: 'deleted', deleted: true})]);
    try {
      const s = q.snapshot().alerts; assert.equal(s.status, 'live'); assert.equal(s.items.length, 4); assert.equal(s.sourceUrl, URLS.alerts);
      s.items.sort((a,b)=>['active','end-exclusive','future','unbounded'].indexOf(a.id)-['active','end-exclusive','future','unbounded'].indexOf(b.id)); assert.equal(s.items[0].header, 'Official test alert'); assert.equal(s.items[0].description, description); assert.equal(s.items[0].confirmed, true);
      assert.equal(s.items[1].activity, 'expired'); assert.equal(s.items[1].confirmed, false); assert.equal(s.items[2].activity, 'upcoming'); assert.equal(s.items[3].activity, 'active');
    } finally { q.stop(); }
  });
  await test('Alert selector AND/OR semantics and only matched active NO_SERVICE confirms warning', async () => {
    const q = await mapProvider([vehicle(NIGHT, {sequence: 1, stopId: 'S1', status: 1})], [alert(NIGHT, {id: 'wrong-stop', selectors: [{routeId: 'R1', stopId: 'ST'}]}), alert(NIGHT, {id: 'right-stop', selectors: [{routeId: 'WRONG'}, {routeId: 'R1', stopId: 'S2'}]}), alert(NIGHT, {id: 'empty', selectors: [{}]}), alert(NIGHT, {id: 'wrong-trip', selectors: [{routeId: 'R1', tripId: 'T1'}]}), alert(NIGHT, {id: 'expired', periods: [{end: NIGHT}]}), alert(NIGHT, {id: 'unknown-agency', selectors: [{agencyId: 'UNKNOWN', routeId: 'R1'}]})]);
    try { const d = q.vehicleDetails('v1'); assert.deepEqual(d.alerts.map(a => a.id), ['right-stop']); assert.equal(d.serviceStatus.status, 'no-service-alert'); assert.deepEqual(d.serviceStatus.alertIds, ['right-stop']); } finally { q.stop(); }
  });
  await test('Stale alerts, future warnings and non-NO_SERVICE do not claim suspension', async () => {
    for (const [alerts, options] of [[[alert(NIGHT)], {alertTimestamp: NIGHT - 91000}], [[alert(NIGHT, {periods: [{start: NIGHT + 1000}]})], {}], [[alert(NIGHT, {effect: 2})], {}], [[], {}]]) {
      const q = await mapProvider([vehicle(NIGHT, {sequence: 1, stopId: 'S1'})], alerts, options);
      try { assert.equal(q.vehicleDetails('v1').serviceStatus.status, 'unknown'); } finally { q.stop(); }
    }
    assert.equal(t.alertActivity([], null), 'unknown');
  });
  await test('Alert FULL_DATASET replacement removes vanished warnings', async () => {
    mono += POLL_MS; now = NIGHT; a = [alert(NIGHT)]; await p.refresh(); assert.equal(p.snapshot().alerts.items.length, 1);
    mono += POLL_MS; a = []; await p.refresh(); assert.deepEqual(p.snapshot().alerts.items, []);
  });
  await test('ETag disk cache revalidation, no dependencies or installation', async () => {
    const dir = await fs.mkdtemp(path.join(__dirname, '.transit-test-cache-'));
    const a = new TransitProvider({cacheDir: dir, now: () => NIGHT, monotonic: () => 0, fetcher});
    let conditional = false;
    try {
      await a.refresh(); assert.equal(a.snapshot().static.cacheError, null); a.stop();
      const b = new TransitProvider({cacheDir: dir, now: () => NIGHT, monotonic: () => 0, fetcher: async (url, opts) => {
        if (url === URLS.static) { conditional = opts.etag === '"test-etag"'; return {status: 304}; }
        return {status: 200, body: feed(NIGHT)};
      }});
      await b.refresh(); assert.equal(conditional, true); assert.equal(b.snapshot().static.source, 'cache-validated'); assert.equal(b.routes().length, 1); b.stop();
    } finally { a.stop(); for (const name of ['saskatoon-gtfs.zip', 'saskatoon-gtfs.json', 'saskatoon-gtfs.zip.tmp', 'saskatoon-gtfs.json.tmp']) await fs.unlink(path.join(dir, name)).catch(e => { if (e.code !== 'ENOENT') throw e; }); await fs.rmdir(dir); }
  });
  await test('Stop prevents late in-flight feed commits and future polling', async () => {
    let release;
    const wait = new Promise(resolve => { release = resolve; });
    const q = new TransitProvider({now: () => NIGHT, fetcher: async url => { await wait; return {status: 200, body: url === URLS.static ? zip() : feed(NIGHT, [vehicle(NIGHT)])}; }});
    const pending = q.refresh(); await new Promise(resolve => setImmediate(resolve)); q.stop(); release(); await pending;
    assert.equal(q.snapshot().vehicles.length, 0); assert.equal(q.snapshot().static.ready, false); await q.refresh(); assert.equal(q.snapshot().vehicles.length, 0);
  });
  p.stop();
  console.log('\n' + passed + ' offline transit test groups passed. No app launched and no printer calls made.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
