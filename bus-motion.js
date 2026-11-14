

(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BusMotion = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const R = 6371008.8, RAD = Math.PI / 180, DEG = 180 / Math.PI;
  const LIMITS = Object.freeze({predictionMs: 30000, predictionMeters: 300,
    staleMs: 90000, maxSpeed: 45, correctionMs: 1000,
    correctionMeters: 100, vectorMaxAgeMs: 60000, routeMatchMeters: 35});
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const wrap = value => ((value + 180) % 360 + 360) % 360 - 180;
  const validPoint = point => point && finite(point.lat) && finite(point.lng) &&
    Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180;
  const point = value => Array.isArray(value) ? {lat: value[0], lng: value[1]} : null;
  const sameIdentity = (a, b) => a.id === b.id && a.routeId === b.routeId && a.tripId === b.tripId;
  const identity = vehicle => ({id: vehicle.id ?? null, routeId: vehicle.routeId ?? null, tripId: vehicle.tripId ?? null});
  function distanceMeters(a, b) {
    const lat = (b.lat - a.lat) * RAD, lng = wrap(b.lng - a.lng) * RAD;
    const h = Math.sin(lat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(lng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(clamp(h, 0, 1)));
  }
  function bearingBetween(a, b) {
    const delta = wrap(b.lng - a.lng) * RAD, la = a.lat * RAD, lb = b.lat * RAD;
    return (Math.atan2(Math.sin(delta) * Math.cos(lb), Math.cos(la) * Math.sin(lb) -
      Math.sin(la) * Math.cos(lb) * Math.cos(delta)) * DEG + 360) % 360;
  }
  function destination(start, heading, meters) {
    const angular = meters / R, bearing = heading * RAD, lat = start.lat * RAD;
    const nextLat = Math.asin(clamp(Math.sin(lat) * Math.cos(angular) +
      Math.cos(lat) * Math.sin(angular) * Math.cos(bearing), -1, 1));
    const nextLng = start.lng * RAD + Math.atan2(Math.sin(bearing) * Math.sin(angular) * Math.cos(lat),
      Math.cos(angular) - Math.sin(lat) * Math.sin(nextLat));
    return {lat: nextLat * DEG, lng: wrap(nextLng * DEG)};
  }
  function interpolate(a, b, t) {
    return {lat: a.lat + (b.lat - a.lat) * t, lng: wrap(a.lng + wrap(b.lng - a.lng) * t)};
  }
  function normalizePaths(paths, vehicle) {
    if (!Array.isArray(paths) || !paths.length) return [];
    const list = finite(paths[0]?.[0]) ? [paths] : paths;
    return list.filter(path => Array.isArray(path) || (path &&
      (path.routeId == null || path.routeId === vehicle.routeId) &&
      (path.tripId == null || path.tripId === vehicle.tripId))).map(path => Array.isArray(path) ? path : path.points)
      .filter(path => Array.isArray(path) && path.length > 1);
  }

  function routeAdvance(match, meters) {
    let remaining = meters, cursor = match.position, index = match.index, moved = 0;
    while (index + 1 < match.path.length) {
      const a = point(match.path[index]), b = point(match.path[index + 1]);
      if (!validPoint(a) || !validPoint(b) || distanceMeters(a, b) > 1000) break;
      const length = distanceMeters(cursor, b);
      if (length >= remaining && length > 0.001) {
        return {point: interpolate(cursor, b, remaining / length), distance: moved + remaining, ended: false};
      }
      moved += length; remaining -= length; cursor = b; index++;
      if (remaining <= 0.001) return {point: cursor, distance: moved, ended: index + 1 >= match.path.length};
    }
    return {point: cursor, distance: moved, ended: true};
  }
  function matchRoute(paths, fix, motion) {
    if (motion.speed <= 0 || !finite(motion.bearing) || Math.abs(fix.lat) > 85) return null;
    const candidates = [], cos = Math.cos(fix.lat * RAD);
    for (const path of normalizePaths(paths, fix)) {
      for (let index = 0; index + 1 < path.length; index++) {
        const a = point(path[index]), b = point(path[index + 1]);
        if (!validPoint(a) || !validPoint(b)) continue;
        const length = distanceMeters(a, b);
        if (length < 0.5 || length > 1000 || Math.abs(wrap(bearingBetween(a, b) - motion.bearing)) > 50) continue;
        const ax = wrap(a.lng - fix.lng) * RAD * R * cos, ay = (a.lat - fix.lat) * RAD * R;
        const bx = wrap(b.lng - fix.lng) * RAD * R * cos, by = (b.lat - fix.lat) * RAD * R;
        const dx = bx - ax, dy = by - ay;
        const t = clamp(-(ax * dx + ay * dy) / (dx * dx + dy * dy), 0, 1);
        const position = interpolate(a, b, t), distance = distanceMeters(position, fix);
        if (distance <= LIMITS.routeMatchMeters) candidates.push({path, index, position, distance});
      }
    }
    candidates.sort((a, b) => a.distance - b.distance);
    const best = candidates[0];
    if (!best) return null;

    const horizon = Math.min(LIMITS.predictionMeters, motion.speed * LIMITS.predictionMs / 1000);
    const end = routeAdvance(best, horizon).point;
    if (candidates.some(candidate => candidate.distance <= best.distance + 8 &&
      distanceMeters(end, routeAdvance(candidate, horizon).point) > 40)) return null;
    return best;
  }
  function inferMotion(fix, previous, teleport) {
    if (teleport) return {speed: 0, bearing: null, source: 'teleport-reset'};
    const speed = fix.speedMetersPerSecond, bearing = fix.bearing;
    if ((speed != null && (!finite(speed) || speed < 0 || speed > LIMITS.maxSpeed)) ||
      (bearing != null && (!finite(bearing) || bearing < 0 || bearing > 360))) {
      return {speed: 0, bearing: null, source: 'invalid-motion'};
    }
    if (speed != null && speed <= 0.2) return {speed: 0, bearing: finite(bearing) ? bearing % 360 : null, source: 'stationary'};
    let inferred = null;
    if (previous) {
      const elapsed = fix.updatedAt - previous.updatedAt, distance = distanceMeters(previous, fix);
      if (elapsed >= 1000 && elapsed <= LIMITS.vectorMaxAgeMs) {
        if (distance <= 3) return {speed: 0, bearing: null, source: 'stationary'};
        const observedSpeed = distance / (elapsed / 1000);
        if (observedSpeed <= LIMITS.maxSpeed) inferred = {speed: observedSpeed,
          bearing: bearingBetween(previous, fix), source: 'observed-fixes'};
      }
    }
    if (finite(speed) && finite(bearing)) return {speed, bearing: bearing % 360, source: 'telemetry'};
    return inferred || {speed: 0, bearing: finite(bearing) ? bearing % 360 : null, source: 'none'};
  }
  class Tracker {
    constructor() { this.reset(); }
    reset() {
      this._fix = this._shown = this._blocked = this._clock = this._correction = this._route = null;
      this._motion = {speed: 0, bearing: null, source: 'none'};
      this._reduced = false;
    }
    _clockReason(options) {
      if (options.clockAvailable === false || !finite(options.nowMs) || options.nowMs <= 0 ||
          !finite(options.monoMs) || options.monoMs < 0) return 'time-unavailable';
      if (this._clock && !this._blocked && (options.monoMs < this._clock.monoMs ||
          options.nowMs < this._clock.nowMs - 1000 || Math.abs((options.nowMs - this._clock.nowMs) -
          (options.monoMs - this._clock.monoMs)) > 5000)) return 'time-discontinuity';
      this._clock = {nowMs: options.nowMs, monoMs: options.monoMs};
      return null;
    }
    _freshnessReason(fix, options) {
      if (options.stale === true || fix.stale === true ||
          (fix.freshness != null && !['live', 'fresh'].includes(fix.freshness))) return 'stale-feed';
      if (!finite(fix.updatedAt) || fix.updatedAt <= 0) return 'unknown-observation-time';
      if (fix.updatedAt > options.nowMs + 5000) return 'future-observation';
      if (options.nowMs - fix.updatedAt >= LIMITS.staleMs) return 'stale-position';
      return null;
    }
    _hold(reason, options) {
      this._blocked = this._blocked || reason;
      if (options.reducedMotion !== undefined) this._reduced = Boolean(options.reducedMotion);
      this._correction = null;
      if (!this._shown && this._fix) this._shown = {lat: this._fix.lat, lng: this._fix.lng};
      return this._result(options, {frozen: true, stale: true, reason: this._blocked});
    }
    _result(options, flags) {
      if (!this._fix || !this._shown) return null;
      return {lat: this._shown.lat, lng: this._shown.lng,
        estimated: distanceMeters(this._shown, this._fix) > 0.05,
        frozen: Boolean(flags.frozen), stale: Boolean(flags.stale), reason: flags.reason,
        observedAt: this._fix.updatedAt, observedLat: this._fix.lat, observedLng: this._fix.lng,
        ageSeconds: options.clockAvailable !== false && finite(options.nowMs) && finite(this._fix.updatedAt) ?
          Math.max(0, (options.nowMs - this._fix.updatedAt) / 1000) : null,
        bearing: this._motion.bearing, speedMetersPerSecond: this._motion.speed,
        motionSource: this._motion.source, routeMatched: Boolean(this._route)};
    }
    _target(options) {
      const ageMs = Math.max(0, options.nowMs - this._fix.updatedAt);
      const requested = Math.min(ageMs, LIMITS.predictionMs) / 1000 * this._motion.speed;
      const meters = Math.min(requested, LIMITS.predictionMeters);
      let position = {lat: this._fix.lat, lng: this._fix.lng}, ended = false;
      if (meters > 0) {
        if (this._route) {
          const next = routeAdvance(this._route, meters);

          position = {lat: this._fix.lat + next.point.lat - this._route.position.lat,
            lng: wrap(this._fix.lng + wrap(next.point.lng - this._route.position.lng))};
          ended = next.ended;
        } else position = destination(this._fix, this._motion.bearing, meters);
      }
      const capped = this._motion.speed > 0 && (ageMs >= LIMITS.predictionMs || requested >= LIMITS.predictionMeters);
      return {position, frozen: capped || ended || this._motion.speed === 0,
        reason: ended ? 'route-end' : capped ? 'prediction-limit' : this._motion.speed === 0 ? this._motion.source : 'estimated'};
    }
    _startCorrection(from, target, monoMs) {
      this._correction = from && distanceMeters(from, target) <= LIMITS.correctionMeters ?
        {lat: from.lat - target.lat, lng: wrap(from.lng - target.lng), started: monoMs} : null;
    }
    update(vehicle, options = {}) {
      if (!vehicle || !validPoint({lat: vehicle.latitude, lng: vehicle.longitude})) return this._hold('invalid-position', options);
      const next = {...identity(vehicle), lat: vehicle.latitude, lng: vehicle.longitude,
        updatedAt: vehicle.updatedAt, stale: vehicle.stale, freshness: vehicle.freshness,
        bearing: vehicle.bearing, speedMetersPerSecond: vehicle.speedMetersPerSecond};
      const changed = this._fix && !sameIdentity(this._fix, next);
      if (changed) this.reset();
      const clockReason = this._clockReason(options);
      const reason = clockReason || this._freshnessReason(next, options);
      const previous = this._fix;
      if (!previous) {
        this._fix = next;
        this._shown = {lat: next.lat, lng: next.lng};
        if (reason) return this._hold(reason, options);
      } else {
        if (reason) return this._hold(reason, options);

        if (finite(previous.updatedAt) && previous.updatedAt <= options.nowMs + 5000 &&
            next.updatedAt <= previous.updatedAt) return this.sample(options);
      }
      let from = this._shown;
      if (previous && !this._blocked) {
        this.sample(options);
        from = this._shown;
      }
      const elapsed = previous ? (next.updatedAt - previous.updatedAt) / 1000 : 0;
      const teleport = Boolean(previous && elapsed > 0 &&
        distanceMeters(previous, next) > Math.max(100, elapsed * LIMITS.maxSpeed));

      const inferPrevious = !this._blocked && previous ? previous : null;
      this._fix = next;
      this._blocked = null;
      if (options.reducedMotion !== undefined) this._reduced = Boolean(options.reducedMotion);
      this._motion = inferMotion(next, inferPrevious, teleport);
      this._route = matchRoute(options.paths, next, this._motion);
      this._correction = null;
      if (previous && !teleport && !this._reduced) this._startCorrection(from, this._target(options).position, options.monoMs);
      return this.sample(options);
    }
    sample(options = {}) {
      if (!this._fix) return null;
      const clockReason = this._clockReason(options);
      if (clockReason) return this._hold(clockReason, options);
      const freshnessReason = this._freshnessReason(this._fix, options);
      if (freshnessReason) return this._hold(freshnessReason, options);
      if (this._blocked) return this._hold(this._blocked, options);
      const reduced = options.reducedMotion === undefined ? this._reduced : Boolean(options.reducedMotion);
      if (reduced) {
        this._reduced = true;
        this._correction = null;
        this._shown = {lat: this._fix.lat, lng: this._fix.lng};
        return this._result(options, {frozen: true, stale: false, reason: 'reduced-motion'});
      }
      const target = this._target(options);
      if (this._reduced) this._startCorrection(this._shown, target.position, options.monoMs);
      this._reduced = false;
      this._shown = target.position;
      let correcting = false;
      if (this._correction) {
        const t = clamp((options.monoMs - this._correction.started) / LIMITS.correctionMs, 0, 1);
        const weight = 1 - t * t * (3 - 2 * t);
        this._shown = {lat: this._shown.lat + this._correction.lat * weight,
          lng: wrap(this._shown.lng + this._correction.lng * weight)};
        correcting = t < 1;
        if (!correcting) this._correction = null;
      }
      return this._result(options, {frozen: target.frozen && !correcting, stale: false,
        reason: correcting ? 'correcting' : target.reason});
    }
  }
  return Object.freeze({Tracker, LIMITS, distanceMeters, bearingBetween, destination});
});
