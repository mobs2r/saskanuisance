'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {Tracker, LIMITS, distanceMeters, destination} = require('./bus-motion');
const EPOCH = Date.UTC(2026, 10, 11, 12);
const START = {lat: 52.12, lng: -106.65};
let passed = 0;
function test(name, action) {
  try { action(); passed++; console.log('PASS: ' + name); }
  catch (error) { console.error('FAIL: ' + name); throw error; }
}
const at = (seconds, extras = {}) => ({nowMs: EPOCH + seconds * 1000, monoMs: seconds * 1000, ...extras});
const vehicle = (seconds = 0, position = START, extras = {}) => ({id: 'bus-1', routeId: '4', tripId: 'trip-a',
  latitude: position.lat, longitude: position.lng, updatedAt: EPOCH + seconds * 1000,
  stale: false, freshness: 'live', bearing: 90, speedMetersPerSecond: 10, ...extras});
function near(actual, expected, tolerance = 0.1) {
  assert.ok(distanceMeters(actual, expected) <= tolerance,
    `Expected positions within ${tolerance}m, got ${distanceMeters(actual, expected)}m`);
}
function tracker(input = vehicle(), options = at(0)) { const t = new Tracker(); t.update(input, options); return t; }

test('Node and browser API, without DOM, dependencies, timers, or wall-clock reads', () => {
  const context = vm.createContext({Date: {now() { throw new Error('Untrusted wall clock'); }}});
  vm.runInContext(fs.readFileSync(require.resolve('./bus-motion'), 'utf8'), context);
  const t = new context.BusMotion.Tracker();
  assert.equal(t.sample(at(0)), null);
  t.update(vehicle(), at(0));
  near(t.sample(at(5)), destination(START, 90, 50));
  assert.ok(Object.isFrozen(LIMITS));
});
test('Fresh heading/speed advances an explicitly estimated point, not the actual timestamp', () => {
  const t = tracker(), state = t.sample(at(5));
  near(state, destination(START, 90, 50));
  assert.equal(state.observedAt, EPOCH);
  assert.equal(state.observedLat, START.lat);
  assert.equal(state.observedLng, START.lng);
  assert.equal(state.estimated, true);
  assert.equal(state.stale, false);
  assert.equal(state.frozen, false);
  assert.equal(state.ageSeconds, 5);
  assert.equal(state.motionSource, 'telemetry');
});
test('Extrapolation is capped at 300m and 30s without jumping back to the actual fix', () => {
  const t = tracker(vehicle(0, START, {speedMetersPerSecond: 20}));
  const capped = t.sample(at(15));
  near(capped, destination(START, 90, 300));
  assert.equal(capped.frozen, true);
  assert.equal(capped.reason, 'prediction-limit');
  near(t.sample(at(30)), capped);
  near(t.sample(at(89)), capped);
  const stale = t.sample(at(90));
  near(stale, capped); assert.equal(stale.stale, true); assert.equal(stale.estimated, true);
  const slow = tracker(vehicle(0, START, {speedMetersPerSecond: 2}));
  near(slow.sample(at(30)), destination(START, 90, 60));
  near(slow.sample(at(89)), destination(START, 90, 60));
});
test('Stale source freezes exactly the last displayed point and needs a newer fresh observation', () => {
  const t = tracker(), shown = t.sample(at(5));
  near(t.sample(at(10, {stale: true})), shown);
  const held = t.sample(at(11)); near(held, shown); assert.equal(held.stale, true);
  near(t.update(vehicle(), at(12)), shown);
  const next = destination(START, 90, 100);
  const resumed = t.update(vehicle(13, next), at(13));
  assert.equal(resumed.stale, false); near(resumed, shown);
  near(t.sample(at(14)), destination(next, 90, 10));
});
test('Unavailable clock never falls back to wall time and freezes until a newer fresh observation', () => {
  const t = tracker(), shown = t.sample(at(5));
  const unavailable = t.sample({nowMs: null, monoMs: 6000});
  near(unavailable, shown); assert.equal(unavailable.reason, 'time-unavailable');
  assert.equal(unavailable.ageSeconds, null);
  near(t.sample(at(7)), shown);
  near(t.update(vehicle(), at(8)), shown);
  const next = destination(START, 90, 70);
  const resumed = t.update(vehicle(9, next), at(9));
  assert.equal(resumed.stale, false);
  near(t.sample(at(10)), destination(next, 90, 10));
});
test('No inferred vector bridges a stale or unavailable period', () => {
  const t = tracker(vehicle(0, START, {bearing: null, speedMetersPerSecond: null}));
  t.sample(at(1, {stale: true}));
  const next = destination(START, 90, 40);
  t.update(vehicle(20, next, {bearing: null, speedMetersPerSecond: null}), at(20));
  const state = t.sample(at(22));
  near(state, next); assert.equal(state.motionSource, 'none');
});
test('Stale newer packets do not overwrite the last accepted actual fix', () => {
  const t = tracker(), shown = t.sample(at(5));
  const state = t.update(vehicle(10, destination(START, 90, 100), {stale: true, freshness: 'stale'}), at(10));
  near(state, shown); assert.equal(state.observedAt, EPOCH); assert.equal(state.stale, true);
});
test('Unknown speed or bearing does not invent motion from a single observation', () => {
  for (const extras of [{bearing: null}, {speedMetersPerSecond: null}, {bearing: null, speedMetersPerSecond: null}]) {
    const t = tracker(vehicle(0, START, extras)), state = t.sample(at(20));
    near(state, START); assert.equal(state.estimated, false); assert.equal(state.frozen, true);
  }
});
test('Recent consecutive fixes provide a plausible fallback vector', () => {
  for (const extras of [{bearing: null, speedMetersPerSecond: null}, {bearing: null}, {speedMetersPerSecond: null}]) {
    const t = tracker(vehicle(0, START, extras)), next = destination(START, 90, 40);
    t.update(vehicle(20, next, extras), at(20));
    const state = t.sample(at(22));
    near(state, destination(next, 90, 4), 0.2);
    assert.equal(state.motionSource, 'observed-fixes');
    assert.ok(Math.abs(state.speedMetersPerSecond - 2) < 0.001);
  }
});
test('Old vector pairs and sub-second pairs are not used for inferred movement', () => {
  for (const seconds of [0.5, 61]) {
    const extras = {bearing: null, speedMetersPerSecond: null};
    const t = tracker(vehicle(0, START, extras)), next = destination(START, 90, 20);
    t.update(vehicle(seconds, next, extras), at(seconds));
    const state = t.sample(at(seconds + 2)); near(state, next); assert.equal(state.motionSource, 'none');
  }
});
test('Explicit zero speed and consecutive stationary/jitter fixes stay stationary', () => {
  const stopped = tracker(vehicle(0, START, {speedMetersPerSecond: 0, bearing: null}));
  near(stopped.sample(at(20)), START);
  assert.equal(stopped.sample(at(21)).motionSource, 'stationary');
  for (const meters of [0, 2]) {
    const t = tracker(), next = destination(START, 90, meters);
    t.update(vehicle(20, next), at(20));
    const state = t.sample(at(22)); near(state, next); assert.equal(state.motionSource, 'stationary');
  }
});
test('Out-of-order and duplicate timestamps cannot move the fix or restart prediction', () => {
  const t = tracker(), shown = t.sample(at(10));
  let state = t.update(vehicle(0, destination(START, 90, 200), {speedMetersPerSecond: 30}), at(10));
  near(state, shown); assert.equal(state.observedAt, EPOCH);
  state = t.update(vehicle(-10, destination(START, 90, 200)), at(11));
  near(state, destination(START, 90, 110)); assert.equal(state.observedAt, EPOCH);
  t.update(vehicle(), at(20));
  near(t.sample(at(40)), destination(START, 90, 300));
});
test('Implausible or invalid telemetry cannot drive estimates or fallback inference', () => {
  for (const extras of [{speedMetersPerSecond: 46}, {speedMetersPerSecond: -1}, {speedMetersPerSecond: NaN},
    {speedMetersPerSecond: Infinity}, {bearing: 361}, {bearing: -1}, {bearing: NaN}, {bearing: '90'}]) {
    const t = tracker(), next = destination(START, 90, 40);
    t.update(vehicle(20, next, extras), at(20));
    const state = t.sample(at(22)); near(state, next); assert.equal(state.motionSource, 'invalid-motion');
  }
});
test('Teleport fixes snap, disable inference, and never animate across the map', () => {
  const t = tracker(), next = destination(START, 90, 2000);
  t.sample(at(5));
  const state = t.update(vehicle(10, next), at(10));
  near(state, next); assert.equal(state.motionSource, 'teleport-reset');
  assert.equal(state.estimated, false); near(t.sample(at(20)), next);
});
test('Invalid coordinates freeze safely and initial invalid input has no marker', () => {
  const empty = new Tracker(); assert.equal(empty.update(vehicle(0, {lat: NaN, lng: 0}), at(0)), null);
  for (const position of [{lat: 91, lng: 0}, {lat: 0, lng: 181}, {lat: Infinity, lng: 0}, {lat: '52', lng: 0}]) {
    const t = tracker(), shown = t.sample(at(5));
    const state = t.update(vehicle(10, position), at(10));
    near(state, shown); assert.equal(state.stale, true);
    assert.equal(t.update(vehicle(11), at(11)).stale, false);
  }
});
test('Fresh correction is continuous and converges to the new predicted fix in one second', () => {
  const t = tracker(), shown = t.sample(at(20)), next = destination(START, 90, 180);
  const initial = t.update(vehicle(20, next), at(20));
  near(initial, shown); assert.equal(initial.reason, 'correcting'); assert.equal(initial.estimated, true);
  const halfway = t.sample(at(20.5));
  near(halfway, destination(START, 90, 195), 0.2);
  near(t.sample(at(21)), destination(next, 90, 10), 0.2);
  assert.equal(t.sample(at(21.1)).reason, 'estimated');
});
test('Large corrections snap rather than sweep, even if elapsed movement is plausible', () => {
  const t = tracker(vehicle(0, START, {speedMetersPerSecond: 0}));
  const next = destination(START, 90, 200);
  const state = t.update(vehicle(30, next, {speedMetersPerSecond: 0}), at(30));
  near(state, next); assert.equal(state.estimated, false); assert.equal(state.reason, 'stationary');
});
test('Stopping after motion smoothly corrects to the actual fix and then stays there', () => {
  const t = tracker(), shown = t.sample(at(5)), next = destination(START, 90, 40);
  const initial = t.update(vehicle(5, next, {speedMetersPerSecond: 0}), at(5));
  near(initial, shown); assert.equal(initial.frozen, false);
  const stopped = t.sample(at(6)); near(stopped, next); assert.equal(stopped.estimated, false);
  near(t.sample(at(20)), next);
});
test('Reduced motion snaps to actual fixes and disables interpolation and extrapolation', () => {
  const t = tracker(vehicle(), at(10, {reducedMotion: true}));
  near(t.sample(at(20)), START);
  const next = destination(START, 90, 50);
  const state = t.update(vehicle(20, next), at(20, {reducedMotion: true}));
  near(state, next); assert.equal(state.estimated, false); assert.equal(state.reason, 'reduced-motion');
  near(t.sample(at(30)), next);
  const resumed = t.sample(at(31, {reducedMotion: false}));

  assert.equal(resumed.stale, false);
});
test('Changing reduced-motion preference while fresh snaps; stale freeze has priority', () => {
  const t = tracker(); t.sample(at(5));
  near(t.sample(at(6, {reducedMotion: true})), START);
  near(t.sample(at(7, {reducedMotion: false})), START);
  near(t.sample(at(8)), destination(START, 90, 80));
  const shown = t.sample(at(9));
  near(t.sample(at(10, {stale: true, reducedMotion: true})), shown);
});
test('ID, route, and trip changes reset history without cross-vehicle or cross-trip interpolation', () => {
  for (const extras of [{id: 'bus-2'}, {routeId: '7'}, {tripId: 'trip-b'}]) {
    const t = tracker(), next = destination(START, 90, 40);
    t.sample(at(5));
    const state = t.update(vehicle(10, next, {...extras, bearing: null, speedMetersPerSecond: null}), at(10));
    near(state, next); assert.equal(state.motionSource, 'none'); assert.equal(state.estimated, false);
  }
});
test('Monotonic reversal or a large epoch/monotonic mismatch freezes the last display', () => {
  for (const options of [{nowMs: EPOCH + 6000, monoMs: 4000}, {nowMs: EPOCH + 60000, monoMs: 6000},
    {nowMs: EPOCH + 3000, monoMs: 6000}]) {
    const t = tracker(), shown = t.sample(at(5)), state = t.sample(options);
    near(state, shown); assert.equal(state.stale, true); assert.equal(state.reason, 'time-discontinuity');
  }
});
test('Null/invalid clock and unknown/far-future observation timestamps never simulate motion', () => {
  for (const options of [at(0, {nowMs: null}), at(0, {nowMs: NaN}), at(0, {monoMs: -1}), at(0, {clockAvailable: false})]) {
    const t = tracker(vehicle(), options), state = t.sample(options);
    near(state, START); assert.equal(state.stale, true);
    if (options.clockAvailable === false || !Number.isFinite(options.nowMs)) assert.equal(state.ageSeconds, null);
  }
  for (const updatedAt of [null, NaN, EPOCH + 60000]) {
    const t = tracker(vehicle(0, START, {updatedAt})), state = t.sample(at(1));
    near(state, START); assert.equal(state.stale, true);
  }
});
test('Route assistance follows a matched bend while preserving the actual GPS coordinate', () => {
  const east = destination(START, 90, 80), north = destination(east, 0, 200);
  const paths = [{points: [[START.lat, START.lng], [east.lat, east.lng], [north.lat, north.lng]]}];
  const t = tracker(vehicle(), at(0, {paths}));
  const state = t.sample(at(12));
  near(state, destination(east, 0, 40), 0.2); assert.equal(state.routeMatched, true);
  near(t.sample(at(0)), state);
});
test('An invalid future initial timestamp cannot permanently poison observation ordering', () => {
  for (const options of [at(0), at(0, {nowMs: null})]) {
    const t = tracker(vehicle(0, START, {updatedAt: EPOCH + 3600000}), options);
    const next = destination(START, 90, 20);
    const recovered = t.update(vehicle(2, next), at(2));
    assert.equal(recovered.stale, false); assert.equal(recovered.observedAt, EPOCH + 2000);
    near(t.sample(at(3)), destination(next, 90, 10));
  }
});
test('Reduced-motion preference persists across updates and while a source is frozen', () => {
  const t = tracker(vehicle(), at(0, {reducedMotion: true})), next = destination(START, 90, 20);
  near(t.update(vehicle(2, next), at(2)), next);
  near(t.sample(at(3)), next);
  t.sample(at(4, {stale: true, reducedMotion: false}));
  t.sample(at(5, {reducedMotion: true}));
  const latest = destination(START, 90, 60);
  near(t.update(vehicle(6, latest), at(6)), latest);
  near(t.sample(at(8)), latest);
});
test('One raw polyline and multiple raw polylines are accepted', () => {
  const end = destination(START, 90, 100);
  const path = [[START.lat, START.lng], [end.lat, end.lng]];
  for (const paths of [path, [path]]) {
    const t = tracker(vehicle(), at(0, {paths}));
    assert.equal(t.sample(at(5)).routeMatched, true);
  }
});
test('Route shape ends and invalid-point gaps stop prediction without bridging or looping', () => {
  const end = destination(START, 90, 80), beyond = destination(START, 90, 250);
  for (const path of [[[START.lat, START.lng], [end.lat, end.lng]],
    [[START.lat, START.lng], [end.lat, end.lng], null, [beyond.lat, beyond.lng]]]) {
    const t = tracker(vehicle(), at(0, {paths: [path]})), state = t.sample(at(15));
    near(state, end); assert.equal(state.frozen, true); assert.equal(state.reason, 'route-end');
    near(t.sample(at(20)), end);
  }
});
test('Off-route, opposite-heading, mismatched identity, long-gap, and ambiguous routes are not forced', () => {
  const east = destination(START, 90, 80), far = destination(START, 0, 100);
  const farEnd = destination(far, 90, 300), longEnd = destination(START, 90, 1500);
  const north = destination(east, 0, 200), south = destination(east, 180, 200);
  const path = end => [[START.lat, START.lng], [east.lat, east.lng], [end.lat, end.lng]];
  const variants = [
    [{points: [[far.lat, far.lng], [farEnd.lat, farEnd.lng]]}],
    [{points: [[east.lat, east.lng], [START.lat, START.lng]]}],
    [{routeId: 'wrong', points: path(north)}],
    [{tripId: 'wrong', points: path(north)}],
    [{points: [[START.lat, START.lng], [longEnd.lat, longEnd.lng]]}],
    [{points: path(north)}, {points: path(south)}]
  ];
  for (const paths of variants) {
    const t = tracker(vehicle(), at(0, {paths})), state = t.sample(at(12));
    assert.equal(state.routeMatched, false); near(state, destination(START, 90, 120));
  }
});
test('Nearby route matching preserves GPS lateral offset rather than snapping to road geometry', () => {
  const offset = destination(START, 0, 10), end = destination(START, 90, 300);
  const t = tracker(vehicle(0, offset), at(0, {paths: [[[START.lat, START.lng], [end.lat, end.lng]]]}));
  near(t.sample(at(0)), offset);
  const state = t.sample(at(5)); assert.equal(state.routeMatched, true);
  near(state, destination(offset, 90, 50), 0.2);
});
test('Dateline positions, north bearing 360, and returned-object mutation remain safe', () => {
  const start = {lat: 0, lng: 179.999}, t = tracker(vehicle(0, start));
  const state = t.sample(at(20)); assert.ok(state.lng < 0); assert.ok(state.lng >= -180);
  near(state, destination(start, 90, 200));
  state.lat = -85; state.lng = 0;
  near(t.sample(at(21)), destination(start, 90, 210));
  const north = tracker(vehicle(0, START, {bearing: 360}));
  near(north.sample(at(5)), destination(START, 0, 50));
  t.reset(); assert.equal(t.sample(at(22)), null);
});
console.log(`PASS: ${passed} bus-motion test groups; estimated, capped, stale-safe and reduced-motion behavior verified.`);
