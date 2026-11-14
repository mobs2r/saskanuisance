'use strict';

const BASE='https://gisext.saskatoon.ca/arcgis/rest/services/AGOL/RRCP/MapServer';
const AMENITIES='https://gisext.saskatoon.ca/arcgis/rest/services/AGOL/CyclingGuide/MapServer';
const LAYERS=Object.freeze([{id:0,key:'activeRestrictions'},{id:1,key:'upcomingRestrictions'},{id:2,key:'activeConstruction'},{id:3,key:'upcomingConstruction'}]);
const AMENITY_LAYERS=Object.freeze([{id:5,key:'leisureFacilities'},{id:6,key:'hospitals'}]);
const MAX_RESPONSE=12000000;
class CityMapProvider{
 constructor({fetcher=globalThis.fetch,refreshMs=5*60*1000}={}){this.fetcher=fetcher;this.refreshMs=refreshMs;this.data={status:'loading',updated:null,error:'',activeRestrictions:[],upcomingRestrictions:[],activeConstruction:[],upcomingConstruction:[],leisureFacilities:[],hospitals:[]};this.pending=null;this.timer=null;}
 start(){if(this.timer)return;this.refresh().catch(()=>{});this.timer=setInterval(()=>this.refresh().catch(()=>{}),this.refreshMs);this.timer.unref?.();}
 stop(){if(this.timer)clearInterval(this.timer);this.timer=null;}
 snapshot(){return structuredClone(this.data);}
 async queryLayer(layer,amenity=false){const query=new URLSearchParams({where:'1=1',outFields:'*',returnGeometry:'true',outSR:'4326',geometryPrecision:'5',f:'json'});const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),12000);timeout.unref?.();try{const response=await this.fetcher((amenity?AMENITIES:BASE)+'/'+layer.id+'/query?'+query.toString(),{headers:{Accept:'application/json'},redirect:'error',signal:controller.signal});if(!response.ok)throw new Error('City map returned HTTP '+response.status+'.');const text=await response.text();if(text.length>MAX_RESPONSE)throw new Error('City map response exceeded its size limit.');const json=JSON.parse(text);if(json.error)throw new Error(json.error.message||'City map query failed.');return Array.isArray(json.features)?json.features.filter(feature=>feature?.geometry&&feature?.attributes):[];}finally{clearTimeout(timeout);}}
 refresh(){if(this.pending)return this.pending;this.pending=(async()=>{try{const layers=[...LAYERS.map(layer=>({layer,amenity:false})),...AMENITY_LAYERS.map(layer=>({layer,amenity:true}))];const results=await Promise.allSettled(layers.map(({layer,amenity})=>this.queryLayer(layer,amenity)));const failed=results.filter(result=>result.status==='rejected');if(failed.length===results.length)throw failed[0].reason;const next={status:failed.length?'partial':'current',updated:new Date().toISOString(),error:failed.map(result=>result.reason?.message||'Layer unavailable.').join(' ')};for(let i=0;i<layers.length;i++)next[layers[i].layer.key]=results[i].status==='fulfilled'?results[i].value:[];this.data=next;}catch(error){this.data={...this.data,status:this.data.updated?'stale':'unavailable',error:error?.name==='AbortError'?'City map request timed out.':error?.message||'City map unavailable.'};}return this.snapshot();})();return this.pending.finally(()=>{this.pending=null;});}
}
module.exports={CityMapProvider,BASE};
