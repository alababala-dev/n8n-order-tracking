/**
 * PRODUCTION-READY ORDER TRACKER BACKEND
 * * Logic:
 * 1. Receives order updates from n8n (POST).
 * 2. Provides order status lookups for the front-end (GET).
 * 3. Automatically advances order status based on Israel business days.
 */

/***** CONFIGURATION (Replace with your own values) *****/
const SHEET_NAME     = 'Orders';
const TZ             = 'Asia/Jerusalem';
const SITE_BASE      = 'https://your-tracking-frontend.com/'; 
const SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID_HERE'; 
const SHARED_SECRET  = 'YOUR_SECURE_TOKEN_HERE';

/***** UI MENU *****/
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Tracker Tools')
    .addItem('Backfill all links', 'backfillAllTrackerUrls')
    .addItem('Update link for selected row', 'updateLinkForActiveRow')
    .addToUi();
}

/***** WEB HANDLERS *****/
function doGet(e) {
  // Healthcheck
  if (e && e.parameter && e.parameter.ping === '1') {
    return ContentService.createTextOutput('PONG').setMimeType(ContentService.MimeType.TEXT);
  }
  return _realDoGet(e);
}

function doPost(e) {
  if (e && e.parameter && e.parameter.ping === '1') {
    return ContentService.createTextOutput('PONG').setMimeType(ContentService.MimeType.TEXT);
  }
  return _realDoPost(e);
}

/** Fetch order data for the frontend tracker */
function _realDoGet(e) {
  var o = (e && e.parameter && e.parameter.o || '').trim();
  var t = (e && e.parameter && e.parameter.t || '').trim();
  var cb = (e && e.parameter && e.parameter.callback) || '';
  var api = (e && e.parameter && e.parameter.api) || '';

  var row = findOrder(o, t);

  var payload = row ? {
    ok: true,
    order_id: row.order_id,
    customer_name: row.customer_name,
    status_step: row.status_step,
    updated_at: row.updated_at
  } : {
    ok: false,
    error: 'Order not found.'
  };

  var text = JSON.stringify(payload);

  if (api && cb) {
    return ContentService.createTextOutput(cb + '(' + text + ')').setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.JSON);
}

