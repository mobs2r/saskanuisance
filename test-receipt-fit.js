'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

const electron = require('electron');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'receipt-fit-'));
const run = spawnSync(electron, ['.', '--receipt-fit=' + dir, '--no-sandbox', '--disable-gpu', '--ozone-platform=headless'], {
  cwd: __dirname,
  encoding: 'utf8',
  timeout: 90000,
  env: {...process.env, ELECTRON_DISABLE_SANDBOX: '1'}
});
const reportPath = path.join(dir, 'fit.json');
const report = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8')) : null;
if (run.status !== 0 || !report || report.ok !== true) {
  console.error(run.stdout);
  console.error(run.stderr);
  console.error(report);
  assert.fail(report?.message || 'offscreen renderReceipt failed');
}
assert.equal(report.width, 448);
assert.ok(report.height >= 500 && report.height <= 1600, 'ticket height ' + report.height);
assert.ok(report.chunks >= 3 && report.chunks <= 41);
assert.equal(report.timeText, '6:45 PM');
assert.equal(report.dateText, 'MAR 8,2026');
assert.doesNotMatch(report.message || '', /does not fit/);
const payload = fs.readFileSync(path.join(dir, 'payload.bin'));
const helper = path.join(__dirname, 'ReceiptPrint.exe');
if (fs.existsSync(helper)) {
  const dry = spawnSync(process.platform === 'win32' ? helper : 'mono', process.platform === 'win32' ? ['--dry-run'] : [helper, '--dry-run'], {input: payload, encoding: 'utf8'});
  if (dry.status === 0) {
    const parsed = JSON.parse(dry.stdout);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.printerOpened, false);
    assert.equal(parsed.bytes, report.bytes);
  } else if (process.platform === 'win32') {
    console.error(dry.stdout);
    console.error(dry.stderr);
    assert.fail('real receipt dry-run failed');
  }
}
if (process.platform === 'win32') {
  assert.equal(report.dryRun.printerOpened, false);
  assert.equal(report.dryRun.ok, true);
  assert.equal(report.dryRun.bytes, report.bytes);
}
console.log('FIT width ' + report.width + ', height ' + report.height + ', chunks ' + report.chunks + ', bytes ' + report.bytes);
