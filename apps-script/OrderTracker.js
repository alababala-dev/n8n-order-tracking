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


