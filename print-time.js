'use strict';
function parsePrintedAt(input, now = new Date()) {
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const m = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const sec = Number(m[3] ?? 0);
  const mer = m[4]?.toLowerCase();
  if (mer) {
    if (h < 1 || h > 12) return null;
    if (mer === 'pm' && h !== 12) h += 12;
    if (mer === 'am' && h === 12) h = 0;
  }
  if (h > 23 || min > 59 || sec > 59) return null;
  const d = new Date(now);
  d.setHours(h, min, sec, 0);
  return d;
}
module.exports = {parsePrintedAt};
