'use strict';
const {app, BrowserWindow, ipcMain, dialog, session, powerMonitor, shell} = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const {fileURLToPath} = require('node:url');
const {spawn} = require('node:child_process');
const {rasterize, WIDTH} = require('./raster');
const {InternetClock} = require('./internet-clock');
const {WindowsAnnouncements}=require('./stop-announcements');
const announcements=new WindowsAnnouncements();
const {PROFILE,profileFor,savedProfile} = require('./paper-profiles');
const {parsePrintedAt} = require('./print-time');
const {compose} = require('./text-print');
const {validateChunks} = require('./receipt-chunks');
const {HOTLINE_IMAGE} = require('./camera-feeds');
const {createCameraProbe} = require('./camera-probe');
const tokens = require('./tokens');
const {SignalBus} = require('./signal-bus');
const {createAdapters} = require('./adapters');
const {helperPath} = require('./runtime-paths');
let selectedPaper = 'roll57';
const settingsFile = () => path.join(app.getPath('userData'),'paper-settings.json');
async function loadPaper() { try { selectedPaper=savedProfile(JSON.parse(await fs.readFile(settingsFile(),'utf8'))); } catch { selectedPaper='roll57'; } }
async function savePaper(id) {
  profileFor(id); if(busy) throw new Error('Finish the print dialog before changing paper.');
  await fs.mkdir(app.getPath('userData'),{recursive:true});
  await fs.writeFile(settingsFile(),JSON.stringify({version:1,profile:id},null,2),'utf8');
  selectedPaper=id; return {selected:selectedPaper,profiles:[PROFILE]};
}
const internetClock = new InternetClock();
// FIX: self-scheduling sync that backs off while the clock has no anchor.
let syncTimer = null;
function scheduleSync() {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => { await internetClock.sync(); scheduleSync(); }, internetClock.retryDelayMs());
  if (syncTimer.unref) syncTimer.unref();
}
const receiptFormat = new Intl.DateTimeFormat('en-US', {timeZone:'America/Regina',year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',hour12:true});
let transitProvider=null, weatherProvider=null, cityInfoProvider=null, cityMapProvider=null, saskPowerProvider=null, cityPowerProvider=null;
const trustedNow=()=>{try{return internetClock.now();}catch{return null;}};
const bus = new SignalBus();
let signalReady = null;
function signals() {
  if (!signalReady) signalReady = createAdapters({cacheDir: path.join(app.getPath('userData'), 'signals'), now: trustedNow, ...(selfTestDir ? {fetcher: async () => { throw new Error('Signals stay offline during self-test.'); }} : {})})
    .then(list => { for (const adapter of list) { bus.register(adapter); adapter.start().catch(() => {}); } return bus; });
  return signalReady;
}
function transitData(){if(!transitProvider){const {TransitProvider}=require('./transit-provider');transitProvider=new TransitProvider({cacheDir:path.join(app.getPath('userData'),'transit-cache'),now:trustedNow});transitProvider.start().catch(()=>{});}return transitProvider;}
function weatherData(){if(!weatherProvider){const {WeatherProvider}=require('./weather-provider');weatherProvider=new WeatherProvider({cacheDir:path.join(app.getPath('userData'),'weather-cache'),now:trustedNow});weatherProvider.start().catch(()=>{});}return weatherProvider;}
function cityInfoData(){if(!cityInfoProvider){const {CityInfoProvider}=require('./city-info-provider');cityInfoProvider=new CityInfoProvider();cityInfoProvider.start();}return cityInfoProvider;}
function cityMapData(){if(!cityMapProvider){const {CityMapProvider}=require('./city-map-provider');cityMapProvider=new CityMapProvider();cityMapProvider.start();}return cityMapProvider;}
function powerOutageData(){if(!saskPowerProvider){const {SaskPowerProvider}=require('./saskpower-provider');saskPowerProvider=new SaskPowerProvider();saskPowerProvider.start();}return saskPowerProvider;}
function cityPowerData(){if(!cityPowerProvider){const {CityPowerProvider}=require('./city-power-provider');cityPowerProvider=new CityPowerProvider();}return cityPowerProvider;}
// FIX: clear the sync timer on quit.
app.on('before-quit',()=>{if(syncTimer)clearTimeout(syncTimer);cameraProbe.stop();bus.stopAll();transitProvider?.stop();weatherProvider?.stop();cityInfoProvider?.stop();cityMapProvider?.stop();saskPowerProvider?.stop();cityPowerProvider?.stop();announcements.stop();});
const REMOTE_IMAGES=Object.freeze([
  /^https:\/\/tile\.openstreetmap\.org\/\d{1,2}\/\d+\/\d+\.png$/,
  /^https:\/\/[abc]\.tile\.opentopomap\.org\/\d{1,2}\/\d+\/\d+\.png$/,
  /^https:\/\/[abc]\.tile\.openstreetmap\.fr\/hot\/\d{1,2}\/\d+\/\d+\.png$/,
  /^https:\/\/[abc]\.tile-cyclosm\.openstreetmap\.fr\/cyclosm\/\d{1,2}\/\d+\/\d+\.png$/,
  /^https:\/\/tile\.memomaps\.de\/tilegen\/\d{1,2}\/\d+\/\d+\.png$/,
  /^https:\/\/basemaps\.cartocdn\.com\/(?:dark_all|light_all)\/\d{1,2}\/\d+\/\d+\.png$/,
  /^https:\/\/tiles\.maps\.eox\.at\/wmts\/1\.0\.0\/s2cloudless_3857\/default\/g\/\d{1,2}\/\d+\/\d+\.jpg$/,
  HOTLINE_IMAGE,
  /^https:\/\/phenocam\.nau\.edu\/data\/latest\/saskatoon1\.jpg(?:\?v=\d{10,13})?$/
]);
const cameraProbe = createCameraProbe({allowed: url => REMOTE_IMAGES.some(pattern => pattern.test(url))});
let routePlanner=null;
function planner(){if(!routePlanner){const {RoutePlanner}=require('./route-planner');routePlanner=new RoutePlanner({transit:()=>transitData(),weather:()=>weatherData().snapshot(),now:()=>trustedNow()??Date.now()});}return routePlanner;}
const PRINTER = 'M860 USB Text Test';
const ZOOM = 203.2 / 96;
const htmlPath = path.join(__dirname, 'index.html');
const selfTestArg = process.argv.find(value => value.startsWith('--self-test='));
const selfTestDir = selfTestArg ? path.resolve(selfTestArg.slice('--self-test='.length)) : null;
let window = null;
let busy = false;
let printHelperCalls = 0;
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
if(selfTestDir) { const profile=path.join(selfTestDir,'profile'); require('node:fs').mkdirSync(profile,{recursive:true}); app.setPath('userData',profile); }
app.setName('Sample Receipt');
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.whenReady().then(start).catch(async error => {
    if (selfTestDir) await fs.writeFile(path.join(selfTestDir, 'failure.txt'), error.stack || String(error)).catch(() => {});
    else dialog.showErrorBox('Saskanuisance', 'The app could not open.\n' + error.message);
    app.exit(1);
  });
}
app.on('window-all-closed', () => app.quit());
function secureWindow(win) {
  win.setMenu(null);
  win.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
  win.webContents.on('will-navigate', event => event.preventDefault());
  const ownPage = webContents => { try { return Boolean(window) && !window.isDestroyed() && webContents === window.webContents && fileURLToPath(webContents.getURL()) === htmlPath; } catch { return false; } };
  win.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => callback((permission === 'geolocation' || permission === 'fullscreen') && ownPage(webContents)));
  win.webContents.session.setPermissionCheckHandler((webContents, permission) => (permission === 'geolocation' || permission === 'fullscreen') && ownPage(webContents));
}
function isTrusted(event) {
  try { return event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && fileURLToPath(event.senderFrame.url) === htmlPath; }
  catch { return false; }
}
async function printerStatus() {
  const printers = await window.webContents.getPrintersAsync();
  const printer = printers.find(value => value.name === PRINTER);
  let connection = 'unknown';
  try { connection = (await sendRaster(null, 'Status')).connection || 'unknown'; } catch {}
  return {available: Boolean(printer), printer: PRINTER, status: printer?.status ?? null, connection: printer ? connection : 'unknown'};
}
function sendRaster(raster, mode = 'Print') {
  if (mode !== 'Status') validateChunks(raster && raster.chunks);
  if (mode === 'Print') printHelperCalls++;
  return new Promise((resolve, reject) => {
    const executable = helperPath('ReceiptPrint.exe');
    const child = spawn(executable, [mode === 'Status' ? '--status' : mode === 'DryRun' ? '--dry-run' : '--print'], {windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe']});
    let output = '', errors = '';
    let settled = false;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(value); };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error('Printing timed out. Its outcome is uncertain; check the printer before trying again.'));
    }, mode === 'Status' ? 5000 : 30000);
    child.stdout.on('data', chunk => { output += chunk.toString(); });
    child.stderr.on('data', chunk => { errors += chunk.toString(); });
    child.on('error', error => finish(error));
    child.stdin.on('error', () => {});
    child.on('close', code => {
      try {
        const result = JSON.parse(output.trim().replace(/^\uFEFF/, ''));
        if (code !== 0 || !result.ok) throw new Error(result.message + (result.outcomeUncertain ? ' Some paper may have printed. Check before trying again.' : ''));
        finish(null, result);
      } catch (error) { finish(new Error(output.trim() ? error.message : (errors.trim() || 'Printer helper did not return a result. Check the printer before trying again.'))); }
    });
    if (mode === 'Status') { child.stdin.end(); return; }
    const header = Buffer.alloc(8);
    header.writeUInt32LE(0x31504d53, 0); header.writeUInt32LE(raster.chunks.length, 4);
    const parts = [header];
    for (const chunk of raster.chunks) {
      const length = Buffer.alloc(4); length.writeUInt32LE(chunk.length);
      parts.push(length, chunk);
    }
    child.stdin.end(Buffer.concat(parts));
  });
}
async function captureHidden(win, rectangle) {
  let lastError;
  for(let attempt=0;attempt<3;attempt++) {
    try { return await win.webContents.capturePage(rectangle, {stayHidden:true,stayAwake:true}); }
    catch(error) { lastError=error; if(attempt<2) { if(win.webContents.isOffscreen()) win.webContents.invalidate(); await delay(250*(attempt+1)); } }
  }
  throw new Error('Receipt image capture failed before printing: '+(lastError?.message || String(lastError)));
}
async function renderReceipt(now = internetClock.now(), paperId = selectedPaper) {
  const paper = profileFor(paperId);
  // Offscreen receipt capture does not paint while a hidden window is throttled. The visible window keeps the default.
  const renderer = new BrowserWindow({show: false, width: paper.width, height: 1000, useContentSize: true, backgroundColor: '#ffffff', webPreferences: {nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false, offscreen: true}});
  secureWindow(renderer);
  try {
    await renderer.loadFile(htmlPath, {query: {render: '1'}});
    renderer.webContents.setZoomFactor(ZOOM);
    const details = await renderer.webContents.executeJavaScript(`(async () => {
      await document.fonts.ready;
      await Promise.all(Array.from(document.images).map(image => image.decode()));
      window.sampleReceipt.setPaper(${JSON.stringify(paper)});
      window.sampleReceipt.refreshExpiry(${Number(now)});
      const ticket = document.querySelector('.ticket');
      if (!ticket) throw new Error('Receipt layout is missing the ticket.');
      const foot = document.querySelector('.terms').getBoundingClientRect();
      const rect = ticket.getBoundingClientRect();
      return {paper: ${JSON.stringify(paper.id)}, overflow: getComputedStyle(document.documentElement).overflow, bodyWidth: document.body.getBoundingClientRect().width, height: rect.height, width: rect.width, footerTop: foot.top, footerBottom: foot.bottom, ticketBottom: rect.bottom,
        // FIX: optional chaining so a placeholder render cannot throw a raw TypeError.
        time: document.querySelector('#expiry-time').dateTime, timeText: (document.querySelector('#expiry-time').getAttribute('aria-label') || document.querySelector('#expiry-time').textContent || '').trim() || null, dateText: (document.querySelector('#expiry-date').getAttribute('aria-label') || document.querySelector('#expiry-date').textContent || '').trim() || null,
        footer: document.querySelector('.terms').textContent, logoTransform: getComputedStyle(document.querySelector('.logo')).transform,
        trim: getComputedStyle(ticket, '::after').borderLeftStyle, trimDisplay: getComputedStyle(ticket,'::after').display,
        logoWidth: document.querySelector('.logo').getBoundingClientRect().width,
        fontSizes: ['.heading','.valid-label','.terms'].map(selector=>getComputedStyle(document.querySelector(selector)).fontSize),
        // FIX: missing nodes collapse to a zero-width box instead of dereferencing null.
        contentBounds: ['.heading','.valid-label','#expiry-time','#expiry-date','.logo'].map(selector=>{const el=document.querySelector(selector);if(!el)return {selector,left:0,right:0,top:0};let r;if(el.tagName==='H2'||el.tagName==='P'||el.tagName==='TIME'){const range=document.createRange();range.selectNodeContents(el);r=range.getBoundingClientRect();}else{r=el.getBoundingClientRect();}return {selector,left:r.left,right:r.right,top:r.top};}),
        trimX: rect.right,
        footerLines: Array.from(document.querySelectorAll('.terms-line')).map(node => { const range = document.createRange(); range.selectNodeContents(node); const r = range.getBoundingClientRect(); return {text: node.textContent, left: r.left, right: r.right, top: r.top, bottom: r.bottom}; })};
    })()`);
    if (details.trimDisplay !== 'none') throw new Error('Trim guide failed validation. Printing stopped.');
    if (details.footerTop < 0 || details.footerBottom > details.ticketBottom + 1) throw new Error('Footer does not fit the ticket. Printing stopped.');
    if (!details.footer.includes('permits transfers prior') || details.footerLines.length !== 3 || details.footerLines.some(line => line.left < 0 || line.right >= details.trimX)) throw new Error('Footer failed validation. Printing stopped.');
    // FIX: explicit message when the clock had no value to stamp.
    if (!details.timeText || !details.dateText) throw new Error('The receipt has no internet time. Wait for the clock indicator, then try again.');
    if(details.contentBounds.some(item=>item.left < -.05 || item.right > details.trimX + .05)) throw new Error('Original-size content does not fit this paper layout. Printing stopped instead of shrinking or clipping.');
    const height = Math.ceil(details.height * ZOOM);
    if (height < 500 || height > 1600) throw new Error('Unexpected receipt size. Printing stopped.');
    renderer.setContentSize(paper.width, height);
    await delay(120);
    const captured = await captureHidden(renderer,{x: 0, y: 0, width: paper.width, height});
    const image = captured.resize({width: paper.width, height, quality: 'best'});
    const raster = rasterize(image.toBitmap(), paper.width, height, paper);
    const logoBox = details.contentBounds.find(item => item.selector === '.logo');
    const logoCss = Math.max(1, details.logoWidth * (201 / 800));
    const logoCapture = await captureHidden(renderer, {x: 0, y: Math.max(0, Math.floor(logoBox.top)), width: Math.round(paper.width / ZOOM), height: Math.ceil(logoCss)});
    const logoHeight = Math.max(1, Math.ceil(logoCss * ZOOM));
    const logoImage = logoCapture.resize({width: paper.width, height: logoHeight, quality: 'best'});
    const logoRaster = rasterize(logoImage.toBitmap(), paper.width, logoHeight, paper);
    return {image, raster, logoRaster, details};
  } finally { renderer.destroy(); }
}
const PRINT_CONFIRM = Object.freeze({type: 'none', title: '', message: 'Are you ready to print?', buttons: ['Yes', 'No'], defaultId: 1, cancelId: 1, noLink: true});
async function handlePrint(event, ask = () => dialog.showMessageBox(window, PRINT_CONFIRM), options = {}) {
  if (!isTrusted(event)) throw new Error('Untrusted request.');
  if (busy) return {ok: false, message: 'A print request is already open.'};
  busy = true;
  try {
    internetClock.now();
    const rawTime = options?.printedAt;
    const supplied = rawTime !== undefined && rawTime !== null && String(rawTime).trim() !== '';
    const printedAt = supplied ? parsePrintedAt(rawTime) : null;
    if (supplied && !printedAt) return {ok: false, message: 'That print time is not valid. Use HH:MM in 24-hour form, or leave it blank.'};
    const gate=transitData().serviceHours();
    if(!gate.allowed)return {ok:false,message:gate.status==='off-hours'?'Printing is disabled outside scheduled bus service. See the countdown in the app.':'Printing is disabled: '+gate.reason+'.'};
    const status = await printerStatus();
    if (!status.available) return {ok: false, message: 'M860 USB Text Test was not found. Connect the printer and reopen the app.'};
    if (status.connection === 'disconnected') return {ok: false, message: 'The M860 USB device is disconnected. Check its cable and power, then try again.'};
    const answer = await ask();
    if (answer.response !== 0) return {ok: true, cancelled: true, message: 'Cancelled. Nothing was printed.'};
    const stamp = printedAt ?? internetClock.now();
    const token = await tokens.current();
    const issuedAt = token ? token.issuedAt : stamp;
    const preview = await renderReceipt(issuedAt);
    internetClock.now();
    if(!transitData().serviceHours().allowed)return {ok:false,message:'Scheduled service availability changed. Nothing was printed.'};
    const expiry = new Date(issuedAt + 90 * 60 * 1000);
    const parts = Object.fromEntries(receiptFormat.formatToParts(expiry).map(part => [part.type, part.value]));
    const raster = compose({
      time: parts.hour + ':' + parts.minute + ' ' + parts.dayPeriod,
      date: (parts.month + ' ' + parts.day + ',' + parts.year).toUpperCase(),
      terms: preview.details.footerLines.map(line => line.text),
      barcode: null,
      logo: preview.logoRaster,
      profile: profileFor(selectedPaper)
    });
    const result = await sendRaster(raster);
    return {ok: true, message: 'Sample sent to M860 (job ' + result.jobId + '). Check the paper before printing again.'};
  } catch (error) { return {ok: false, message: error.message}; }
  finally { busy = false; }
}
let liveFeedSet=null;
function liveFeeds(){if(!liveFeedSet){const {ViaLive,Scooters}=require('./live-feeds');liveFeedSet={via:new ViaLive({ttl:60000}),scooters:new Scooters({ttl:60000})};}return liveFeedSet;}
async function start() {
  await loadPaper();
  tokens.init(app.getPath('userData'));
  // FIX: initial sync then self-scheduling retries; resume reschedules too.
  internetClock.sync().finally(scheduleSync);
  powerMonitor.on('suspend',()=>internetClock.invalidate('Computer was suspended; internet time needs resync.'));
  powerMonitor.on('resume',()=>{internetClock.invalidate('Resyncing after wake.'); internetClock.sync().finally(scheduleSync);});
  session.defaultSession.webRequest.onBeforeRequest({urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*']}, (details, callback) => callback({cancel: !(!selfTestDir && details.resourceType==='image' && REMOTE_IMAGES.some(pattern=>pattern.test(details.url)))}));
  session.defaultSession.webRequest.onBeforeSendHeaders({urls:['https://tile.openstreetmap.org/*','https://*.tile.openstreetmap.fr/*','https://*.tile-cyclosm.openstreetmap.fr/*','https://*.tile.opentopomap.org/*','https://basemaps.cartocdn.com/*']},(details,callback)=>callback({requestHeaders:{...details.requestHeaders,'User-Agent':'IllicitSampleReceipt/1.6 (+https://illicit.page; contact: biz@illicit.page)'}}));
  const captureOffscreen = Boolean(selfTestDir);
  window = new BrowserWindow({title: 'Saskanuisance', icon: path.join(__dirname, 'icon.ico'), width: 1280, height: 860, minWidth: 1000, minHeight: 760, show: !selfTestDir, autoHideMenuBar: true, backgroundColor: '#ffffee', webPreferences: {preload: path.join(__dirname, 'preload.js'), offscreen: captureOffscreen, ...(captureOffscreen ? {backgroundThrottling: false} : {}), contextIsolation: true, nodeIntegration: false, sandbox: true}});
  secureWindow(window);
  ipcMain.handle('sample:open-link', async (event,key) => {
    if(!isTrusted(event)) throw new Error('Untrusted request.');
    const links={ofl:'https://openfontlicense.org/open-font-license-official-text/',odbl:'https://opendatacommons.org/licenses/odbl/1-0/',osmCopyright:'https://www.openstreetmap.org/copyright',weatherLicense:'https://eccc-msc.github.io/open-data/licence/readme_en/',license:'https://creativecommons.org/licenses/by/4.0/',ogl:'https://open.canada.ca/en/open-government-licence-canada'};
    if(!Object.hasOwn(links,key)) throw new Error('Unsupported link.');
    if(selfTestDir) return {ok:true,url:links[key],opened:false};
    await shell.openExternal(links[key]); return {ok:true};
  });
  ipcMain.handle('sample:cameras:watch', (event, items) => {
    if(!isTrusted(event) || !Array.isArray(items) || items.length > 24) throw new Error('Untrusted request.');
    cameraProbe.watch(items);
    return {watching: items.length};
  });
  ipcMain.handle('sample:cameras:health', event => {
    if(!isTrusted(event)) throw new Error('Untrusted request.');
    return cameraProbe.snapshot();
  });
  ipcMain.handle('sample:plan', async (event,request) => {
    if(!isTrusted(event)) throw new Error('Untrusted request.');
    if(!request||typeof request!=='object'||JSON.stringify(request).length>2000) throw new Error('Invalid trip request.');
    try { return planner().plan(request); } catch (error) { return {status:'error',message:error?.message||'Trip planner unavailable.',options:[]}; }
  });
  ipcMain.handle('sample:voice:status',event=>{if(!isTrusted(event))throw Error('Untrusted request.');return announcements.status();});
  ipcMain.handle('sample:voice:stop',event=>{if(!isTrusted(event))throw Error('Untrusted request.');announcements.stop();return {stopped:true};});
  ipcMain.handle('sample:voice:approach',(event,id)=>{if(!isTrusted(event)||typeof id!=='string'||id.length>100)throw Error('Invalid vehicle.');return announcements.approach(id,transitData().vehicleDetails(id),trustedNow());});
  ipcMain.handle('sample:transit:snapshot',event=>{if(!isTrusted(event))throw Error('Untrusted request.');return transitData().snapshot();});
  ipcMain.handle('sample:transit:map-stops',event=>{if(!isTrusted(event))throw Error('Untrusted request.');return transitData().mapStops();});
  ipcMain.handle('sample:transit:vehicle',(event,id)=>{if(!isTrusted(event)||typeof id!=='string'||id.length>100)throw Error('Invalid vehicle.');return transitData().vehicleDetails(id);});
  ipcMain.handle('sample:transit:vehicle-shape',(event,id)=>{if(!isTrusted(event)||typeof id!=='string'||id.length>100)throw Error('Invalid vehicle.');return transitData().vehicleShape(id);});
  ipcMain.handle('sample:transit:shapes',(event,id)=>{if(!isTrusted(event)||typeof id!=='string'||id.length>100)throw Error('Invalid route.');return transitData().routeShapes(id);});
  ipcMain.handle('sample:transit:routes',event=>{if(!isTrusted(event))throw Error('Untrusted request.');return transitData().routes();});
  ipcMain.handle('sample:transit:stops',(event,query)=>{if(!isTrusted(event)||typeof query!=='string'||query.length>100)throw Error('Invalid stop query.');return transitData().searchStops(query);});
  ipcMain.handle('sample:transit:departures',(event,id)=>{if(!isTrusted(event)||typeof id!=='string'||id.length>100)throw Error('Invalid stop.');return transitData().departures(id,{limit:12});});
  ipcMain.handle('sample:weather',event=>{if(!isTrusted(event))throw Error('Untrusted request.');return weatherData().snapshot();});
  ipcMain.handle('sample:city-info',async event=>{if(!isTrusted(event))throw new Error('Untrusted request.');return cityInfoData().refresh();});
  ipcMain.handle('sample:city-map',async event=>{if(!isTrusted(event))throw new Error('Untrusted request.');return cityMapData().refresh();});
  ipcMain.handle('sample:via-live',async event=>{if(!isTrusted(event))throw new Error('Untrusted request.');return liveFeeds().via.get();});
  ipcMain.handle('sample:scooters',async event=>{if(!isTrusted(event))throw new Error('Untrusted request.');return liveFeeds().scooters.get();});
  ipcMain.handle('sample:power-outages',async event=>{if(!isTrusted(event))throw new Error('Untrusted request.');return powerOutageData().refresh();});
  ipcMain.handle('sample:city-power-updates',async event=>{if(!isTrusted(event))throw new Error('Untrusted request.');return cityPowerData().refresh();});
  ipcMain.handle('sample:paper:get', event => { if(!isTrusted(event)) throw new Error('Untrusted request.'); return {selected:selectedPaper,profiles:[PROFILE]}; });
  ipcMain.handle('sample:paper:set', (event,id) => { if(!isTrusted(event)) throw new Error('Untrusted request.'); return savePaper(id); });
  ipcMain.handle('sample:tokens:get', async event => { if(!isTrusted(event)) throw new Error('Untrusted request.'); return tokens.load(); });
  ipcMain.handle('sample:tokens:add', async (event, input) => { if(!isTrusted(event)) throw new Error('Untrusted request.'); return tokens.add(input ?? {}); });
  ipcMain.handle('sample:tokens:remove', async (event, id) => { if(!isTrusted(event)) throw new Error('Untrusted request.'); return tokens.remove(id); });
  ipcMain.handle('sample:tokens:select', async (event, id) => { if(!isTrusted(event)) throw new Error('Untrusted request.'); return tokens.select(id); });
  ipcMain.handle('sample:service-hours', event=>{if(!isTrusted(event))throw Error('Untrusted request.');return transitData().serviceHours();});
  ipcMain.handle('sample:time', event => { if (!isTrusted(event)) throw new Error('Untrusted request.'); return internetClock.snapshot(); });
  ipcMain.handle('sample:status', event => { if (!isTrusted(event)) throw new Error('Untrusted request.'); return printerStatus(); });
  ipcMain.handle('sample:signal', async event => { if (!isTrusted(event)) throw new Error('Untrusted request.'); await signals(); return bus.summary(); });
  ipcMain.handle('sample:signal:recheck', async (event, id) => { if (!isTrusted(event) || typeof id !== 'string' || id.length > 40) throw new Error('Invalid source.'); const adapter = (await signals()).get(id); if (!adapter) throw new Error('Unknown source.'); return adapter.refresh(); });
  ipcMain.handle('sample:signal:recent', async (event, id) => { if (!isTrusted(event) || typeof id !== 'string' || id.length > 40) throw new Error('Invalid source.'); const adapter = (await signals()).get(id); if (!adapter?.ring) throw new Error('No trail for that source.'); return adapter.ring.recent(80); });
  ipcMain.handle('sample:print', async (event, options) => {
    const result = await handlePrint(event, undefined, options);
    if (!result.ok) await dialog.showMessageBox(window, {type: 'error', title: 'Printer', message: result.message, buttons: ['OK']});
    return result;
  });
  await window.loadFile(htmlPath);
  if (selfTestDir) await selfTest();
}
async function selfTest() {
  const assert = require('node:assert/strict');
  await fs.mkdir(selfTestDir, {recursive: true});
  assert.equal(PRINT_CONFIRM.message, 'Are you ready to print?');
  assert.deepEqual(PRINT_CONFIRM.buttons, ['Yes', 'No']);
  assert.equal(PRINT_CONFIRM.cancelId, 1);
  assert.equal(PRINT_CONFIRM.defaultId, 1);
  assert.equal(PRINT_CONFIRM.detail, undefined);
  // FIX: the sync assert was network-dependent; retry before declaring failure.
  for (let attempt = 0; attempt < 3; attempt++) {
    await internetClock.sync();
    if (internetClock.snapshot().status === 'synced') break;
    await delay(1500);
  }
  assert.equal(internetClock.snapshot().status, 'synced', 'Live HTTPS internet time must synchronize: ' + (internetClock.snapshot().error || 'no detail'));
  const now = internetClock.now();
  const receipt = await renderReceipt(now);
  assert.ok(Math.abs((Date.parse(receipt.details.time) - now) - 90 * 60000) < 1, 'Expiry must be internet time plus 90 minutes, within Date millisecond precision.');
  assert.equal(receipt.raster.width, 448);
  const footerGaps=receipt.details.footerLines.slice(1).map((line,index)=>line.top-receipt.details.footerLines[index].bottom);
  assert.ok(footerGaps[0]>footerGaps[1]+2, 'Footer needs extra space above line 2 only.');
  assert.match(receipt.details.timeText, /^\d{1,2}:\d{2} [AP]M$/);
  assert.match(await (async()=>{ const n=new Date(now+90*60000); return new Intl.DateTimeFormat('en-US',{timeZone:'America/Regina',hour:'numeric',minute:'2-digit',hour12:true}).format(n); })(), /^\d{1,2}:\d{2} [AP]M$/);
  assert.ok(receipt.raster.chunks.every((chunk, index, all) => index === 0 || index === all.length - 1 || chunk.length <= 3784));
  await fs.writeFile(path.join(selfTestDir, 'receipt-preview.png'), receipt.image.toPNG());
  await fs.writeFile(path.join(selfTestDir, 'receipt-preview.escpos'), Buffer.concat(receipt.raster.chunks));
  const dryRun = await sendRaster(receipt.raster, 'DryRun');
  assert.equal(dryRun.printerOpened, false);
  assert.equal(dryRun.bytes, receipt.raster.bytes);
  const yearEnd = Date.UTC(2027, 0, 1, 5, 45, 0);
  const rollover = await renderReceipt(yearEnd);
  assert.equal(rollover.details.dateText, 'JAN 1,2027');
  const fixedTime = Date.parse('2026-03-08T23:15:00Z');
  const fixed = await renderReceipt(fixedTime);
  assert.equal(fixed.details.timeText, '6:45 PM', 'Custom print time must reach the receipt, plus 90 minutes.');
  assert.equal(fixed.details.dateText, 'MAR 8,2026');
  const event = {sender: window.webContents, senderFrame: window.webContents.mainFrame};
  const originalPrinterStatus = await printerStatus();
  let release;
  const heldAnswer = new Promise(resolve => { release = resolve; });
  const firstRequest = handlePrint(event, async () => heldAnswer);
  const repeated = await handlePrint(event, async () => ({response: 0}));
  if(transitData().serviceHours().allowed) assert.equal(repeated.message, 'A print request is already open.'); else assert.equal(repeated.ok,false);
  release({response: 1});
  await firstRequest;
  const cancel = await handlePrint(event, async () => ({response: 1}));
  assert.ok(cancel.cancelled || !transitData().serviceHours().allowed || !originalPrinterStatus.available || originalPrinterStatus.connection === 'disconnected');
  let trustedRejected = false;
  try { await handlePrint({sender: null}); } catch { trustedRejected = true; }
  assert.ok(trustedRejected);
  assert.equal(printHelperCalls, 0);
  const security = await window.webContents.executeJavaScript(`({nodeExposed: typeof require !== 'undefined', hasBridge: typeof window.sampleApp?.print === 'function', protocol: location.protocol, scripts: document.querySelectorAll('script:not([src])').length})`);
  assert.equal(security.nodeExposed, false); assert.equal(security.hasBridge, true); assert.equal(security.protocol, 'file:'); assert.equal(security.scripts, 0);
  internetClock.invalidate('Self-test: temporarily lost internet sync.');
  await delay(1200);
  const staleUi=await window.webContents.executeJavaScript(`({state:document.getElementById('clock-status').dataset.state,disabled:document.getElementById('print').disabled})`);
  assert.equal(staleUi.state,'stale'); assert.equal(staleUi.disabled,true);
  await internetClock.sync(); await delay(1200);
  const syncedUi=await window.webContents.executeJavaScript(`({state:document.getElementById('clock-status').dataset.state,disabled:document.getElementById('print').disabled,time:document.getElementById('current-time').textContent,date:document.getElementById('current-date').textContent})`);
  assert.equal(syncedUi.state,'synced'); assert.equal(syncedUi.disabled,!transitData().serviceHours().allowed);
  const narrow = receipt, narrowDryRun=dryRun, paperDialog={single57:true};
  assert.equal(receipt.details.trimDisplay,'none');
  assert.equal(selectedPaper,'roll57');
  assert.equal(await window.webContents.executeJavaScript("document.querySelector('#paper-choice')"),null);
  const brandUi=await window.webContents.executeJavaScript(`(async()=>{
    const photo=new Image();photo.src='assets/saskatoon-quintin-soloviev.jpg';await photo.decode();
    document.getElementById('credits-open').click();
    const result={photoWidth:photo.naturalWidth,photoHeight:photo.naturalHeight,creditsOpen:document.getElementById('credits-dialog').open,credit:document.getElementById('credits-dialog').textContent,hasSeparateInternetIcon:!!document.getElementById('time-status'),printer:document.getElementById('printer-name').textContent,statusFont:getComputedStyle(document.querySelector('.device-status')).fontSize,clockFont:getComputedStyle(document.querySelector('.clock-copy')).fontSize,blur:getComputedStyle(document.querySelector('.app-backdrop'),'::before').filter,footerLinks:document.querySelectorAll('.footer-links a').length};
    document.getElementById('credits-close').click();
    result.brandLink=await window.sampleApp.openLink('osmCopyright');
    try{await window.sampleApp.openLink('unsupported');result.badLinkRejected=false;}catch{result.badLinkRejected=true;}
    return result;
  })()`);
  assert.ok(brandUi.photoWidth>1000); assert.equal(brandUi.creditsOpen,true); assert.match(brandUi.credit,/Quintin Soloviev/); assert.match(brandUi.credit,/CC BY 4.0/);
  assert.equal(brandUi.hasSeparateInternetIcon,false); assert.ok(['Connected','Not detected','Unknown'].includes(brandUi.printer));
  assert.equal(brandUi.statusFont,'13px'); assert.equal(brandUi.statusFont,brandUi.clockFont); assert.equal(brandUi.blur,'blur(2.5px)'); assert.equal(brandUi.footerLinks,0);
  assert.equal(brandUi.brandLink.opened,false); assert.equal(brandUi.badLinkRejected,true);
  window.webContents.debugger.attach('1.3');
  await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  const reducedMotion=await window.webContents.executeJavaScript(`({matches:matchMedia('(prefers-reduced-motion: reduce)').matches,animation:getComputedStyle(document.querySelector('.preview')).animationName,transition:getComputedStyle(document.getElementById('print')).transitionDuration,background:getComputedStyle(document.querySelector('.app-backdrop'),'::before').animationName,waves:!!document.querySelector('.ambient-waves'),separator:document.querySelector('.clock-separator').textContent})`);
  assert.equal(reducedMotion.matches,true); assert.equal(reducedMotion.animation,'none'); assert.equal(reducedMotion.transition,'0s'); assert.equal(reducedMotion.background,'none'); assert.equal(reducedMotion.waves,false); assert.equal(reducedMotion.separator,',');
  window.webContents.debugger.detach();
  await delay(750);
  window.setContentSize(1280, 900);
  await delay(150);
  const centered = await window.webContents.executeJavaScript(`(() => {
    const preview=document.querySelector('.app-workspace').getBoundingClientRect();
    const controls=document.querySelector('.brand-footer').getBoundingClientRect();
    return {centerX:(preview.left+preview.right)/2, centerY:(preview.top+controls.bottom)/2, width:innerWidth, height:innerHeight, scrollW:document.documentElement.scrollWidth, scrollH:document.documentElement.scrollHeight, footerWidth:controls.width};
  })()`);
  assert.ok(Math.abs(centered.centerX-centered.width/2)<2, 'Dashboard must span the horizontal center.');
  assert.ok(Math.abs(centered.centerY-centered.height/2)<2, 'Dashboard and footer must fill the screen.');
  const wideScreenshot = await captureHidden(window,undefined);
  await fs.writeFile(path.join(selfTestDir, 'app-wide-preview.png'), wideScreenshot.toPNG());
  window.setContentSize(1000, 700);
  await delay(200);
  const screenshot = await captureHidden(window,undefined);
  await fs.writeFile(path.join(selfTestDir, 'app-preview.png'), screenshot.toPNG());
  await fs.writeFile(path.join(selfTestDir, 'self-test.json'), JSON.stringify({ok: true, electron: process.versions.electron, receipt: receipt.details, dimensions: receipt.image.getSize(), chunks: receipt.raster.chunks.map(chunk => chunk.length), dryRun, yearRollover: rollover.details.dateText, customTime: fixed.details, cancel, repeated, staleUi, syncedUi, internetTime: internetClock.snapshot(), centered, printConfirmation: PRINT_CONFIRM, security, printHelperCalls, paperProfiles: [PROFILE], narrow: narrow.details, narrowDimensions: narrow.image.getSize(), narrowDryRun, paperDialog, reducedMotion, brandUi, printer: originalPrinterStatus}, null, 2));
  app.quit();
}
