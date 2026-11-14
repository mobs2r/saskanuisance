'use strict';
const fs=require('node:fs'),zlib=require('node:zlib'),path=require('node:path');
const EARTH=6371008.8,RAD=Math.PI/180;
const WALK=1,BIKE=2,CAR=4,ONEWAY_F=8,ONEWAY_B=16,BIKE_ONEWAY=32,BIKE_WAY=64,STEPS=256;
const DAY=86400,MAX_ROUNDS=5,TRANSFER_SLACK=60,BOARD_SLACK=30;
function meters(a,b,c,d){const p1=a*RAD,p2=c*RAD,dp=p2-p1,dl=(d-b)*RAD;const x=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;return 2*EARTH*Math.asin(Math.min(1,Math.sqrt(x)));}
function bearing(a,b,c,d){const y=Math.sin((d-b)*RAD)*Math.cos(c*RAD),x=Math.cos(a*RAD)*Math.sin(c*RAD)-Math.sin(a*RAD)*Math.cos(c*RAD)*Math.cos((d-b)*RAD);return(Math.atan2(y,x)/RAD+360)%360;}
class Heap{constructor(){this.k=[];this.v=[];}get size(){return this.k.length;}push(key,val){const k=this.k,v=this.v;let i=k.length;k.push(key);v.push(val);while(i>0){const p=(i-1)>>1;if(k[p]<=key)break;k[i]=k[p];v[i]=v[p];i=p;}k[i]=key;v[i]=val;}pop(){const k=this.k,v=this.v,top=v[0],topKey=k[0],lk=k.pop(),lv=v.pop();if(k.length){let i=0;const n=k.length;for(;;){let c=2*i+1;if(c>=n)break;if(c+1<n&&k[c+1]<k[c])c++;if(k[c]>=lk)break;k[i]=k[c];v[i]=v[c];i=c;}k[i]=lk;v[i]=lv;}this.lastKey=topKey;return top;}}
const MODES=Object.freeze({
 walk:{bit:WALK,speed:1.25},
 bike:{bit:BIKE,speed:4.6},
 scooter:{bit:BIKE,speed:4.2},
 drive:{bit:CAR,speed:13.9}
});
const BUSY=new Set(['primary','secondary','trunk','primary_link','secondary_link','trunk_link']);
class StreetGraph{
 constructor(raw){
  const n=raw.nodes.length/2;this.n=n;this.lat=new Float64Array(n);this.lon=new Float64Array(n);
  for(let i=0;i<n;i++){this.lat[i]=raw.nodes[2*i]/1e5;this.lon[i]=raw.nodes[2*i+1]/1e5;}
  this.nodeFlags=Uint16Array.from(raw.nodeFlags);this.hw=raw.hw;this.names=raw.names;
  const m=raw.edges.length/7;this.m=m;this.ea=new Int32Array(m);this.eb=new Int32Array(m);this.len=new Float64Array(m);this.flags=new Uint16Array(m);this.kind=new Uint8Array(m);this.speed=new Uint8Array(m);this.name=new Int32Array(m);this.geom=raw.geom;
  const deg=new Int32Array(n+1);
  for(let e=0;e<m;e++){const o=e*7;this.ea[e]=raw.edges[o];this.eb[e]=raw.edges[o+1];this.len[e]=raw.edges[o+2]/10;this.flags[e]=raw.edges[o+3];this.kind[e]=raw.edges[o+4];this.speed[e]=Math.max(5,Math.min(110,raw.edges[o+5]));this.name[e]=raw.edges[o+6];deg[this.ea[e]+1]++;deg[this.eb[e]+1]++;}
  for(let i=0;i<n;i++)deg[i+1]+=deg[i];
  this.adjStart=deg;this.adj=new Int32Array(2*m);const fill=deg.slice(0,n);
  for(let e=0;e<m;e++){this.adj[fill[this.ea[e]]++]=e;this.adj[fill[this.eb[e]]++]=e;}
  this.cell=0.002;this.grid=new Map();
  for(let i=0;i<n;i++){const key=Math.floor(this.lat[i]/this.cell)+':'+Math.floor(this.lon[i]/this.cell);let list=this.grid.get(key);if(!list)this.grid.set(key,list=[]);list.push(i);}
 }
 static load(file){return new StreetGraph(JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8')));}
 nearest(lat,lon,bit,maxMeters=500){
  const cy=Math.floor(lat/this.cell),cx=Math.floor(lon/this.cell);let best=-1,bestD=Infinity;
  for(let r=0;r<=4;r++){for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){if(Math.max(Math.abs(dy),Math.abs(dx))!==r)continue;const list=this.grid.get((cy+dy)+':'+(cx+dx));if(!list)continue;for(const i of list){if(!(this.nodeFlags[i]&bit))continue;const d=meters(lat,lon,this.lat[i],this.lon[i]);if(d<bestD){bestD=d;best=i;}}}
   if(best>=0&&bestD<r*this.cell*111000*0.6)break;}
  return best>=0&&bestD<=maxMeters?{node:best,meters:bestD}:null;
 }
 edgeCost(e,from,mode,opts){
  const f=this.flags[e],k=this.hw[this.kind[e]],forward=this.ea[e]===from,L=this.len[e];
  if(mode==='walk'){if(!(f&WALK))return Infinity;let s=L/opts.walkSpeed;if(f&STEPS)s*=1.6;if(BUSY.has(k))s*=1.05;return s;}
  if(mode==='bike'||mode==='scooter'){if(!(f&BIKE))return Infinity;if(f&BIKE_ONEWAY){if(f&ONEWAY_F&&!forward)return Infinity;if(f&ONEWAY_B&&forward)return Infinity;}let s=L/MODES[mode].speed;if(f&BIKE_WAY)s*=0.85;else if(BUSY.has(k))s*=1.45;if(k==='track'||k==='bridleway')s*=mode==='scooter'?2:1.3;if(f&STEPS)s*=4;return s*(opts.winter?1.15:1);}
  if(mode==='drive'){if(!(f&CAR))return Infinity;if(f&ONEWAY_F&&!forward)return Infinity;if(f&ONEWAY_B&&forward)return Infinity;let v=this.speed[e]/3.6*0.9;if(k==='service')v=Math.min(v,4);if(opts.winter)v*=0.85;return L/v+0.6;}
  return Infinity;
 }
 maxSpeed(mode,opts){return mode==='walk'?opts.walkSpeed:mode==='drive'?110/3.6:MODES[mode].speed;}
 search(sources,mode,opts,{limit=Infinity,target=-1}={}){
  const dist=new Map(),prev=new Map(),heap=new Heap(),tLat=target>=0?this.lat[target]:0,tLon=target>=0?this.lon[target]:0,vmax=this.maxSpeed(mode,opts);
  const h=i=>target>=0?meters(this.lat[i],this.lon[i],tLat,tLon)/vmax:0;
  for(const[node,cost]of sources){if(cost<(dist.get(node)??Infinity)){dist.set(node,cost);heap.push(cost+h(node),node);}}
  const done=new Set();
  while(heap.size){const u=heap.pop();if(done.has(u))continue;done.add(u);const du=dist.get(u);if(u===target)break;if(du>limit)continue;
   for(let j=this.adjStart[u];j<this.adjStart[u+1];j++){const e=this.adj[j],v=this.ea[e]===u?this.eb[e]:this.ea[e];const c=this.edgeCost(e,u,mode,opts);if(c===Infinity)continue;const nd=du+c;if(nd<(dist.get(v)??Infinity)&&nd<=limit){dist.set(v,nd);prev.set(v,e);heap.push(nd+h(v),v);}}}
  return {dist,prev,done};
 }
 edgePoints(e,from){
  const pts=[[this.lat[this.ea[e]],this.lon[this.ea[e]]]];let la=Math.round(this.lat[this.ea[e]]*1e5),lo=Math.round(this.lon[this.ea[e]]*1e5);const g=this.geom[e]||[];
  for(let i=0;i<g.length;i+=2){la+=g[i];lo+=g[i+1];pts.push([la/1e5,lo/1e5]);}
  pts.push([this.lat[this.eb[e]],this.lon[this.eb[e]]]);return this.ea[e]===from?pts:pts.reverse();
 }
 trace(prev,target){const edges=[];let v=target;let guard=0;while(prev.has(v)&&guard++<200000){const e=prev.get(v);const u=this.ea[e]===v?this.eb[e]:this.ea[e];edges.push([e,u]);v=u;}return edges.reverse();}
 label(e){const n=this.names[this.name[e]];if(n)return n;const k=this.hw[this.kind[e]];return({footway:'footpath',path:'path',cycleway:'bike path',steps:'stairs',pedestrian:'plaza',service:'lane',track:'track',corridor:'walkway',living_street:'street',residential:'street',unclassified:'road'})[k]||'road';}
 describe(edgeSeq,mode){
  const points=[],steps=[];let group=null,distance=0;
  const verb=mode==='drive'?'Drive':mode==='walk'?'Walk':'Ride';
  for(const[e,from]of edgeSeq){const pts=this.edgePoints(e,from);if(points.length)pts.shift();points.push(...pts);const name=this.label(e),L=this.len[e];distance+=L;
   const startB=bearing(...pts.length>1?[...pts[0],...pts[1]]:[0,0,0,0]);
   if(group&&group.name===name){group.distance+=L;group.endBearing=bearing(...this.lastTwo(points));continue;}
   let text;
   if(!group)text=verb+' along '+name;
   else{let d=((startB-group.endBearing)+540)%360-180;const a=Math.abs(d),side=d<0?'left':'right';text=a<25?'Continue onto '+name:a<60?'Bear '+side+' onto '+name:a<150?'Turn '+side+' onto '+name:'Sharp '+side+' onto '+name;}
   group={name,distance:L,text,endBearing:bearing(...this.lastTwo(points))};steps.push(group);}
  const merged=[];for(let i=0;i<steps.length;i++){const s=steps[i],last=merged[merged.length-1];if(last&&(s.distance<20&&i<steps.length-1||/^Continue/.test(s.text)&&s.name===last.name)){last.distance+=s.distance;continue;}merged.push(s);}
  return {points,distance,steps:merged.map(s=>({text:s.text,distance:Math.round(s.distance)}))};
 }
 lastTwo(points){const a=points[points.length-2]||points[0],b=points[points.length-1];return[a[0],a[1],b[0],b[1]];}
}
class TransitIndex{
 constructor(data,graph){
  this.data=data;this.graph=graph;this.stopIds=[...data.stops.keys()];this.stopIndex=new Map(this.stopIds.map((id,i)=>[id,i]));
  const n=this.stopIds.length;this.stopNode=new Int32Array(n).fill(-1);this.stopSnap=new Float64Array(n);this.nodeStops=new Map();
  for(let i=0;i<n;i++){const s=data.stops.get(this.stopIds[i]);const hit=graph.nearest(s.latitude,s.longitude,WALK,300);if(!hit)continue;this.stopNode[i]=hit.node;this.stopSnap[i]=hit.meters;let l=this.nodeStops.get(hit.node);if(!l)this.nodeStops.set(hit.node,l=[]);l.push(i);}
  const patterns=new Map();
  for(const[tripId,times]of data.tripStops){if(times.length<2)continue;const trip=data.trips.get(tripId);if(!trip)continue;const key=trip.routeId+'|'+times.map(t=>t.stopId).join('>');let p=patterns.get(key);if(!p)patterns.set(key,p={id:patterns.size,routeId:trip.routeId,stops:times.map(t=>this.stopIndex.get(t.stopId)),trips:[]});p.trips.push({trip,seq:times.map(t=>t.sequence),dep:Int32Array.from(times,t=>t.departure),arr:Int32Array.from(times,t=>t.arrival),pickup:times.map(t=>t.pickup!==false)});}
  this.patterns=[...patterns.values()];for(const p of this.patterns)p.trips.sort((a,b)=>a.dep[0]-b.dep[0]);
  this.stopPatterns=Array.from({length:n},()=>[]);for(const p of this.patterns)p.stops.forEach((s,i)=>this.stopPatterns[s].push([p,i]));
  this.transfers=new Map();
 }
 transfersFrom(i,opts){let t=this.transfers.get(i);if(t)return t;t=[];const node=this.stopNode[i];if(node>=0){const res=this.graph.search([[node,0]],'walk',{walkSpeed:1},{limit:450});for(const[v,d]of res.dist){const list=this.nodeStops.get(v);if(list)for(const j of list)if(j!==i)t.push([j,d+this.stopSnap[i]+this.stopSnap[j]]);}}this.transfers.set(i,t);return t;}
}
function delayFor(info,seq){if(!info||info.cancelled)return 0;let d=null;for(const[s,v]of info.points){if(s<=seq)d=v;else break;}return d??0;}
class RoutePlanner{
 constructor({graphFile=path.join(__dirname,'data','route-graph.json.gz'),transit=()=>null,weather=()=>null,helpers=null,now=()=>Date.now()}={}){this.graphFile=graphFile;this.transit=transit;this.weather=weather;this.now=now;this.helpers=helpers||require('./transit-provider')._test;this.graph=null;this.index=null;this.indexData=null;}
 ensureGraph(){if(!this.graph)this.graph=StreetGraph.load(this.graphFile);return this.graph;}
 conditions(){const w=this.weather();const d=w?.data||{};const cond=String(d.condition||''),t=Number.isFinite(d.temperature)?d.temperature:null,chill=Number.isFinite(d.windChill)?d.windChill:t;
  let walkSpeed=1.25,note='',winter=false;
  if(/snow|blizzard|freezing|ice pellets|flurr/i.test(cond)){walkSpeed=1.05;winter=true;note='Snowy sidewalks: walking times padded.';}
  else if(chill!==null&&chill<=-25){walkSpeed=1.15;winter=true;note='Extreme cold: shorter walks preferred.';}
  else if(/rain|drizzle|shower|thunder/i.test(cond)){walkSpeed=1.18;note='Wet out: walking times padded.';}
  return {walkSpeed,winter,note,coldWalkCap:chill!==null&&chill<=-30?700:null};}
 snap(point,bit){const g=this.ensureGraph();return g.nearest(point.lat,point.lon,bit,800);}
 streetTrip(req,mode,opts){
  const g=this.ensureGraph(),bit=MODES[mode].bit,a=this.snap(req.from,bit),b=this.snap(req.to,bit);
  if(!a||!b)return null;
  const speed=mode==='walk'?opts.walkSpeed:MODES[mode].speed;
  const res=g.search([[a.node,a.meters/Math.max(1,opts.walkSpeed)]],mode,opts,{target:b.node});
  if(!res.dist.has(b.node))return null;
  const seq=g.trace(res.prev,b.node),info=g.describe(seq,mode),secs=res.dist.get(b.node)+b.meters/Math.max(1,opts.walkSpeed);
  const pts=[[req.from.lat,req.from.lon],...info.points,[req.to.lat,req.to.lon]];
  return {secs,leg:{type:mode,distance:Math.round(info.distance+a.meters+b.meters),path:pts,steps:info.steps}};
 }
 plan(req){
  const r=validate(req),opts=this.conditions(),now=this.now();
  if(r.mode!=='transit'){
   const t=this.streetTrip(r,r.mode,opts);if(!t)return {status:'none',message:'No '+({walk:'walking',bike:'cycling',scooter:'scooter',drive:'driving'})[r.mode]+' route found between those points.',options:[],note:opts.note};
   const start=r.when==='arrive'?r.time-t.secs*1000:(r.time??now);
   const leg={...t.leg,depart:start,arrive:start+t.secs*1000,from:{name:r.from.name||'Start',lat:r.from.lat,lon:r.from.lon},to:{name:r.to.name||'Destination',lat:r.to.lat,lon:r.to.lon}};
   return {status:'ok',options:[{mode:r.mode,depart:leg.depart,arrive:leg.arrive,duration:Math.round(t.secs),walkMeters:r.mode==='walk'?leg.distance:0,transfers:0,legs:[leg]}],note:opts.note};
  }
  return this.transitPlan(r,opts,now);
 }
 transitIndex(){const snap=this.transit()?.planningSnapshot?.();if(!snap?.data)return {snap:null,index:null};if(this.indexData!==snap.data){this.index=new TransitIndex(snap.data,this.ensureGraph());this.indexData=snap.data;}return {snap,index:this.index};}
 transitPlan(r,opts,now){
  const g=this.ensureGraph();const{snap,index}=this.transitIndex();
  const walkOnly=this.streetTrip(r,'walk',opts);
  const walkOption=walkOnly?(()=>{const start=r.when==='arrive'?r.time-walkOnly.secs*1000:(r.time??now);const leg={...walkOnly.leg,type:'walk',depart:start,arrive:start+walkOnly.secs*1000,from:{name:r.from.name||'Start',lat:r.from.lat,lon:r.from.lon},to:{name:r.to.name||'Destination',lat:r.to.lat,lon:r.to.lon}};return {mode:'walk',depart:leg.depart,arrive:leg.arrive,duration:Math.round(walkOnly.secs),walkMeters:leg.distance,transfers:0,legs:[leg]};})():null;
  if(!index){return {status:walkOption?'ok':'none',message:'Bus schedules are still loading. Showing walking only.',options:walkOption?[walkOption]:[],note:opts.note};}
  const maxWalk=Math.min(r.maxWalk,opts.coldWalkCap??Infinity);
  const a=this.snap(r.from,WALK),b=this.snap(r.to,WALK);if(!a||!b)return {status:'none',message:'Pick points closer to a street or path.',options:[],note:opts.note};
  const reach=(hit)=>{const res=g.search([[hit.node,hit.meters]],'walk',{walkSpeed:1},{limit:maxWalk});const out=new Map();for(const[v,d]of res.dist){const list=index.nodeStops.get(v);if(list)for(const s of list){const m=d+index.stopSnap[s];if(m<=maxWalk+60&&m<(out.get(s)??Infinity))out.set(s,m);}}return out;};
  const access=reach(a),egress=reach(b);
  if(!access.size||!egress.size){return {status:walkOption?'ok':'none',message:'No bus stop within your walking limit.',options:walkOption?[walkOption]:[],note:opts.note};}
  const base=r.time??now,H=this.helpers,D0=H.serviceDate(base),mid=H.serviceMidnight(D0);
  const ctx={index,snap,mid,D0,H,cache:new Map(),opts};
  const runAt=t0=>this.raptor(ctx,Math.round((t0-mid)/1000),access,egress);
  let journeys=[];const seen=new Set();
  const addAll=list=>{for(const j of list){const sig=j.legs.map(l=>l.kind==='ride'?l.inst.trip.trip.id+'@'+l.board:'w').join('|');if(seen.has(sig))continue;seen.add(sig);journeys.push(j);}};
  if(r.when==='arrive'){
   const deadline=Math.round((r.time-mid)/1000);let t0=deadline-150*60;
   for(let i=0;i<12&&t0<deadline;i++){const list=runAt(mid+t0*1000);if(!list.length)break;addAll(list.filter(j=>j.arrive<=deadline));const firstBoard=Math.min(...list.map(j=>j.firstBoard));t0=Math.max(t0+60,firstBoard-(list[0].accessSecs||0)+60);}
   journeys=journeys.filter(j=>j.arrive<=deadline).sort((x,y)=>y.departSecs-x.departSecs||x.transfers-y.transfers);
  } else {
   let t0=Math.round((base-mid)/1000);
   for(let i=0;i<4;i++){const list=runAt(mid+t0*1000);if(!list.length)break;addAll(list);const firstBoard=Math.min(...list.map(j=>j.firstBoard));t0=firstBoard-Math.max(...list.map(j=>j.accessSecs))+61;if(t0<=Math.round((base-mid)/1000))t0=Math.round((base-mid)/1000)+300*(i+1);}
   journeys.sort((x,y)=>x.arrive-y.arrive||x.transfers-y.transfers);
  }
  const dominates=(p,j)=>p!==j&&p.arrive<=j.arrive&&p.departSecs>=j.departSecs&&p.transfers<=j.transfers&&p.walk<=j.walk+50&&(p.arrive<j.arrive||p.departSecs>j.departSecs||p.transfers<j.transfers||p.walk<j.walk);
  const pareto=journeys.filter(j=>!journeys.some(p=>dominates(p,j)));
  const bestArrive=Math.min(...pareto.map(j=>j.arrive));
  const options=pareto.filter(j=>r.when==='arrive'||j.arrive<=bestArrive+25*60).slice(0,4).map(j=>this.materialize(ctx,j,r,opts));
  if(walkOption&&(walkOption.duration<=25*60||!options.length))options.push(walkOption);
  options.sort((x,y)=>r.when==='arrive'?y.depart-x.depart:x.arrive-y.arrive);
  return {status:options.length?'ok':'none',message:options.length?'':'No bus trip found for that time. Try a later time or a longer walk.',options,note:opts.note,live:snap.delays.size>0};
 }
 instances(ctx,p){
  let list=ctx.cache.get(p.id);if(list)return list;list=[];
  for(const off of[-1,0,1]){const date=ctx.H.serviceDate(ctx.mid+off*DAY*1000+12*3600000);for(const t of p.trips){if(!ctx.H.serviceActive(ctx.index.data,t.trip.serviceId,date))continue;const info=ctx.snap.delays.get(t.trip.id);if(info?.cancelled&&off===0)continue;const live=info&&off===0&&(!info.startDate||info.startDate===date);const shift=off*DAY;const dep=new Int32Array(t.dep.length),arr=new Int32Array(t.arr.length);let delayed=false;for(let i=0;i<dep.length;i++){const d=live?delayFor(info,t.seq[i]):0;if(d)delayed=true;dep[i]=t.dep[i]+shift+d;arr[i]=t.arr[i]+shift+d;}list.push({trip:t,date,dep,arr,live:!!live,delayed});}}
  list.sort((x,y)=>x.dep[0]-y.dep[0]);ctx.cache.set(p.id,list);return list;
 }
 raptor(ctx,t0,access,egress){
  const ix=ctx.index,n=ix.stopIds.length,speed=ctx.opts.walkSpeed;
  const tau=[],par=[],best=new Float64Array(n).fill(Infinity);let marked=new Set();
  const t0r=new Float64Array(n).fill(Infinity),p0=new Array(n);
  for(const[s,m]of access){const t=t0+m/speed;if(t<t0r[s]){t0r[s]=t;p0[s]={kind:'access',meters:m};best[s]=t;marked.add(s);}}
  tau.push(t0r);par.push(p0);
  const results=[];
  for(let k=1;k<=MAX_ROUNDS&&marked.size;k++){
   const prevTau=tau[k-1],cur=new Float64Array(n).fill(Infinity),cp=new Array(n);tau.push(cur);par.push(cp);
   const queue=new Map();
   for(const s of marked)for(const[p,i]of ix.stopPatterns[s]){const q=queue.get(p);if(q===undefined||i<q)queue.set(p,i);}
   const improved=new Set();
   for(const[p,start]of queue){
    const inst=this.instances(ctx,p);if(!inst.length)continue;let trip=null,boardPos=-1;
    for(let i=start;i<p.stops.length;i++){const s=p.stops[i];
     if(trip){const a=trip.arr[i];if(a<best[s]&&a<cur[s]){cur[s]=a;best[s]=a;cp[s]={kind:'ride',p,inst:trip,board:boardPos,alight:i};improved.add(s);}}
     const ready=prevTau[s]+(k>1?BOARD_SLACK:0);
     if(ready<Infinity&&(!trip||ready<=trip.dep[i])){
      let lo=0,hi=inst.length;while(lo<hi){const mid=(lo+hi)>>1;if(inst[mid].dep[i]<ready)lo=mid+1;else hi=mid;}
      let cand=null;for(let j=Math.max(0,lo-3);j<Math.min(inst.length,lo+4);j++){const x=inst[j];if(x.dep[i]>=ready&&x.trip.pickup[i]&&(!cand||x.arr[Math.min(i+1,x.arr.length-1)]<cand.arr[Math.min(i+1,cand.arr.length-1)]))cand=x;}
      if(cand&&(!trip||cand.dep[i]<trip.dep[i]||cand!==trip&&cand.arr[Math.min(i+1,cand.arr.length-1)]<trip.arr[Math.min(i+1,trip.arr.length-1)])&&cand.dep[i]-ready<4*3600){trip=cand;boardPos=i;}
     }
    }
   }
   const next=new Set(improved);
   for(const s of improved){for(const[j,m]of ix.transfersFrom(s)){const t=cur[s]+m/speed+TRANSFER_SLACK;if(t<best[j]&&t<cur[j]){cur[j]=t;best[j]=t;cp[j]={kind:'walk',from:s,meters:m};next.add(j);}}}
   marked=next;
   let bestTarget=Infinity,bestStop=-1;for(const[s,m]of egress){if(cur[s]===Infinity)continue;const t=cur[s]+m/speed;if(t<bestTarget){bestTarget=t;bestStop=s;}}
   if(bestStop>=0){const j=this.reconstruct(tau,par,k,bestStop,egress.get(bestStop),bestTarget,speed);if(j&&!results.some(x=>x.arrive<=j.arrive))results.push(j);}
  }
  return results;
 }
 reconstruct(tau,par,k,stop,egressM,arrive,speed){
  const legs=[];let s=stop,round=k,guard=0;
  while(guard++<50){const p=par[round][s];if(!p)return null;
   if(p.kind==='access'){legs.unshift({kind:'access',stop:s,meters:p.meters});break;}
   if(p.kind==='walk'){legs.unshift({kind:'transfer',from:p.from,to:s,meters:p.meters});s=p.from;continue;}
   legs.unshift({kind:'ride',p:p.p,inst:p.inst,board:p.board,alight:p.alight});s=p.p.stops[p.board];round--;}
  const rides=legs.filter(l=>l.kind==='ride');if(!rides.length)return null;
  const first=rides[0],accessM=legs[0].kind==='access'?legs[0].meters:0;
  const walk=accessM+egressM+legs.filter(l=>l.kind==='transfer').reduce((a,l)=>a+l.meters,0);
  return {legs,egressStop:stop,egressM,arrive:Math.round(arrive),firstBoard:first.inst.dep[first.board],accessSecs:accessM/speed,departSecs:first.inst.dep[first.board]-accessM/speed,transfers:rides.length-1,walk};
 }
 materialize(ctx,j,r,opts){
  const ix=ctx.index,data=ix.data,g=this.graph,mid=ctx.mid,abs=s=>mid+Math.round(s*1000);
  const stopPt=i=>{const s=data.stops.get(ix.stopIds[i]);return {name:s.name,code:s.code||'',lat:s.latitude,lon:s.longitude,id:s.id};};
  const walkLeg=(from,to,start,label)=>{const t=this.streetTrip({from,to},'walk',opts);const secs=t?t.secs:meters(from.lat,from.lon,to.lat,to.lon)*1.3/opts.walkSpeed;return {type:'walk',from,to,depart:abs(start),arrive:abs(start+secs),distance:t?t.leg.distance:Math.round(meters(from.lat,from.lon,to.lat,to.lon)*1.3),path:t?t.leg.path:[[from.lat,from.lon],[to.lat,to.lon]],steps:t?t.leg.steps:[{text:'Walk to '+to.name,distance:0}],secs};};
  const legs=[];const origin={name:r.from.name||'Start',lat:r.from.lat,lon:r.from.lon},dest={name:r.to.name||'Destination',lat:r.to.lat,lon:r.to.lon};
  const rides=j.legs.filter(l=>l.kind==='ride');
  const firstStop=stopPt(rides[0].p.stops[rides[0].board]);
  const accessSecs=(j.legs[0].meters||0)/opts.walkSpeed;
  legs.push(walkLeg(origin,firstStop,rides[0].inst.dep[rides[0].board]-accessSecs,'access'));
  let lastArrive=null;
  for(const l of j.legs){
   if(l.kind==='ride'){const p=l.p,inst=l.inst,trip=inst.trip.trip,route=data.routes.get(trip.routeId)||{};const stops=p.stops.slice(l.board,l.alight+1).map(stopPt);
    let pathPts=stops.map(s=>[s.lat,s.lon]);const shape=trip.shapeId?data.shapes.get(trip.shapeId):null;
    if(shape&&shape.length>1){const near=(pt,from)=>{let bi=from,bd=Infinity;for(let i=from;i<shape.length;i++){const d=(shape[i][0]-pt.lat)**2+(shape[i][1]-pt.lon)**2;if(d<bd){bd=d;bi=i;}}return bi;};const s0=near(stops[0],0),s1=near(stops[stops.length-1],s0);if(s1>s0)pathPts=shape.slice(s0,s1+1).map(x=>[x[0],x[1]]);}
    const sched=inst.trip.dep[l.board]+Math.round((inst.dep[0]-inst.trip.dep[0])/DAY)*DAY;
    legs.push({type:'bus',from:stops[0],to:stops[stops.length-1],depart:abs(inst.dep[l.board]),arrive:abs(inst.arr[l.alight]),scheduledDepart:abs(sched),live:inst.live,delayMin:inst.live?Math.round((inst.dep[l.board]-sched)/60):null,route:{id:route.id,shortName:route.shortName||'',longName:route.longName||'',color:route.color||null,textColor:route.textColor||null},headsign:trip.headsign||'',stops:stops.length-1,stopNames:stops.map(s=>s.name),path:pathPts});
    lastArrive=inst.arr[l.alight];}
   else if(l.kind==='transfer'){legs.push(walkLeg(stopPt(l.from),stopPt(l.to),lastArrive,'transfer'));}
  }
  const egressFrom=stopPt(j.egressStop);
  legs.push(walkLeg(egressFrom,dest,lastArrive,'egress'));
  const out=legs.filter(l=>!(l.type==='walk'&&l.distance<15)).map(l=>{const{secs,...rest}=l;return rest;});
  const depart=out[0].depart,arrive=out[out.length-1].arrive;
  return {mode:'transit',depart,arrive,duration:Math.round((arrive-depart)/1000),walkMeters:Math.round(out.filter(l=>l.type==='walk').reduce((a,l)=>a+l.distance,0)),transfers:j.transfers,legs:out};
 }
}
function point(p,label){if(!p||!Number.isFinite(p.lat)||!Number.isFinite(p.lon)||Math.abs(p.lat-52.13)>0.6||Math.abs(p.lon+106.67)>0.9)throw new Error(label+' must be in the Saskatoon area.');return {lat:p.lat,lon:p.lon,name:typeof p.name==='string'?p.name.slice(0,120):''};}
function validate(req){
 if(!req||typeof req!=='object')throw new Error('Invalid trip request.');
 const mode=['transit','walk','bike','scooter','drive'].includes(req.mode)?req.mode:'transit';
 const when=['now','depart','arrive'].includes(req.when)?req.when:'now';
 const time=when==='now'?null:Number.isFinite(req.time)?req.time:null;
 if(when!=='now'&&time===null)throw new Error('Pick a time.');
 const maxWalk=Number.isFinite(req.maxWalk)?Math.max(150,Math.min(2500,req.maxWalk)):900;
 return {from:point(req.from,'Start'),to:point(req.to,'Destination'),mode,when:when==='now'?'depart':when,time,maxWalk};
}
module.exports={RoutePlanner,StreetGraph,TransitIndex,validate,meters};
