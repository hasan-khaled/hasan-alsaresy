/**
 * sheets.js — Google Sheets API v4 operations
 * All sheet names and column headers stay in English (data layer).
 * All user-facing status messages are in Arabic.
 */

import { getToken, ensureValidToken, refreshToken } from './auth.js';

const BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

// Sheet definitions: name → header row
const SHEET_HEADERS = {
  Sales:     ['ID', 'Date', 'Description', 'Amount'],
  Purchases: ['ID', 'Date', 'Description', 'Amount'],
  Expenses:  ['ID', 'Date', 'Description', 'Amount'],
  Employees: ['ID', 'Name', 'MonthlySalary', 'LoanBalance', 'LastUpdated'],
};

/* ─────────────────────────────────────────────
   Status bar bridge (set by app.js on window)
───────────────────────────────────────────── */
function setStatus(type) {
  if (typeof window.__setStatus === 'function') window.__setStatus(type);
}
function setStatusOffline() {
  if (typeof window.__setStatusOffline === 'function') window.__setStatusOffline();
}

/* ─────────────────────────────────────────────
   Auth headers
───────────────────────────────────────────── */
function authHeaders() {
  return {
    'Authorization': `Bearer ${getToken()}`,
    'Content-Type':  'application/json',
  };
}

/* ─────────────────────────────────────────────
   Core fetch wrapper
   - Validates token before every call
   - On 401: silent refresh + one retry
   - On network error: offline status message
   - Returns parsed JSON or null
───────────────────────────────────────────── */
async function apiFetch(url, options = {}, isRetry = false) {
  setStatus('saving');
  try {
    const ready = await ensureValidToken();
    if (!ready) { setStatus('error'); return null; }

    options.headers = { ...authHeaders(), ...(options.headers || {}) };

    const response = await fetch(url, options);

    if (response.status === 401 && !isRetry) {
      const refreshed = await refreshToken();
      if (!refreshed) { setStatus('error'); return null; }
      return apiFetch(url, options, true);
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.error('[Sheets] API error', response.status, errText);
      setStatus('error');
      return null;
    }

    const data = await response.json();
    setStatus('saved');
    return data;

  } catch (err) {
    if (!navigator.onLine) {
      setStatusOffline();
    } else {
      console.error('[Sheets] fetch error:', err);
      setStatus('error');
    }
    return null;
  }
}

/* ─────────────────────────────────────────────
   Private helpers
───────────────────────────────────────────── */

/** Fetch raw rows from a sheet, header row stripped */
async function _getRawRows(spreadsheetId, sheetName) {
  const range  = encodeURIComponent(sheetName);
  const result = await apiFetch(`${BASE}/${spreadsheetId}/values/${range}`);
  if (!result) return null;
  const rows = result.values || [];
  return rows.slice(1); // strip header row
}

