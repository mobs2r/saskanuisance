'use strict';
const {Adapter} = require('./adapter');
const {RingBuffer} = require('./ring-buffer');
const {parseWeather} = require('./weather-provider');
const {_test: transitTest} = require('./transit-provider');
const {parseVia, parseBikes} = require('./live-feeds');
const {parseDocument} = require('./city-info-provider');
const {parseFeed} = require('./city-power-provider');
const {parseOutageJson} = require('./saskpower-provider');
const {parseLayer} = require('./city-map-provider');

const text = body => Buffer.from(body).toString('utf8');

function parseWeatherFeed(body) {
  const data = parseWeather(JSON.parse(text(body)));
  return {...data, items: data.forecast};
}

function parseBird(body) {
  return parseBikes(JSON.parse(text(body)), null);
}

function parseRoads(body) {
  return {items: parseLayer(JSON.parse(text(body)))};
}

function parseRealtime(body) {
  const feed = transitTest.decodeFeed(Buffer.isBuffer(body) ? body : Buffer.from(body));
  return {version: feed.header?.version || null, timestamp: feed.header?.timestamp ?? null, items: (feed.entities || []).filter(entity => !entity.deleted)};
}

function parsePower(body) {
  return parseOutageJson(text(body));
}

function parseCityPower(body) {
  return {items: parseFeed(text(body))};
}

function parseViaFeed(body) {
  return parseVia(JSON.parse(text(body)));
}

const SOURCES = Object.freeze([
  {id:'wx-eccc',   label:'ECCC YXE weather',      tier:'A', url:'https://api.weather.gc.ca/collections/citypageweather-realtime/items/sk-40?f=json', parse:parseWeatherFeed},
  {id:'gbfs-bird', label:'Bird scooters',          tier:'A', url:'https://mds.bird.co/gbfs/v2/public/saskatoon/free_bike_status.json', parse:parseBird},
  {id:'gis-rrcp',  label:'Road restrictions',      tier:'A', url:'https://gisext.saskatoon.ca/arcgis/rest/services/AGOL/RRCP/MapServer/0/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&geometryPrecision=5&f=json', parse:parseRoads},
  {id:'transit-veh', label:'Transit vehicles',     tier:'B', url:'https://saskprdtmgtfs.sasktrpcloud.com/TMGTFSRealTimeWebService/Vehicle/VehiclePositions.pb', accept:'application/x-protobuf', maxBytes:8*1024*1024, parse:parseRealtime},
  {id:'transit-upd', label:'Transit predictions',  tier:'B', url:'https://saskprdtmgtfs.sasktrpcloud.com/TMGTFSRealTimeWebService/TripUpdate/TripUpdates.pb', accept:'application/x-protobuf', maxBytes:8*1024*1024, parse:parseRealtime},
  {id:'transit-alt', label:'Transit alerts',       tier:'B', url:'https://saskprdtmgtfs.sasktrpcloud.com/TMGTFSRealTimeWebService/Alert/Alerts.pb', accept:'application/x-protobuf', maxBytes:8*1024*1024, parse:parseRealtime},
  {id:'spc-json',  label:'SaskPower outages',      tier:'B', url:'https://www.saskpower.com/api/sitecore/Content/GetOutageJsonFile', parse:parsePower},
  {id:'city-rss',  label:'City releases',          tier:'C', url:'https://www.saskatoon.ca/news-releases/feed', accept:'application/rss+xml, application/xml', parse:parseDocument},
  {id:'city-power', label:'City power notices',    tier:'C', url:'https://www.saskatoon.ca/service-alerts/service_alert_power_outages/feed', accept:'application/rss+xml, application/xml', parse:parseCityPower},
  {id:'via-live',  label:'VIA Rail positions',     tier:'C', url:'https://tsimobile.viarail.ca/data/allData.json', maxBytes:4*1024*1024, parse:parseViaFeed}
]);

async function createAdapters({cacheDir, now, fetcher}) {
  const adapters = [];
  for (const source of SOURCES) {
    const ring = await new RingBuffer({dir: cacheDir, id: source.id}).init();
    adapters.push(new Adapter({...source, ring, now, fetcher}));
  }
  return adapters;
}

module.exports = {SOURCES, createAdapters};
