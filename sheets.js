/**
 * sheets.js — Talks to the Google Apps Script web app.
 * No OAuth. No Google login. Just fetch().
 *
 * ⚠️ After deploying Code.gs, paste your web app URL below.
 */

export const SCRIPT_URL = 'YOUR_APPS_SCRIPT_URL_HERE';

// ── Branch keys used as query param values ─────────────────
export const BRANCH_KEYS = {
  'حسن':   'hasan',
  'أحمد':  'ahmad',
  'المحل': 'almahall',
};

/* ─── Status bar bridge ──────────────────────────────────── */
function setStatus(type) {
  if (typeof window.__setStatus === 'function') window.__setStatus(type);
}
function setStatusOffline() {
  if (typeof window.__setStatusOffline === 'function') window.__setStatusOffline();
}

/* ─── Core fetch wrapper ─────────────────────────────────── */
async function call(params) {
  setStatus('saving');
  try {
    const url = new URL(SCRIPT_URL);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    }

    const res  = await fetch(url.toString());
    const data = await res.json();

    if (data.error) {
      console.error('[Sheets]', data.error);
      setStatus('error');
      return null;
    }

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

/* ─── Map raw row arrays to objects ──────────────────────── */
function mapTransaction(row) {
  return {
    id:          String(row[0] || ''),
    date:        String(row[1] || ''),
    description: String(row[2] || ''),
    amount:      parseFloat(row[3]) || 0,
  };
}

function mapEmployee(row) {
  return {
    id:          String(row[0] || ''),
    name:        String(row[1] || ''),
    salary:      parseFloat(row[2]) || 0,
    loanBalance: parseFloat(row[3]) || 0,
    lastUpdated: String(row[4] || ''),
  };
}

/* ════════════════════════════════════════════
   PUBLIC API — mirrors the old sheets.js interface
════════════════════════════════════════════ */

export async function initSpreadsheet(branchKey) {
  const result = await call({ action: 'init', branch: branchKey });
  return result !== null;
}

export async function appendRow(branchKey, sheetName, rowData) {
  const result = await call({ action: 'append', branch: branchKey, sheet: sheetName, data: rowData });
  return result !== null;
}

export async function updateRow(branchKey, sheetName, rowId, newRowData) {
  const result = await call({ action: 'update', branch: branchKey, sheet: sheetName, rowId, data: newRowData });
  return result !== null;
}

export async function clearRow(branchKey, sheetName, rowId) {
  const result = await call({ action: 'clear', branch: branchKey, sheet: sheetName, rowId });
  return result !== null;
}

export async function syncAllData(branchKey) {
  const result = await call({ action: 'sync', branch: branchKey });
  if (!result || !result.data) return null;

  const d = result.data;
  return {
    sales:     (d.Sales     || []).map(mapTransaction),
    purchases: (d.Purchases || []).map(mapTransaction),
    expenses:  (d.Expenses  || []).map(mapTransaction),
    employees: (d.Employees || []).map(mapEmployee),
  };
}
