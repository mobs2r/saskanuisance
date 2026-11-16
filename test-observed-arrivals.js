'use strict';
const assert = require('node:assert/strict');
const {Tracker, distance, distanceToPaths} = require('./observed-positions');

const fix = (at, lat, lng, extra = {}) => ({id: 'bus-1', tripId: 'trip-a', latitude: lat, longitude: lng, updatedAt: at, freshness: 'live', ...extra});

const tracker = new Tracker();
assert.equal(tracker.update({id: 'bus-1', latitude: 91, longitude: 0, updatedAt: 1}, {nowMs: 1}), null);
assert.equal(tracker.sample({nowMs: 1}), null);

const first = tracker.update(fix(1_000, 52.13, -106.67), {nowMs: 1_000});
assert.equal(first.observedLat, 52.13);
assert.equal(first.observedLng, -106.67);
assert.equal(first.estimated, false);
assert.equal(first.stale, false);
assert.equal(first.reason, 'measured-gps');

const jumped = tracker.update(fix(11_000, 52.2, -106.67), {nowMs: 11_000});
assert.equal(jumped.lat, 52.13);
assert.match(jumped.reason, /Implausible GPS jump/);
assert.equal(jumped.stale, true);

const confirmed = tracker.update(fix(16_000, 52.201, -106.67), {nowMs: 16_000});
assert.equal(confirmed.lat, 52.201);
assert.equal(confirmed.stale, false);

const late = tracker.update(fix(15_000, 52.201, -106.67), {nowMs: 16_000});
assert.equal(late.lat, 52.201);
assert.match(late.reason, /Out-of-order/);

const aged = tracker.sample({nowMs: 16_000 + 90_000});
assert.equal(aged.stale, true);
assert.equal(aged.observedAt, 16_000);

const same = tracker.update(fix(16_000, 52.201, -106.67, {stale: true}), {nowMs: 16_000});
assert.equal(same.lat, 52.201);
assert.equal(same.stale, true);

const near = distance({latitude: 52.13, longitude: -106.67}, {latitude: 52.1301, longitude: -106.67});
assert.ok(near > 10 && near < 12, 'about 11 m per 0.0001 degree');
const along = distanceToPaths({latitude: 52.13005, longitude: -106.67}, [{points: [[52.13, -106.67], [52.131, -106.67]]}]);
assert.ok(along < 1, 'a point on the segment is on the path');
const off = distanceToPaths({latitude: 52.13, longitude: -106.68}, [[[52.13, -106.67], [52.131, -106.67]]]);
assert.ok(off > 500);

console.log('PASS observed arrivals: measured fixes, jump confirmation, out-of-order reports, stale age, and path distance.');
