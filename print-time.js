'use strict';
const ZONE = 'America/Regina';     // CST year-round, no DST
const VALID_MINUTES = 90;

const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONE, hour12: true,
  hour: '2-digit', minute: '2-digit',
  month: 'short', day: '2-digit', year: 'numeric'
});

function stamp(epoch) {
  const p = Object.fromEntries(fmt.formatToParts(epoch).map(x => [x.type, x.value]));
  return {
    time: `${Number(p.hour)}:${p.minute} ${p.dayPeriod.toUpperCase()}`,
    date: `${p.month} ${p.day},${p.year}`   // deliberately no space after the comma
  };
}

function validUntil(issuedAt) {
  return new Date(issuedAt.getTime() + VALID_MINUTES * 60000);
}

module.exports = { stamp, validUntil, ZONE, VALID_MINUTES };
