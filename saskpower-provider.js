'use strict';

const JSON_URL='https://www.saskpower.com/api/sitecore/Content/GetOutageJsonFile';
const KML_URL='https://outagemap.saskpower.com/Files/GetKmlFile';
const LOCAL_REGION=/Saskatoon|Martensville|Warman|Dalmeny|Clavet/i;
const MAX_JSON=1000000;
const MAX_KML=1500000;

function decode(value){return String(value||'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/&#x([\da-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16)));}
function tag(source,name){const match=source.match(new RegExp('<'+name+'\\b[^>]*>([\\s\\S]*?)<\\/'+name+'>','i'));return match?decode(match[1].replace(/<!\[CDATA\[|\]\]>/g,'')):'';}
function coordinates(source){return source.trim().split(/\s+/).map(pair=>pair.split(',').slice(0,2).map(Number)).filter(pair=>pair.length===2&&pair.every(Number.isFinite));}
function parsePolygon(source){const rings=[...source.matchAll(/<(?:outerBoundaryIs|innerBoundaryIs)\b[^>]*>[\s\S]*?<coordinates\b[^>]*>([\s\S]*?)<\/coordinates>[\s\S]*?<\/(?:outerBoundaryIs|innerBoundaryIs)>/gi)].map(match=>coordinates(match[1])).filter(ring=>ring.length>=4);return rings.length?rings:null;}
function nearSaskatoon(polygons){return polygons.some(rings=>{const points=rings.flat();if(!points.length)return false;const longitudes=points.map(point=>point[0]),latitudes=points.map(point=>point[1]);return Math.max(...latitudes)>=51.9&&Math.min(...latitudes)<=52.48&&Math.max(...longitudes)>=-107.1&&Math.min(...longitudes)<=-106.2;});}
function parsePlacemark(source){const style=tag(source,'styleUrl').replace(/^#/,'');if(style!=='planned-outage'&&style!=='unplanned-outage')return null;const name=tag(source,'name');if(!LOCAL_REGION.test(name))return null;const polygons=[...source.matchAll(/<Polygon\b[^>]*>([\s\S]*?)<\/Polygon>/gi)].map(match=>parsePolygon(match[1])).filter(Boolean);if(!polygons.length||!nearSaskatoon(polygons))return null;const description=tag(source,'description').replace(/<br\s*\/?\s*>/gi,' · ').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,1600);return{type:'Feature',geometry:polygons.length===1?{type:'Polygon',coordinates:polygons[0]}:{type:'MultiPolygon',coordinates:polygons},properties:{name,planned:style==='planned-outage',details:description}};}
function parseKml(text){return{features:[...text.matchAll(/<Placemark\b[^>]*>([\s\S]*?)<\/Placemark>/gi)].map(match=>parsePlacemark(match[1])).filter(Boolean)};}
function parseOutageJson(source){const json=typeof source==='string'?JSON.parse(source):JSON.parse(Buffer.from(source).toString('utf8'));if(!Array.isArray(json.Outages))throw new Error('SaskPower outage feed had an unexpected format.');return{items:json.Outages.filter(item=>LOCAL_REGION.test(item.Region||'')).map(item=>({region:String(item.Region||''),planned:item.Planned==='Planned',alerts:Array.isArray(item.Alerts)?item.Alerts.slice(0,4).map(alert=>({date:String(alert.CreateDate||''),message:String(alert.Message||'').slice(0,1200)})):[]}))};}

class SaskPowerProvider{
 constructor({fetcher=globalThis.fetch,refreshMs=5*60*1000}={}){this.fetcher=fetcher;this.refreshMs=refreshMs;this.data={status:'loading',updated:null,error:'',features:[],items:[]};this.pending=null;this.timer=null;}
 start(){if(this.timer)return;this.refresh().catch(()=>{});this.timer=setInterval(()=>this.refresh().catch(()=>{}),this.refreshMs);this.timer.unref?.();}
 stop(){if(this.timer)clearInterval(this.timer);this.timer=null;}
 snapshot(){return structuredClone(this.data);}
 async get(url,maxBytes,type){const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),18000);timeout.unref?.();try{const response=await this.fetcher(url,{headers:{Accept:type},redirect:'error',signal:controller.signal});if(!response.ok)throw new Error('SaskPower returned HTTP '+response.status+'.');const text=await response.text();if(text.length>maxBytes)throw new Error('SaskPower response exceeded its size limit.');return text;}finally{clearTimeout(timeout);}}
 refresh(){if(this.pending)return this.pending;this.pending=(async()=>{try{const[jsonText,kmlText]=await Promise.all([this.get(JSON_URL,MAX_JSON,'application/json'),this.get(KML_URL,MAX_KML,'application/xml,text/xml')]);const parsedJson=parseOutageJson(jsonText);const parsed=parseKml(kmlText);this.data={status:'current',updated:new Date().toISOString(),error:'',features:parsed.features,items:parsedJson.items};}catch(error){this.data={...this.data,status:this.data.updated?'stale':'unavailable',error:error?.name==='AbortError'?'SaskPower outage request timed out.':error?.message||'SaskPower outage data unavailable.'};}return this.snapshot();})();return this.pending.finally(()=>{this.pending=null;});}
}

module.exports={SaskPowerProvider,JSON_URL,KML_URL,parseKml,parseOutageJson};
