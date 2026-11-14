'use strict';
const assert=require('node:assert/strict');
const {ViaLive,Scooters}=require('./live-feeds');
const reply=body=>async()=>({ok:true,status:200,text:async()=>JSON.stringify(body)});
(async()=>{
 const via=new ViaLive({fetcher:reply({
  '1 (11-11)':{lat:52.2,lng:-107.1,speed:88,direction:300,poll:'2026-11-13T20:00:00Z',departed:true,arrived:false,from:'TORONTO',to:'VANCOUVER',times:[{station:'Saskatoon',code:'SASK',eta:'25m',estimated:'2026-11-13T14:30:00-06:00',scheduled:'2026-11-13T14:10:00-06:00',diffMin:20}]},
  '2 (11-08)':{lat:43.6,lng:-79.4,arrived:true,times:[]},
  '1 (11-04)':{lat:49.2,lng:-123.1,arrived:false,times:[{station:'Vancouver',code:'VCVR',eta:'ARR'}]},
  '15 (11-13)':{lat:45,lng:-63}
 })});
 const v=await via.get();
 assert.equal(v.status,'live');assert.equal(v.items.length,1);
 assert.equal(v.items[0].train,'1');assert.equal(v.items[0].next.late,20);assert.equal(v.items[0].saskatoon.late,20);assert.equal(v.items[0].saskatoon.done,false);
 const bad=await new ViaLive({fetcher:async()=>({ok:false,status:503,text:async()=>''})}).get();
 assert.equal(bad.status,'unavailable');assert.deepEqual(bad.items,[]);
 const urls=[];const sc=new Scooters({fetcher:async url=>{urls.push(url);return{ok:true,status:200,text:async()=>JSON.stringify(url.includes('vehicle_types')?{data:{vehicle_types:[{vehicle_type_id:'s',form_factor:'scooter',max_range_meters:24000}]}}:{last_updated:1794600000,data:{bikes:[{bike_id:'a',lat:52.13,lon:-106.66,vehicle_type_id:'s',current_range_meters:12000,is_disabled:false,is_reserved:false},{bike_id:'b',lat:52.13,lon:-106.66,is_disabled:true}]}})};}});
 const s=await sc.get();
 assert.equal(s.items.length,1);assert.equal(s.items[0].kind,'scooter');assert.equal(s.items[0].range,12000);assert.equal(s.items[0].max,24000);
 assert.ok(urls.every(u=>u.startsWith('https://mds.bird.co/gbfs/v2/public/saskatoon/')));
 console.log('live feed tests passed');
})().catch(e=>{console.error(e);process.exit(1);});
