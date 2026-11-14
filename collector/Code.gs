/**
 * Unfill playtest collector: a Google Apps Script web app that writes each finished level to this Google Sheet.
 * Setup steps are in collector/README.md. The game (src/app/game/playtest.ts) POSTs {v: 1, events: [...]} as text.
 *
 * Tabs it makes:
 *   Plays   one row per finished level ("level") or app open ("open"); columns are COLUMNS below
 *   Errors  anything it couldn't read, kept whole so nothing is lost
 * gen/tuning/playtest.ts reads Plays (File > Download > Comma-separated values) to compare players with the bots.
 */

var COLUMNS = [
  'received', 'id', 'type', 'name', 'device', 'app', 'at',
  'run', 'n', 'board', 'role', 'tier', 'cols', 'rows', 'colors',
  'solverPar', 'par', 'grant', 'movesStart', 'movesLeft', 'lifts', 'outcome', 'points', 'score',
  'startedAt', 'endedAt', 'activeSec', 'think', 'pour', 'taps', 'mirror', 'perm', 'resumes',
  'installed', 'ios', 'screen'
];
var MAX_EVENTS = 100;

function doPost(e) {
  var body = e && e.postData ? String(e.postData.contents || '') : '';
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    try {
      var data = JSON.parse(body);
      var events = data && Array.isArray(data.events) ? data.events.slice(0, MAX_EVENTS) : null;
      if (!events) throw new Error('no events');
      var plays = tab(ss, 'Plays', COLUMNS);
      // a row sent twice (the app closed before it heard back) is kept once
      var seen = {};
      var last = plays.getLastRow();
      if (last > 1) {
        var ids = plays.getRange(2, 2, last - 1, 1).getValues();
        for (var i = 0; i < ids.length; i++) seen[ids[i][0]] = true;
      }
      var now = new Date();
      var rows = [];
      for (var k = 0; k < events.length; k++) {
        var ev = events[k];
        if (!ev || typeof ev.id !== 'string' || typeof ev.device !== 'string' || seen[ev.id]) continue;
        seen[ev.id] = true;
        rows.push(COLUMNS.map(function (c) {
          return c === 'received' ? now : cell(ev[c]);
        }));
      }
      if (rows.length) plays.getRange(last + 1, 1, rows.length, COLUMNS.length).setValues(rows);
      return reply({ ok: true, added: rows.length });
    } catch (err) {
      tab(ss, 'Errors', ['received', 'error', 'body']).appendRow([new Date(), String(err), body.slice(0, 45000)]);
      return reply({ ok: false, error: String(err) });
    }
  } finally {
    lock.releaseLock();
  }
}

/** Opening the web app's URL in a browser shows this, to check the deployment works. */
function doGet() {
  return ContentService.createTextOutput('Unfill playtest collector is running.');
}

/** Lists and objects as JSON text; text that a Sheet would read as a formula gets a leading apostrophe. */
function cell(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  if (typeof v === 'string') {
    var s = v.slice(0, 2000);
    return /^[=+\-@]/.test(s) ? "'" + s : s;
  }
  return v;
}

function tab(ss, name, header) {
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(header);
    sh.setFrozenRows(1);
  }
  return sh;
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
