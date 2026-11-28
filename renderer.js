(() => {
  'use strict';
  const timeNode = document.getElementById('expiry-time');
  const dateNode = document.getElementById('expiry-date');
  const ticket = document.querySelector('.ticket');
  const pageStyle = document.getElementById('page-size');
  const printButton = document.getElementById('print');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  let paperWidth = 56;
  let activeToken = null;

  const bitmap = window.YXE_BITMAP;
  function paintBitmap(node, value, scale, gap, cssScale) {
    const drawn = bitmap.rasterText(value, scale, gap);
    const canvas = document.createElement('canvas');
    canvas.className = 'receipt-bitmap';
    canvas.width = drawn.width;
    canvas.height = drawn.height;
    const ctx = canvas.getContext('2d', {alpha: false});
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, drawn.width, drawn.height);
    ctx.fillStyle = '#000000';
    for (let i = 0; i < drawn.pixels.length; i++) {
      if (!drawn.pixels[i]) continue;
      ctx.fillRect(i % drawn.width, (i / drawn.width) | 0, 1, 1);
    }
    const raw = ctx.getImageData(0, 0, drawn.width, drawn.height);
    for (let i = 0; i < raw.data.length; i += 4) {
      const ink = raw.data[i] < 128 ? 0 : 255;
      raw.data[i] = raw.data[i + 1] = raw.data[i + 2] = ink;
      raw.data[i + 3] = 255;
    }
    ctx.putImageData(raw, 0, 0);
    if (cssScale && cssScale !== 1) {
      canvas.style.width = Math.max(1, Math.round(drawn.width * cssScale)) + 'px';
      canvas.style.height = drawn.height + 'px';
    }
    // Fallback text stays inside the canvas so the fit check measures the bitmap, not a second text box.
    canvas.textContent = value;
    node.replaceChildren(canvas);
    if (node.getAttribute('aria-label') !== value) node.setAttribute('aria-label', value);
  }
  function paintStaticReceipt() {
    paintBitmap(document.querySelector('.heading'), 'Proof of Payment', 2, 1);
    paintBitmap(document.querySelector('.valid-label'), 'Valid Until:', 2, 1);
    for (const line of document.querySelectorAll('.terms-line')) paintBitmap(line, line.textContent, 1, 0, 0.75);
  }

  const zone = 'America/Regina';
  const dateParts = new Intl.DateTimeFormat('en-US', {timeZone:zone,year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',hour12:true});
  const liveTime = new Intl.DateTimeFormat('en-US', {timeZone:zone,hour:'numeric',minute:'2-digit',second:'2-digit',hour12:true});
  const liveDate = new Intl.DateTimeFormat('en-US', {timeZone:zone,year:'numeric',month:'short',day:'numeric'});
  let lastReceiptText = null;

  function clearExpiry() {
    if(lastReceiptText === "pending") return; lastReceiptText = "pending";
    paintBitmap(timeNode, '--:-- --', 2, 1);
    paintBitmap(dateNode, 'Waiting for internet time', 1, 0);
    timeNode.removeAttribute('datetime'); dateNode.removeAttribute('datetime');
  }
  function refreshExpiry(now) {
    if (!Number.isFinite(now)) { clearExpiry(); return; }
    const expiry = new Date(now + 90 * 60 * 1000);
    const parts = Object.fromEntries(dateParts.formatToParts(expiry).map(part=>[part.type,part.value]));
    const nextReceiptText = parts.hour + ':' + parts.minute + ' ' + parts.dayPeriod + '|' + parts.month + ' ' + parts.day + ',' + parts.year;
    if(nextReceiptText !== lastReceiptText) {
      paintBitmap(timeNode, parts.hour + ':' + parts.minute + ' ' + parts.dayPeriod, 2, 1);
      paintBitmap(dateNode, (parts.month + ' ' + parts.day + ',' + parts.year).toUpperCase(), 2, 1);
      lastReceiptText = nextReceiptText;
    }
    const iso = expiry.toISOString(); if (timeNode.dateTime !== iso) { timeNode.dateTime = iso; dateNode.dateTime = iso; }
  }
  function refreshFromToken() {
    if (activeToken) refreshExpiry(activeToken.issuedAt);
  }

  function updatePageSize() {
    const heightMm = Math.ceil(ticket.getBoundingClientRect().height * 25.4 / 96 + 1);
    pageStyle.textContent = '@page { size: ' + paperWidth + 'mm ' + heightMm + 'mm; margin: 0; }';
  }
  function setPaper(paper) {
    if(!paper || paper.id!=="roll57") throw new Error("Unsupported paper layout.");
    paperWidth = 56;
    ticket.style.zoom = "1";
    document.documentElement.style.setProperty("--paper-width",paperWidth+"mm");
    document.documentElement.dataset.paper = paper.id;
    updatePageSize();
  }
  function preparePrint(now) { refreshExpiry(now); updatePageSize(); }
  window.addEventListener('load', updatePageSize);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(updatePageSize);
  paintStaticReceipt();
  clearExpiry(); updatePageSize();
  const isRender = new URLSearchParams(location.search).has('render');
  document.documentElement.classList.toggle('render', isRender);
  window.sampleReceipt = Object.freeze({refreshExpiry, preparePrint, setPaper});

  if (!isRender) {
    const creditsDialog=document.getElementById('credits-dialog');
    document.getElementById('credits-open').addEventListener('click',()=>creditsDialog.showModal());
    document.getElementById('credits-close').addEventListener('click',()=>creditsDialog.close());
    document.addEventListener('click',event=>{const link=event.target.closest('a[data-link]');if(link){event.preventDefault();window.sampleApp.openLink(link.dataset.link).catch(()=>{});}});
    const printerStatus = document.getElementById('printer-status');
    const printerName = document.getElementById('printer-name');
    const timeStatus = document.getElementById('clock-status');
    const currentTime = document.getElementById('current-time');
    const currentDate = document.getElementById('current-date');
    const tokenChoice = document.getElementById('token-choice');
    const tokenAdd = document.getElementById('token-add');
    let checking=false, checkingTime=false, printing=false, clock=null, paperReady=false;
    const printLabel = document.getElementById('print-label');
    const paperError=document.getElementById('paper-error');
    const printTime=document.getElementById('print-time');
    let paperState=null, savingPaper=false, service=null, servicePending=false;
    const serviceNote=document.getElementById('service-countdown');

    async function loadTokens() {
      if (!tokenChoice) return; // ticket picker markup is not in index.html (since e6c47f7); skip instead of aborting the whole UI script
      const data = await window.sampleApp.tokens.get();
      tokenChoice.innerHTML = '<option value="">No ticket (no barcode)</option>';
      for (const token of data.tokens) {
        const option = document.createElement('option');
        option.value = token.id;
        option.textContent = token.label + ' · ' + token.payload;
        tokenChoice.append(option);
      }
      tokenChoice.value = data.selected ? data.selected : '';
      activeToken = data.tokens.find(token => token.id === data.selected) || null;
      refreshFromToken();
      paintClock();
    }

    tokenChoice?.addEventListener('change', async () => {
      await window.sampleApp.tokens.select(tokenChoice.value || null);
      await loadTokens();
    });

    tokenAdd?.addEventListener('click', async () => {
      const payload = prompt('Barcode digits (8):');
      if (!payload) return;
      const label = prompt('Label:', 'Transfer') || 'Transfer';
      try { await window.sampleApp.tokens.add({label, payload, issuedAt: Date.now()}); await loadTokens(); }
      catch (error) { alert(error.message); }
    });

    // FIX: stop swallowing the failure silently; leave the reason on the control.
    loadTokens().catch(error => { if (tokenChoice) tokenChoice.title = 'Tickets unavailable: ' + error.message; });

    async function checkService(){if(servicePending)return;servicePending=true;try{service={...await window.sampleApp.serviceHours(),atMono:performance.now()};}catch{service=null;}finally{servicePending=false;paintClock();}}
    checkService();setInterval(checkService,1000);
    function displayPaper(info) {
      paperState=info; setPaper(info.profiles.find(item=>item.id===info.selected));
      paperReady=true; paintClock();
    }
    window.sampleApp.paper().then(displayPaper).catch(()=>{paperReady=false;paperError.textContent='Paper selection unavailable. Reopen the app.';paperError.hidden=false;paintClock();});
    function setStatus(node, key, value) {
      if(node.dataset[key] === value) return;
      node.dataset[key] = value; node.classList.remove('status-changed');
      requestAnimationFrame(() => node.classList.add('status-changed'));
    }
    let lastClockPaint='';
    function paintClock() {
      const elapsed=clock ? performance.now()-clock.atMono : 0;
      const age=clock?.ageMs === null || clock?.ageMs === undefined ? null : clock.ageMs+elapsed;
      const fresh=clock?.status==='synced' && elapsed>=0 && age!==null && age<=clock.maxAgeMs;
      const state=fresh ? 'synced' : (Number.isFinite(clock?.epochMs) ? 'stale' : 'unavailable');
      // FIX: surface the real clock error instead of a generic string.
      const detail=clock?.error && state!=='synced' ? ' ' + clock.error : '';
      const description=(state==='synced' ? 'Saskatoon time, set from the internet.' : state==='stale' ? 'Clock lost its internet connection. Printing is paused.' : 'Connect to the internet to set the clock. Printing is paused.') + detail;
      const instant=Number.isFinite(clock?.epochMs) && elapsed>=0 ? clock.epochMs+elapsed : null;
      const timeText=instant===null ? 'Time unavailable' : (state==='stale' ? '~ ' : '')+liveTime.format(instant);
      // FIX: put the reason on screen, not just in a tooltip.
      const dateText=instant===null ? (clock?.error || '') : liveDate.format(instant);
      const serviceNow=service&&Number.isFinite(service.now)?service.now+performance.now()-service.atMono:null;
      const serviceFresh=serviceNow!==null&&performance.now()-service.atMono<5000&&serviceNow<service.validUntil;
      const allowed=serviceFresh&&service.allowed;
      const remaining=serviceFresh&&service.status==='off-hours'&&Number.isFinite(service.nextStart)?Math.max(0,Math.ceil((service.nextStart-serviceNow)/1000)):null;
      const countdown=remaining===null?'':Math.floor(remaining/3600)+':'+String(Math.floor(remaining/60)%60).padStart(2,'0')+':'+String(remaining%60).padStart(2,'0');
      const noteText=allowed?'':remaining!==null?'Buses start in '+countdown:serviceFresh&&service.status==='off-hours'?'No more buses scheduled':service?.reason&&service.status==='unknown'?service.reason:'Checking bus times';
      const expired = Boolean(activeToken) && instant !== null && instant > activeToken.issuedAt + 90 * 60 * 1000;
      const disabled=printing || !fresh || !paperReady || !allowed || expired;
      const solar=Number.isFinite(instant)?window.SolarTheme?.themeAt(instant):null;
      const phase=solar?.theme==='light'?'sun':solar?.theme==='dark'?'moon':'unknown';
      const paintKey=[state,description,timeText,dateText,noteText,disabled,phase,printing,allowed,remaining].join('|');
      if(paintKey===lastClockPaint) return;
      lastClockPaint=paintKey;
      setStatus(timeStatus, 'state', state);
      timeStatus.title=description;
      currentTime.textContent=timeText;
      currentDate.textContent=dateText;
      currentTime.title=description; currentDate.title='Saskatoon';
      if(instant===null) clearExpiry();
      else if (activeToken) refreshFromToken();
      else refreshExpiry(instant);
      serviceNote.textContent=noteText;
      serviceNote.hidden=allowed;
      serviceNote.title=''+(remaining!==null?'Next start: '+liveDate.format(service.nextStart)+', '+liveTime.format(service.nextStart)+' Saskatoon.':'');
      printButton.disabled=disabled;
      printTime.disabled=printing;
      printButton.title=!fresh?description:expired?'Ticket expired. Pick or add another.':allowed?'Print the sample receipt':noteText+' (scheduled service, not live operations)';
      const icon=timeStatus.querySelector('.clock-icon');
      if(icon.dataset.phase!==phase){icon.dataset.phase=phase;icon.innerHTML=phase==='sun'?'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>':phase==='moon'?'<path d="M20.5 13.5A8.5 8.5 0 0 1 10.5 3a8.5 8.5 0 1 0 10 10.5Z"/>':'<circle cx="12" cy="12" r="8"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4m0 3h.01"/>';}
      timeStatus.setAttribute('aria-label',description+' '+(phase==='unknown'?'Day or night unknown.':phase==='sun'?'Daytime in Saskatoon.':'Nighttime in Saskatoon.'));
    }
    const checkTime=async()=>{
      if(checkingTime)return; checkingTime=true;
      try { const info=await window.sampleApp.time(); clock={...info,atMono:performance.now()}; }
      catch { if(clock)clock.status='stale'; }
      finally { checkingTime=false; paintClock(); }
    };
    const checkStatus=async()=>{
      if(checking||printing)return; checking=true;
      try {
        const info=await window.sampleApp.status();
        const connection=['connected','disconnected'].includes(info.connection)?info.connection:'unknown';
        setStatus(printerStatus, 'connection', connection);
        printerStatus.title='Printer '+connection+'.';
        printerStatus.setAttribute('aria-label','Printer '+connection);
        printerName.textContent=connection==='connected' ? 'Connected' : connection==='disconnected' ? 'Not detected' : 'Unknown';
        printerName.title=info.printer || 'M860 USB Text Test';
      } catch { printerName.textContent='Unknown'; printerStatus.dataset.connection='unknown'; printerStatus.title='Printer connection unknown'; printerStatus.setAttribute('aria-label','Printer connection unknown'); }
      finally { checking=false; }
    };
    checkStatus(); checkTime(); paintClock();
    setInterval(checkStatus,15000); setInterval(checkTime,5000); setInterval(paintClock,1000);
    printButton.addEventListener('click',async()=>{
      if(printButton.disabled)return;
      const printedAt=printTime.value.trim();
      printing=true; printLabel.textContent='PRINTING...'; printButton.dataset.printing='true'; paintClock();
      try { await window.sampleApp.print(printedAt ? {printedAt} : undefined); }
      finally { printing=false; printLabel.textContent='PRINT'; printButton.dataset.printing='false'; await checkTime(); await checkStatus(); }
    });
  }
})();
