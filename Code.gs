/**
 * Code.gs — Google Apps Script Backend
 * ─────────────────────────────────────
 * Paste this entire file into script.google.com
 * Then deploy as a Web App (see README for steps).
 *
 * This script runs under YOUR Google account and writes
 * directly to the three spreadsheets — no login needed
 * by anyone using the website.
 */

// ── Spreadsheet IDs (one per branch) ──────────────────────
var SPREADSHEETS = {
  'hasan':    '1T7D6Dw7QnSWIX0LvASkRB70CdGiDkf2kOUsBz1Fr-dI',
  'ahmad':    '1yA3r5kLqpDIvrdLPBBzv_-VIFpZ7aNJzGBWhJFKtFF8',
  'almahall': '1JQvugRS_KkyA_0zOZ4Bc-aMrrUJUJ-tGe67KyVAOVYA',
};

// ── Sheet structure ────────────────────────────────────────
var SHEET_HEADERS = {
  'Sales':     ['ID', 'Date', 'Description', 'Amount'],
  'Purchases': ['ID', 'Date', 'Description', 'Amount'],
  'Expenses':  ['ID', 'Date', 'Description', 'Amount'],
  'Employees': ['ID', 'Name', 'MonthlySalary', 'LoanBalance', 'LastUpdated'],
};

// ── Entry point ────────────────────────────────────────────
function doGet(e) {
  try {
    var p      = e.parameter;
    var action = p.action;
    var branch = p.branch;
    var ssId   = SPREADSHEETS[branch];

    if (!ssId) return respond({ error: 'فرع غير معروف: ' + branch });

    if (action === 'sync')   return respond(syncAll(ssId));
    if (action === 'init')   return respond(initSheets(ssId));
    if (action === 'append') return respond(appendRow(ssId, p.sheet, JSON.parse(p.data)));
    if (action === 'update') return respond(updateRow(ssId, p.sheet, p.rowId, JSON.parse(p.data)));
    if (action === 'clear')  return respond(clearRow(ssId, p.sheet, p.rowId));

    return respond({ error: 'إجراء غير معروف: ' + action });

  } catch (err) {
    return respond({ error: err.toString() });
  }
}

// ── JSON response helper ───────────────────────────────────
function respond(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Sync all 4 sheets ──────────────────────────────────────
function syncAll(ssId) {
  var ss   = SpreadsheetApp.openById(ssId);
  var out  = {};

  Object.keys(SHEET_HEADERS).forEach(function (name) {
    var sheet = ss.getSheetByName(name);
    if (!sheet) { out[name] = []; return; }

    var vals = sheet.getDataRange().getValues();
    // Skip header row, skip empty rows (column A empty)
    out[name] = vals.slice(1).filter(function (row) {
      return row[0] !== '' && row[0] !== null && row[0] !== undefined;
    });
  });

  return { ok: true, data: out };
}

// ── Create missing sheets + header rows ────────────────────
function initSheets(ssId) {
  var ss = SpreadsheetApp.openById(ssId);

  Object.keys(SHEET_HEADERS).forEach(function (name) {
    var sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
      var headers = SHEET_HEADERS[name];
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    }
  });

  return { ok: true };
}

// ── Append a row ───────────────────────────────────────────
function appendRow(ssId, sheetName, rowData) {
  var ss    = SpreadsheetApp.openById(ssId);
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return { error: 'الورقة غير موجودة: ' + sheetName };

  sheet.appendRow(rowData);
  return { ok: true };
}

// ── Update a row by ID (column A) ─────────────────────────
function updateRow(ssId, sheetName, rowId, newRowData) {
  var ss    = SpreadsheetApp.openById(ssId);
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return { error: 'الورقة غير موجودة: ' + sheetName };

  var vals     = sheet.getDataRange().getValues();
  var rowIndex = -1;

  for (var i = 1; i < vals.length; i++) {
    if (String(vals[i][0]) === String(rowId)) { rowIndex = i + 1; break; }
  }

  if (rowIndex === -1) return { error: 'الصف غير موجود: ' + rowId };

  sheet.getRange(rowIndex, 1, 1, newRowData.length).setValues([newRowData]);
  return { ok: true };
}

// ── Clear a row by ID (column A) — does NOT delete the row ─
function clearRow(ssId, sheetName, rowId) {
  var ss    = SpreadsheetApp.openById(ssId);
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return { error: 'الورقة غير موجودة: ' + sheetName };

  var vals     = sheet.getDataRange().getValues();
  var rowIndex = -1;

  for (var i = 1; i < vals.length; i++) {
    if (String(vals[i][0]) === String(rowId)) { rowIndex = i + 1; break; }
  }

  if (rowIndex === -1) return { error: 'الصف غير موجود: ' + rowId };

  var colCount = SHEET_HEADERS[sheetName] ? SHEET_HEADERS[sheetName].length : 5;
  sheet.getRange(rowIndex, 1, 1, colCount).clearContent();
  return { ok: true };
}
