'use strict';
const FEED_URL='https://www.saskatoon.ca/news-releases/feed';
const LIMIT=1000000;
const REFRESH=10*60*1000;
function decode(value){return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&#(x[\da-f]+|\d+);/gi,(_,n)=>{const x=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):parseInt(n,10);return Number.isFinite(x)&&x>=0&&x<=0x10ffff&&!(x>=0xd800&&x<=0xdfff)?String.fromCodePoint(x):' ';}).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');}
function field(xml,name){const lower=xml.toLowerCase(),tag='<'+name.toLowerCase(),at=lower.indexOf(tag);if(at<0)return '';const open=xml.indexOf('>',at),close=lower.indexOf('</'+name.toLowerCase()+'>',open+1);return open<0||close<0?'':xml.slice(open+1,close);}
function clean(value,max){return decode(value).replace(/<br\s*\/?\s*>/gi,' ').replace(/<\/p>/gi,' ').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,max);}
function parse(xml){const items=[...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].slice(0,80).map(([,raw])=>({title:clean(field(raw,'title'),180),date:clean(field(raw,'pubDate'),80),summary:clean(field(raw,'content:encoded')||field(raw,'description'),900)})).filter(item=>item.title);const roadItems=items.filter(item=>/daily road report|road restriction|road closure|lane closure|construction|traffic detour|road work/i.test(item.title+' '+item.summary)).slice(0,4);return{items:items.slice(0,12),roadItems};}
function parseDocument(xml){const text=Buffer.isBuffer(xml)?xml.toString('utf8'):String(xml??'');if(text.length>LIMIT||!/<rss\b|<feed\b/i.test(text))throw new Error('City news feed was not a valid RSS document.');const next=parse(text);if(!next.items.length)throw new Error('City news feed had no readable releases.');return next;}
class CityInfoProvider{
 constructor({fetcher=globalThis.fetch,refreshMs=REFRESH}={}){this.fetcher=fetcher;this.refreshMs=refreshMs;this.items=[];this.roadItems=[];this.error='';this.updated='';this.pending=null;this.timer=null;}
 start(){if(this.timer)return;this.refresh().catch(()=>{});this.timer=setInterval(()=>this.refresh().catch(()=>{}),this.refreshMs);this.timer.unref?.();}
 stop(){if(this.timer)clearInterval(this.timer);this.timer=null;}
 snapshot(){return{status:this.items.length?(this.error?'stale':'current'):'unavailable',items:this.items,roadItems:this.roadItems,updated:this.updated,error:this.error};}
 refresh(){if(this.pending)return this.pending;this.pending=(async()=>{const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),10000);timer.unref?.();try{const response=await this.fetcher(FEED_URL,{headers:{Accept:'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8'},redirect:'error',signal:controller.signal});if(!response.ok)throw new Error('City news feed returned HTTP '+response.status+'.');const xml=await response.text();const next=parseDocument(xml);this.items=next.items;this.roadItems=next.roadItems;this.updated=this.items[0].date;this.error='';return this.snapshot();}catch(error){this.error=error?.name==='AbortError'?'City news feed timed out.':error?.message||'City news feed unavailable.';return this.snapshot();}finally{clearTimeout(timer);this.pending=null;}})();return this.pending;}
}
module.exports={CityInfoProvider,FEED_URL,parseDocument};
