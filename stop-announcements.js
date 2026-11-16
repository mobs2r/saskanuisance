'use strict';
const {spawn}=require('node:child_process');
const {helperPath}=require('./runtime-paths');
function distance(a,b){const rad=Math.PI/180,x=(b.latitude-a.latitude)*rad,y=(b.longitude-a.longitude)*rad,s=Math.sin(x/2)**2+Math.cos(a.latitude*rad)*Math.cos(b.latitude*rad)*Math.sin(y/2)**2;return 6371000*2*Math.atan2(Math.sqrt(s),Math.sqrt(1-s));}
class ApproachGate{
 constructor(){this.seen=new Map();this.previous=new Map();}
 inspect(detail,now){
  const v=detail?.vehicle,atStop=detail?.positionStatus==='stopped-at',s=atStop?detail.currentStop:detail?.nextStop;
  const confirmed=atStop?detail.currentStopStatus==='confirmed':detail?.nextStopStatus==='confirmed';
  if(!Number.isFinite(now)||detail?.status!=='live'||v?.stale||!confirmed||!s?.id||!s.name||!v?.id||!v.tripId||!Number.isFinite(v.updatedAt)||now-v.updatedAt>60000||now-v.updatedAt< -5000)return null;
  if(!['incoming','in-transit-to','stopped-at'].includes(detail.positionStatus)||detail.serviceStatus?.status==='no-service-alert')return null;
  const sequence=atStop?detail.currentStopSequence:detail.nextStopSequence,key=[v.id,v.tripId,s.id,sequence].join('|');
  if(this.seen.has(key)&&now-this.seen.get(key)<6*60*60*1000)return null;
  const valid=[v.latitude,v.longitude,s.latitude,s.longitude].every(Number.isFinite),metres=valid?distance(v,s):null;

  const arriving=atStop||detail.positionStatus==='incoming'||(metres!==null&&metres<=150);
  if(!arriving)return null;
  this.seen.set(key,now);if(this.seen.size>512)this.seen.delete(this.seen.keys().next().value);
  return {key,text:'Arriving at '+String(s.name).replace(/[\x00-\x1f\x7f]/g,' ').slice(0,180)+'.',stop:s.id,vehicle:v.id};
 }
}
class WindowsAnnouncements{
 constructor({spawnProcess=spawn}={}){this.spawnProcess=spawnProcess;this.child=null;this.gate=new ApproachGate();this.ready=null;this.target=null;}
 stop(){this.target=null;if(this.child){this.child.kill();this.child=null;}}
 run(payload){return new Promise(resolve=>{
  let settled=false,output='';const finish=result=>{if(settled)return;settled=true;clearTimeout(timer);if(this.child===child)this.child=null;resolve(result);};let child;
  try{child=this.spawnProcess(helperPath('AnnouncementVoice.exe'),[],{windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});}catch{return resolve({available:false,error:'Windows voice unavailable'});}
  if(payload.mode==='speak')this.child=child;const timer=setTimeout(()=>{child.kill();finish({available:false,error:'Voice timed out'});},20000);
  child.stdout.on('data',x=>{output+=x.toString();if(output.length>8192){child.kill();finish({available:false,error:'Unexpected voice output'});}});child.stderr.on('data',()=>{});
  child.once('error',()=>finish({available:false,error:'Windows voice unavailable'}));child.once('close',code=>{try{const result=JSON.parse(output.trim());finish(code===0?result:{available:false,error:'Windows voice unavailable'});}catch{finish({available:false,error:'Windows voice unavailable'});}});
  child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(payload));
 });}
 async status(){if(!this.ready)this.ready=this.run({mode:'status'});return this.ready;}
 async approach(id,detail,now){
  if(this.target!==id){this.stop();this.target=id;}
  const event=this.gate.inspect(detail,now);if(!event)return {spoken:false};
  const ready=await this.status();if(this.target!==id)return {spoken:false};if(!ready.available)return {spoken:false,...ready};
  if(this.child)this.child.kill();const result=await this.run({mode:'speak',text:event.text});return {...result,spoken:Boolean(result.available),text:event.text};
 }
}
module.exports={ApproachGate,WindowsAnnouncements,distance};
