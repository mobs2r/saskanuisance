'use strict';
const https = require('node:https');
const {randomUUID} = require('node:crypto');
const {performance} = require('node:perf_hooks');
const ZONE = 'America/Regina';
const MAX_AGE_MS = 90000;
const mono = () => performance.now();
function fetchSource(provider, monotonic = mono) {
  return new Promise((resolve, reject) => {
    const url = provider === 'Cloudflare' ? 'https://www.cloudflare.com/cdn-cgi/trace' : 'https://www.google.com/generate_204';
    const started = monotonic();
    let settled = false;
    const finish = (error, value) => { if(settled) return; settled=true; clearTimeout(timer); error ? reject(error) : resolve(value); };
    const request = https.get(url + '?receipt_clock=' + randomUUID(), {headers:{'Cache-Control':'no-cache, no-store','Pragma':'no-cache','User-Agent':'SampleReceipt-InternetClock/1.0'}, agent:false}, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; if(body.length>16384) request.destroy(new Error('Time response too large.')); });
      response.on('error', error => finish(error));
      response.on('end', () => {
        try {
          if(response.statusCode !== (provider === 'Cloudflare' ? 200 : 204)) throw new Error(provider + ' time source unavailable.');
          // FIX: one second of cache slack instead of a hard reject on any Age header.
          if(Number(response.headers.age || 0) > 2) throw new Error('Cached time response rejected.');
          const ended = monotonic();
          const rtt = ended-started;
          // FIX: 5s ceiling; 3s tripped on ordinary slow links.
          if(rtt<0 || rtt>5000) throw new Error('Time response was too slow.');
          const match = body.match(/^ts=(\d+(?:\.\d+)?)$/m);
          const epoch = provider === 'Cloudflare' ? (match ? Number(match[1])*1000 : NaN) : Date.parse(response.headers.date || '');
          if(!Number.isFinite(epoch) || epoch<Date.UTC(2020,0,1) || epoch>Date.UTC(2100,0,1)) throw new Error('Invalid internet timestamp.');
          finish(null,{provider,epochMs:epoch+rtt/2,atMono:ended,rttMs:rtt});
        } catch(error) { finish(error); }
      });
    });
    const timer = setTimeout(() => { request.destroy(); finish(new Error(provider + ' time request timed out.')); },6000);
    request.on('error', error => finish(error));
  });
}
class InternetClock {
  constructor({monotonic=mono,fetcher=fetchSource,maxAge=MAX_AGE_MS}={}) {
    this.monotonic=monotonic; this.fetcher=fetcher; this.maxAge=maxAge;
    this.anchor=null; this.lastError='Waiting for internet time.'; this.pending=null; this.generation=0;
  }
  snapshot() {
    const current=this.monotonic();
    const age=this.anchor ? current-this.anchor.atMono : null;
    const sane=age!==null && age>=0;
    // FIX: a recorded error no longer downgrades a fresh anchor. Only real staleness does.
    const expired=!sane || age>this.maxAge;
    const status=!this.anchor ? 'unavailable' : (expired ? 'stale' : 'synced');
    return {status,epochMs:sane ? this.anchor.epochMs+age : null,ageMs:sane?age:null,maxAgeMs:this.maxAge,timeZone:ZONE,error:this.lastError,sources:this.anchor?.sources || []};
  }
  now() { const state=this.snapshot(); if(state.status!=='synced') throw new Error('Internet time is unavailable or stale. Reconnect and wait for the time indicator to turn green.'); return state.epochMs; }
  invalidate(reason='Internet time needs a new sync.') { this.lastError=reason; this.generation++; }
  // FIX: back off quickly while there is no anchor, then settle onto the minute.
  retryDelayMs() { return this.anchor ? 60000 : 5000; }
  sync() {
    if(this.pending) return this.pending;
    const generation=this.generation;
    this.pending=(async()=>{
      const providers=['Cloudflare','Google'];
      try {
        // FIX: allSettled so one blocked source no longer fails the whole sync.
        const settled=await Promise.allSettled(providers.map(provider=>this.fetcher(provider,this.monotonic)));
        const at=this.monotonic();
        const good=[];
        const failures=[];
        settled.forEach((result,index)=>{
          if(result.status==='fulfilled') good.push(result.value);
          else failures.push(providers[index] + ': ' + (result.reason?.message || String(result.reason)));
        });
        if(!good.length) throw new Error('No time source answered. ' + failures.join(' '));
        const estimates=good.map(sample=>sample.epochMs+(at-sample.atMono));
        if(estimates.some(value=>!Number.isFinite(value))) throw new Error('Invalid internet timestamp.');
        // FIX: only cross-check agreement when both sources actually answered.
        if(estimates.length===2 && Math.abs(estimates[0]-estimates[1])>3000) throw new Error('Internet time sources disagree.');
        if(generation!==this.generation) throw new Error('Time sync interrupted.');
        this.anchor={epochMs:estimates.reduce((total,value)=>total+value,0)/estimates.length,atMono:at,sources:good.map(sample=>sample.provider)};
        this.lastError=failures.length ? 'Degraded: ' + failures.join(' ') : null;
      } catch(error) { this.lastError=error.message || 'Internet time unavailable.'; }
      finally { this.pending=null; }
      return this.snapshot();
    })();
    return this.pending;
  }
}
module.exports={InternetClock,fetchSource,ZONE,MAX_AGE_MS};
