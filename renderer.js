
(() => {
  'use strict';
  const timeNode = document.getElementById('expiry-time');
  const dateNode = document.getElementById('expiry-date');
  const ticket = document.querySelector('.ticket');
  const pageStyle = document.getElementById('page-size');
  const printButton = document.getElementById('print');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  let paperWidth = 56;

  const dateGlyphs = {"0":{"advance":1233,"path":"M616 1270Q514 1270 467.0 1145.0Q420 1020 420 745Q420 471 467.0 346.0Q514 221 616 221Q719 221 766.0 346.0Q813 471 813 745Q813 1020 766.0 1145.0Q719 1270 616 1270ZM123 745Q123 1133 246.0 1326.5Q369 1520 616 1520Q864 1520 987.0 1327.0Q1110 1134 1110 745Q1110 357 987.0 164.0Q864 -29 616 -29Q369 -29 246.0 164.5Q123 358 123 745Z"},"1":{"advance":1233,"path":"M188 260H518V1229L211 1153V1419L520 1493H805V260H1135V0H188Z"},"2":{"advance":1233,"path":"M434 260H1063V0H115V252L275 422Q560 725 621 795Q696 881 729.0 947.5Q762 1014 762 1079Q762 1179 701.5 1233.5Q641 1288 530 1288Q451 1288 352.5 1256.5Q254 1225 147 1165V1440Q254 1479 356.5 1499.5Q459 1520 553 1520Q790 1520 925.5 1409.5Q1061 1299 1061 1108Q1061 1020 1031.5 943.0Q1002 866 930 772Q877 704 639 466Q510 337 434 260Z"},"3":{"advance":1233,"path":"M549 668H391V928H549Q659 928 719.5 971.5Q780 1015 780 1094Q780 1177 719.5 1223.5Q659 1270 549 1270Q465 1270 369.0 1249.0Q273 1228 170 1188V1456Q273 1487 373.0 1503.5Q473 1520 565 1520Q801 1520 933.0 1417.0Q1065 1314 1065 1133Q1065 1000 989.0 915.5Q913 831 772 805Q932 777 1016.0 677.5Q1100 578 1100 416Q1100 199 961.0 85.0Q822 -29 557 -29Q444 -29 334.5 -10.0Q225 9 125 45V319Q219 272 328.0 247.5Q437 223 557 223Q677 223 747.0 278.5Q817 334 817 428Q817 543 747.0 605.5Q677 668 549 668Z"},"4":{"advance":1233,"path":"M694 1165 317 575H694ZM668 1493H977V575H1141V322H977V0H694V322H102V608Z"},"5":{"advance":1233,"path":"M193 1493H1004V1233H432V956Q468 970 509.0 976.5Q550 983 596 983Q818 983 956.0 843.0Q1094 703 1094 479Q1094 244 944.5 107.5Q795 -29 537 -29Q441 -29 343.0 -13.0Q245 3 143 35V301Q226 260 313.5 239.5Q401 219 489 219Q645 219 726.0 285.5Q807 352 807 479Q807 596 726.5 666.5Q646 737 512 737Q433 737 353.5 717.5Q274 698 193 659Z"},"6":{"advance":1233,"path":"M643 748Q547 748 496.5 678.5Q446 609 446 477Q446 346 496.5 276.5Q547 207 643 207Q739 207 790.5 276.5Q842 346 842 477Q842 608 790.5 678.0Q739 748 643 748ZM1030 1458V1190Q951 1235 878.5 1257.5Q806 1280 739 1280Q579 1280 495.5 1172.5Q412 1065 408 855Q455 920 528.0 952.5Q601 985 700 985Q902 985 1012.0 857.5Q1122 730 1122 496Q1122 245 998.5 107.0Q875 -31 651 -31Q378 -31 254.5 152.0Q131 335 131 743Q131 1131 282.0 1324.5Q433 1518 735 1518Q805 1518 879.5 1503.0Q954 1488 1030 1458Z"},"7":{"advance":1233,"path":"M135 1493H1079V1284L573 0H272L758 1233H135Z"},"8":{"advance":1233,"path":"M616 666Q517 666 456.0 603.5Q395 541 395 438Q395 335 456.0 272.0Q517 209 616 209Q715 209 776.5 273.0Q838 337 838 438Q838 541 777.0 603.5Q716 666 616 666ZM397 791Q284 830 225.0 913.5Q166 997 166 1118Q166 1304 287.0 1412.0Q408 1520 616 1520Q825 1520 946.0 1412.0Q1067 1304 1067 1118Q1067 998 1009.0 914.5Q951 831 840 791Q964 753 1034.0 655.0Q1104 557 1104 420Q1104 205 977.0 88.0Q850 -29 616 -29Q383 -29 256.0 88.0Q129 205 129 420Q129 558 200.0 656.0Q271 754 397 791ZM428 1094Q428 1006 478.5 954.5Q529 903 616 903Q704 903 754.5 954.5Q805 1006 805 1094Q805 1181 754.5 1231.5Q704 1282 616 1282Q530 1282 479.0 1231.0Q428 1180 428 1094Z"},"9":{"advance":1233,"path":"M203 20V289Q282 243 354.5 221.0Q427 199 494 199Q653 199 736.5 305.5Q820 412 825 624Q778 559 705.0 526.5Q632 494 532 494Q331 494 221.0 621.5Q111 749 111 983Q111 1233 234.0 1370.0Q357 1507 582 1507Q855 1507 978.5 1324.5Q1102 1142 1102 735Q1102 348 951.0 154.5Q800 -39 498 -39Q428 -39 353.5 -24.0Q279 -9 203 20ZM590 741Q685 741 735.5 810.5Q786 880 786 1012Q786 1143 735.5 1212.5Q685 1282 590 1282Q494 1282 442.5 1212.5Q391 1143 391 1012Q391 881 442.5 811.0Q494 741 590 741Z"},"J":{"advance":1233,"path":"M109 74V416Q195 328 292.5 282.0Q390 236 489 236Q605 236 659.0 294.0Q713 352 713 479V1233H352V1493H1008V479Q1008 206 893.5 88.5Q779 -29 516 -29Q421 -29 317.5 -3.0Q214 23 109 74Z"},"a":{"advance":1233,"path":"M700 526Q536 526 471.0 484.0Q406 442 406 340Q406 264 451.0 219.0Q496 174 573 174Q689 174 753.0 261.5Q817 349 817 506V526ZM1108 639V0H817V125Q764 51 681.0 11.0Q598 -29 498 -29Q307 -29 200.5 72.0Q94 173 94 354Q94 550 221.0 643.5Q348 737 614 737H817V786Q817 857 765.5 893.5Q714 930 614 930Q509 930 410.5 903.5Q312 877 205 819V1069Q302 1109 402.0 1128.0Q502 1147 614 1147Q887 1147 997.5 1036.0Q1108 925 1108 639Z"},"n":{"advance":1233,"path":"M1071 727V0H780V682Q780 804 745.5 856.5Q711 909 633 909Q554 909 508.5 838.0Q463 767 463 641V0H172V1120H463V952Q494 1045 569.0 1096.0Q644 1147 750 1147Q909 1147 990.0 1041.5Q1071 936 1071 727Z"},"F":{"advance":1233,"path":"M1112 1233H477V911H1055V651H477V0H182V1493H1112Z"},"e":{"advance":1233,"path":"M1102 55Q1000 13 894.0 -8.0Q788 -29 670 -29Q389 -29 240.5 121.5Q92 272 92 555Q92 829 235.0 988.0Q378 1147 625 1147Q874 1147 1011.5 999.5Q1149 852 1149 584V465H390Q391 333 468.0 268.0Q545 203 698 203Q799 203 897.0 232.0Q995 261 1102 324ZM854 685Q852 801 794.5 860.5Q737 920 625 920Q524 920 464.0 858.5Q404 797 393 684Z"},"b":{"advance":1233,"path":"M850 557Q850 719 796.0 811.0Q742 903 647 903Q552 903 497.0 811.0Q442 719 442 557Q442 395 497.0 303.0Q552 211 647 211Q742 211 796.0 303.0Q850 395 850 557ZM442 961Q496 1054 567.5 1100.5Q639 1147 729 1147Q928 1147 1035.5 995.0Q1143 843 1143 559Q1143 279 1037.0 125.0Q931 -29 739 -29Q638 -29 563.0 20.0Q488 69 442 166V0H150V1556H442Z"},"M":{"advance":1233,"path":"M86 1493H438L616 838L793 1493H1147V0H893V1196L735 543H500L340 1196V0H86Z"},"r":{"advance":1233,"path":"M1151 811Q1103 855 1038.5 877.0Q974 899 897 899Q804 899 734.5 866.5Q665 834 627 772Q603 734 593.5 680.0Q584 626 584 516V0H291V1120H584V946Q627 1042 716.0 1094.5Q805 1147 924 1147Q984 1147 1041.5 1132.5Q1099 1118 1151 1090Z"},"A":{"advance":1233,"path":"M616 1223 477 612H756ZM436 1493H797L1200 0H905L813 369H418L328 0H33Z"},"p":{"advance":1233,"path":"M442 158V-426H150V1120H442V952Q488 1049 563.0 1098.0Q638 1147 739 1147Q931 1147 1037.0 993.0Q1143 839 1143 559Q1143 275 1035.5 123.0Q928 -29 729 -29Q639 -29 567.5 17.5Q496 64 442 158ZM850 561Q850 723 796.0 815.0Q742 907 647 907Q552 907 497.0 815.0Q442 723 442 561Q442 399 497.0 307.0Q552 215 647 215Q742 215 796.0 307.0Q850 399 850 561Z"},"y":{"advance":1233,"path":"M711 -67Q652 -153 569.5 -193.0Q487 -233 369 -233H127V-111H246Q336 -111 378.0 -94.0Q420 -77 463 -16L485 31L59 1120H367L623 393L868 1120H1176Z"},"u":{"advance":1233,"path":"M160 391V1120H453V436Q453 315 487.0 263.0Q521 211 600 211Q679 211 723.5 281.0Q768 351 768 477V1120H1061V0H768V166Q737 73 662.5 22.0Q588 -29 483 -29Q323 -29 241.5 77.0Q160 183 160 391Z"},"l":{"advance":1233,"path":"M387 467V1331H90V1556H680V467Q680 335 721.0 280.0Q762 225 860 225H1094V0H778Q569 0 478.0 108.0Q387 216 387 467Z"},"g":{"advance":1233,"path":"M803 578Q803 728 746.0 818.5Q689 909 596 909Q504 909 447.5 819.0Q391 729 391 578Q391 426 447.5 336.0Q504 246 596 246Q689 246 746.0 336.5Q803 427 803 578ZM1096 84Q1096 -185 974.5 -304.5Q853 -424 580 -424Q488 -424 398.0 -410.5Q308 -397 215 -369V-100Q298 -146 384.0 -168.0Q470 -190 561 -190Q685 -190 744.0 -131.5Q803 -73 803 51V172Q760 92 689.0 53.0Q618 14 516 14Q324 14 211.0 164.0Q98 314 98 571Q98 837 211.0 993.0Q324 1149 514 1149Q610 1149 685.0 1104.0Q760 1059 803 977V1120H1096Z"},"o":{"advance":1233,"path":"M616 909Q511 909 451.0 816.5Q391 724 391 559Q391 394 451.0 301.5Q511 209 616 209Q722 209 782.0 301.5Q842 394 842 559Q842 724 782.0 816.5Q722 909 616 909ZM98 559Q98 830 238.5 988.5Q379 1147 616 1147Q854 1147 994.5 988.5Q1135 830 1135 559Q1135 288 994.5 129.5Q854 -29 616 -29Q379 -29 238.5 129.5Q98 288 98 559Z"},"S":{"advance":1233,"path":"M510 655Q287 740 208.0 833.5Q129 927 129 1085Q129 1288 259.0 1404.0Q389 1520 616 1520Q719 1520 822.0 1496.5Q925 1473 1026 1427V1139Q931 1206 833.0 1241.0Q735 1276 639 1276Q532 1276 475.0 1233.0Q418 1190 418 1110Q418 1048 459.5 1007.5Q501 967 633 918L760 870Q940 804 1025.0 695.0Q1110 586 1110 420Q1110 194 976.5 82.5Q843 -29 573 -29Q462 -29 350.5 -2.5Q239 24 135 76V381Q253 297 363.5 256.0Q474 215 582 215Q691 215 751.0 264.5Q811 314 811 403Q811 470 771.0 520.5Q731 571 655 600Z"},"O":{"advance":1233,"path":"M616 1255Q503 1255 451.0 1134.5Q399 1014 399 745Q399 477 451.0 356.5Q503 236 616 236Q730 236 782.0 356.5Q834 477 834 745Q834 1014 782.0 1134.5Q730 1255 616 1255ZM92 745Q92 1128 224.5 1324.0Q357 1520 616 1520Q876 1520 1008.5 1324.0Q1141 1128 1141 745Q1141 363 1008.5 167.0Q876 -29 616 -29Q357 -29 224.5 167.0Q92 363 92 745Z"},"c":{"advance":1233,"path":"M1061 57Q987 14 902.0 -7.5Q817 -29 719 -29Q460 -29 314.0 127.0Q168 283 168 559Q168 836 315.0 992.5Q462 1149 721 1149Q811 1149 894.5 1128.0Q978 1107 1061 1063V795Q997 850 920.5 879.5Q844 909 762 909Q619 909 542.0 818.0Q465 727 465 559Q465 391 542.0 301.0Q619 211 762 211Q847 211 921.0 239.5Q995 268 1061 326Z"},"N":{"advance":1233,"path":"M119 1493H436L852 408V1493H1112V0H797L379 1085V0H119Z"},"v":{"advance":1233,"path":"M1153 1120 797 0H436L80 1120H377L616 246L856 1120Z"},"D":{"advance":1233,"path":"M432 1227V266H512Q686 266 760.0 375.5Q834 485 834 748Q834 1009 760.0 1118.0Q686 1227 512 1227ZM137 1493H453Q819 1493 980.0 1318.5Q1141 1144 1141 748Q1141 351 980.0 175.5Q819 0 453 0H137Z"}," ":{"advance":1233,"path":""},",":{"advance":1233,"path":"M461 329H784V0H730V-73H622V-146H461V-183H353V-110H461Z"},"t":{"advance":1233,"path":"M690 1438V1120H1073V895H690V365Q690 290 726.5 257.5Q763 225 848 225H1073V0H827Q575 0 486.0 80.5Q397 161 397 379V895H111V1120H397V1438Z"},":":{"advance":1233,"path":"M449 1063H782V698H449ZM449 367H782V0H449Z"},"P":{"advance":1233,"path":"M457 1245V807H578Q723 807 781.5 856.0Q840 905 840 1026Q840 1147 781.5 1196.0Q723 1245 578 1245ZM162 1493H567Q876 1493 1011.5 1383.0Q1147 1273 1147 1026Q1147 779 1011.5 669.0Q876 559 567 559H457V0H162Z"}};
  function renderDateOutline(value) {
    let advance = 0;
    const outlines = [];
    for (const character of value) {
      const glyph = dateGlyphs[character];
      if (!glyph) continue;
      if (glyph.path) outlines.push(`<path transform="translate(${advance} 0)" d="${glyph.path}"/>`);
      advance += glyph.advance;
    }
    const widthMm = advance / 2048 * 7 * .68;
    dateNode.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -1901 ${advance} 2384" width="${widthMm}mm" height="8.1484375mm" preserveAspectRatio="none" role="img" aria-label="${value}"><title>${value}</title><g fill="#000" fill-rule="nonzero" stroke="none" transform="scale(1 -1)">${outlines.join('')}</g></svg>`;
  }
  function renderTimeOutline(value) {
    let advance = 0;
    const outlines = [];
    for (const character of value) {
      const glyph = dateGlyphs[character];
      if (!glyph) continue;
      if (glyph.path) outlines.push(`<path transform="translate(${advance} 0)" d="${glyph.path}"/>`);
      advance += glyph.advance;
    }
    const widthMm = advance / 2048 * 7.2 * .68;
    timeNode.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -1901 ${advance} 2384" width="${widthMm}mm" height="8.38125mm" preserveAspectRatio="none" role="img" aria-label="${value}"><title>${value}</title><g fill="#000" fill-rule="nonzero" stroke="none" transform="scale(1 -1)">${outlines.join('')}</g></svg>`;
  }
  const zone = 'America/Regina';
  const dateParts = new Intl.DateTimeFormat('en-US', {timeZone:zone,year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',hour12:true});
  const liveTime = new Intl.DateTimeFormat('en-US', {timeZone:zone,hour:'numeric',minute:'2-digit',second:'2-digit',hour12:true});
  const liveDate = new Intl.DateTimeFormat('en-US', {timeZone:zone,year:'numeric',month:'short',day:'numeric'});
  let lastReceiptText = null;
  function clearExpiry() {
    if(lastReceiptText === "pending") return; lastReceiptText = "pending";
    timeNode.innerHTML='<span class="pending-time">--:-- --</span>';
    dateNode.innerHTML='<span class="pending-date">Waiting for internet time</span>';
    timeNode.removeAttribute('datetime'); dateNode.removeAttribute('datetime');
  }
  function refreshExpiry(now) {
    if (!Number.isFinite(now)) { clearExpiry(); return; }
    const expiry = new Date(now + 90 * 60 * 1000);
    const parts = Object.fromEntries(dateParts.formatToParts(expiry).map(part=>[part.type,part.value]));
    const nextReceiptText = `${parts.hour}:${parts.minute} ${parts.dayPeriod}|${parts.month} ${parts.day},${parts.year}`;
    if(nextReceiptText !== lastReceiptText) {
      renderTimeOutline(`${parts.hour}:${parts.minute} ${parts.dayPeriod}`);
      renderDateOutline(`${parts.month} ${parts.day},${parts.year}`);
      lastReceiptText = nextReceiptText;
    }
    timeNode.dateTime = expiry.toISOString(); dateNode.dateTime = expiry.toISOString();
  }
  function updatePageSize() {
    const heightMm = Math.ceil(ticket.getBoundingClientRect().height * 25.4 / 96 + 1);
    pageStyle.textContent = `@page { size: ${paperWidth}mm ${heightMm}mm; margin: 0; }`;
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
    let checking=false, checkingTime=false, printing=false, clock=null, paperReady=false;
    const printLabel = document.getElementById('print-label');
    const paperError=document.getElementById('paper-error');
    const printTime=document.getElementById('print-time');
    let paperState=null, savingPaper=false, service=null, servicePending=false;
    const serviceNote=document.getElementById('service-countdown');
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
    function paintClock() {
      const elapsed=clock ? performance.now()-clock.atMono : 0;
      const age=clock?.ageMs === null || clock?.ageMs === undefined ? null : clock.ageMs+elapsed;
      const fresh=clock?.status==='synced' && elapsed>=0 && age!==null && age<=clock.maxAgeMs;
      const state=fresh ? 'synced' : (Number.isFinite(clock?.epochMs) ? 'stale' : 'unavailable');
      setStatus(timeStatus, 'state', state);
      const description=state==='synced' ? 'Saskatoon time, set from the internet.' : state==='stale' ? 'Clock lost its internet connection. Printing is paused.' : 'Connect to the internet to set the clock. Printing is paused.';
      timeStatus.title=description; timeStatus.setAttribute('aria-label',description);
      const instant=Number.isFinite(clock?.epochMs) && elapsed>=0 ? clock.epochMs+elapsed : null;
      currentTime.textContent=instant===null ? 'Time unavailable' : (state==='stale' ? '~ ' : '')+liveTime.format(instant);
      currentDate.textContent=instant===null ? '' : liveDate.format(instant);
      currentTime.title=description; currentDate.title='Saskatoon';
      if(instant===null) clearExpiry(); else refreshExpiry(instant);
      const serviceNow=service&&Number.isFinite(service.now)?service.now+performance.now()-service.atMono:null;
      const serviceFresh=serviceNow!==null&&performance.now()-service.atMono<5000&&serviceNow<service.validUntil;
      const allowed=serviceFresh&&service.allowed;
      const remaining=serviceFresh&&service.status==='off-hours'&&Number.isFinite(service.nextStart)?Math.max(0,Math.ceil((service.nextStart-serviceNow)/1000)):null;
      const countdown=remaining===null?'':Math.floor(remaining/3600)+':'+String(Math.floor(remaining/60)%60).padStart(2,'0')+':'+String(remaining%60).padStart(2,'0');
      serviceNote.textContent=allowed?'':remaining!==null?'Buses start in '+countdown:serviceFresh&&service.status==='off-hours'?'No more buses scheduled':service?.reason&&service.status==='unknown'?service.reason:'Checking bus times';
      serviceNote.hidden=allowed;
      serviceNote.title=''+(remaining!==null?'Next start: '+liveDate.format(service.nextStart)+', '+liveTime.format(service.nextStart)+' Saskatoon.':'');
      printButton.disabled=printing || !fresh || !paperReady || !allowed;
      printTime.disabled=printing;
      printButton.title=!fresh?description:allowed?'Print the sample receipt':serviceNote.textContent+' (scheduled service, not live operations)';
      const solar=Number.isFinite(instant)?window.SolarTheme?.themeAt(instant):null;
      const phase=solar?.theme==='light'?'sun':solar?.theme==='dark'?'moon':'unknown';
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
      if(checking)return; checking=true;
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
    setInterval(checkStatus,5000); setInterval(checkTime,1000); setInterval(paintClock,250);
    printButton.addEventListener('click',async()=>{
      if(printButton.disabled)return;
      const printedAt=printTime.value.trim();
      printing=true; printLabel.textContent='PRINTING...'; printButton.dataset.printing='true'; paintClock();
      try { await window.sampleApp.print(printedAt ? {printedAt} : undefined); }
      finally { printing=false; printLabel.textContent='PRINT'; printButton.dataset.printing='false'; await checkTime(); await checkStatus(); }
    });
  }
})();
