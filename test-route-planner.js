'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const {RoutePlanner}=require('./route-planner');
const now=Date.parse('2026-11-13T19:40:00Z');
(async()=>{
 const empty=new RoutePlanner({transit:()=>({planningSnapshot:()=>({data:null,now,delays:new Map()})}),weather:()=>null,now:()=>now});
 const a={lat:52.1335,lon:-106.6313,name:'U of S'},b={lat:52.1520,lon:-106.7360,name:'Confederation Mall'};
 for(const mode of ['walk','bike','scooter','drive']){const r=empty.plan({from:a,to:b,mode});assert.equal(r.status,'ok',mode);const o=r.options[0];assert.ok(o.legs[0].path.length>10,mode+' path');assert.ok(o.legs[0].distance>7000&&o.legs[0].distance<16000,mode+' distance '+o.legs[0].distance);assert.ok(o.legs[0].steps.length>2,mode+' steps');assert.ok(o.arrive>o.depart);}
 const walk=empty.plan({from:a,to:b,mode:'walk'}).options[0],bike=empty.plan({from:a,to:b,mode:'bike'}).options[0];assert.ok(walk.duration>bike.duration,'walking slower than cycling');
 const t=empty.plan({from:a,to:b,mode:'transit'});assert.ok(t.status==='ok'||t.status==='error');assert.match(t.message||'',/loading|walking/i);
 assert.throws(()=>empty.plan({from:{lat:50,lon:-100},to:b,mode:'walk'}),/Saskatoon/);
 assert.throws(()=>empty.plan({from:a,to:b,mode:'walk',when:'arrive'}),/time/);assert.throws(()=>empty.plan(null));
 const winter=new RoutePlanner({transit:()=>({planningSnapshot:()=>({data:null,now,delays:new Map()})}),weather:()=>({status:'current',data:{condition:'Snow',temperature:-12,windChill:-20}}),now:()=>now});
 const w=winter.plan({from:a,to:b,mode:'walk'});assert.ok(w.options[0].duration>walk.duration,'snow slows walking');assert.ok(w.note);
 let transitChecked=false;
 if(fs.existsSync(process.env.YXE_GTFS||'/tmp/yxe_gtfs.zip')){
  const {_test}=require('./transit-provider');const data=await _test.parseStatic(await _test.readZip(fs.readFileSync(process.env.YXE_GTFS||'/tmp/yxe_gtfs.zip')));
  const live=new RoutePlanner({transit:()=>({planningSnapshot:()=>({data,now,delays:new Map()})}),weather:()=>null,now:()=>now});
  const r=live.plan({from:a,to:b,mode:'transit',when:'now'});assert.equal(r.status,'ok');assert.ok(r.options.some(o=>o.legs.some(l=>l.type==='bus')),'has a bus option');
  for(const o of r.options){assert.ok(o.depart>=now-60000);let prev=o.depart;for(const l of o.legs){assert.ok(l.depart>=prev-1000,'legs ordered');assert.ok(l.arrive>=l.depart);prev=l.arrive;}}
  const arrive=Date.parse('2026-11-14T00:30:00Z'),ra=live.plan({from:a,to:b,mode:'transit',when:'arrive',time:arrive});assert.equal(ra.status,'ok');assert.ok(ra.options.every(o=>o.arrive<=arrive+60000),'arrive-by respected');
  transitChecked=true;
 }
 console.log('PASS route planner: walk/bike/scooter/drive paths and directions, winter slowdown, area and mode validation'+(transitChecked?', bus+walk options in time order and arrive-by.':'. (Bus check skipped: no GTFS file.)'));
})().catch(e=>{console.error(e);process.exit(1);});
