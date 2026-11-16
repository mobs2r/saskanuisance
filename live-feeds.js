'use strict';
const VIA_URL='https://tsimobile.viarail.ca/data/allData.json';
const BIRD='https://mds.bird.co/gbfs/v2/public/saskatoon/';
const num=v=>{const n=Number(v);return Number.isFinite(n)?n:null;};
async function getJson(fetcher,url,max){const c=new AbortController();const t=setTimeout(()=>c.abort(),15000);t.unref?.();try{const r=await fetcher(url,{headers:{Accept:'application/json'},redirect:'error',signal:c.signal});if(!r.ok)throw new Error('HTTP '+r.status);const text=await r.text();if(text.length>max)throw new Error('Response too large');return JSON.parse(text);}finally{clearTimeout(t);}}
class CachedFeed{
 constructor({fetcher=globalThis.fetch,ttl=60000,now=()=>Date.now()}={}){this.fetcher=fetcher;this.ttl=ttl;this.now=now;this.value=null;this.at=0;this.pending=null;}
 async get(){if(this.value&&this.now()-this.at<this.ttl)return this.value;if(!this.pending)this.pending=this.load().then(v=>{this.value=v;this.at=this.now();return v;},e=>({status:'unavailable',error:String(e?.message||e),items:[]})).finally(()=>{this.pending=null;});return this.pending;}
}
function parseVia(d){
 const items=[];
 for(const[key,v]of Object.entries(d||{})){
  const m=/^(\d{1,4})\s*\((\d\d-\d\d)\)$/.exec(key);if(!m||!['1','2'].includes(m[1])||!v||v.arrived)continue;if(Array.isArray(v.times)&&!v.times.some(s=>s&&s.eta!=='ARR'))continue;
  const lat=num(v.lat),lon=num(v.lng);if(lat===null||lon===null)continue;
  const times=Array.isArray(v.times)?v.times:[];const next=times.find(s=>s&&s.eta!=='ARR')||null;const sk=times.find(s=>s&&s.code==='SASK')||null;
  items.push({train:m[1],date:m[2],from:String(v.from||''),to:String(v.to||''),lat,lon,speed:num(v.speed),heading:num(v.direction),poll:Date.parse(v.poll)||null,next:next?{station:String(next.station||''),estimated:Date.parse(next.estimated)||null,late:num(next.diffMin)}:null,saskatoon:sk?{estimated:Date.parse(sk.estimated)||null,scheduled:Date.parse(sk.scheduled)||null,late:num(sk.diffMin),done:sk.eta==='ARR'}:null});
 }
 return {items};
}
function parseBikes(bikes,types){
 const kinds=new Map((types?.data?.vehicle_types||[]).map(t=>[t.vehicle_type_id,t]));
 const items=(bikes?.data?.bikes||[]).filter(b=>!b.is_disabled&&!b.is_reserved).map(b=>{const t=kinds.get(b.vehicle_type_id)||{};return{id:String(b.bike_id||''),lat:num(b.lat),lon:num(b.lon),kind:t.form_factor==='bicycle'?'e-bike':'scooter',range:num(b.current_range_meters),max:num(t.max_range_meters)};}).filter(b=>b.lat!==null&&b.lon!==null).slice(0,3000);
 return {items,updated:(num(bikes?.last_updated)||0)*1000};
}
class ViaLive extends CachedFeed{
 async load(){
  const d=await getJson(this.fetcher,VIA_URL,4000000);
  return {status:'live',updated:this.now(),items:parseVia(d).items};
 }
}
class Scooters extends CachedFeed{
 async load(){
  const [bikes,types]=await Promise.all([getJson(this.fetcher,BIRD+'free_bike_status.json',6000000),getJson(this.fetcher,BIRD+'vehicle_types.json',200000).catch(()=>null)]);
  const parsed=parseBikes(bikes,types);
  return {status:'live',updated:parsed.updated||this.now(),operator:'Bird',items:parsed.items};
 }
}
module.exports={ViaLive,Scooters,parseVia,parseBikes};
