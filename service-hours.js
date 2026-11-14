'use strict';

const DAY=86400000, MAX_AGE=7*3600000;
const cache=new WeakMap();
function scheduleState(data,now,{ageMs,error=false,stopped=false}={}) {
 const unknown=reason=>({status:'unknown',allowed:false,reason,now,nextStart:null,validUntil:null,basis:'Official GTFS scheduled bus trips, not live operations'});
 if(!Number.isFinite(now))return unknown('Internet time unavailable');
 if(!data)return unknown('Schedule unavailable');
 if(error||stopped||!Number.isFinite(ageMs)||ageMs<0||ageMs>MAX_AGE)return unknown('Schedule needs revalidation');
 const date=new Date(now-6*3600000).toISOString().slice(0,10).replaceAll('-','');
 const c=data.coverage;
 if(!c?.startDate||!c?.endDate||date<c.startDate||date>c.endDate)return unknown('Schedule does not cover today');
 if(data.hasFrequencies)return unknown('Frequency-based schedule not supported');
 let entry=cache.get(data);
 if(!entry||entry.date!==date){
  const parse=d=>Date.UTC(+d.slice(0,4),+d.slice(4,6)-1,+d.slice(6,8));
  const today=parse(date),end=parse(c.endDate),intervals=[];
  const trips=[...data.trips.values()].filter(t=>{const type=data.routes.get(t.routeId)?.routeType;return type===3||(type>=700&&type<=799);});
  if(!trips.length)return unknown('No bus schedule identified');
  if(trips.some(t=>!Number.isFinite(t.firstSeconds)||!Number.isFinite(t.lastSeconds)||t.lastSeconds<t.firstSeconds))return unknown('Bus schedule is incomplete');

  const back=Math.ceil(Math.max(...trips.map(t=>t.lastSeconds))/86400);
  for(let day=today-back*DAY;day<=Math.min(end,today+366*DAY);day+=DAY){
   const key=new Date(day).toISOString().slice(0,10).replaceAll('-','');
   for(const t of trips){const ex=data.exceptions.get(t.serviceId)?.get(key),cal=data.calendar.get(t.serviceId);
    const active=ex?ex===1:Boolean(cal&&key>=cal.start&&key<=cal.end&&cal.days[new Date(day).getUTCDay()]);
    if(active)intervals.push([day+6*3600000+t.firstSeconds*1000,day+6*3600000+t.lastSeconds*1000]);
   }
  }
  intervals.sort((a,b)=>a[0]-b[0]);const merged=[];
  for(const i of intervals){const last=merged.at(-1);if(last&&i[0]<=last[1])last[1]=Math.max(last[1],i[1]);else merged.push(i.slice());}
  entry={date,intervals:merged};cache.set(data,entry);
 }
 const current=entry.intervals.find(i=>i[0]<=now&&now<i[1]);
 const next=entry.intervals.find(i=>i[0]>now);
 return {status:current?'scheduled':'off-hours',allowed:!!current,now,nextStart:next?.[0]??null,validUntil:Math.min(now+Math.max(0,MAX_AGE-ageMs),current?.[1]??next?.[0]??Infinity,new Date(now-6*3600000).setUTCHours(24,0,0,0)+6*3600000),reason:current?'Scheduled bus service':'Outside scheduled bus service',basis:'Official GTFS scheduled bus trips, not live operations'};
}
function sortNotices(items){

 const start=a=>{const times=(a.periods||[]).map(p=>p.start).filter(Number.isFinite);return times.length?Math.min(...times):null;};
 return items.map((item,index)=>({...item,effectiveStart:start(item),_order:index})).sort((a,b)=>a.effectiveStart===null?(b.effectiveStart===null?a._order-b._order:1):b.effectiveStart===null?-1:b.effectiveStart-a.effectiveStart||a._order-b._order).map(({_order,...item})=>item);
}
module.exports={scheduleState,sortNotices,MAX_AGE};