/** Receive and log updates from n8n */
function _realDoPost(e) {
  try {
    var parsed = parseIncoming_(e);
    var secret = parsed.body.secret || (e && e.parameter && e.parameter.secret) || '';

    // Authorization
    if (SHARED_SECRET && secret !== SHARED_SECRET) {
      return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'unauthorized' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Logging for failed updates from n8n
    if (parsed.body && parsed.body.event === 'failed_update') {
      appendLog_(_getSheet(), parsed.body);
      return ContentService.createTextOutput(JSON.stringify({ ok: true, logged: true }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Process and Upsert Order Data
    var body = parsed.body || {};
    var order_id = body.order_id || body.id || (body.order && body.order.id);
    var fname = body.customer_name || 'Customer';
    var status_step = body.status_step || 1;

    if (!order_id) {
      return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'missing order_id' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var sh = _getSheet();
    var res = upsertOrderRow_(sh, { order_id: order_id, customer_name: fname, status_step: status_step });

    return ContentService.createTextOutput(JSON.stringify({
      ok: true,
      order_id: String(order_id),
      tracker_url: res.tracker_url
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function appendLog_(sh, log) {
  var logSheet = SpreadsheetApp.getActive().getSheetByName('Logs') || SpreadsheetApp.getActive().insertSheet('Logs');
  if (logSheet.getLastRow() === 0) {
    logSheet.appendRow(['ts','order_id','customer_name','status_step','reason','remote_ip']);
  }
  logSheet.appendRow([
    String(log.ts || ''),
    String(log.order_id || ''),
    String(log.customer_name || ''),
    Number(log.status_step || 0),
    String(log.reason || ''),
    String(log.remote_ip || '')
  ]);
}

function parseIncoming_(e){
  var body = {};
  if (e && e.postData && e.postData.contents) {
    try { body = JSON.parse(e.postData.contents); } catch(_) {}
  }
  return { body: body, parameter: (e && e.parameter) || {} };
}


/***** SHEET HELPERS *****/
function _getSheet() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) throw new Error('Sheet not found: ' + SHEET_NAME);
  return sh;
}

function _getHeaderIndexes(sh) {
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var idx = {};
  headers.forEach(function(h, i){ idx[String(h).trim()] = i; });
  ['order_id','customer_name','status_step','token','updated_at','tracker_url'].forEach(function(h){
    if (!(h in idx)) throw new Error('Missing header: ' + h);
  });
  return idx;
}

function _makeToken_(len) {
  var raw = Utilities.getUuid().replace(/-/g, '') + Math.random().toString(36).slice(2);
  return raw.slice(0, len || 16);
}

function _ensureTokenForRow_(sh, rowIndex, idx) {
  var tokenCell = sh.getRange(rowIndex, idx.token + 1);
  var token = String(tokenCell.getValue() || '').trim();
  if (!token) {
    token = _makeToken_(16);
    tokenCell.setValue(token);
  }
  return token;
}

function _touchUpdatedAt_(sh, rowIndex, idx) {
  var cell = sh.getRange(rowIndex, idx.updated_at + 1);
  cell.setValue(new Date());                  // store a real Date
  cell.setNumberFormat('dd/MM/yyyy');         // display format
}

/***** BUILD FULL TRACKER LINK *****/
function buildTrackerUrl(orderId, token, params) {
  function enc(k, v){ return encodeURIComponent(k) + '=' + encodeURIComponent(v); }
  var parts = [ enc('o', String(orderId)), enc('t', String(token)) ];
  if (params) {
    if (params.logo)      parts.push(enc('logo', params.logo));
    if (params.logoDark)  parts.push(enc('logoDark', params.logoDark));
    if (params.logoLight) parts.push(enc('logoLight', params.logoLight));
  }
  return SITE_BASE + '?' + parts.join('&');
}

/***** WRITE tracker_url FOR A SPECIFIC ROW *****/
function _setTrackerUrlForRow(sh, rowIndex, idx, params) {
  var lastCol = sh.getLastColumn();
  var row = sh.getRange(rowIndex, 1, 1, lastCol).getValues()[0];

  var orderId = String(row[idx.order_id] || '').trim();
  if (!orderId) return;

  var token = String(row[idx.token] || '').trim();
  if (!token) {
    token = _makeToken_(16);
    sh.getRange(rowIndex, idx.token + 1).setValue(token);
  }

  var link = buildTrackerUrl(orderId, token, params || null);
  sh.getRange(rowIndex, idx.tracker_url + 1).setValue(link);
}

/***** MENU: BACKFILL ALL ROWS *****/
function backfillAllTrackerUrls() {
  var sh = _getSheet();
  var idx = _getHeaderIndexes(sh);
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return;

  for (var r = 2; r <= lastRow; r++) {
    _setTrackerUrlForRow(sh, r, idx, null);
  }
  SpreadsheetApp.getActive().toast('tracker_url filled for all rows');
}

/***** MENU: UPDATE ONLY THE SELECTED ROW *****/
function updateLinkForActiveRow() {
  var sh = _getSheet();
  var r = sh.getActiveRange().getRow();
  if (r === 1) { SpreadsheetApp.getActive().toast('Select a data row (not the header)'); return; }
  var idx = _getHeaderIndexes(sh);
  _setTrackerUrlForRow(sh, r, idx, null);
  SpreadsheetApp.getActive().toast('tracker_url updated for row ' + r);
}

/***** AUTO-FILL ON EDIT + STAMP updated_at (no loops) *****/
function onEdit(e) {
  try {
    if (!e) return;
    var sh = e.range.getSheet();
    if (sh.getName() !== SHEET_NAME) return;

    var idx = _getHeaderIndexes(sh);
    var r   = e.range.getRow();
    if (r === 1) return; // header

    var editedCol = e.range.getColumn();
    var ignoreCols = [ idx.tracker_url + 1, idx.updated_at + 1 ]; // ignore our own writes / manual date tweaks

    // If user edits anything meaningful in the row, stamp updated_at
    if (ignoreCols.indexOf(editedCol) === -1) {
      _touchUpdatedAt_(sh, r, idx);
    }

    // Build/refresh the link whenever we have order_id + token
    var orderId = String(sh.getRange(r, idx.order_id + 1).getValue() || '').trim();
    if (!orderId) return;

    var token = _ensureTokenForRow_(sh, r, idx);
    var link  = buildTrackerUrl(orderId, token, null);

    var urlCell = sh.getRange(r, idx.tracker_url + 1);
    if (String(urlCell.getValue() || '') !== link) {
      urlCell.setValue(link); // retriggers onEdit, but ignored by ignoreCols
    }
  } catch (err) {
    Logger.log(err);
  }
}

/***** LOOKUP FOR THE API (used by doGet above) *****/
function findOrder(orderId, token) {
  if (!orderId || !token) return null;

  var sh = _getSheet();
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return null;

  var headers = values[0].map(function(h){ return String(h).trim(); });
  var idx = {};
  headers.forEach(function(h, i){ idx[h] = i; });

  var required = ['order_id','customer_name','status_step','token','updated_at'];
  for (var i = 0; i < required.length; i++) {
    if (!(required[i] in idx)) return null;
  }

  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var rowOrder = String(row[idx['order_id']]).trim();
    var rowToken = String(row[idx['token']]).trim();
    if (rowOrder === String(orderId) && rowToken === String(token)) {
      var name = row[idx['customer_name']] || '';
      var stepRaw = row[idx['status_step']];
      var step = parseInt(stepRaw, 10); if (isNaN(step)) step = 0;

      var upd = row[idx['updated_at']];
      var updatedStr = '';
      if (upd instanceof Date) {
        updatedStr = Utilities.formatDate(upd, TZ, 'dd/MM/yyyy'); // or 'HH:mm dd/MM/yyyy'
      } else if (upd !== '' && upd != null) {
        updatedStr = String(upd);
      }
      return {
        order_id: rowOrder,
        customer_name: String(name),
        status_step: step,
        updated_at: updatedStr
      };
    }
  }
  return null;
}

/***** UPSERT HELPERS *****/
function upsertOrderRow_(sh, data) {
  // expects: { order_id, customer_name, status_step }
  var idx = _getHeaderIndexes(sh);

  // Find by order_id
  var lastRow = sh.getLastRow();
  var count = Math.max(lastRow - 1, 0);
  var range = count > 0 ? sh.getRange(2, idx.order_id + 1, count, 1).getValues() : [];
  var targetRow = -1;
  for (var i = 0; i < range.length; i++) {
    if (String(range[i][0]).trim() === String(data.order_id)) {
      targetRow = 2 + i;
      break;
    }
  }

  // Create if missing
  if (targetRow === -1) {
    targetRow = lastRow + 1;
    sh.getRange(targetRow, idx.order_id + 1).setValue(String(data.order_id));
  }

  // Customer name
  if (data.customer_name) {
    sh.getRange(targetRow, idx.customer_name + 1).setValue(String(data.customer_name));
  }

  // Status step (default 1)
  var step = parseInt(data.status_step, 10);
  if (isNaN(step) || step < 1) step = 1;
  sh.getRange(targetRow, idx.status_step + 1).setValue(step);

  // Ensure token + link
  var token = _ensureTokenForRow_(sh, targetRow, idx);
  var link  = buildTrackerUrl(data.order_id, token, null);
  sh.getRange(targetRow, idx.tracker_url + 1).setValue(link);

  // Touch updated_at
  _touchUpdatedAt_(sh, targetRow, idx);

  return { row: targetRow, token: token, tracker_url: link, status_step: step };
}

/***** AUTO-ADVANCE STATUS BY BUSINESS DAYS (IL) *****/

// Business-day durations (in business days) from current step → next step
const STEP_DURATIONS = { 1: 1, 2: 2, 3: 1 }; // step 4 is terminal
const EXCLUDE_FRIDAY = true; // Israel: treat Friday as non-business day, like Saturday

// Public holiday calendars (either should exist on the account)
const HOLIDAY_CAL_IDS = [
  'en.il#holiday@group.v.calendar.google.com',
  'he.il#holiday@group.v.calendar.google.com'
];

/**
 * Run daily (create a trigger with installDailyStatusTrigger).
 * Advances status_step respecting IL business days and holidays.
 */
function runDailyStatus() {
  const sh = _getSheet();
  const idx = _getHeaderIndexes(sh);

  const lastRow = sh.getLastRow();
  if (lastRow < 2) return;

  const lastCol = sh.getLastColumn();
  const range = sh.getRange(2, 1, lastRow - 1, lastCol);
  const values = range.getValues();

  const today = _dateOnly_(new Date(), TZ);
  const holidayCal = _getILHolidayCalendar_();

  let changed = false;

  for (let r = 0; r < values.length; r++) {
    const row = values[r];

    // Skip empty lines (no order_id)
    const orderId = String(row[idx.order_id]).trim();
    if (!orderId) continue;

    // Current step
    let step = parseInt(row[idx.status_step], 10);
    if (!Number.isFinite(step) || step < 1) step = 1;
    if (step >= 4) continue; // final state

    // Reference date = last updated_at (or now if empty)
    let updatedAt = row[idx.updated_at];
    if (!(updatedAt instanceof Date)) {
      updatedAt = new Date();
      row[idx.updated_at] = updatedAt;
      changed = true;
    }

    let ref = _dateOnly_(updatedAt, TZ);
    let progressed = false;

    // Catch up if many days passed; advance step-by-step
    while (step < 4) {
      const neededBizDays = STEP_DURATIONS[step];
      if (!neededBizDays) break;

      const due = _addBusinessDaysIL_(ref, neededBizDays, holidayCal);
      // If today is on/after the due date → advance
      if (today.getTime() >= due.getTime()) {
        step += 1;
        ref = _dateOnly_(new Date(), TZ); // reset reference after each advance
        progressed = true;
      } else {
        break;
      }
    }

    if (progressed) {
      // Write back new step and updated_at
      row[idx.status_step] = step;
      row[idx.updated_at] = new Date();
      changed = true;
    }

    values[r] = row;
  }

  if (changed) {
    range.setValues(values);
    // Ensure formatting remains date-only
    sh.getRange(2, idx.updated_at + 1, lastRow - 1, 1).setNumberFormat('dd/MM/yyyy');
  }
}

/** Install a daily trigger at 09:00 IL time (run once). */
function installDailyStatusTrigger() {
  ScriptApp.newTrigger('runDailyStatus')
    .timeBased()
    .atHour(9)     // local TZ (set project TZ to Asia/Jerusalem)
    .everyDays(1)
    .create();
}

/***** Helpers for business-day calculations *****/

function _dateOnly_(d, tz) {
  return new Date(Utilities.formatDate(d, tz, 'yyyy-MM-dd')); // midnight in tz
}
function _addDays_(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

function _isBusinessDayIL_(d, holidayCal) {
  // 0=Sun ... 5=Fri, 6=Sat ; exclude Fri & Sat
  const dow = d.getDay();
  if (dow === 5 || dow === 6) return false; // Fri/Sat
  if (holidayCal) {
    // Any all-day holiday blocks the date
    const evs = holidayCal.getEventsForDay(d);
    if (evs && evs.some(ev => ev.isAllDayEvent())) return false;
  }
  return true;
}

function _addBusinessDaysIL_(startDate, days, holidayCal) {
  let d = new Date(startDate);
  let added = 0;
  while (added < days) {
    d = _addDays_(d, 1);
    if (_isBusinessDayIL_(d, holidayCal)) added++;
  }
  return d;
}

function _getILHolidayCalendar_() {
  for (const id of HOLIDAY_CAL_IDS) {
    try {
      const cal = CalendarApp.getCalendarById(id);
      if (cal) return cal;
    } catch (e) {}
  }
  // Fallback by name (depends on account language)
  const en = CalendarApp.getCalendarsByName('Holidays in Israel');
  if (en && en.length) return en[0];
  const he = CalendarApp.getCalendarsByName('חגים בישראל');
  if (he && he.length) return he[0];
  return null; // if none, we still skip Fri/Sat

