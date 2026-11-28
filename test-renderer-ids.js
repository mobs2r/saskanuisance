'use strict';
// Regression: renderer.js dereferences getElementById() results directly. A missing id used to abort the whole UI script
// (clock, printer status and print button never started). Every id it uses must exist in index.html, or be guarded.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
const js=fs.readFileSync(path.join(__dirname,'renderer.js'),'utf8');
const optional=new Set(['token-choice','token-add']); // guarded with ?. / early return in renderer.js
const missing=[...new Set([...js.matchAll(/getElementById\('([^']+)'\)/g)].map(m=>m[1]))].filter(id=>!optional.has(id)&&!html.includes('id="'+id+'"'));
assert.deepEqual(missing,[],'renderer.js uses ids that index.html lacks: '+missing.join(', '));
console.log('PASS: every element id renderer.js requires exists in index.html.');
