'use strict';
const PROFILES=Object.freeze([Object.freeze({id:'roll57',label:'57 mm',description:'56 mm print area for 57 mm stock with a 4 mm left alignment correction for the manual guide. Physical roll feeding remains untested.',scale:1,rasterWidth:448,artworkMm:56,horizontalOffsetDots:-32})]);
function profileFor(id){if(id!=='roll57')throw Error('Unsupported paper layout.');return PROFILES[0];}
function savedProfile(){return 'roll57';}
module.exports={PROFILES,profileFor,savedProfile};
