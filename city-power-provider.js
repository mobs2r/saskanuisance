'use strict';

const FEED_URL='https://www.saskatoon.ca/service-alerts/service_alert_power_outages/feed';
const MAX_RESPONSE=700000;

function decode(value){return String(value||'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/&#x([\da-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16))).replace(/&nbsp;/g,' ');}
function value(source,name){const match=source.match(new RegExp('<'+name+'\\b[^>]*>([\\s\\S]*?)<\\/'+name+'>','i'));return match?decode(match[1].replace(/<!\[CDATA\[|\]\]>/g,'')):'';}
function parseFeed(xml){return[...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map(match=>{const item=match[1],description=decode(value(item,'description')).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();return{title:value(item,'title'),date:value(item,'pubDate'),link:value(item,'link'),description};}).filter(item=>item.title);}

class CityPowerProvider{
 constructor({fetcher=globalThis.fetch,now=()=>Date.now(),refreshMs=5*60*1000}={}){this.fetcher=fetcher;this.now=now;this.refreshMs=refreshMs;this.data={status:'loading',updated:null,error:'',items:[]};this.pending=null;this.timer=null;}
 start(){if(this.timer)return;this.refresh().catch(()=>{});this.timer=setInterval(()=>this.refresh().catch(()=>{}),this.refreshMs);this.timer.unref?.();}
 stop(){if(this.timer)clearInterval(this.timer);this.timer=null;}
 snapshot(){return structuredClone(this.data);}
 refresh(){if(this.pending)return this.pending;this.pending=(async()=>{try{const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);timeout.unref?.();let text;try{const response=await this.fetcher(FEED_URL,{headers:{Accept:'application/rss+xml,application/xml'},redirect:'error',signal:controller.signal});if(!response.ok)throw new Error('City power feed returned HTTP '+response.status+'.');text=await response.text();if(text.length>MAX_RESPONSE)throw new Error('City power feed exceeded its size limit.');}finally{clearTimeout(timeout);}const items=parseFeed(text),latest=Date.parse(items[0]?.date||'');const age=Number.isFinite(latest)?this.now()-latest:Infinity;this.data={status:age>24*60*60*1000?'stale':'current',updated:new Date(this.now()).toISOString(),lastNoticeAt:Number.isFinite(latest)?new Date(latest).toISOString():null,error:'',items:items.slice(0,12)};}catch(error){this.data={...this.data,status:this.data.updated?'stale':'unavailable',error:error?.name==='AbortError'?'City power feed request timed out.':error?.message||'City power updates unavailable.'};}return this.snapshot();})();return this.pending.finally(()=>{this.pending=null;});}
}

module.exports={CityPowerProvider,FEED_URL,parseFeed};
