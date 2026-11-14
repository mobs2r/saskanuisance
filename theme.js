
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else{root.SolarTheme=api;if(typeof document!=='undefined')api.mount(root,document);}})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';const LATITUDE=52.1332,LONGITUDE=-106.67,ZONE='America/Regina',RAD=Math.PI/180;
 const dateFormat=new Intl.DateTimeFormat('en-CA',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit'});
 function localDate(epochMs){if(!Number.isFinite(epochMs))return null;try{const p=Object.fromEntries(dateFormat.formatToParts(epochMs).filter(x=>x.type!=='literal').map(x=>[x.type,Number(x.value)]));return{year:p.year,month:p.month,day:p.day};}catch{return null;}}
 function solarTimes(epochMs){const d=localDate(epochMs);if(!d)return null;const midnight=Date.UTC(d.year,d.month-1,d.day),n=Math.floor((midnight-Date.UTC(d.year,0,1))/86400000)+1,days=(Date.UTC(d.year+1,0,1)-Date.UTC(d.year,0,1))/86400000,gamma=2*Math.PI/days*(n-1);
  const equation=229.18*(.000075+.001868*Math.cos(gamma)-.032077*Math.sin(gamma)-.014615*Math.cos(2*gamma)-.040849*Math.sin(2*gamma));
  const declination=.006918-.399912*Math.cos(gamma)+.070257*Math.sin(gamma)-.006758*Math.cos(2*gamma)+.000907*Math.sin(2*gamma)-.002697*Math.cos(3*gamma)+.00148*Math.sin(3*gamma);
  const cosine=(Math.cos(90.833*RAD)/(Math.cos(LATITUDE*RAD)*Math.cos(declination)))-Math.tan(LATITUDE*RAD)*Math.tan(declination);if(cosine < -1 || cosine > 1)return null;
  const hourAngle=Math.acos(cosine)/RAD,noon=720-4*LONGITUDE-equation,sunrise=midnight+(noon-4*hourAngle)*60000,sunset=midnight+(noon+4*hourAngle)*60000;
  return{sunrise,sunset,date:`${d.year}-${String(d.month).padStart(2,'0')}-${String(d.day).padStart(2,'0')}`,timeZone:ZONE,latitude:LATITUDE,longitude:LONGITUDE,approximate:true,method:'NOAA fractional-year solar approximation'};
 }
 function themeAt(epochMs){const sun=solarTimes(epochMs);return sun?{theme:epochMs>=sun.sunrise&&epochMs<sun.sunset?'light':'dark',...sun}:null;}
 function mount(win,doc){if(doc.documentElement.classList.contains('render')||new URLSearchParams(win.location.search).has('render'))return null;const html=doc.documentElement;let busy=false,anchor=null,lastTheme=html.dataset.theme==='light'?'light':'dark',timer=null;
  html.dataset.theme=lastTheme;html.dataset.themeSource='approximate Saskatoon sunrise/sunset';html.dataset.themeTimeStatus='unavailable';
  function apply(){if(!anchor)return;const elapsed=win.performance.now()-anchor.mono;if(elapsed<0||elapsed>anchor.validFor){html.dataset.themeTimeStatus='stale';return;}const result=themeAt(anchor.epoch+elapsed);if(!result)return;const changed=lastTheme!==result.theme;lastTheme=result.theme;html.dataset.theme=lastTheme;html.dataset.themeTimeStatus='synced';html.dataset.sunrise=new Date(result.sunrise).toISOString();html.dataset.sunset=new Date(result.sunset).toISOString();if(changed)doc.dispatchEvent(new win.CustomEvent('solar-theme-change',{detail:result}));}
  async function refresh(){if(busy)return;busy=true;try{const s=await win.sampleApp?.time();if(s?.status!=='synced'||!Number.isFinite(s.epochMs)){anchor=null;html.dataset.themeTimeStatus=s?.status==='stale'?'stale':'unavailable';return;}const age=Number.isFinite(s.ageMs)?Math.max(0,s.ageMs):0,max=Number.isFinite(s.maxAgeMs)?Math.min(90000,Math.max(0,s.maxAgeMs)):90000;if(age>=max){anchor=null;html.dataset.themeTimeStatus='stale';return;}anchor={epoch:s.epochMs,mono:win.performance.now(),validFor:max-age};apply();}catch{anchor=null;html.dataset.themeTimeStatus='unavailable';}finally{busy=false;}}
  doc.addEventListener('visibilitychange',()=>{if(!doc.hidden)refresh();});refresh();timer=win.setInterval(()=>{apply();if(!doc.hidden)refresh();},15000);return{refresh,apply,stop(){win.clearInterval(timer);anchor=null;}};
 }
 return Object.freeze({LATITUDE,LONGITUDE,ZONE,localDate,solarTimes,themeAt,mount});
});