/** Column number (1-indexed) → letter: 1→A, 2→B … */
function _colLetter(n) {
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Sanitize row values — null/undefined → empty string */
function _sanitize(arr) {
  return arr.map(v => (v === undefined || v === null) ? '' : v);
}

/** Raw row array → transaction object */
function _mapTransaction(row) {
  return {
    id:          String(row[0] || ''),
    date:        String(row[1] || ''),
    description: String(row[2] || ''),
    amount:      parseFloat(row[3]) || 0,
  };
}

/** Raw row array → employee object */
function _mapEmployee(row) {
  return {
    id:          String(row[0] || ''),
    name:        String(row[1] || ''),
    salary:      parseFloat(row[2]) || 0,
    loanBalance: parseFloat(row[3]) || 0,
    lastUpdated: String(row[4] || ''),
  };
}

/* ═══════════════════════════════════════════════
   PUBLIC API
═══════════════════════════════════════════════ */

/**
 * Ensure all 4 required sheets exist in the spreadsheet.
 * Creates missing sheets and writes header rows.
 * Never overwrites existing sheets.
 * Returns true on success, false on failure.
 */
export async function initSpreadsheet(spreadsheetId) {
  setStatus('saving');

  // 1. Fetch existing sheet names
  const meta = await apiFetch(
    `${BASE}/${spreadsheetId}?fields=sheets.properties.title`
  );
  if (!meta) return false;

  const existing = new Set((meta.sheets || []).map(s => s.properties.title));

  // 2. Build addSheet requests for missing sheets
  const addReqs = Object.keys(SHEET_HEADERS)
    .filter(name => !existing.has(name))
    .map(name => ({ addSheet: { properties: { title: name } } }));

  if (addReqs.length > 0) {
    const ok = await apiFetch(`${BASE}/${spreadsheetId}:batchUpdate`, {
      method: 'POST',
      body:   JSON.stringify({ requests: addReqs }),
    });
    if (!ok) return false;
  }

  // 3. Add header rows to newly created sheets
  const headerData = Object.keys(SHEET_HEADERS)
    .filter(name => !existing.has(name))
    .map(name => ({ range: `${name}!A1`, values: [SHEET_HEADERS[name]] }));

  if (headerData.length > 0) {
    const ok = await apiFetch(`${BASE}/${spreadsheetId}/values:batchUpdate`, {
      method: 'POST',
      body:   JSON.stringify({ valueInputOption: 'RAW', data: headerData }),
    });
    if (!ok) return false;
  }

  setStatus('saved');
  return true;
}

/**
 * Append a row to a sheet.
 * rowData: array of values — [id, date, description, amount]
 */
export async function appendRow(spreadsheetId, sheetName, rowData) {
  const range = encodeURIComponent(`${sheetName}!A:A`);
  const result = await apiFetch(
    `${BASE}/${spreadsheetId}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { method: 'POST', body: JSON.stringify({ values: [_sanitize(rowData)] }) }
  );
  return result !== null;
}

/**
 * Update an existing row identified by its ID (column A value).
 */
export async function updateRow(spreadsheetId, sheetName, rowId, newRowData) {
  const rows = await _getRawRows(spreadsheetId, sheetName);
  if (!rows) return false;

  const idx = rows.findIndex(r => r[0] === String(rowId));
  if (idx === -1) {
    console.warn('[Sheets] updateRow: id not found:', rowId);
    return false;
  }

  const sheetRow = idx + 2; // +1 for 1-index, +1 for header row
  const range    = encodeURIComponent(`${sheetName}!A${sheetRow}`);

  const result = await apiFetch(
    `${BASE}/${spreadsheetId}/values/${range}?valueInputOption=RAW`,
    { method: 'PUT', body: JSON.stringify({ values: [_sanitize(newRowData)] }) }
  );
  return result !== null;
}

/**
 * Clear a row identified by its ID (column A value).
 * Does NOT delete the row — just empties the cells.
 * App filters empty rows on load by checking if column A is empty.
 */
export async function clearRow(spreadsheetId, sheetName, rowId) {
  const rows = await _getRawRows(spreadsheetId, sheetName);
  if (!rows) return false;

  const idx = rows.findIndex(r => r[0] === String(rowId));
  if (idx === -1) {
    console.warn('[Sheets] clearRow: id not found:', rowId);
    return false;
  }

  const sheetRow  = idx + 2;
  const colCount  = SHEET_HEADERS[sheetName]?.length || 5;
  const lastCol   = _colLetter(colCount);
  const range     = encodeURIComponent(
    `${sheetName}!A${sheetRow}:${lastCol}${sheetRow}`
  );

  const result = await apiFetch(
    `${BASE}/${spreadsheetId}/values/${range}:clear`,
    { method: 'POST', body: JSON.stringify({}) }
  );
  return result !== null;
}

/**
 * Get all non-empty data rows from a sheet (header stripped).
 * Returns array of arrays.
 */
export async function getAllRows(spreadsheetId, sheetName) {
  const rows = await _getRawRows(spreadsheetId, sheetName);
  if (!rows) return [];
  return rows.filter(r => r && r[0] && String(r[0]).trim() !== '');
}

/**
 * Sync all 4 sheets in parallel.
 * Returns { sales, purchases, expenses, employees } — each an array of objects.
 */
export async function syncAllData(spreadsheetId) {
  setStatus('saving');
  const [salesRaw, purchasesRaw, expensesRaw, employeesRaw] = await Promise.all([
    getAllRows(spreadsheetId, 'Sales'),
    getAllRows(spreadsheetId, 'Purchases'),
    getAllRows(spreadsheetId, 'Expenses'),
    getAllRows(spreadsheetId, 'Employees'),
  ]);
  setStatus('saved');
  return {
    sales:     salesRaw.map(_mapTransaction),
    purchases: purchasesRaw.map(_mapTransaction),
    expenses:  expensesRaw.map(_mapTransaction),
    employees: employeesRaw.map(_mapEmployee),
  };
}
