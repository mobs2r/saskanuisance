(()=>{
 'use strict';
 const html=document.documentElement;
 if(html.classList.contains('render'))return;
 const $=id=>document.getElementById(id);
 const make=(tag,cls,text)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined&&text!==null)el.textContent=String(text);return el;};
 const api=window.sampleApp||{};
 const D=Object.assign({places:[],cams:[],rail:{lines:[],crossings:[],yards:[],stations:[]},via:null,bike:[],parks:[],brt:[]},window.YXE_DATA||{});
 const panel=$('receipt-panel'),rail=document.querySelector('.transit-sidebar'),controls=panel?.querySelector('.controls'),weather=$('weather-open'),preview=panel?.querySelector('.preview'),tracked=$('tracked-bus'),allBuses=$('all-buses');
 if(!panel||!rail||!controls||!weather||!window.cityDashboard||!window.L)return;
 const dash=window.cityDashboard,map=dash.map,ZONE='America/Regina';
 const saved=(key,fallback)=>{try{const v=localStorage.getItem('yxe:'+key);return v===null?fallback:JSON.parse(v);}catch{return fallback;}};
 const save=(key,value)=>{try{localStorage.setItem('yxe:'+key,JSON.stringify(value));}catch{}};
 const button=(label,cls,title)=>{const b=make('button',cls||'',label);b.type='button';if(title){b.title=title;b.setAttribute('aria-label',title);}return b;};
 const RAD=Math.PI/180;
 const meters=(a,b,c,d)=>{const x=(d-b)*RAD*Math.cos((a+c)/2*RAD),y=(c-a)*RAD;return Math.sqrt(x*x+y*y)*6371000;};
 const dist=m=>!Number.isFinite(m)?'':m<950?Math.max(10,Math.round(m/10)*10)+' m':(m/1000).toFixed(m<9950?1:0)+' km';
 const timeFormat=new Intl.DateTimeFormat('en-CA',{timeZone:ZONE,hour:'numeric',minute:'2-digit'});
 const clock=ms=>Number.isFinite(ms)?timeFormat.format(ms).replace(/\s*([ap])\.?\s*m\.?/i,(_,x)=>' '+x.toUpperCase()+'M'):'';
 const dayFormat=new Intl.DateTimeFormat('en-CA',{timeZone:ZONE,weekday:'short',month:'short',day:'numeric'});
 const partsFormat=new Intl.DateTimeFormat('en-US',{timeZone:ZONE,weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 const WEEK={Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6};
 function localNow(ms=Date.now()){const p=Object.fromEntries(partsFormat.formatToParts(ms).map(x=>[x.type,x.value]));return{day:WEEK[p.weekday],min:(Number(p.hour)%24)*60+Number(p.minute)};}
 const sameDay=(a,b)=>dayFormat.format(a)===dayFormat.format(b);
 const when=ms=>sameDay(ms,Date.now())?clock(ms):dayFormat.format(ms)+' '+clock(ms);
 const mins=s=>{const m=Math.max(1,Math.round(s/60));return m<60?m+' min':Math.floor(m/60)+' h '+(m%60?m%60+' min':'');};

 const DAYS=['Su','Mo','Tu','We','Th','Fr','Sa'],DAY_NAMES={Mo:'Mon',Tu:'Tue',We:'Wed',Th:'Thu',Fr:'Fri',Sa:'Sat',Su:'Sun',PH:'Holidays'},hoursCache=new Map();
 function parseRules(text){
  if(/^24\/7$/i.test(text))return{always:true};
  const rules=[];
  for(const raw of text.split(';')){
   const rule=raw.trim();if(!rule)continue;
   const m=/^((?:(?:Mo|Tu|We|Th|Fr|Sa|Su|PH)(?:\s*-\s*(?:Mo|Tu|We|Th|Fr|Sa|Su))?\s*,?\s*)*)(.*)$/.exec(rule);
   let days=null;
   if(m[1].trim()){
    days=new Set();let holiday=false;
    for(const part of m[1].split(',')){const piece=part.trim();if(!piece)continue;if(piece==='PH'){holiday=true;continue;}const[a,b]=piece.split(/\s*-\s*/),i=DAYS.indexOf(a),j=b?DAYS.indexOf(b):i;if(i<0||j<0)return null;for(let k=i,n=0;n<7;k=(k+1)%7,n++){days.add(k);if(k===j)break;}}
    if(!days.size){if(holiday)continue;return null;}
   }
   const rest=m[2].trim();
   if(/^(off|closed)$/i.test(rest)){rules.push({days,ranges:[]});continue;}
   if(rest==='24/7'){rules.push({days,ranges:[[0,1440]]});continue;}
   const ranges=[];
   for(const piece of rest.split(',')){const q=/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\+?$/.exec(piece.trim());if(!q)return null;const start=Number(q[1])*60+Number(q[2]);let end=Number(q[3])*60+Number(q[4]);if(end<=start)end+=1440;ranges.push([start,end]);}
   rules.push({days,ranges});
  }
  return rules.length?{rules}:null;
 }
 function parseHours(text){if(typeof text!=='string'||!text.trim())return null;if(!hoursCache.has(text)){let spec=null;try{spec=parseRules(text.trim());}catch{spec=null;}hoursCache.set(text,spec);}return hoursCache.get(text);}
 const dayRanges=(spec,day)=>{let out=[];for(const r of spec.rules)if(!r.days||r.days.has(day))out=r.ranges;return out;};
 const hhmm=min=>{const m=((min%1440)+1440)%1440,h=Math.floor(m/60),mm=m%60;return(h%12||12)+(mm?':'+String(mm).padStart(2,'0'):'')+(h<12?' AM':' PM');};
 function hoursState(text,ms){
  const spec=parseHours(text);if(!spec)return null;
  if(spec.always)return{open:true,label:'Open 24 hours'};
  const{day,min}=localNow(ms);
  for(const[s,e]of dayRanges(spec,day))if(min>=s&&min<e)return{open:true,label:e-s>=1440?'Open 24 hours':'Open until '+hhmm(e)};
  for(const[,e]of dayRanges(spec,(day+6)%7))if(e>1440&&min+1440<e)return{open:true,label:'Open until '+hhmm(e)};
  const later=dayRanges(spec,day).filter(([s])=>s>min).sort((a,b)=>a[0]-b[0])[0];
  return{open:false,label:later?'Closed · opens '+hhmm(later[0]):'Closed now'};
 }
 const prettyHours=text=>text==='24/7'?'24 hours, every day':text.split(';').map(x=>x.trim()).filter(Boolean).map(x=>x.replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su|PH)\b/g,d=>DAY_NAMES[d]).replace(/(\d{1,2}):(\d{2})/g,(_,h,m)=>hhmm(Number(h)*60+Number(m))).replace(/\boff\b/,'closed')).join('\n');

 const ICON_PATHS={
  wifi:'<path d="M1.5 6.5q6.5-5.5 13 0M3.8 9q4.2-3.5 8.4 0M6.2 11.4q1.8-1.3 3.6 0"/><rect x="7" y="12.6" width="2" height="2" class="f"/>',
  wc:'<circle cx="4.5" cy="2.8" r="1.5" class="f"/><path d="M3 5.5h3v4.5H5.3v4H3.7v-4H3z" class="f"/><circle cx="11.5" cy="2.8" r="1.5" class="f"/><path d="M11.5 5.2l2.6 5.3h-1.6V14h-2v-3.5H8.9z" class="f"/><path d="M8 1v14" opacity=".55"/>',
  water:'<path d="M8 1.5C8 1.5 3.5 7 3.5 10a4.5 4.5 0 0 0 9 0C12.5 7 8 1.5 8 1.5z" class="f"/><path d="M6 10.5a2 2 0 0 0 2 2" class="hl"/>',
  late:'<path d="M3.5 1.5v4a1.5 1.5 0 0 0 3 0v-4M5 1.5V14.5M11.5 1.5c-1.6.8-2.3 3-2.3 6.5h2.3v6.5"/>',
  open247:'<circle cx="8" cy="8" r="6.2"/><path d="M8 4v4.2l2.8 1.6"/>',
  rx:'<path d="M5.4 11.6a2.9 2.9 0 0 1 0-4.1l2.1-2.1a2.9 2.9 0 0 1 4.1 4.1l-2.1 2.1a2.9 2.9 0 0 1-4.1 0z"/><path d="M6.4 6.4l3.2 3.2"/><path d="M8.6 10.6l-1.9 1.9-.1.1a2.9 2.9 0 0 1-1.2-1.2l2-2z" class="f"/>',
  help:'<path d="M8 13.8S2 9.8 2 5.9A3 3 0 0 1 8 4.6a3 3 0 0 1 6 1.3c0 3.9-6 7.9-6 7.9z" class="f"/>',
  lib:'<path d="M8 4C6 2.8 4 2.6 1.5 3v10c2.5-.4 4.5-.2 6.5 1 2-1.2 4-1.4 6.5-1V3C12 2.6 10 2.8 8 4zM8 4v10"/>',
  mail:'<path d="M4 14.5V6a4 4 0 0 1 8 0v8.5z"/><path d="M5.8 7h4.4M2.5 14.5h11"/>',
  cmb:'<rect x="2" y="2.5" width="12" height="10"/><path d="M2 6h12M2 9.3h12M6 2.5v10M10 2.5v10M3.5 15h9"/>',
  post:'<rect x="1.8" y="3.8" width="12.4" height="8.4"/><path d="M1.8 3.8L8 9l6.2-5.2"/>',
  atm:'<rect x="1.5" y="4.5" width="13" height="7"/><circle cx="8" cy="8" r="1.8"/><path d="M3.5 6.5v3M12.5 6.5v3"/>',
  gas:'<path d="M3 14.5V2.5h6v12M2 14.5h8M3 7h6M9 5.5l2.5 1.8V12a1 1 0 0 0 2 0V5.5l-2-2"/>',
  ev:'<path d="M9.5 1L4 9h4l-1.5 6L12 7H8z" class="f"/>',
  phone:'<path d="M4.2 2l2.3 2.7-1.2 1.6c.9 1.9 2.3 3.3 4.2 4.2l1.6-1.2 2.7 2.3-1.5 2C7 13.4 2.4 8.8 2.2 3.6z" class="f"/>',
  liquor:'<path d="M7 1.5h2v3l1.6 2.2v7.8H5.4V6.7L7 4.5z"/><path d="M5.4 9h5.2"/>',
  cannabis:'<path d="M8 15V8.5M8 8.5C6.8 5.5 7 3.2 8 1.2c1 2 1.2 4.3 0 7.3zM8 8.5C5.7 6.4 3.8 5.6 1.5 5.6c.6 2.2 2.6 3.9 6.5 2.9zM8 8.5c2.3-2.1 4.2-2.9 6.5-2.9-.6 2.2-2.6 3.9-6.5 2.9zM8 9c-1.6.3-3.3 1.2-4.3 2.6M8 9c1.6.3 3.3 1.2 4.3 2.6"/>',
  vape:'<rect x="1.5" y="10.5" width="9.5" height="3"/><path d="M11 12h2.5M12.3 8.5c0-1.2 1.2-1.2 1.2-2.4s-1.2-1.2-1.2-2.4"/>',
  art:'<path d="M8 1.8a6.2 6.2 0 1 0 0 12.4c1 0 1.3-.8.9-1.5-.5-.9 0-1.9 1-1.9H11a3.2 3.2 0 0 0 3.2-3.2C14.2 4.4 11.4 1.8 8 1.8z"/><rect x="4" y="6.5" width="1.6" height="1.6" class="f"/><rect x="6.5" y="4" width="1.6" height="1.6" class="f"/><rect x="9.6" y="4.4" width="1.6" height="1.6" class="f"/>',
  wiki:'<path d="M1.5 6L8 2.2 14.5 6z"/><path d="M3.5 7v5.5M6.5 7v5.5M9.5 7v5.5M12.5 7v5.5M1.5 14h13"/>',
  view:'<path d="M1.2 8.5S3.8 3.8 8 3.8s6.8 4.7 6.8 4.7-2.6 4.7-6.8 4.7-6.8-4.7-6.8-4.7z"/><circle cx="8" cy="8.5" r="2" class="f"/>',
  parking:'<path d="M4.8 14.5V2.2h4a3.4 3.4 0 0 1 0 6.8h-4" stroke-width="2.4"/>',
  parkin:'<path d="M1 6.2L8 1.8l7 4.4"/><path d="M5.8 14.5V6.5h2.8a2.3 2.3 0 0 1 0 4.6H5.8" stroke-width="2"/>',
  meter:'<rect x="4.5" y="1.5" width="7" height="7.5"/><path d="M8 9v5.5M5.5 14.5h5M6.5 4.2h3M6.5 6.5h1.5"/>',
  load:'<rect x="1.2" y="4" width="8.3" height="6.8"/><path d="M9.5 6.5h3l2.2 2.4v1.9H9.5"/><circle cx="4" cy="12.3" r="1.4" class="f"/><circle cx="12" cy="12.3" r="1.4" class="f"/>',
  access:'<circle cx="7.5" cy="2.4" r="1.4" class="f"/><path d="M7.5 4.6v4.2h3.8l1.7 4.4M7.5 6.6h3.3M5.5 7.3a3.7 3.7 0 1 0 4.9 4.9"/>',
  bikerack:'<circle cx="3.9" cy="10.8" r="2.7"/><circle cx="12.1" cy="10.8" r="2.7"/><path d="M3.9 10.8L6.4 5.5h4.3l1.4 5.3M6.4 5.5L8.2 10.8l2.5-5.3M5.2 3.8h2.4M10 3.5h1.8"/>',
  bikefix:'<path d="M10.8 1.6a3.2 3.2 0 0 0-3 4.3L2 11.7l2.3 2.3 5.8-5.8a3.2 3.2 0 0 0 4.3-3l-1.9 1.4-1.8-.4-.4-1.8z" class="f"/>',
  recycle:'<path d="M13.2 8a5.2 5.2 0 1 1-1.6-3.8"/><path d="M12.6 1.6v3.2H9.4"/><path d="M5.8 8.2l1.6 1.6 3-3.2"/>',
  laundry:'<rect x="2.5" y="1.5" width="11" height="13"/><circle cx="8" cy="9" r="3.2"/><path d="M4.5 3.8h2.2M11 3.8h.5"/>',
  coach:'<path d="M2.5 13V3.5A1.5 1.5 0 0 1 4 2h8a1.5 1.5 0 0 1 1.5 1.5V13z"/><path d="M2.5 8h11M5 13v1.6M11 13v1.6M6 4.3h4"/><rect x="4" y="10" width="1.6" height="1.4" class="f"/><rect x="10.4" y="10" width="1.6" height="1.4" class="f"/>',
  stop:'<rect x="3.5" y="1.5" width="9" height="6"/><path d="M8 7.5v7M5.5 14.5h5M5.5 4.5h5"/>',
  cam:'<path d="M1.8 5h3l1.2-1.8h4L11.2 5h3v8.5H1.8z"/><circle cx="8" cy="9.1" r="2.4"/>',
  tree:'<path d="M8 14.8V10M8 1.2L3.2 10h9.6z"/>',
  rec:'<path d="M2.2 14.5V6.4L8 2.4l5.8 4v8.1z"/><path d="M6 14.5v-4h4v4"/>',
  hospital:'<path d="M4.2 2.2v11.6M11.8 2.2v11.6M4.2 8h7.6" stroke-width="2.4"/>',
  train:'<rect x="3" y="1.8" width="10" height="10" rx="1.6"/><path d="M3 7.2h10M5.2 11.8l-1.8 2.8M10.8 11.8l1.8 2.8"/><rect x="4.8" y="8.8" width="1.6" height="1.5" class="f"/><rect x="9.6" y="8.8" width="1.6" height="1.5" class="f"/>',
  scooter:'<circle cx="3.6" cy="12.4" r="1.8"/><circle cx="12.6" cy="12.4" r="1.8"/><path d="M5.4 12.4h5.4L9.2 2.6h2.6"/>',
  brt:'<path d="M2.5 13V3.5A1.5 1.5 0 0 1 4 2h8a1.5 1.5 0 0 1 1.5 1.5V13z"/><path d="M2.5 8h11"/><path d="M8.6 9.2L7 11.6h2l-1 2" />',
  dot:'<circle cx="8" cy="8" r="3" class="f"/>'
 };
 const ico=k=>'<svg class="ico" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">'+(ICON_PATHS[k]||ICON_PATHS.dot)+'</svg>';
 const icoEl=(k,cls)=>{const s=make('span','pin pin-inline '+(cls||''));s.innerHTML=ico(k);return s;};
 const CATS={
  wifi:{label:'Free Wi-Fi',glyph:'wifi',group:'essentials',on:true},
  wc:{label:'Washrooms',glyph:'wc',group:'essentials',on:true},
  wcg:{label:'Gas station washrooms (likely)',glyph:'wc',group:'essentials'},
  water:{label:'Drinking water',glyph:'water',group:'essentials'},
  late:{label:'Late-night food',glyph:'late',group:'essentials'},
  open247:{label:'Open 24/7',glyph:'open247',group:'essentials'},
  rx:{label:'Pharmacies',glyph:'rx',group:'essentials'},
  help:{label:'Shelters & food banks',glyph:'help',group:'essentials'},
  lib:{label:'Libraries',glyph:'lib',group:'errands'},
  mail:{label:'Street mailboxes',glyph:'mail',group:'errands'},
  cmb:{label:'Community mailboxes',glyph:'cmb',group:'errands'},
  post:{label:'Post offices',glyph:'post',group:'errands'},
  atm:{label:'ATMs',glyph:'atm',group:'errands'},
  gas:{label:'Gas stations',glyph:'gas',group:'errands'},
  ev:{label:'EV chargers',glyph:'ev',group:'errands'},
  phone:{label:'Payphones',glyph:'phone',group:'errands'},
  laundry:{label:'Laundromats',glyph:'laundry',group:'errands'},
  recycle:{label:'Recycling depots',glyph:'recycle',group:'errands'},
  parking:{label:'Parking',glyph:'parking',group:'parkgrp'},
  meter:{label:'Parking pay stations',glyph:'meter',group:'parkgrp'},
  load:{label:'Loading zones',glyph:'load',group:'parkgrp'},
  coach:{label:'Coaches & shuttles',glyph:'coach',group:'move'},
  bikerack:{label:'Bike racks',glyph:'bikerack',group:'move'},
  bikefix:{label:'Bike repair stands',glyph:'bikefix',group:'move'},
  liquor:{label:'Liquor stores',glyph:'liquor',group:'shops'},
  cannabis:{label:'Cannabis stores',glyph:'cannabis',group:'shops'},
  vape:{label:'Vape shops',glyph:'vape',group:'shops'},
  art:{label:'Public art',glyph:'art',group:'explore'},
  wiki:{label:'Landmarks',glyph:'wiki',group:'explore'},
  view:{label:'Lookouts',glyph:'view',group:'explore'}
 };
 const IO_LABEL={indoor:'Indoor',outdoor:'Outdoor',covered:'Covered',unknown:'Indoor/outdoor unknown'};
 const pinKind=p=>p.c==='parking'?(p.i==='indoor'||p.i==='covered'?['parkin','pin-parking pin-parking-in']:['parking','pin-parking pin-parking-'+(p.i||'unknown')]):p.c==='load'&&/Accessible|Access Transit/.test(p.n||'')?['access','pin-load pin-load-acc']:[CATS[p.c].glyph,'pin-'+p.c+' pin-'+CATS[p.c].group];
 const SOURCE={spl:'Saskatoon Public Library',cityheat:'City of Saskatoon',city:'City of Saskatoon',cp:'Canada Post',atp:'Store locator',rx:'Rider Express published schedule',dd:'Dakota Dunes Casino'};
 const places=(Array.isArray(D.places)?D.places:[]).filter(p=>CATS[p.c]&&Number.isFinite(p.la)&&Number.isFinite(p.lo));
 const byCat=new Map();for(const p of places){if(!byCat.has(p.c))byCat.set(p.c,[]);byCat.get(p.c).push(p);}

 let here=saved('here',null);if(!here||!Number.isFinite(here.lat)||!Number.isFinite(here.lon))here=null;
 const origin=()=>here||(()=>{const c=map.getCenter();return{lat:c.lat,lon:c.lng,label:'map centre'};})();
 const away=p=>{const o=origin();return meters(o.lat,o.lon,p.la??p.lat,p.lo??p.lon);};

 const topbar=make('header','topbar'),brand=make('div','brand'),tabs=make('nav','tabs'),topRight=make('div','top-right');
 brand.append(make('b','','YXE'),make('span','',' field guide'));
 tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Sections');
 topRight.append(weather);
 topbar.append(brand,tabs,topRight);
 document.body.prepend(topbar);
 const paneHost=make('div','panes'),panes=new Map(),tabButtons=new Map();
 const TABS=[['near','near'],['route','route'],['bus','bus'],['wifi','wi-fi'],['places','places'],['mail','mail'],['cams','cams'],['city','city'],['signal','signal']];
 const paneOpen=new Map();
 for(const[id,label]of TABS){
  const b=button(label,'tab');b.setAttribute('role','tab');b.id='tab-'+id;b.setAttribute('aria-controls','pane-'+id);b.addEventListener('click',()=>show(id));tabs.append(b);tabButtons.set(id,b);
  const p=make('section','pane');p.id='pane-'+id;p.setAttribute('role','tabpanel');p.setAttribute('aria-labelledby',b.id);p.hidden=true;paneHost.append(p);panes.set(id,p);
 }
 let current=null;
 function show(id){
  if(!panes.has(id))id='near';
  current=id;save('tab',id);
  for(const[key,p]of panes)p.hidden=key!==id;
  for(const[key,b]of tabButtons){b.setAttribute('aria-selected',String(key===id));b.tabIndex=key===id?0:-1;}
  if(id==='signal')html.dataset.view='terminal';
  else if(html.dataset.view==='terminal')delete html.dataset.view;
  paneOpen.get(id)?.();
 }
 tabs.addEventListener('keydown',e=>{if(e.key!=='ArrowRight'&&e.key!=='ArrowLeft')return;const ids=TABS.map(t=>t[0]),i=ids.indexOf(current),n=ids[(i+(e.key==='ArrowRight'?1:ids.length-1))%ids.length];show(n);tabButtons.get(n).focus();e.preventDefault();});
 const head=(text,extra)=>{const h=make('h2','pane-head',text);if(extra)h.append(extra);return h;};

 const searchLabel=document.querySelector('.transit-search-label'),search=$('transit-search'),results=$('transit-search-results'),listTabs=document.querySelector('.list-tabs'),busList=$('bus-list'),stops=$('stops-pane');
 const busPane=panes.get('bus');
 if(searchLabel){searchLabel.textContent='Find a bus, route or stop';searchLabel.classList.add('sr-only');}
 if(search)search.placeholder='bus, route, stop…';
 if(allBuses){allBuses.textContent='show all';allBuses.title='Show every bus';}
 const busTop=make('div','row-tools');if(search)busTop.append(search);if(allBuses)busTop.append(allBuses);
 busPane.append(head('Buses'));if(searchLabel)busPane.append(searchLabel);busPane.append(busTop);
 for(const el of [results,tracked,listTabs,busList,stops])if(el)busPane.append(el);
 if(listTabs)listTabs.hidden=false;if(busList)busList.hidden=false;
 const announce=$('announcements-toggle');if(announce)announce.title='Reads out the next stop while you follow a bus.';
 const follow=$('follow-bus');if(follow)follow.title='Keep the map on this bus';
 const depNote=$('departure-note');if(depNote&&depNote.textContent==='Choose a stop')depNote.textContent='Pick a stop';

 const dock=make('footer','dock');dock.append(controls);
 rail.replaceChildren(paneHost,dock);
 const printLabel=$('print-label');if(printLabel)printLabel.textContent='PRINT TICKET';
 const countdown=$('service-countdown');if(countdown)countdown.removeAttribute('title');
 const action=document.querySelector('.action-row');let dialogPreview=null;
 if(preview&&action){
  dialogPreview=make('dialog','receipt-preview-dialog');dialogPreview.id='receipt-preview-dialog';dialogPreview.setAttribute('aria-labelledby','receipt-preview-title');
  const top=make('header','receipt-preview-heading'),close=button('×','receipt-preview-close','Close'),title=make('strong','','Ticket preview');title.id='receipt-preview-title';top.append(title,close);
  const content=make('div','receipt-preview-content');content.append(preview);dialogPreview.append(top,content);document.body.append(dialogPreview);
  close.addEventListener('click',()=>dialogPreview.close());dialogPreview.addEventListener('click',e=>{if(e.target===dialogPreview)dialogPreview.close();});
  const open=button('PREVIEW','preview-button');open.addEventListener('click',()=>dialogPreview.showModal());action.append(open);
 }
 const appTitle=document.querySelector('.app-title');if(appTitle)appTitle.hidden=true;
 new MutationObserver(()=>{if(tracked&&!tracked.hidden&&current!=='bus')show('bus');}).observe(tracked||document.createElement('i'),{attributes:true,attributeFilter:['hidden']});
 const depHeading=$('departure-heading');if(depHeading)new MutationObserver(()=>{if(current!=='bus'&&stops&&!stops.hidden)show('bus');}).observe(depHeading,{childList:true,characterData:true,subtree:true});

 const mapWrap=document.querySelector('.map-wrap');
 const BASEMAPS=[
  ['street','Street',L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© <a href="#" data-link="osmCopyright">OpenStreetMap contributors</a>'})],
  ['light','Paper',L.tileLayer('https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© <a href="#" data-link="osmCopyright">OpenStreetMap contributors</a> © CARTO'})],
  ['dark','Night',L.tileLayer('https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© <a href="#" data-link="osmCopyright">OpenStreetMap contributors</a> © CARTO'})],
  ['transit','Transit',L.tileLayer('https://tile.memomaps.de/tilegen/{z}/{x}/{y}.png',{maxZoom:18,attribution:'© <a href="#" data-link="osmCopyright">OpenStreetMap contributors</a> · ÖPNVKarte'})],
  ['cycle','Cycling',L.tileLayer('https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',{subdomains:'abc',maxZoom:19,attribution:'© <a href="#" data-link="osmCopyright">OpenStreetMap contributors</a> · CyclOSM'})],
  ['topo','Terrain',L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',{subdomains:'abc',maxZoom:17,attribution:'© <a href="#" data-link="osmCopyright">OpenStreetMap contributors</a>, SRTM · OpenTopoMap (CC-BY-SA)'})],
  ['hot','Humanitarian',L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',{subdomains:'abc',maxZoom:19,attribution:'© <a href="#" data-link="osmCopyright">OpenStreetMap contributors</a> · HOT'})],
  ['satellite','Satellite',L.tileLayer('https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg',{maxNativeZoom:14,maxZoom:19,attribution:'Sentinel-2 cloudless by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2016 &amp; 2017)'})]
 ];
 map.eachLayer(layer=>{if(layer instanceof L.TileLayer)map.removeLayer(layer);});
 const mapNotice=$('map-notice');
 let basemap=null,tileFailures=0;
 function setBasemap(id,auto=false){
  const entry=BASEMAPS.find(b=>b[0]===id)||BASEMAPS[0];
  if(basemap)map.removeLayer(basemap);
  basemap=entry[2];tileFailures=0;basemap.addTo(map);basemap.bringToBack();
  html.dataset.basemap=entry[0];if(!auto)save('basemap',entry[0]);
  for(const input of document.querySelectorAll('input[name="basemap"]'))input.checked=input.value===entry[0];
 }
 for(const[,,layer]of BASEMAPS){layer.on('tileerror',()=>{if(layer===basemap&&++tileFailures>6&&mapNotice){mapNotice.textContent='Map images can’t load right now.';mapNotice.hidden=false;}});const clear=()=>{if(layer===basemap&&mapNotice&&/^(Loading map|Map images can)/.test(mapNotice.textContent)){mapNotice.hidden=true;tileFailures=0;}};layer.on('tileload',clear);layer.on('load',clear);}
 const tonePane=map.createPane('tone');tonePane.style.zIndex='250';tonePane.style.pointerEvents='none';
 const toneShade=document.createElement('div');toneShade.className='map-tone-shade';tonePane.appendChild(toneShade);
 function placeTone(){const size=map.getSize(),origin=map.containerPointToLayerPoint([0,0]);toneShade.style.width=size.x+'px';toneShade.style.height=size.y+'px';toneShade.style.transform='translate3d('+origin.x+'px,'+origin.y+'px,0)';}
 map.on('move zoom resize',placeTone);placeTone();

 const markerFor=new Map();
 const iconCache=new Map();
 const pinIcon=(glyph,cls)=>{const key=glyph+'|'+cls;if(!iconCache.has(key))iconCache.set(key,L.divIcon({className:'pin '+cls,html:ico(glyph),iconSize:[20,18],iconAnchor:[10,9],popupAnchor:[0,-9]}));return iconCache.get(key);};
 let parkIO=saved('parkIO','any');if(!['any','indoor','outdoor','unknown'].includes(parkIO))parkIO='any';
 const ioMatch=p=>p.c!=='parking'||parkIO==='any'||(parkIO==='indoor'?(p.i==='indoor'||p.i==='covered'):p.i===parkIO);
 function placeLayer(cat){
  const group=L.layerGroup();
  for(const p of byCat.get(cat)||[]){if(!ioMatch(p))continue;const[g,cls]=pinKind(p);const m=L.marker([p.la,p.lo],{icon:pinIcon(g,cls),title:p.n||CATS[cat].label,alt:p.n||CATS[cat].label,keyboard:false});m.bindPopup(()=>placePopup(p),{className:'retro-popup',maxWidth:280});m.addTo(group);markerFor.set(p,m);}
  return group;
 }
 function sourceLine(p){
  const line=make('div','pop-src');
  const src=p.s?.startsWith('osm:')?'OpenStreetMap':p.s?.startsWith('wd:')?'Wikidata':SOURCE[p.s];
  if(src)line.textContent='Source: '+src;
  return line;
 }
 function placePopup(p){
  const cat=CATS[p.c],w=make('div','pop');
  w.append(make('b','pop-title',p.n||cat.label));
  w.append(make('div','pop-meta',(p.c==='parking'?IO_LABEL[p.i||'unknown']+' parking':cat.label)+(here?' · '+dist(away(p))+' away':'')));
  if(p.a)w.append(make('div','',p.a));
  const state=hoursState(p.h);if(state)w.append(make('div',state.open?'is-open':'is-closed',state.label));
  if(p.h&&p.h!=='24/7'&&parseHours(p.h))w.append(make('div','pop-hours',prettyHours(p.h)));
  if(p.p){const a=make('div','pop-phone','☎ '+p.p);w.append(a);}
  if(p.k)w.append(make('div','pop-note',p.k));
  if(p.b&&p.c==='coach')w.append(make('div','pop-note',p.b));
  if(p.x)w.append(make('div','','By '+p.x));
  if(p.w==='yes')w.append(make('div','','Wheelchair accessible'));
  w.append(routeActions({lat:p.la,lon:p.lo,name:p.n||cat.label}),sourceLine(p));
  return w;
 }
 function routeActions(target){
  const r=make('div','pop-actions'),to=button('route here','btn'),from=button('start here','btn');
  to.addEventListener('click',()=>{map.closePopup();setEndpoint('to',target);show('route');planIfReady();});
  from.addEventListener('click',()=>{map.closePopup();setEndpoint('from',target);show('route');planIfReady();});
  r.append(to,from);return r;
 }

 function arcFeature(feature,active=false){const g=feature?.geometry;if(!g)return null;let shape=null;if(Array.isArray(g.rings)&&g.rings.length)shape={type:'Polygon',coordinates:g.rings};else if(Array.isArray(g.paths)&&g.paths.length)shape=g.paths.length===1?{type:'LineString',coordinates:g.paths[0]}:{type:'MultiLineString',coordinates:g.paths};else if(Number.isFinite(g.x)&&Number.isFinite(g.y))shape={type:'Point',coordinates:[g.x,g.y]};if(!shape)return null;return{type:'Feature',geometry:shape,properties:{attributes:feature.attributes||{},active}};}
 const HIDE=new Set(['OBJECTID','FID','Shape__Area','Shape__Length','GlobalID','Shape_Area','Shape_Length','created_user','created_date','last_edited_user','last_edited_date']);
 const pretty=v=>{if(typeof v==='number'&&v>946684800000&&v<4102444800000)return dayFormat.format(v);return String(v);};
 function featurePopup(feature,label){const attrs=feature?.properties?.attributes||{},w=make('div','pop');w.append(make('b','pop-title',label),make('div',feature?.properties?.active?'is-closed':'pop-meta',feature?.properties?.active?'In effect now':'Coming up'));for(const[key,value]of Object.entries(attrs).filter(([k,v])=>!HIDE.has(k)&&v!==null&&v!==''&&typeof v!=='object').slice(0,7)){const row=make('div','pop-row');row.append(make('small','',key.replaceAll('_',' ')),make('span','',pretty(value)));w.append(row);}return w;}
 const closureLayer=L.geoJSON([],{style:f=>{const a=f?.properties?.active;return{color:a?'#c00':'#c80',weight:a?4:3,opacity:.9,fillColor:a?'#e44':'#ea4',fillOpacity:a?.25:.12,dashArray:a?'':'6 5'};},pointToLayer:(f,ll)=>L.circleMarker(ll,{radius:6}),onEachFeature:(f,l)=>l.bindPopup(()=>featurePopup(f,'Road closure'),{className:'retro-popup'})});
 const workLayer=L.geoJSON([],{style:f=>{const a=f?.properties?.active;return{color:a?'#b60':'#987',weight:a?4:3,opacity:.9,fillColor:'#fb3',fillOpacity:a?.22:.1,dashArray:a?'2 6':'6 5'};},pointToLayer:(f,ll)=>L.circleMarker(ll,{radius:6}),onEachFeature:(f,l)=>l.bindPopup(()=>featurePopup(f,'Construction'),{className:'retro-popup'})});
 const facilityLayer=L.layerGroup();
 const powerLayer=L.geoJSON([],{style:f=>({color:f?.properties?.planned?'#36a':'#c00',weight:3,opacity:.95,fillColor:f?.properties?.planned?'#69c':'#e54',fillOpacity:.32}),onEachFeature:(f,l)=>l.bindPopup(()=>{const p=f?.properties||{},w=make('div','pop');w.append(make('b','pop-title',p.name||'Power outage'),make('div','is-closed',p.planned?'Planned outage':'Power outage'));if(p.details)w.append(make('div','pop-note',p.details));return w;},{className:'retro-popup'})});
 const facilities=[];
 function refreshFacilities(data){
  facilityLayer.clearLayers();facilities.length=0;
  const hospitals=data.hospitals||[];
  for(const feature of [...hospitals,...(data.leisureFacilities||[])]){
   const point=arcFeature(feature);if(point?.geometry.type!=='Point')continue;
   const a=feature.attributes||{},hospital=hospitals.includes(feature),name=a.Facility_Name||a.Name||a.FacilityName||a.Site_Name||(hospital?'Hospital':'Leisure centre'),ll=point.geometry.coordinates.slice().reverse();
   const kind=a.Facility_Type||a.FacilityType||(hospital?'Hospital':'Leisure centre'),address=a.Address||a.Address_1||'';
   const entry={kind:hospital?'hospital':'facility',n:name,la:ll[0],lo:ll[1],sub:kind};facilities.push(entry);
   const m=L.marker(ll,{icon:pinIcon(hospital?'hospital':'rec',hospital?'pin-hospital':'pin-facility pin-explore'),title:name,alt:name,keyboard:false});
   m.bindPopup(()=>{const w=make('div','pop');w.append(make('b','pop-title',name),make('div','pop-meta',kind+(here?' · '+dist(away(entry))+' away':'')));if(address)w.append(make('div','',address));w.append(routeActions({lat:ll[0],lon:ll[1],name}),(()=>{return make('div','pop-src','Source: City of Saskatoon');})());return w;},{className:'retro-popup'});
   m.addTo(facilityLayer);markerFor.set(entry,m);
  }
  searchDirty=true;
 }

 const lineRenderer=L.canvas({padding:.3});
 function railLayer(){
  const g=L.layerGroup(),lines=D.rail?.lines||[];
  for(const y of D.rail?.yards||[])if(Array.isArray(y.p)&&y.p.length>2)L.polygon(y.p,{renderer:lineRenderer,color:'#776',weight:1,fillColor:'#998',fillOpacity:.18,interactive:true}).bindTooltip(y.n||'Rail yard',{sticky:true}).addTo(g);
  for(const l of lines){if(!Array.isArray(l.p)||l.p.length<2)continue;const tip=[l.n,(l.o||'').replaceAll(';',' · ')].filter(Boolean).join(' — ')||'Railway';L.polyline(l.p,{renderer:lineRenderer,color:'#333',weight:4,opacity:.8}).bindTooltip(tip,{sticky:true}).addTo(g);L.polyline(l.p,{renderer:lineRenderer,color:'#fff',weight:2,dashArray:'6 6',opacity:.9,interactive:false}).addTo(g);}
  for(const c of D.rail?.crossings||[])L.circleMarker([c[0],c[1]],{renderer:lineRenderer,radius:3,color:'#900',weight:1,fillColor:c[2]?'#f33':'#fc3',fillOpacity:1}).bindTooltip(c[2]?'Level crossing (road)':'Level crossing (path)').addTo(g);
  return g;
 }
 function bikeLayer(){const g=L.layerGroup();for(const s of D.bike||[])if(Array.isArray(s.p)&&s.p.length>1)L.polyline(s.p,{renderer:lineRenderer,color:s.l===1?'#2a7':'#5b9',weight:s.l===1?3:2,opacity:.85}).bindTooltip(s.k||'Bike route',{sticky:true}).addTo(g);return g;}
 const parkList=[];
 function parksLayer(){
  const g=L.layerGroup();
  for(const p of D.parks||[]){if(!Array.isArray(p.r)||!p.r.length)continue;const rings=p.r.map(r=>r.map(([x,y])=>[y,x]));const poly=L.polygon(rings,{renderer:lineRenderer,color:'#3a7d3a',weight:1,fillColor:'#7c5',fillOpacity:.28});poly.bindPopup(()=>{const w=make('div','pop'),c=poly.getBounds().getCenter();w.append(make('b','pop-title',p.n||'Park'),make('div','pop-meta',[p.k,p.a].filter(Boolean).join(' · ')||'Park'));w.append(routeActions({lat:c.lat,lon:c.lng,name:p.n||'Park'}));w.append(make('div','pop-src','Source: City of Saskatoon'));return w;},{className:'retro-popup'});poly.addTo(g);}
  return g;
 }
 for(const p of D.parks||[]){const ring=p.r?.[0];if(!Array.isArray(ring)||!ring.length)continue;let x=0,y=0;for(const pt of ring){x+=pt[0];y+=pt[1];}parkList.push({kind:'park',n:p.n||'Park',la:y/ring.length,lo:x/ring.length,sub:p.k||'Park'});}
 function brtLayer(){const g=L.layerGroup(),icon=pinIcon('brt','pin-brt pin-move');for(const s of D.brt||[])if(Number.isFinite(s.la))L.marker([s.la,s.lo],{icon,title:s.n,keyboard:false}).bindPopup(()=>{const w=make('div','pop');w.append(make('b','pop-title',s.n),make('div','pop-meta','Planned rapid-transit station. Not open yet.'));return w;},{className:'retro-popup'}).addTo(g);return g;}

 function zonedMidnight(ymd,zone){const y=Number(ymd.slice(0,4)),m=Number(ymd.slice(4,6)),d=Number(ymd.slice(6,8)),guess=Date.UTC(y,m-1,d,12);const name=new Intl.DateTimeFormat('en-US',{timeZone:zone,timeZoneName:'longOffset'}).formatToParts(guess).find(x=>x.type==='timeZoneName')?.value||'GMT';const o=/GMT([+-])(\d{2}):?(\d{2})?/.exec(name);const offset=o?(o[1]==='-'?-1:1)*(Number(o[2])*60+Number(o[3]||0)):0;return Date.UTC(y,m-1,d)-offset*60000;}
 function trainTimes(limit=4,from=Date.now()){
  const via=D.via;if(!via?.runs)return[];const out=[],zone=via.tz||'America/Toronto';
  for(let back=-4;back<=10;back++){
   const day=new Date(from+back*86400000),ymd=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(day).replaceAll('-',''),wd=new Date(Date.UTC(Number(ymd.slice(0,4)),Number(ymd.slice(4,6))-1,Number(ymd.slice(6,8)))).getUTCDay();
   for(const run of via.runs){if(!run.days?.[wd]||ymd<run.start||ymd>run.end)continue;const base=zonedMidnight(ymd,zone),arr=base+run.arr*1000,dep=base+run.dep*1000;if(dep>=from-10*60000)out.push({run,arr,dep});}
  }
  const seen=new Set();return out.filter(x=>{const k=x.run.train+'@'+x.dep;if(seen.has(k))return false;seen.add(k);return true;}).sort((a,b)=>a.arr-b.arr).slice(0,limit);
 }
 function trainRows(limit){const box=make('div','trains');const list=trainTimes(limit);if(!list.length){box.append(make('p','muted','No trains scheduled.'));return box;}for(const t of list){const row=make('div','train-row');row.append(make('span','route-chip via','VIA '+t.run.train),make('span','',(t.run.to?'to '+t.run.to:'')),make('span','mono',(t.arr<Date.now()&&t.dep>Date.now()?'boarding · leaves '+clock(t.dep):'arr '+when(t.arr)+' · dep '+clock(t.dep))));box.append(row);}return box;}
 const liveTrains=L.layerGroup(),scooterLayer=L.layerGroup();let trainData=null,scooterData=null;
 const minsAgo=t=>{const m=Math.max(0,Math.round((Date.now()-t)/60000));return m<1?'just now':m<120?m+' min ago':Math.round(m/60)+' h ago';};
 const lateText=n=>!Number.isFinite(n)?'':n>=2?n+' min late':n<=-2?(-n)+' min early':'on time';
 const titleCase=t=>String(t||'').toLowerCase().replace(/\b[a-z]/g,c=>c.toUpperCase());
 function trainPopup(t){
  const w=make('div','pop');w.append(make('b','pop-title','VIA '+t.train+' · The Canadian'),make('div','pop-meta',titleCase(t.from)+' → '+titleCase(t.to)));
  w.append(make('div','is-open','Live position · '+(t.poll?minsAgo(t.poll):'time unknown')+(Number.isFinite(t.speed)?' · '+Math.round(t.speed)+' km/h':'')));
  if(t.next)w.append(make('div','','Next: '+t.next.station+(t.next.estimated?' · '+clock(t.next.estimated):'')+(lateText(t.next.late)?' · '+lateText(t.next.late):'')));
  if(t.saskatoon&&!t.saskatoon.done&&t.saskatoon.estimated)w.append(make('div','','Saskatoon · '+when(t.saskatoon.estimated)+(lateText(t.saskatoon.late)?' · '+lateText(t.saskatoon.late):'')));
  w.append(make('div','pop-note','Tracker uses cell signal and can lag.'),make('div','pop-src','Source: VIA Rail train tracker'));return w;
 }
 function drawTrains(){liveTrains.clearLayers();for(const t of trainData?.items||[]){if(!Number.isFinite(t.lat)||!Number.isFinite(t.lon))continue;const late=Number(t.next?.late)>=15;L.marker([t.lat,t.lon],{icon:pinIcon('train','pin-train'+(late?' late':'')),title:'VIA '+t.train,alt:'VIA '+t.train,keyboard:false,zIndexOffset:600}).bindPopup(()=>trainPopup(t),{className:'retro-popup',maxWidth:300}).addTo(liveTrains);}}
 async function refreshTrains(force){if(!api.viaLive||(!force&&!layerState.via))return;try{trainData=await api.viaLive();}catch{trainData={status:'unavailable',items:[]};}drawTrains();}
 function trainLiveLines(){const box=make('div','trains');if(!trainData||trainData.status!=='live'){box.append(make('p','muted','Live positions unavailable. Times above are scheduled.'));return box;}if(!trainData.items.length){box.append(make('p','muted','No trains on the line right now.'));return box;}for(const t of trainData.items){const row=make('div','train-row');row.append(make('span','route-chip via','VIA '+t.train),make('span','','live · '+(t.next?'next '+t.next.station:'')+(t.saskatoon&&!t.saskatoon.done&&t.saskatoon.estimated?' · Saskatoon '+when(t.saskatoon.estimated):'')),make('span','mono',lateText(t.next?.late)));box.append(row);}return box;}
 function scooterPopup(v){const w=make('div','pop');w.append(make('b','pop-title','Bird '+v.kind),make('div','pop-meta','Live · '+(scooterData?.updated?minsAgo(scooterData.updated):'')));if(Number.isFinite(v.range))w.append(make('div','',(v.range/1000).toFixed(1)+' km range left'+(Number.isFinite(v.max)&&v.max>0?' · '+Math.round(v.range/v.max*100)+'% battery':'')));w.append(make('div','pop-note','Unlock in the Bird app.'),routeActions({lat:v.lat,lon:v.lon,name:'Bird '+v.kind}),make('div','pop-src','Source: Bird public feed'));return w;}
 function drawScooters(){scooterLayer.clearLayers();for(const v of scooterData?.items||[])L.marker([v.lat,v.lon],{icon:pinIcon(v.kind==='e-bike'?'bikerack':'scooter','pin-scooter'),title:'Bird '+v.kind,keyboard:false}).bindPopup(()=>scooterPopup(v),{className:'retro-popup',maxWidth:260}).addTo(scooterLayer);refreshCounts();}
 async function refreshScooters(force){if(!api.scooters||(!force&&!layerState.scooters))return scooterData;try{scooterData=await api.scooters();}catch{scooterData={status:'unavailable',items:[]};}drawScooters();return scooterData;}
 function scooterNote(){const box=make('p','note');const o=ends.from||origin();const set=scooterData;if(!set){box.textContent='Checking for Bird scooters…';refreshScooters(true).then(()=>{if(lastPlan)renderPlan();});return box;}if(set.status!=='live'){box.textContent='Scooter feed unavailable right now.';return box;}const list=set.items.filter(v=>v.kind==='scooter').map(v=>({v,d:meters(o.lat,o.lon,v.lat,v.lon)})).sort((a,b)=>a.d-b.d);if(!list.length){box.textContent='No Bird scooters out right now. Route assumes your own.';return box;}const n=list[0];box.textContent='Nearest Bird scooter '+dist(n.d)+' from start'+(Number.isFinite(n.v.range)?' · '+(n.v.range/1000).toFixed(1)+' km range':'')+'.';return box;}
 function viaLayer(){
  const g=L.layerGroup(),st=D.via?.stop;liveTrains.addTo(g);refreshTrains();
  if(Array.isArray(D.via?.line)&&D.via.line.length>1)L.polyline(D.via.line,{renderer:lineRenderer,color:'#ffcc00',weight:3,opacity:.9,dashArray:'10 6'}).bindTooltip('VIA Rail · The Canadian',{sticky:true}).addTo(g);
  if(st&&Number.isFinite(st.la))L.marker([st.la,st.lo],{icon:pinIcon('train','pin-via pin-move'),title:'VIA Rail station',keyboard:false}).bindPopup(()=>{const w=make('div','pop');w.append(make('b','pop-title','Saskatoon VIA Rail station'),make('div','pop-meta','The Canadian · Toronto ⇄ Vancouver'),make('div','fine','Scheduled'),trainRows(4),trainLiveLines());w.append(routeActions({lat:st.la,lon:st.lo,name:'VIA Rail station'}));w.append(make('div','pop-src','Schedule: VIA Rail'));return w;},{className:'retro-popup',maxWidth:320}).addTo(g);
  return g;
 }

 const cams=(Array.isArray(D.cams)?D.cams:[]).filter(c=>typeof c.url==='string'&&Number.isFinite(c.la));
 const camUrl=(cam,ms)=>cam.url+(cam.url.includes('?')?'&':'?')+'v='+ms;
 const every=s=>s>=3600?'every '+Math.round(s/3600)+' h':s>=120?'every '+Math.round(s/60)+' min':'every minute';
 const tv=make('section','tv'),tvBar=make('header','tv-bar'),tvTitle=make('b','tv-title'),tvSrc=make('span','tv-src'),tvPrev=button('◀','tv-btn','Previous camera'),tvNext=button('▶','tv-btn','Next camera'),tvClose=button('×','tv-btn','Close');
 const tvScreen=make('div','tv-screen'),tvImg=make('img','tv-img'),tvStatic=make('div','tv-static'),tvMsg=make('span','tv-msg');
 const tvCtl=make('footer','tv-ctl'),tvPlay=button('❚❚','tv-btn','Pause'),tvRefresh=button('⟳','tv-btn','Refresh now'),tvFull=button('⛶','tv-btn','Full screen'),tvLive=make('span','tv-live'),tvTime=make('span','tv-time mono');
 tvImg.alt='';tvImg.decoding='async';
 tvStatic.append(tvMsg);tvScreen.append(tvImg,tvStatic);tvBar.append(tvTitle,tvSrc,tvPrev,tvNext,tvClose);tvCtl.append(tvPlay,tvRefresh,tvFull,tvLive,tvTime);tv.append(tvBar,tvScreen,tvCtl);tv.hidden=true;
 tv.setAttribute('role','dialog');tv.setAttribute('aria-label','Camera');
 if(mapWrap)mapWrap.append(tv);
 const player={cam:null,playing:true,timer:0,ticker:0,loaded:0,token:0,state:'idle'};
 function tvState(state,message){player.state=state;tv.dataset.state=state;tvMsg.textContent=message||'';tvStatic.hidden=state==='ok';tvLive.textContent=state==='error'?'NO SIGNAL':player.playing?'● LIVE':'❚❚ PAUSED';}
 function tvTick(){if(!player.cam)return;if(!player.loaded){tvTime.textContent='';return;}const age=Math.max(0,Math.round((Date.now()-player.loaded)/1000));tvTime.textContent=clock(player.loaded)+' · '+(age<60?age+' s ago':Math.round(age/60)+' min ago');}
 function tvSchedule(){clearTimeout(player.timer);if(player.playing&&player.cam&&!tv.hidden)player.timer=setTimeout(tvLoad,Math.max(30,player.cam.every||60)*1000);}
 function tvLoad(){
  const cam=player.cam;if(!cam)return;const token=++player.token,probe=new Image(),ms=Date.now();let done=false;
  if(player.state!=='ok')tvState('loading','TUNING…');else tv.dataset.busy='true';
  const fail=()=>{if(done||token!==player.token)return;done=true;tv.dataset.busy='false';tvState('error','NO SIGNAL · camera is offline or not responding');tvSchedule();};
  const guard=setTimeout(fail,20000);
  probe.onload=()=>{if(done||token!==player.token)return;done=true;clearTimeout(guard);tv.dataset.busy='false';if(!probe.naturalWidth){fail();return;}tvImg.src=probe.src;tvImg.alt=cam.n;player.loaded=ms;tvState('ok');tvTick();tvSchedule();};
  probe.onerror=()=>{clearTimeout(guard);fail();};
  probe.src=camUrl(cam,ms);
 }
 function openCam(cam){
  if(!cam)return;player.cam=cam;player.loaded=0;player.playing=true;tvImg.removeAttribute('src');tvTitle.textContent=cam.n;tvSrc.textContent=cam.src+' · '+every(cam.every||60);tvPlay.textContent='❚❚';tvPlay.title='Pause';tv.hidden=false;tvState('loading','TUNING…');tvLoad();clearInterval(player.ticker);player.ticker=setInterval(tvTick,1000);
  for(const row of document.querySelectorAll('.cam-row'))row.setAttribute('aria-current',String(row.dataset.cam===cam.id));
 }
 function closeCam(){clearTimeout(player.timer);clearInterval(player.ticker);player.token++;player.cam=null;tv.hidden=true;tv.classList.remove('tv-max');if(document.fullscreenElement===tv)document.exitFullscreen().catch(()=>{});for(const row of document.querySelectorAll('.cam-row'))row.setAttribute('aria-current','false');}
 const stepCam=d=>{const i=cams.indexOf(player.cam);openCam(cams[(i+d+cams.length)%cams.length]);};
 tvPrev.addEventListener('click',()=>stepCam(-1));tvNext.addEventListener('click',()=>stepCam(1));tvClose.addEventListener('click',closeCam);
 tvPlay.addEventListener('click',()=>{player.playing=!player.playing;tvPlay.textContent=player.playing?'❚❚':'▶';tvPlay.title=player.playing?'Pause':'Play';if(player.playing)tvLoad();else clearTimeout(player.timer);tvState(player.state==='ok'?'ok':player.state,tvMsg.textContent);});
 tvRefresh.addEventListener('click',tvLoad);
 tvFull.addEventListener('click',async()=>{if(document.fullscreenElement){document.exitFullscreen().catch(()=>{});return;}if(tv.classList.contains('tv-max')){tv.classList.remove('tv-max');return;}try{await tv.requestFullscreen();}catch{tv.classList.add('tv-max');}});
 tv.addEventListener('keydown',e=>{if(e.key==='Escape'){if(tv.classList.contains('tv-max'))tv.classList.remove('tv-max');else closeCam();e.stopPropagation();}else if(e.key===' '){tvPlay.click();e.preventDefault();}else if(e.key==='ArrowRight')stepCam(1);else if(e.key==='ArrowLeft')stepCam(-1);});
 L.DomEvent.disableClickPropagation(tv);L.DomEvent.disableScrollPropagation(tv);
 function camLayer(){const g=L.layerGroup(),icon=pinIcon('cam','pin-cam pin-watch');for(const cam of cams){const m=L.marker([cam.la,cam.lo],{icon,title:cam.n,keyboard:false});m.on('click',()=>openCam(cam));m.addTo(g);markerFor.set(cam,m);}return g;}

 const LAYERS={
  buses:{label:'Buses',group:'move',on:true,show:v=>dash.setBusLayerVisible?.(v)},
  stops:{label:'Bus stops',group:'move',on:true,show:v=>dash.setStopLayerVisible?.(v)},
  bike:{label:'Bike routes',group:'move',build:bikeLayer,count:()=>(D.bike||[]).length},
  rail:{label:'Railways & crossings',group:'move',build:railLayer,count:()=>(D.rail?.crossings||[]).length},
  via:{label:'VIA Rail (live trains)',group:'move',build:viaLayer},
  scooters:{label:'Bird scooters (live)',group:'move',icon:['scooter','pin-scooter'],layer:scooterLayer,count:()=>scooterData?(scooterData.items.length||'none out'):0},
  brt:{label:'Future rapid transit',group:'move',build:brtLayer,count:()=>(D.brt||[]).length},
  closures:{label:'Road closures',group:'move',on:true,layer:closureLayer,count:()=>closureLayer.getLayers().length},
  construction:{label:'Construction',group:'move',on:true,layer:workLayer,count:()=>workLayer.getLayers().length},
  cams:{label:'Cameras',group:'watch',on:true,build:camLayer,count:()=>cams.length},
  power:{label:'Power outages',group:'watch',on:true,layer:powerLayer,count:()=>powerLayer.getLayers().length},
  parks:{label:'Parks',group:'explore',build:parksLayer,count:()=>(D.parks||[]).length},
  facilities:{label:'Leisure & hospitals',group:'explore',layer:facilityLayer,count:()=>facilityLayer.getLayers().length}
 };
 for(const[id,c]of Object.entries(CATS))LAYERS[id]={label:c.label,group:c.group,on:Boolean(c.on),icon:[c.glyph,'pin-'+id+' pin-'+c.group],build:()=>placeLayer(id),count:()=>(byCat.get(id)||[]).length};
 Object.assign(LAYERS.stops,{icon:['stop','pin-stop pin-move']});Object.assign(LAYERS.via,{icon:['train','pin-via pin-move']});Object.assign(LAYERS.brt,{icon:['brt','pin-brt pin-move']});Object.assign(LAYERS.cams,{icon:['cam','pin-cam pin-watch']});Object.assign(LAYERS.parks,{icon:['tree','pin-park pin-explore']});Object.assign(LAYERS.facilities,{icon:['rec','pin-facility pin-explore']});
 const GROUPS=[['move','Getting around'],['parkgrp','Parking'],['essentials','Essentials'],['errands','Errands'],['shops','Liquor, cannabis & vape'],['explore','Explore'],['watch','Watch']];
 const layerState=Object.assign(Object.fromEntries(Object.entries(LAYERS).map(([k,v])=>[k,Boolean(v.on)])),saved('layers',{}));
 function setLayer(id,on){
  const spec=LAYERS[id];if(!spec)return;layerState[id]=Boolean(on);save('layers',layerState);
  if(spec.show)spec.show(Boolean(on)&&(id!=='stops'||map.getZoom()>=14));
  else{if(!spec.layer&&on&&spec.build)spec.layer=spec.build();if(spec.layer){if(on)spec.layer.addTo(map);else map.removeLayer(spec.layer);}}
  const box=document.getElementById('layer-'+id);if(box)box.checked=Boolean(on);
  if(on&&id==='scooters')refreshScooters(true);
 }
 const ensureLayer=id=>{if(!layerState[id])setLayer(id,true);};

 const picker=L.control({position:'topright'});
 let pickerBox=null;
 picker.onAdd=()=>{
  const root=L.DomUtil.create('div','layer-picker');
  const toggle=button('layers ▾','picker-toggle','Map layers');toggle.setAttribute('aria-expanded','false');
  const box=make('div','picker-box');box.hidden=true;pickerBox=box;
  const bases=make('fieldset','picker-group');bases.append(make('legend','','Map style'));const baseGrid=make('div','picker-grid');
  for(const[id,label]of BASEMAPS){const l=make('label'),i=make('input');i.type='radio';i.name='basemap';i.value=id;i.addEventListener('change',()=>setBasemap(id,false));l.append(i,' '+label);baseGrid.append(l);}
  bases.append(baseGrid);box.append(bases);
  for(const[gid,glabel]of GROUPS){
   const f=make('fieldset','picker-group'),legend=make('legend','',glabel),all=button('all','linkish','Show all '+glabel),none=button('none','linkish','Hide all '+glabel);legend.append(' ',all,' / ',none);f.append(legend);const grid=make('div','picker-grid');
   const ids=Object.entries(LAYERS).filter(([,v])=>v.group===gid).map(([k])=>k);
   for(const id of ids){const spec=LAYERS[id],l=make('label'),i=make('input');i.type='checkbox';i.id='layer-'+id;i.checked=layerState[id];i.addEventListener('change',()=>setLayer(id,i.checked));l.append(i);if(spec.icon)l.append(' ',icoEl(spec.icon[0],spec.icon[1]));l.append(' '+spec.label);const n=spec.count?.();if(n)l.append(make('small','',' '+n));grid.append(l);}
   all.addEventListener('click',()=>ids.forEach(id=>setLayer(id,true)));none.addEventListener('click',()=>ids.forEach(id=>setLayer(id,false)));
   f.append(grid);box.append(f);
  }
  toggle.addEventListener('click',()=>{box.hidden=!box.hidden;toggle.setAttribute('aria-expanded',String(!box.hidden));if(!box.hidden)refreshCounts();});
  root.append(toggle,box);L.DomEvent.disableClickPropagation(root);L.DomEvent.disableScrollPropagation(root);
  return root;
 };
 picker.addTo(map);
 function refreshCounts(){if(!pickerBox)return;for(const[id,spec]of Object.entries(LAYERS)){const input=document.getElementById('layer-'+id);if(!input||!spec.count)continue;const label=input.parentElement;let small=label.querySelector('small');const n=spec.count();if(!small){small=make('small');label.append(small);}small.textContent=n?' '+n:'';}}
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&pickerBox&&!pickerBox.hidden){pickerBox.hidden=true;document.querySelector('.picker-toggle')?.setAttribute('aria-expanded','false');}});
 map.on('click',()=>{if(pickerBox&&!pickerBox.hidden){pickerBox.hidden=true;document.querySelector('.picker-toggle')?.setAttribute('aria-expanded','false');}});

 let mapStops=[],routeColors=new Map(),searchDirty=true,searchIndex=[];
 const contrast=hex=>{const m=/^#?([0-9a-f]{6})$/i.exec(hex||'');if(!m)return'#fff';const n=parseInt(m[1],16),r=n>>16&255,g=n>>8&255,b=n&255;return(r*299+g*587+b*114)/1000>150?'#000':'#fff';};
 function chip(short,color,cls){const c=make('span','route-chip'+(cls?' '+cls:''),short||'?');if(color){c.style.background=color;c.style.color=contrast(color);}return c;}
 const fold=t=>String(t||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\bu of s\b/g,'university of saskatchewan').replace(/[’'.]/g,'');
 function buildIndex(){
  if(!searchDirty)return searchIndex;searchDirty=false;
  const list=[];
  for(const p of places)list.push({kind:p.c,name:p.n||CATS[p.c].label,sub:(p.c==='parking'?IO_LABEL[p.i||'unknown']+(p.i==='unknown'?'':' parking'):CATS[p.c].label)+(p.a?' · '+p.a:''),la:p.la,lo:p.lo,hours:p.h,ref:p,text:fold([p.n,CATS[p.c].label,p.a,p.k,p.b,p.x].filter(Boolean).join(' '))});
  for(const s of mapStops)if(Number.isFinite(s.latitude)&&s.locationType!==1)list.push({kind:'stop',name:s.name,sub:'Bus stop'+(s.code?' #'+s.code:''),la:s.latitude,lo:s.longitude,ref:s,text:fold(s.name+' stop bus '+(s.code||''))});
  for(const c of cams)list.push({kind:'cam',name:c.n,sub:'Camera · '+c.src,la:c.la,lo:c.lo,ref:c,text:fold(c.n+' camera cam '+c.src)});
  for(const p of parkList)list.push({kind:'park',name:p.n,sub:'Park'+(p.sub&&p.sub!=='Park'?' · '+p.sub:''),la:p.la,lo:p.lo,ref:p,text:fold(p.n+' park '+p.sub)});
  for(const f of facilities)list.push({kind:f.kind,name:f.n,sub:f.sub,la:f.la,lo:f.lo,ref:f,text:fold(f.n+' '+f.sub)});
  if(D.via?.stop)list.push({kind:'via',name:'VIA Rail station',sub:'Train station · The Canadian',la:D.via.stop.la,lo:D.via.stop.lo,ref:D.via.stop,text:'via rail train station canadian'});
  searchIndex=list;return list;
 }
 function query(text,{kinds=null,openNow=false,sort='near',limit=150,pred=null}={}){
  const words=fold(text).split(/[^a-z0-9#]+/).filter(Boolean);
  const hit=(hay,w)=>hay.startsWith(w)||hay.includes(' '+w)||(w.length>3&&hay.includes(w));
  let list=buildIndex().filter(e=>(!kinds||kinds.has(e.kind))&&words.every(w=>hit(e.text,w)));
  if(openNow)list=list.filter(e=>e.hours&&hoursState(e.hours)?.open);
  if(pred)list=list.filter(pred);
  const o=origin();
  for(const e of list)e.d=meters(o.lat,o.lon,e.la,e.lo);
  if(words.length&&sort!=='az'){const q=words.join(' '),score=e=>{const n=e.fold||(e.fold=fold(e.name));return(n.startsWith(q)?0:4)+words.filter(w=>!hit(n,w)).length;};list.sort((a,b)=>score(a)-score(b)||a.d-b.d);}
  else if(sort==='az')list.sort((a,b)=>a.name.localeCompare(b.name));
  else list.sort((a,b)=>a.d-b.d);
  return list.slice(0,limit);
 }
 const KIND_GLYPH=Object.assign(Object.fromEntries(Object.entries(CATS).map(([k,v])=>[k,[v.glyph,'pin-'+k+' pin-'+v.group]])),{stop:['stop','pin-stop pin-move'],cam:['cam','pin-cam pin-watch'],park:['tree','pin-park pin-explore'],facility:['rec','pin-facility pin-explore'],hospital:['hospital','pin-hospital'],via:['train','pin-via pin-move']});
 function focus(e){
  const r=e.ref;
  if(e.kind==='stop'){dash.selectStop?.(r.id);show('bus');return;}
  if(e.kind==='cam'){ensureLayer('cams');map.setView([e.la,e.lo],Math.max(map.getZoom(),11));openCam(r);return;}
  if(e.kind==='park'){ensureLayer('parks');map.setView([e.la,e.lo],16);return;}
  if(e.kind==='via'){ensureLayer('via');map.setView([e.la,e.lo],15);const g=LAYERS.via.layer;g?.eachLayer(l=>{if(l instanceof L.Marker)l.openPopup();});return;}
  if(e.kind==='facility'||e.kind==='hospital')ensureLayer('facilities');else if(CATS[e.kind])ensureLayer(e.kind);
  const m=markerFor.get(r);map.setView([e.la,e.lo],Math.max(map.getZoom(),16));if(m)setTimeout(()=>m.openPopup(),60);
 }
 function row(e){
  const b=make('button','place-row');b.type='button';const[glyph,cls]=CATS[e.kind]&&e.ref?pinKind(e.ref):KIND_GLYPH[e.kind]||['dot',''];
  const pin=icoEl(glyph,cls);
  const copy=make('span','place-copy');copy.append(make('span','place-name',e.name));
  const meta=make('span','place-meta',e.sub);copy.append(meta);
  const right=make('span','place-side');right.append(make('span','mono',dist(e.d)));
  if(e.hours){const st=hoursState(e.hours);if(st)right.append(make('span',st.open?'is-open':'is-closed',st.open?'open':'closed'));}
  b.append(pin,copy,right);b.addEventListener('click',()=>focus(e));return b;
 }
 function renderRows(box,list,empty){box.replaceChildren();if(!list.length){box.append(make('p','muted',empty||'Nothing found.'));return;}const frag=document.createDocumentFragment();for(const e of list)frag.append(row(e));box.append(frag);}
 const hereLabel=()=>here?(here.label||'your spot'):'the map centre';

 const placesPane=panes.get('places');
 const pSearch=make('input','field');pSearch.type='search';pSearch.placeholder='search everything…';pSearch.setAttribute('aria-label','Search places');pSearch.maxLength=80;
 const pChips=make('div','chips'),pOpen=make('label','check'),pOpenBox=make('input'),pSort=make('select','field small');pOpenBox.type='checkbox';pOpen.append(pOpenBox,' open now');
 for(const[v,l]of[['near','nearest'],['az','A–Z']]){const o=make('option','',l);o.value=v;pSort.append(o);}
 pSort.setAttribute('aria-label','Sort');
 const pTools=make('div','row-tools');pTools.append(pOpen,make('span','spacer'),pSort);
 const pCount=make('p','muted count'),pList=make('div','place-list');
 const chipKinds=new Set();
 const CHIP_SETS=[['all','all',null],['wc','washrooms',['wc','wcg']],['wifi','wi-fi',['wifi']],['food','late food',['late','open247']],['rx','pharmacy',['rx']],['water','water',['water']],['money','atm',['atm']],['mail','mail',['mail','cmb','post']],['park','parking',['parking','meter','load']],['gas','gas',['gas','ev']],['shops','liquor / weed / vape',['liquor','cannabis','vape']],['help','help',['help']],['see','sights',['art','wiki','view','park']],['fun','rec',['facility','hospital','lib']],['more','bikes / coach / more',['coach','bikerack','bikefix','laundry','recycle','phone']],['bus','stops',['stop']],['cam','cams',['cam']]];
 let chipSel='all';
 for(const[id,label]of CHIP_SETS){const c=button(label,'chip');c.dataset.chip=id;c.setAttribute('aria-pressed',String(id==='all'));c.addEventListener('click',()=>{chipSel=id;for(const x of pChips.children)x.setAttribute('aria-pressed',String(x.dataset.chip===id));renderPlaces();});pChips.append(c);}
 const pIO=make('div','chips io-chips');pIO.setAttribute('aria-label','Parking type');
 for(const[v,l]of[['any','any'],['indoor','indoor / covered'],['outdoor','outdoor'],['unknown','unknown']]){const c=button(l,'chip');c.dataset.io=v;c.setAttribute('aria-pressed',String(v===parkIO));c.addEventListener('click',()=>setParkIO(v));pIO.append(c);}
 function setParkIO(v){parkIO=v;save('parkIO',v);for(const x of pIO.children)x.setAttribute('aria-pressed',String(x.dataset.io===v));const spec=LAYERS.parking;if(spec?.layer){const on=map.hasLayer(spec.layer);map.removeLayer(spec.layer);spec.layer=null;if(on)setLayer('parking',true);}renderPlaces();}
 placesPane.append(head('Places'),pSearch,pChips,pIO,pTools,pCount,pList);
 function renderPlaces(){const set=CHIP_SETS.find(c=>c[0]===chipSel)?.[2];pIO.hidden=chipSel!=='park';const list=query(pSearch.value,{kinds:set?new Set(set):null,openNow:pOpenBox.checked,sort:pSort.value,limit:200,pred:chipSel==='park'&&parkIO!=='any'?e=>e.kind==='parking'&&ioMatch(e.ref):null});if(chipSel==='park')ensureLayer('parking');pCount.textContent=list.length+(list.length===200?'+':'')+' near '+hereLabel();renderRows(pList,list,'Nothing matches. Try fewer words.');}
 let pTimer=0;pSearch.addEventListener('input',()=>{clearTimeout(pTimer);pTimer=setTimeout(renderPlaces,120);});pOpenBox.addEventListener('change',renderPlaces);pSort.addEventListener('change',renderPlaces);
 paneOpen.set('places',renderPlaces);

 const mailPane=panes.get('mail'),mailSearch=make('input','field'),mailChips=make('div','chips'),mailCount=make('p','muted count'),mailList=make('div','place-list');
 mailSearch.type='search';mailSearch.placeholder='street, corner or post office…';mailSearch.setAttribute('aria-label','Find mailboxes');mailSearch.maxLength=80;
 const mailKinds=[['all','all',['mail','cmb','post']],['street','street boxes',['mail']],['community','community boxes',['cmb']],['counter','post offices',['post']]];let mailKind='all';
 const mailNote=make('p','fine','Community boxes have outgoing letter slots. Collection times only where listed.');
 for(const[id,label]of mailKinds){const b=button(label,'chip');b.dataset.mail=id;b.setAttribute('aria-pressed',String(id===mailKind));b.addEventListener('click',()=>{mailKind=id;for(const x of mailChips.children)x.setAttribute('aria-pressed',String(x.dataset.mail===id));renderMail();});mailChips.append(b);}
 mailPane.append(head('Mail'),mailSearch,mailChips,make('p','fine',(byCat.get('mail')||[]).length+' street boxes · '+(byCat.get('cmb')||[]).length+' community box sites · '+(byCat.get('post')||[]).length+' counters'),mailCount,mailList,mailNote);
 function renderMail(){const kinds=mailKinds.find(x=>x[0]===mailKind)[2],list=query(mailSearch.value,{kinds:new Set(kinds),limit:200});mailCount.textContent=list.length+(list.length===200?'+':'')+' near '+hereLabel();renderRows(mailList,list,'No mailboxes match. Try a street name.');}
 mailSearch.addEventListener('input',renderMail);paneOpen.set('mail',renderMail);

 const wifiPane=panes.get('wifi');
 const wSearch=make('input','field');wSearch.type='search';wSearch.placeholder='filter wi-fi spots…';wSearch.setAttribute('aria-label','Filter Wi-Fi spots');wSearch.maxLength=60;
 const wOpen=make('label','check'),wOpenBox=make('input');wOpenBox.type='checkbox';wOpen.append(wOpenBox,' open now');
 const wKind=make('select','field small');for(const[v,l]of[['all','all spots'],['library','libraries'],['listed','listed on the map'],['chain','chain restaurants']]){const o=make('option','',l);o.value=v;wKind.append(o);}wKind.setAttribute('aria-label','Kind of spot');
 const wTools=make('div','row-tools');wTools.append(wOpen,make('span','spacer'),wKind);
 const wCount=make('p','muted count'),wList=make('div','place-list');
 const wNote=make('p','fine','Chain spots are listed because the chain offers free guest Wi-Fi; a few locations may not. Library Wi-Fi runs during opening hours.');
 wifiPane.append(head('Free Wi-Fi'),wSearch,wTools,wCount,wList,wNote);
 function renderWifi(){const kind=wKind.value;let list=query(wSearch.value,{kinds:new Set(['wifi']),openNow:wOpenBox.checked,limit:500});list=list.filter(e=>kind==='all'||(kind==='library'?(e.ref.s==='spl'||/librar/i.test(e.name)):kind==='chain'?/Chain/.test(e.ref.k||''):!/Chain/.test(e.ref.k||'')&&e.ref.s!=='spl'));wCount.textContent=list.length+' spots · nearest to '+hereLabel();renderRows(wList,list,'No Wi-Fi spots match.');if(!layerState.wifi)setLayer('wifi',true);}
 let wTimer=0;wSearch.addEventListener('input',()=>{clearTimeout(wTimer);wTimer=setTimeout(renderWifi,120);});wOpenBox.addEventListener('change',renderWifi);wKind.addEventListener('change',renderWifi);
 paneOpen.set('wifi',renderWifi);

 const camsPane=panes.get('cams'),camList=make('div','cam-list');
 camsPane.append(head('Cameras'),camList,(()=>{return make('p','fine','Still images that refresh on their own. Highway Hotline, a community webcam and PhenoCam.');})());
 let camsBuilt=false;
 function renderCams(){
  const o=origin();
  const list=cams.slice().sort((a,b)=>meters(o.lat,o.lon,a.la,a.lo)-meters(o.lat,o.lon,b.la,b.lo));
  if(!camsBuilt){camsBuilt=true;}
  camList.replaceChildren();
  const bucket=Math.floor(Date.now()/120000)*120000;
  for(const cam of list){
   const b=make('button','cam-row');b.type='button';b.dataset.cam=cam.id;b.setAttribute('aria-current',String(player.cam===cam));
   const thumb=make('span','cam-thumb'),img=make('img');img.loading='lazy';img.alt='';img.src=camUrl(cam,bucket);img.addEventListener('error',()=>thumb.classList.add('dead'),{once:true});thumb.append(img);
   const copy=make('span','place-copy');copy.append(make('span','place-name',cam.n),make('span','place-meta',cam.src+' · '+every(cam.every||60)+' · '+dist(meters(o.lat,o.lon,cam.la,cam.lo))));
   b.append(thumb,copy);b.addEventListener('click',()=>{ensureLayer('cams');openCam(cam);});camList.append(b);
  }
 }
 paneOpen.set('cams',renderCams);

 const tripLayer=L.layerGroup().addTo(map),hereLayer=L.layerGroup().addTo(map);
 let pickTarget=null;
 const inArea=(lat,lon)=>Math.abs(lat-52.13)<0.6&&Math.abs(lon+106.67)<0.9;
 function drawHere(){hereLayer.clearLayers();if(here)L.marker([here.lat,here.lon],{icon:L.divIcon({className:'you-are-here',html:'<span></span>',iconSize:[18,18],iconAnchor:[9,9]}),title:'You are here',keyboard:false,zIndexOffset:900}).addTo(hereLayer);}
 function setHere(spot){here=spot?{lat:spot.lat,lon:spot.lon,label:spot.label||'your spot'}:null;save('here',here);drawHere();if(current&&paneOpen.has(current))paneOpen.get(current)();}
 function startPick(target,message){pickTarget=target;mapWrap?.classList.add('picking');if(mapNotice){mapNotice.textContent=message||'Click the map to pick a spot. Esc cancels.';mapNotice.hidden=false;}}
 function endPick(){pickTarget=null;mapWrap?.classList.remove('picking');if(mapNotice&&/^Click the map/.test(mapNotice.textContent))mapNotice.hidden=true;}
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&pickTarget)endPick();});
 map.on('click',e=>{if(!pickTarget)return;const spot={lat:e.latlng.lat,lon:e.latlng.lng};const target=pickTarget;endPick();if(target==='here')setHere({...spot,label:'picked spot'});else{setEndpoint(target,{...spot,name:'Point on map'});planIfReady();}});
 map.on('contextmenu',e=>{const spot={lat:e.latlng.lat,lon:e.latlng.lng},w=make('div','pop'),r=make('div','pop-actions'),mine=button('near here','btn');w.append(make('b','pop-title',spot.lat.toFixed(5)+', '+spot.lon.toFixed(5)));mine.addEventListener('click',()=>{map.closePopup();setHere({...spot,label:'picked spot'});show('near');});r.append(mine);w.append(routeActions({...spot,name:'Point on map'}),r);L.popup({className:'retro-popup'}).setLatLng(e.latlng).setContent(w).openOn(map);});
 function locate(after){
  const done=message=>{nearStatus.textContent=message;};
  if(!navigator.geolocation){done('Location isn’t available here. Pick a spot on the map.');return;}
  done('Finding you…');
  navigator.geolocation.getCurrentPosition(pos=>{const{latitude:lat,longitude:lon}=pos.coords;if(!inArea(lat,lon)){done('You look to be outside Saskatoon. Pick a spot on the map.');return;}setHere({lat,lon,label:'your location'});map.setView([lat,lon],Math.max(map.getZoom(),15));done('');after?.();},()=>done('Couldn’t find you. Pick a spot on the map instead.'),{enableHighAccuracy:true,timeout:12000,maximumAge:60000});
 }

 const nearPane=panes.get('near'),nearHead=head('Near the map centre'),nearTools=make('div','row-tools'),findMe=button('find me','btn'),pickSpot=button('pick on map','btn'),useCentre=button('use map centre','btn'),nearStatus=make('p','muted status');
 nearStatus.setAttribute('role','status');
 nearTools.append(findMe,pickSpot,useCentre);
 const busHead=make('h3','sub-head','Next buses'),busBox=make('div','next-buses'),closeHead=make('h3','sub-head','Closest'),closeBox=make('div','place-list');
 nearPane.append(nearHead,nearTools,nearStatus,busHead,busBox,closeHead,closeBox);
 findMe.addEventListener('click',()=>locate());pickSpot.addEventListener('click',()=>startPick('here'));useCentre.addEventListener('click',()=>{const c=map.getCenter();setHere({lat:c.lat,lon:c.lng,label:'map centre spot'});});
 const CLOSEST=['wc','wcg','wifi','late','open247','rx','water','atm','mail','cmb','post','gas','help'];
 let nearToken=0,nearTimer=0;
 async function renderNear(){
  const token=++nearToken,o=origin();
  nearHead.textContent='Near '+hereLabel();
  const picks=[];
  for(const cat of CLOSEST){const list=(byCat.get(cat)||[]).map(p=>({p,d:meters(o.lat,o.lon,p.la,p.lo)})).sort((a,b)=>a.d-b.d);if(!list.length)continue;const open=cat==='late'?list.find(x=>hoursState(x.p.h)?.open):null;const best=open||list[0];picks.push({kind:cat,name:best.p.n||CATS[cat].label,sub:CATS[cat].label+(best.p.a?' · '+best.p.a:''),la:best.p.la,lo:best.p.lo,hours:best.p.h,ref:best.p,d:best.d});}
  renderRows(closeBox,picks);
  clearTimeout(nearTimer);nearTimer=setTimeout(()=>{if(current==='near')renderNear();},30000);
  if(!mapStops.length)await loadStops();
  if(token!==nearToken)return;
  const near=mapStops.filter(s=>s.locationType!==1&&Number.isFinite(s.latitude)).map(s=>({s,d:meters(o.lat,o.lon,s.latitude,s.longitude)})).sort((a,b)=>a.d-b.d).slice(0,4).filter((x,i)=>i===0||x.d<900);
  if(!near.length){busBox.replaceChildren(make('p','muted','No stops nearby.'));return;}
  if(!api.departures){busBox.replaceChildren(make('p','muted','Bus times aren’t available.'));return;}
  const blocks=await Promise.all(near.map(async({s,d})=>{let res=null;try{res=await api.departures(s.id);}catch{res=null;}return{s,d,res};}));
  if(token!==nearToken)return;
  busBox.replaceChildren();
  for(const{s,d,res}of blocks){
   const box=make('div','stop-block'),top=make('button','stop-top');top.type='button';
   top.append(make('b','',s.name),make('span','mono muted',' '+dist(d)+' · '+Math.max(1,Math.round(d/75))+' min walk'));
   top.addEventListener('click',()=>{dash.selectStop?.(s.id);show('bus');});
   box.append(top);
   const deps=(res?.departures||[]).filter(x=>x.status!=='cancelled'&&x.status!=='skipped').slice(0,3);
   if(!deps.length)box.append(make('div','muted dep-line',res?.clockAvailable===false?'Setting clock…':'No buses soon'));
   for(const x of deps){const line=make('div','dep-line'),time=x.expectedTime??x.scheduledTime;line.append(chip(x.routeShortName,routeColors.get(x.routeId)),make('span','dep-sign',x.headsign||x.routeLongName||''),make('span','mono dep-when',(Number.isFinite(x.minutesAway)&&x.minutesAway<60?(x.minutesAway<1?'now':Math.ceil(x.minutesAway)+' min'):clock(time))));if(x.realtime)line.append(make('span','live-dot','●'));line.title=(x.realtime?'Live · ':'Scheduled · ')+clock(time);box.append(line);}
   busBox.append(box);
  }
 }
 paneOpen.set('near',renderNear);
 async function loadStops(){if(!api.mapStops)return;try{const list=await api.mapStops();if(Array.isArray(list)&&list.length){mapStops=list;searchDirty=true;}}catch{}}
 async function loadRoutes(){if(!api.routes)return;try{for(const r of await api.routes())if(r?.id)routeColors.set(r.id,r.color?(r.color.startsWith('#')?r.color:'#'+r.color):null);}catch{}}

 const routePane=panes.get('route'),form=make('form','planner'),ends={from:null,to:null},endInputs={},endMarkers={};
 form.noValidate=true;
 function endpointField(which,label){
  const wrap=make('div','ep'),lab=make('label','ep-label',label),input=make('input','field'),me=button('me','btn small','Use my location'),pick=button('map','btn small','Pick on the map'),sug=make('div','suggest');
  input.type='search';input.id='plan-'+which;lab.htmlFor=input.id;input.placeholder=which==='from'?'start: place, stop or address':'destination';input.autocomplete='off';input.maxLength=80;sug.hidden=true;sug.setAttribute('role','listbox');
  let items=[],active=-1;
  const choose=e=>{sug.hidden=true;if(!e)return;setEndpoint(which,e.here?{lat:here.lat,lon:here.lon,name:'My location'}:{lat:e.la,lon:e.lo,name:e.name});planIfReady();};
  const paint=()=>{sug.replaceChildren();items.forEach((e,i)=>{const b=make('button','sug'+(i===active?' active':''));b.type='button';b.setAttribute('role','option');const[g,cls]=e.here?['◎','pin-here']:(KIND_GLYPH[e.kind]||['•','']);const pin=make('span','pin pin-inline '+cls);pin.append(make('span','',g));b.append(pin,make('span','place-name',e.name),make('span','place-meta',e.sub||''));b.addEventListener('mousedown',ev=>{ev.preventDefault();choose(e);});sug.append(b);});sug.hidden=!items.length;};
  input.addEventListener('input',()=>{ends[which]=null;drawEnds();const text=input.value.trim(),coords=/^(-?\d{1,2}\.\d+)\s*,\s*(-?\d{2,3}\.\d+)$/.exec(text);items=[];if(here&&(!text||'my location'.startsWith(text.toLowerCase())))items.push({here:true,name:'My location',sub:hereLabel()});if(coords&&inArea(Number(coords[1]),Number(coords[2])))items.push({kind:'pin',name:text,sub:'Coordinates',la:Number(coords[1]),lo:Number(coords[2])});if(text.length>1)items.push(...query(text,{limit:7}));active=items.length?0:-1;paint();});
  input.addEventListener('keydown',e=>{if(sug.hidden)return;if(e.key==='ArrowDown'||e.key==='ArrowUp'){active=(active+(e.key==='ArrowDown'?1:items.length-1))%items.length;paint();e.preventDefault();}else if(e.key==='Enter'){choose(items[active]);e.preventDefault();}else if(e.key==='Escape'){sug.hidden=true;e.stopPropagation();}});
  input.addEventListener('blur',()=>setTimeout(()=>{sug.hidden=true;},120));
  input.addEventListener('focus',()=>{if(!input.value&&here){items=[{here:true,name:'My location',sub:hereLabel()}];active=0;paint();}});
  me.addEventListener('click',()=>{if(here){setEndpoint(which,{lat:here.lat,lon:here.lon,name:'My location'});planIfReady();}else locate(()=>{setEndpoint(which,{lat:here.lat,lon:here.lon,name:'My location'});planIfReady();});});
  pick.addEventListener('click',()=>startPick(which,'Click the map to set the '+(which==='from'?'start':'destination')+'. Esc cancels.'));
  const line=make('div','ep-line');line.append(input,me,pick);wrap.append(lab,line,sug);endInputs[which]=input;return wrap;
 }
 const fromField=endpointField('from','from'),toField=endpointField('to','to'),swap=button('⇅ swap','linkish','Swap start and destination');
 swap.addEventListener('click',()=>{const a=ends.from,b=ends.to;setEndpoint('from',b);setEndpoint('to',a);planIfReady();});
 const MODES=[['transit','bus + walk'],['walk','walk'],['bike','bike'],['scooter','scooter'],['drive','drive']];
 let mode=saved('mode','transit');if(!MODES.some(m=>m[0]===mode))mode='transit';
 const modeRow=make('div','chips modes');modeRow.setAttribute('role','radiogroup');modeRow.setAttribute('aria-label','Travel by');
 for(const[id,label]of MODES){const c=button(label,'chip');c.dataset.mode=id;c.setAttribute('role','radio');c.setAttribute('aria-checked',String(id===mode));c.addEventListener('click',()=>{mode=id;save('mode',id);for(const x of modeRow.children)x.setAttribute('aria-checked',String(x.dataset.mode===id));transitOnly.hidden=id!=='transit';planIfReady();});modeRow.append(c);}
 const whenSel=make('select','field small'),whenAt=make('input','field small');
 for(const[v,l]of[['now','leave now'],['depart','leave at'],['arrive','arrive by']]){const o=make('option','',l);o.value=v;whenSel.append(o);}
 whenSel.setAttribute('aria-label','When');whenAt.type='datetime-local';whenAt.setAttribute('aria-label','Time');whenAt.hidden=true;
 const localInput=ms=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(ms).map(x=>[x.type,x.value]));return p.year+'-'+p.month+'-'+p.day+'T'+p.hour+':'+p.minute;};
 const fromInput=v=>{const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v||'');return m?Date.UTC(+m[1],+m[2]-1,+m[3],+m[4]+6,+m[5]):NaN;};
 whenSel.addEventListener('change',()=>{whenAt.hidden=whenSel.value==='now';if(!whenAt.hidden&&!whenAt.value)whenAt.value=localInput(Date.now()+(whenSel.value==='arrive'?3600000:0));});
 const walkSel=make('select','field small');for(const m of[400,600,900,1200,1600,2400]){const o=make('option','',(m<1000?m+' m':(m/1000)+' km')+' max walk');o.value=String(m);walkSel.append(o);}walkSel.value=String(saved('maxWalk',900));walkSel.setAttribute('aria-label','Longest walk');walkSel.addEventListener('change',()=>save('maxWalk',Number(walkSel.value)));
 const transitOnly=make('span','');transitOnly.append(walkSel);transitOnly.hidden=mode!=='transit';
 const whenRow=make('div','row-tools'),go=make('button','btn go','go');go.type='submit';whenRow.append(whenSel,whenAt,transitOnly,make('span','spacer'),go);
 const swapRow=make('div','swap-row');swapRow.append(swap);
 form.append(fromField,swapRow,toField,modeRow,whenRow);
 const planOut=make('div','plan-out');planOut.setAttribute('aria-live','polite');
 routePane.append(head('Route'),form,planOut);
 form.addEventListener('submit',e=>{e.preventDefault();runPlan();});
 function drawEnds(){for(const k of['from','to']){if(endMarkers[k]){map.removeLayer(endMarkers[k]);endMarkers[k]=null;}const p=ends[k];if(p)endMarkers[k]=L.marker([p.lat,p.lon],{icon:L.divIcon({className:'trip-end trip-'+k,html:'<span>'+(k==='from'?'A':'B')+'</span>',iconSize:[20,20],iconAnchor:[10,10]}),title:p.name,keyboard:false,zIndexOffset:1000}).addTo(map);}}
 function setEndpoint(which,p){ends[which]=p&&Number.isFinite(p.lat)?{lat:p.lat,lon:p.lon,name:(p.name||'Point on map').slice(0,80)}:null;if(endInputs[which]){endInputs[which].value=ends[which]?.name||'';const box=endInputs[which].closest('.ep')?.querySelector('.suggest');if(box)box.hidden=true;}drawEnds();}
 let planTimer=0;function planIfReady(){clearTimeout(planTimer);if(ends.from&&ends.to)planTimer=setTimeout(runPlan,80);}
 let planToken=0,lastPlan=null,selected=0;
 const VERB={walk:'Walk',bike:'Ride',scooter:'Scoot',drive:'Drive'};
 async function runPlan(){
  if(!ends.from||!ends.to){planOut.replaceChildren(make('p','muted','Pick a start and a destination.'));return;}
  if(!api.plan){planOut.replaceChildren(make('p','muted','Trip planning isn’t available.'));return;}
  const req={from:ends.from,to:ends.to,mode,when:whenSel.value,maxWalk:Number(walkSel.value)||900};
  if(req.when!=='now'){const t=fromInput(whenAt.value);if(!Number.isFinite(t)){planOut.replaceChildren(make('p','is-closed','Pick a time.'));return;}req.time=t;}
  const token=++planToken;planOut.replaceChildren(make('p','muted blink','Working out routes…'));
  let res;try{res=await api.plan(req);}catch{res={status:'error',message:'Couldn’t plan that trip. Try again.',options:[]};}
  if(token!==planToken)return;
  lastPlan=res;selected=0;renderPlan();
 }
 function renderPlan(){
  const res=lastPlan;planOut.replaceChildren();tripLayer.clearLayers();
  if(!res||res.status!=='ok'||!res.options?.length){planOut.append(make('p','is-closed',res?.message||'No routes found. Try a longer walk or another time.'));return;}
  if(res.note)planOut.append(make('p','note',res.note));
  if(res.options[0]?.mode==='scooter')planOut.append(scooterNote());
  res.options.forEach((o,i)=>{
   const card=make('article','option'+(i===selected?' open':'')),sum=make('button','option-sum');sum.type='button';sum.setAttribute('aria-expanded',String(i===selected));
   const times=make('span','mono option-times',clock(o.depart)+' → '+clock(o.arrive)),dur=make('b','option-dur',mins(o.duration));
   const legsLine=make('span','option-legs');
   o.legs.forEach((l,k)=>{if(k)legsLine.append(make('span','sep','›'));if(l.type==='bus')legsLine.append(chip(l.route?.shortName,l.route?.color));else legsLine.append(make('span','leg-word',(l.type==='walk'?'walk ':l.type+' ')+dist(l.distance)));});
   const meta=make('span','option-meta',o.mode==='transit'?(o.transfers?o.transfers+' transfer'+(o.transfers>1?'s':''):'no transfers')+' · '+dist(o.walkMeters)+' walking':dist(o.legs[0]?.distance));
   const head2=make('span','option-head');head2.append(times,dur);sum.append(head2,legsLine,meta);
   sum.addEventListener('click',()=>{selected=i;renderPlan();});
   card.append(sum);
   if(i===selected)card.append(legView(o));
   planOut.append(card);
  });
  planOut.append(make('p','fine','Bus times use the schedule plus live delays when buses report them. Leave a few minutes for tight transfers.'));
  drawOption(res.options[selected]);
 }
 function legView(o){
  const list=make('ol','legs');
  for(const leg of o.legs){
   const li=make('li','leg leg-'+leg.type),t=make('span','leg-time mono',clock(leg.depart)),body=make('div','leg-body');
   if(leg.type==='bus'){
    const title=make('div','leg-title');title.append(chip(leg.route?.shortName,leg.route?.color),' ',make('b','',leg.headsign||leg.route?.longName||'Bus'));
    body.append(title,make('div','','Board at '+leg.from.name+(leg.from.code?' · #'+leg.from.code:'')),make('div','','Ride '+leg.stops+' stop'+(leg.stops===1?'':'s')+', get off at '+leg.to.name+' · '+clock(leg.arrive)));
    if(leg.live&&Number.isFinite(leg.delayMin))body.append(make('div',Math.abs(leg.delayMin)<=1?'is-open':'is-closed',leg.delayMin>1?'Running '+leg.delayMin+' min late':leg.delayMin<-1?'Running '+(-leg.delayMin)+' min early':'On time'));
    if(Array.isArray(leg.stopNames)&&leg.stopNames.length>2){const d=make('details','steps'),s=make('summary','','stops');d.append(s);const ol=make('ol');for(const n of leg.stopNames)ol.append(make('li','',n));d.append(ol);body.append(d);}
   }else{
    const secs=Math.max(60,(leg.arrive-leg.depart)/1000);
    body.append(make('div','leg-title',VERB[leg.type]+' '+dist(leg.distance)+' · '+mins(secs)+(leg.to?.name&&leg.to.name!=='Destination'?' to '+leg.to.name:'')));
    if(Array.isArray(leg.steps)&&leg.steps.length){const d=make('details','steps'),s=make('summary','','directions');d.open=o.legs.length===1;d.append(s);const ol=make('ol');for(const st of leg.steps)ol.append(make('li','',st.text+(st.distance?' · '+dist(st.distance):'')));d.append(ol);body.append(d);}
   }
   li.append(t,body);list.append(li);
  }
  const end=make('li','leg leg-end');end.append(make('span','leg-time mono',clock(o.arrive)),make('div','leg-body','Arrive · '+(ends.to?.name||'destination')));list.append(end);
  return list;
 }
 function drawOption(o){
  tripLayer.clearLayers();if(!o)return;const bounds=L.latLngBounds([]);
  for(const leg of o.legs){
   const pts=(leg.path||[]).filter(p=>Array.isArray(p)&&Number.isFinite(p[0]));if(pts.length<2)continue;
   if(leg.type==='bus'){L.polyline(pts,{color:'#000',weight:9,opacity:.45,interactive:false}).addTo(tripLayer);L.polyline(pts,{color:leg.route?.color||'#800000',weight:5,opacity:1}).bindTooltip((leg.route?.shortName||'')+' '+(leg.headsign||''),{sticky:true}).addTo(tripLayer);for(const p of[leg.from,leg.to])if(Number.isFinite(p?.lat))L.circleMarker([p.lat,p.lon],{radius:5,color:'#000',weight:2,fillColor:'#fff',fillOpacity:1}).bindTooltip(p.name).addTo(tripLayer);}
   else L.polyline(pts,{color:leg.type==='walk'?'#34345c':leg.type==='drive'?'#800000':'#117743',weight:leg.type==='walk'?4:5,opacity:.95,dashArray:leg.type==='walk'?'1 8':null,lineCap:'round',interactive:false}).addTo(tripLayer);
   for(const p of pts)bounds.extend(p);
  }
  if(bounds.isValid())map.fitBounds(bounds,{padding:[50,50],maxZoom:16});
 }

 const cityPane=panes.get('city');
 const roadBox=make('div','road-brief'),roadCount=make('p','muted'),powerNote=make('p','power-note','Checking for outages…'),trainBox=make('div','');
 const linkRow=(...items)=>{const r=make('div','link-row');for(const i of items)r.append(i);return r;};
 const noticeBtn=button('bus notices','linkish');noticeBtn.addEventListener('click',()=>$('alerts-open')?.click());
 cityPane.append(
  head('City'),
  make('h3','sub-head','Roads'),roadBox,roadCount,
  make('h3','sub-head','Power'),powerNote,
  make('h3','sub-head','Trains'),trainBox,
  make('h3','sub-head','Quick'),linkRow(noticeBtn,...[['wc','washrooms'],['food','late food'],['mail','mail'],['rx','pharmacy'],['gas','gas'],['help','help']].map(([id,label])=>{const b=button(label,'linkish');b.addEventListener('click',()=>{if(id==='mail'){show('mail');return;}show('places');pChips.querySelector('[data-chip="'+id+'"]')?.click();});return b;}))
 );
 paneOpen.set('city',()=>{const fill=()=>trainBox.replaceChildren(trainRows(3),trainLiveLines());fill();refreshTrains(true).then(fill);refreshCounts();roadCount.textContent=closureLayer.getLayers().length+' closures · '+workLayer.getLayers().length+' construction zones on the map';});

 let mapBusy=false,infoBusy=false,powerBusy=false;
 async function refreshMapData(){
  if(mapBusy||!api.cityMap)return;mapBusy=true;
  try{const data=await api.cityMap();closureLayer.clearLayers();closureLayer.addData([...(data.activeRestrictions||[]).map(f=>arcFeature(f,true)),...(data.upcomingRestrictions||[]).map(f=>arcFeature(f,false))].filter(Boolean));workLayer.clearLayers();workLayer.addData([...(data.activeConstruction||[]).map(f=>arcFeature(f,true)),...(data.upcomingConstruction||[]).map(f=>arcFeature(f,false))].filter(Boolean));refreshFacilities(data);if(current==='city')paneOpen.get('city')();}
  catch{}finally{mapBusy=false;}
 }
 function showCityInfo(data){
  const latest=(data?.roadItems||[])[0];roadBox.replaceChildren();
  if(latest){const card=make('div','post'),title=latest.title||'Road update';let summary=String(latest.summary||'').trim();if(summary.startsWith(title))summary=summary.slice(title.length).trim();summary=summary.replace(/^For immediate release[:\s]*/i,'').replace(/^[A-Z][a-z]+\.? \d{1,2},? \d{4}\s*[-–]?\s*(\d{1,2}:\d{2}\s*[ap]\.?m\.?)?\s*(TC[\d-]+)?\s*/i,'');card.append(make('b','',title));if(summary)card.append(make('p','',summary.length>220?summary.slice(0,217).replace(/\s+\S*$/,'')+'…':summary));roadBox.append(card);}
  else roadBox.append(make('p','muted',data?.status==='unavailable'?'Road news can’t load right now.':'No road news today.'));
 }
 async function refreshCityInfo(){if(infoBusy||!api.cityInfo)return;infoBusy=true;try{showCityInfo(await api.cityInfo());}catch{showCityInfo({status:'unavailable'});}finally{infoBusy=false;}}
 async function refreshPower(){
  if(powerBusy||!api.powerOutages)return;powerBusy=true;
  try{
   const[data,city]=await Promise.all([api.powerOutages(),api.cityPowerUpdates?api.cityPowerUpdates().catch(()=>({})):Promise.resolve({})]);
   powerLayer.clearLayers();if(Array.isArray(data?.features))powerLayer.addData(data.features);
   const count=powerLayer.getLayers().length,latest=city?.items?.[0],regional=(data?.items||[]).flatMap(i=>(i.alerts||[]).slice(0,1).map(a=>({i,a})))[0];
   const parts=[];
   if(count)parts.push(count+' SaskPower outage area'+(count===1?'':'s')+' on the map.');
   else if(regional)parts.push(regional.i.region+': '+regional.a.message);
   else if(data?.status==='unavailable')parts.push('SaskPower outages can’t load right now.');
   else parts.push('No SaskPower outages nearby.');
   if(latest&&city.status!=='stale'){const d=latest.date?new Date(latest.date):null;parts.push('Light & Power: '+latest.title+(d&&!Number.isNaN(d.valueOf())?' ('+dayFormat.format(d)+')':''));}
   powerNote.textContent=parts.join(' ');powerNote.dataset.state=count?'alert':'ok';
  }catch{powerNote.textContent='Outage info can’t load right now.';}finally{powerBusy=false;}
 }

 const themeBase=()=>html.dataset.theme==='dark'?'dark':'street';
 setBasemap(saved('basemap',null)||themeBase(),saved('basemap',null)===null);
 new MutationObserver(()=>{if(saved('basemap',null)===null&&html.dataset.basemap!==themeBase())setBasemap(themeBase(),true);}).observe(html,{attributes:true,attributeFilter:['data-theme']});
 for(const id of Object.keys(LAYERS))setLayer(id,layerState[id]);
 drawHere();
 const zoomClass=()=>{const z=map.getZoom(),el=map.getContainer();el.classList.toggle('z-low',z<12.5);el.classList.toggle('z-mid',z>=12.5&&z<14.5);if(layerState.stops)dash.setStopLayerVisible?.(z>=14);};
 map.on('zoomend',zoomClass);zoomClass();
 loadStops().then(()=>{if(current==='near')renderNear();});loadRoutes();
 refreshMapData();refreshCityInfo();refreshPower();
 setInterval(refreshMapData,5*60*1000);setInterval(refreshTrains,60*1000);setInterval(()=>refreshScooters(false),60*1000);setInterval(refreshCityInfo,10*60*1000);setInterval(refreshPower,5*60*1000);
 const signalPane=panes.get('signal'),terminal=document.getElementById('signal-terminal');
 if(signalPane&&terminal){signalPane.append(terminal);terminal.hidden=false;}
 show(saved('tab','near'));
 window.cityGuide=Object.freeze({show,openCam,closeCam,setLayer,setBasemap,setHere,setEndpoint,runPlan,query,hoursState,trainTimes,refreshMapData,refreshCityInfo,refreshPower,mapLayers:()=>({closures:closureLayer,construction:workLayer,power:powerLayer,facilities:facilityLayer,trip:tripLayer}),preview:()=>dialogPreview});
})();
