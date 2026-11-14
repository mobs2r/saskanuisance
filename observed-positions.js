
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.BusPositions=api;})(typeof globalThis==='object'?globalThis:this,function(){
 'use strict';
 const valid=v=>v&&Number.isFinite(v.latitude)&&Number.isFinite(v.longitude)&&Math.abs(v.latitude)<=90&&Math.abs(v.longitude)<=180;
 const distance=(a,b)=>{const r=Math.PI/180,x=(b.latitude-a.latitude)*r,y=(b.longitude-a.longitude)*r,h=Math.sin(x/2)**2+Math.cos(a.latitude*r)*Math.cos(b.latitude*r)*Math.sin(y/2)**2;return 6371000*2*Math.asin(Math.sqrt(Math.min(1,h)));};
 class Tracker{
  constructor(){this.fix=null;this.problem=null;this.suspect=null;}
  update(v,o={}){
   if(!valid(v)){this.problem='Invalid GPS report';return this.sample(o);}
   const old=this.fix;
   if(old&&old.id===v.id&&old.tripId===v.tripId){
    if(Number.isFinite(old.updatedAt)&&(!Number.isFinite(v.updatedAt)||v.updatedAt<old.updatedAt)){this.problem='Out-of-order GPS report';return this.sample(o);}
    if(v.updatedAt===old.updatedAt){this.fix={...old,stale:v.stale,freshness:v.freshness};return this.sample(o);}
    const dt=(v.updatedAt-old.updatedAt)/1000;
    if(dt>0&&dt<90&&distance(old,v)>Math.max(150,dt*55)){
     const confirmed=this.suspect&&v.updatedAt>this.suspect.updatedAt&&distance(this.suspect,v)<Math.max(100,(v.updatedAt-this.suspect.updatedAt)/1000*55);
     if(!confirmed){this.suspect={...v};this.problem='Implausible GPS jump; waiting for another report';return this.sample(o);}
    }
   }
   this.fix={...v};this.problem=null;this.suspect=null;return this.sample(o);
  }
  sample(o={}){
   const v=this.fix;if(!v)return null;
   const age=Number.isFinite(o.nowMs)&&Number.isFinite(v.updatedAt)?(o.nowMs-v.updatedAt)/1000:null;
   const stale=Boolean(o.stale||v.stale||this.problem||age===null||age< -5||age>=90||!['live','fresh',undefined].includes(v.freshness));
   return {lat:v.latitude,lng:v.longitude,observedLat:v.latitude,observedLng:v.longitude,observedAt:v.updatedAt,ageSeconds:age===null?null:Math.max(0,age),estimated:false,routeMatched:false,frozen:true,stale,reason:this.problem||(stale?'stale-position':'measured-gps')};
  }
 }
 function distanceToPaths(v,paths){let best=Infinity;const scale=111195,cos=Math.cos(v.latitude*Math.PI/180);for(const shape of paths||[]){const p=shape.points||shape;for(let i=1;i<p.length;i++){const a=p[i-1],b=p[i];if(!Array.isArray(a)||!Array.isArray(b))continue;const ax=(a[1]-v.longitude)*scale*cos,ay=(a[0]-v.latitude)*scale,bx=(b[1]-v.longitude)*scale*cos,by=(b[0]-v.latitude)*scale,dx=bx-ax,dy=by-ay,len=dx*dx+dy*dy;if(!Number.isFinite(len)||len>1e6)continue;const t=len?Math.max(0,Math.min(1,-(ax*dx+ay*dy)/len)):0;best=Math.min(best,Math.hypot(ax+t*dx,ay+t*dy));}}return Number.isFinite(best)?best:null;}
 return Object.freeze({Tracker,distance,distanceToPaths});
});
