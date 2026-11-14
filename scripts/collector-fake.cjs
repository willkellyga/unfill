// A stand-in for Google Apps Script that runs collector/Code.gs as it is, against an in-memory Sheet, so the
// collector and the game's upload can be tested without Will's Google account.
//
//   const { load, serve } = require('./collector-fake.cjs');
//   const gs = load();                 // gs.doPost({ postData: { contents } }), gs.sheet('Plays') -> rows
//   const srv = await serve(gs, 0);    // POST /exec like the web app; GET /plays.csv for the Plays tab as CSV
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const http = require('node:http');
const vm = require('node:vm');

function load() {
  const tabs = new Map();
  const makeSheet = (name) => {
    const rows = [];
    return {
      name,
      rows,
      appendRow: (r) => rows.push(r.slice()),
      setFrozenRows: () => {},
      getLastRow: () => rows.length,
      getRange: (row, col, nRows, nCols) => ({
        getValues: () => rows.slice(row - 1, row - 1 + nRows).map((r) => r.slice(col - 1, col - 1 + nCols)),
        setValues: (vals) => {
          if (vals.length !== nRows || vals.some((v) => v.length !== nCols)) throw new Error('setValues: size mismatch');
          vals.forEach((v, i) => {
            const r = (rows[row - 1 + i] = rows[row - 1 + i] || []);
            v.forEach((x, j) => (r[col - 1 + j] = x));
          });
        },
      }),
    };
  };
  const ss = {
    getSheetByName: (n) => tabs.get(n) || null,
    insertSheet: (n) => {
      const s = makeSheet(n);
      tabs.set(n, s);
      return s;
    },
  };
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (text) => ({ text, setMimeType() { return this; } }),
    },
    JSON,
    Date,
    String,
    Array,
  };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(join(__dirname, '..', 'collector', 'Code.gs'), 'utf8'), ctx);
  return {
    doPost: (e) => ctx.doPost(e),
    doGet: () => ctx.doGet(),
    sheet: (n) => (tabs.get(n) ? tabs.get(n).rows : null),
  };
}

const csvCell = (v) => {
  const s = v instanceof Date ? v.toISOString() : String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';

/** An HTTP server like the deployed web app. `requests` counts POSTs; `failNext` makes the next N fail. */
function serve(gs, port = 0) {
  const state = { requests: 0, failNext: 0 };
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url.startsWith('/plays.csv')) {
      res.writeHead(200, { 'Content-Type': 'text/csv' });
      res.end(toCsv(gs.sheet('Plays') || []));
      return;
    }
    if (req.method === 'GET') {
      res.end(gs.doGet().text);
      return;
    }
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      state.requests++;
      if (state.failNext > 0) {
        state.failNext--;
        req.socket.destroy(); // a network failure, as the phone would see it
        return;
      }
      const out = gs.doPost({ postData: { contents: body } });
      // Apps Script answers a POST with a redirect to the result; the browser follows it (and can't read it)
      res.writeHead(302, { Location: '/result?' + encodeURIComponent(out.text) });
      res.end();
    });
  });
  return new Promise((resolve) =>
    server.listen(port, () => resolve({ server, port: server.address().port, state, close: () => server.close() })),
  );
}

module.exports = { load, serve, toCsv };
