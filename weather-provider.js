'use strict';
const https=require('node:https');
const fs=require('node:fs/promises');
const path=require('node:path');
const {performance}=require('node:perf_hooks');
const URL='https://api.weather.gc.ca/collections/citypageweather-realtime/items/sk-40?f=json';
const POLL_MS=15*60*1000, STALE_MS=2*60*60*1000, LIMIT=2*1024*1024;
const text=(v,max=1000)=>typeof v==='string'?v.trim().slice(0,max):null;
const num=(v,min,max)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max?v:null;
const stamp=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT/.test(v)&&Number.isFinite(Date.parse(v))?Date.parse(v):null;
function parseWeather(input){
 const p=input?.properties,c=p?.currentConditions;
 if(p?.name?.en!=='Saskatoon'||!c||typeof c!=='object')throw Error('Unexpected ECCC weather response.');
 const observedAt=stamp(c.timestamp?.en);if(observedAt===null)throw Error('Weather observation timestamp missing.');
 const f=p.forecastGroup;
 return {city:'Saskatoon',observedAt,station:text(c.station?.value?.en,180),condition:text(c.condition?.en,180),temperature:num(c.temperature?.value?.en,-100,70),humidity:num(c.relativeHumidity?.value?.en,0,100),windSpeed:num(c.wind?.speed?.value?.en,0,400),windDirection:text(c.wind?.direction?.value?.en,12),windGust:num(c.wind?.gust?.value?.en,0,500),windChill:num(c.windChill?.value?.en,-120,70),forecastIssuedAt:stamp(f?.timestamp?.en),forecast:Array.isArray(f?.forecasts)?f.forecasts.slice(0,8).map(row=>({period:text(row.period?.textForecastName?.en,60)||text(row.period?.value?.en,60),summary:text(row.textSummary?.en,1500)})).filter(row=>row.period&&row.summary):[],attribution:'Data Source: Environment and Climate Change Canada'};
}
function fetchWeather(etag){return new Promise((resolve,reject)=>{
 let settled=false;const done=(err,result)=>{if(settled)return;settled=true;clearTimeout(timer);err?reject(err):resolve(result);};
 const request=https.get(URL,{headers:{'User-Agent':'SampleReceipt-SaskatoonWeather/1.4 (local desktop; ECCC city forecast)','Accept':'application/geo+json, application/json',...(etag?{'If-None-Match':etag}:{})}},res=>{
 if(res.statusCode===304){res.resume();done(null,{notModified:true});return;}
 if(res.statusCode!==200){res.resume();done(Error('ECCC weather request returned '+res.statusCode));return;}
 let size=0;const chunks=[];res.on('data',chunk=>{size+=chunk.length;if(size>LIMIT)request.destroy(Error('Weather response exceeds limit.'));else chunks.push(chunk);});
 res.on('error',err=>done(err));res.on('end',()=>{try{done(null,{raw:JSON.parse(Buffer.concat(chunks).toString('utf8')),data:parseWeather(JSON.parse(Buffer.concat(chunks).toString('utf8'))),etag:typeof res.headers.etag==='string'?res.headers.etag.slice(0,256):null});}catch(err){done(err);}});
 });const timer=setTimeout(()=>{request.destroy();done(Error('ECCC weather request timed out.'));},10000);request.on('error',err=>done(err));
});}
class WeatherProvider{
 constructor({cacheDir,now=()=>null,monotonic=()=>performance.now(),fetcher=fetchWeather}={}){this.cacheDir=cacheDir;this.now=()=>{try{const n=now();return Number.isFinite(n)?n:null;}catch{return null;}};this.mono=monotonic;this.fetcher=fetcher;this.data=null;this.etag=null;this.fetchedAt=null;this.lastSuccess=null;this.lastAttempt=null;this.error='Weather has not loaded.';this.pending=null;this.timer=null;this.started=false;}
 async start(){if(this.started)return this.snapshot();this.started=true;if(this.cacheDir){try{const raw=await fs.readFile(path.join(this.cacheDir,'weather.json'),'utf8');if(raw.length>LIMIT)throw Error('cache too large');const saved=JSON.parse(raw);if(saved?.version===1&&saved.raw){this.data=parseWeather(saved.raw);}}catch{}}
 this.timer=setInterval(()=>this.refresh(),POLL_MS);this.timer.unref?.();return this.refresh();}
 stop(){if(this.timer)clearInterval(this.timer);this.timer=null;}
 refresh(){if(this.pending)return this.pending;const at=this.mono();if(this.lastAttempt!==null&&at-this.lastAttempt<POLL_MS)return Promise.resolve(this.snapshot());this.lastAttempt=at;
 this.pending=(async()=>{try{const r=await this.fetcher(this.etag);if(r.notModified&&!this.data)throw Error('Weather cache missing.');if(!r.notModified){this.data=r.data;this.etag=r.etag||null;if(this.cacheDir&&r.raw){await fs.mkdir(this.cacheDir,{recursive:true});await fs.writeFile(path.join(this.cacheDir,'weather.json'),JSON.stringify({version:1,raw:r.raw}),'utf8').catch(()=>{});}}this.lastSuccess=this.mono();this.fetchedAt=this.now();this.error=null;}catch(e){this.error=e.message||'Weather unavailable.';}finally{this.pending=null;}return this.snapshot();})();return this.pending;}
 snapshot(){const now=this.now(),age=this.data&&now!==null?now-this.data.observedAt:null;const fetchAge=this.lastSuccess===null?null:this.mono()-this.lastSuccess;const fresh=this.data&&age!==null&&age>=-300000&&age<=STALE_MS&&fetchAge!==null&&fetchAge>=0&&fetchAge<=POLL_MS*2&&!this.error;return {status:!this.data?'unavailable':fresh?'current':'stale',data:this.data,observationAgeMs:age,fetchAgeMs:fetchAge,fetchedAt:this.fetchedAt,error:this.error,refreshing:!!this.pending,staleAfterMs:STALE_MS};}
}
module.exports={WeatherProvider,parseWeather,fetchWeather,POLL_MS,STALE_MS,URL};
