/**
 * app.js — Main application logic
 * Entry point: loaded as <script type="module"> from index.html
 */

import { initAuth, signIn, signOut as authSignOut } from './auth.js';
import {
  initSpreadsheet,
  appendRow,
  updateRow,
  clearRow,
  syncAllData,
} from './sheets.js';

/* ─────────────────────────────────────────────
   Branch Configuration
───────────────────────────────────────────── */
const BRANCHES = {
  'حسن': {
    nameAr: 'حسن',
    spreadsheetKey: 'spreadsheetId_hasan',
    backupKey: 'backup_حسن',
  },
  'أحمد': {
    nameAr: 'أحمد',
    spreadsheetKey: 'spreadsheetId_ahmad',
    backupKey: 'backup_أحمد',
  },
  'المحل': {
    nameAr: 'المحل',
    spreadsheetKey: 'spreadsheetId_almahall',
    backupKey: 'backup_المحل',
  },
};

/* ─────────────────────────────────────────────
   App State
───────────────────────────────────────────── */
let state = {
  currentBranch: null,
  spreadsheetId: null,
  sales: [],
  purchases: [],
  expenses: [],
  employees: [],
};

/* ─────────────────────────────────────────────
   Arabic Utilities
───────────────────────────────────────────── */
const MONTHS_AR = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

function formatDate(str) {
  if (!str) return '—';
  const parts = str.split('-');
  if (parts.length !== 3) return str;
  const [y, m, d] = parts;
  const month = MONTHS_AR[parseInt(m, 10) - 1] || m;
  return `${parseInt(d, 10)} ${month} ${y}`;
}

function formatAmount(n) {
  const num = parseFloat(n) || 0;
  return num.toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' JD';
}

function generateId() {
  return Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

function getTodayString() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/* ─────────────────────────────────────────────
   Status Bar
───────────────────────────────────────────── */
let statusTimeout = null;

function setStatus(type) {
  const el = document.getElementById('status-text');
  if (!el) return;
  clearTimeout(statusTimeout);
  el.className = type;
  if (type === 'saving') {
    el.textContent = '⟳ جاري الحفظ...';
  } else if (type === 'saved') {
    el.textContent = '✓ تم حفظ البيانات';
    statusTimeout = setTimeout(() => {
      el.textContent = '';
      el.className = '';
    }, 3000);
  } else if (type === 'error') {
    el.textContent = '⚠ حدث خطأ أثناء الحفظ';
    statusTimeout = setTimeout(() => {
      el.textContent = '';
      el.className = '';
    }, 5000);
  }
}

function setStatusOffline() {
  const el = document.getElementById('status-text');
  if (!el) return;
  clearTimeout(statusTimeout);
  el.className = 'error';
  el.textContent = '⚠ لا يوجد اتصال — تم الحفظ محلياً';
}

// Expose to sheets.js via window
window.__setStatus = setStatus;
window.__setStatusOffline = setStatusOffline;

/* ─────────────────────────────────────────────
   Local Backup
───────────────────────────────────────────── */
function saveLocalBackup() {
  if (!state.currentBranch) return;
  const key = BRANCHES[state.currentBranch].backupKey;
  try {
    localStorage.setItem(key, JSON.stringify({
      sales: state.sales,
      purchases: state.purchases,
      expenses: state.expenses,
      employees: state.employees,
    }));
  } catch (e) {
    console.warn('[app] Could not save local backup:', e);
  }
}

function loadLocalBackup() {
  if (!state.currentBranch) return;
  const key = BRANCHES[state.currentBranch].backupKey;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data.sales)     state.sales     = data.sales;
    if (data.purchases) state.purchases = data.purchases;
    if (data.expenses)  state.expenses  = data.expenses;
    if (data.employees) state.employees = data.employees;
    renderAll();
  } catch (e) {
    console.warn('[app] Could not load local backup:', e);
  }
}

/* ─────────────────────────────────────────────
   Page Navigation
───────────────────────────────────────────── */
function showPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const target = document.getElementById(`page-${pageId}`);
  if (target) target.classList.add('active');
}

/* ─────────────────────────────────────────────
   Tab Switching
───────────────────────────────────────────── */
function switchTab(tabId, btnEl) {
  // Hide all tab contents
  document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
  // Deactivate all tab buttons
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  // Show selected
  const content = document.getElementById(`tab-${tabId}`);
  if (content) content.classList.add('active');
  if (btnEl) btnEl.classList.add('active');
}

// Expose to inline onclick
window.switchTab = switchTab;

/* ─────────────────────────────────────────────
   Form Validation
───────────────────────────────────────────── */
/**
 * Validate a single input field.
 * rules: { required, minLength, isPositiveNumber, isDate }
 * errorSpanId: ID of the <span> showing the error message
 * groupId: ID of the parent .form-group div
 * Returns true if valid.
 */
function validateField(inputEl, rules, groupId, errorSpanId, customMessage) {
  const group = document.getElementById(groupId);
  const errorSpan = document.getElementById(errorSpanId);
  const value = inputEl.value.trim();
  let errorMsg = '';

  if (rules.required && value === '') {
    errorMsg = customMessage || 'هذا الحقل مطلوب';
  } else if (rules.minLength && value.length < rules.minLength) {
    errorMsg = customMessage || 'يجب أن يكون الاسم أكثر من حرفين';
  } else if (rules.isPositiveNumber) {
    const num = parseFloat(value);
    if (isNaN(num) || num <= 0) {
      errorMsg = customMessage || 'يجب أن يكون المبلغ أكبر من صفر';
    }
  } else if (rules.isDate && value === '') {
    errorMsg = customMessage || 'يرجى إدخال تاريخ صحيح';
  }

  if (errorMsg) {
    if (group) group.classList.add('has-error');
    if (errorSpan) {
      errorSpan.textContent = errorMsg;
      errorSpan.style.display = 'block';
    }
    return false;
  } else {
    if (group) group.classList.remove('has-error');
    if (errorSpan) {
      errorSpan.textContent = '';
      errorSpan.style.display = 'none';
    }
    return true;
  }
}

function clearFieldError(groupId, errorSpanId) {
  const group = document.getElementById(groupId);
  const errorSpan = document.getElementById(errorSpanId);
  if (group) group.classList.remove('has-error');
  if (errorSpan) {
    errorSpan.textContent = '';
    errorSpan.style.display = 'none';
  }
}

/* ─────────────────────────────────────────────
   Login Flow
───────────────────────────────────────────── */
function selectBranch(branchName) {
  state.currentBranch = branchName;

  // Hide any previous login error
  const errEl = document.getElementById('login-error');
  if (errEl) errEl.style.display = 'none';

  // Trigger Google OAuth
  signIn((success, error) => {
    if (!success) {
      if (errEl) {
        if (error === 'client_id_not_set') {
          errEl.textContent = '⚠ لم يتم إعداد الـ Client ID بعد. افتح ملف auth.js وضع الـ Client ID الخاص بك.';
        } else if (error === 'popup_closed_by_user' || error === 'access_denied') {
          errEl.textContent = 'تم إلغاء تسجيل الدخول. اضغط مرة أخرى وأكمل خطوات Google.';
        } else {
          errEl.textContent = 'فشل تسجيل الدخول. تأكد من إعداد الـ Client ID ورابط GitHub Pages في Google Cloud.';
        }
        errEl.style.display = 'block';
      }
      state.currentBranch = null;
      return;
    }
    onAuthSuccess();
  });
}

// Expose to inline onclick
window.selectBranch = selectBranch;

async function onAuthSuccess() {
  const branchConfig = BRANCHES[state.currentBranch];
  const savedId = localStorage.getItem(branchConfig.spreadsheetKey);

  // Update top bar branch name
  const topbarBranch = document.getElementById('topbar-branch');
  if (topbarBranch) topbarBranch.textContent = `فرع: ${state.currentBranch}`;

  if (!savedId) {
    // First time for this branch — show setup
    const setupTitle = document.getElementById('setup-title');
    if (setupTitle) setupTitle.textContent = `إعداد جداول البيانات — فرع ${state.currentBranch}`;
    showPage('setup');
  } else {
    state.spreadsheetId = savedId;
    showPage('app');
    // Reset to overview tab
    const overviewBtn = document.querySelector('.tab-btn[data-tab="overview"]');
    switchTab('overview', overviewBtn);
    // Show local data immediately
    loadLocalBackup();
    renderAll();
    // Init sheets (ensure structure exists) then sync
    const ok = await initSpreadsheet(state.spreadsheetId);
    if (ok) {
      await loadFromSheets();
    }
  }
}

/* ─────────────────────────────────────────────
   Setup Page
───────────────────────────────────────────── */
async function onSetupSubmit() {
  const input = document.getElementById('spreadsheet-id-input');
  const errEl = document.getElementById('setup-general-error');
  const btn = document.getElementById('setup-submit-btn');

  if (!input) return;

  // Clear errors
  if (errEl) errEl.style.display = 'none';
  clearFieldError('setup-id-group', 'setup-id-error');

  const rawValue = input.value.trim();
  if (!rawValue) {
    const idErrEl = document.getElementById('setup-id-error');
    const idGroup = document.getElementById('setup-id-group');
    if (idGroup) idGroup.classList.add('has-error');
    if (idErrEl) {
      idErrEl.textContent = 'يرجى إدخال رمز جدول البيانات';
      idErrEl.style.display = 'block';
    }
    return;
  }

  // Extract spreadsheet ID if user pasted a full URL
  const id = extractSpreadsheetId(rawValue);

  btn.disabled = true;
  btn.textContent = 'جاري التحقق...';

  const ok = await initSpreadsheet(id);

  btn.disabled = false;
  btn.textContent = 'حفظ والمتابعة';

  if (ok) {
    localStorage.setItem(BRANCHES[state.currentBranch].spreadsheetKey, id);
    state.spreadsheetId = id;
    // Update top bar
    const topbarBranch = document.getElementById('topbar-branch');
    if (topbarBranch) topbarBranch.textContent = `فرع: ${state.currentBranch}`;
    showPage('app');
    const overviewBtn = document.querySelector('.tab-btn[data-tab="overview"]');
    switchTab('overview', overviewBtn);
    await loadFromSheets();
  } else {
    if (errEl) {
      errEl.textContent = 'لم يتم العثور على جدول البيانات. تأكد من صحة الرمز وأن لديك صلاحية الوصول إليه.';
      errEl.style.display = 'block';
    }
  }
}

/** Extract spreadsheet ID from a URL or return the value as-is */
function extractSpreadsheetId(value) {
  // Try to extract from full Google Sheets URL
  const match = value.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match) return match[1];
  return value;
}

// Expose to inline onclick
window.onSetupSubmit = onSetupSubmit;

/* ─────────────────────────────────────────────
   Logout
───────────────────────────────────────────── */
function logout() {
  state.currentBranch = null;
  state.spreadsheetId = null;
  state.sales = [];
  state.purchases = [];
  state.expenses = [];
  state.employees = [];
  authSignOut();
  showPage('login');
  // Clear the setup input for next time
  const setupInput = document.getElementById('spreadsheet-id-input');
  if (setupInput) setupInput.value = '';
}

// Expose to inline onclick
window.logout = logout;

/* ─────────────────────────────────────────────
   Load from Google Sheets
───────────────────────────────────────────── */
async function loadFromSheets() {
  if (!state.spreadsheetId) return;
  const data = await syncAllData(state.spreadsheetId);
  if (!data) return;

  state.sales     = data.sales     || [];
  state.purchases = data.purchases || [];
  state.expenses  = data.expenses  || [];
  state.employees = data.employees || [];

  saveLocalBackup();
  renderAll();
}

/* ─────────────────────────────────────────────
   Render All Tabs
───────────────────────────────────────────── */
function renderAll() {
  renderOverview();
  renderSales();
  renderPurchases();
  renderExpenses();
  renderEmployees();
}

/* ─────────────────────────────────────────────
   OVERVIEW TAB
───────────────────────────────────────────── */
function renderOverview() {
  const today = getTodayString();

  const todaySales     = state.sales.filter(s => s.date === today).reduce((a, s) => a + s.amount, 0);
  const todayPurchases = state.purchases.filter(s => s.date === today).reduce((a, s) => a + s.amount, 0);
  const todayExpenses  = state.expenses.filter(s => s.date === today).reduce((a, s) => a + s.amount, 0);
  const totalLoans     = state.employees.reduce((a, e) => a + e.loanBalance, 0);
  const netProfit      = todaySales - todayPurchases - todayExpenses;

  setText('card-sales',     formatAmount(todaySales));
  setText('card-purchases', formatAmount(todayPurchases));
  setText('card-expenses',  formatAmount(todayExpenses));
  setText('card-loans',     formatAmount(totalLoans));

  const netEl = document.getElementById('net-profit-value');
  if (netEl) {
    netEl.textContent = formatAmount(netProfit);
    netEl.classList.toggle('negative', netProfit < 0);
  }

  // Recent entries — last 10 across all categories
  const combined = [
    ...state.sales.map(s => ({ ...s, type: 'sales' })),
    ...state.purchases.map(s => ({ ...s, type: 'purchases' })),
    ...state.expenses.map(s => ({ ...s, type: 'expenses' })),
  ];
  combined.sort((a, b) => (b.id > a.id ? 1 : -1));
  const recent = combined.slice(0, 10);

  const tbody = document.getElementById('recent-tbody');
  if (!tbody) return;

  if (recent.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="4">لا توجد إدخالات بعد</td></tr>';
    return;
  }

  tbody.innerHTML = recent.map(entry => {
    const typeBadge = {
      sales:     '<span class="type-badge type-badge--sales">مبيعات</span>',
      purchases: '<span class="type-badge type-badge--purchases">مشتريات</span>',
      expenses:  '<span class="type-badge type-badge--expenses">مصروفات</span>',
    }[entry.type] || '';

    const amtClass = entry.type === 'sales' ? 'amount-positive' : 'amount-negative';
    return `<tr>
      <td>${formatDate(entry.date)}</td>
      <td>${typeBadge}</td>
      <td>${escapeHtml(entry.description) || '—'}</td>
      <td class="${amtClass}">${formatAmount(entry.amount)}</td>
    </tr>`;
  }).join('');
}

/* ─────────────────────────────────────────────
   SALES TAB
───────────────────────────────────────────── */
async function addSale(event) {
  event.preventDefault();

  const dateEl   = document.getElementById('sale-date');
  const descEl   = document.getElementById('sale-desc');
  const amountEl = document.getElementById('sale-amount');
  const btn      = document.getElementById('sale-submit-btn');

  // Validate
  const v1 = validateField(dateEl,   { isDate: true, required: true }, 'sale-date-group',   'sale-date-error');
  const v2 = validateField(descEl,   { minLength: 2 },                  'sale-desc-group',   'sale-desc-error');
  const v3 = validateField(amountEl, { isPositiveNumber: true },        'sale-amount-group', 'sale-amount-error');
  if (!v1 || !v3) return; // date and amount required; description optional

  const entry = {
    id:          generateId(),
    date:        dateEl.value,
    description: descEl.value.trim(),
    amount:      parseFloat(amountEl.value),
  };

  btn.disabled = true;
  state.sales.push(entry);
  saveLocalBackup();
  renderSales();
  renderOverview();

  // Reset form (keep today's date)
  descEl.value   = '';
  amountEl.value = '';

  await appendRow(state.spreadsheetId, 'Sales', [entry.id, entry.date, entry.description, entry.amount]);
  btn.disabled = false;
}

async function deleteSale(id) {
  state.sales = state.sales.filter(s => s.id !== id);
  saveLocalBackup();
  renderSales();
  renderOverview();
  await clearRow(state.spreadsheetId, 'Sales', id);
}

function renderSales() {
  const tbody = document.getElementById('sales-tbody');
  if (!tbody) return;

  if (state.sales.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="4">لا توجد مبيعات مسجلة بعد</td></tr>';
    return;
  }

  const sorted = [...state.sales].sort((a, b) => (b.id > a.id ? 1 : -1));
  tbody.innerHTML = sorted.map(s => `
    <tr>
      <td>${formatDate(s.date)}</td>
      <td>${escapeHtml(s.description) || '—'}</td>
      <td class="amount-positive">${formatAmount(s.amount)}</td>
      <td><button class="delete-btn" onclick="deleteSale('${s.id}')">حذف</button></td>
    </tr>
  `).join('');
}

// Expose
window.addSale = addSale;
window.deleteSale = deleteSale;

/* ─────────────────────────────────────────────
   PURCHASES TAB
───────────────────────────────────────────── */
async function addPurchase(event) {
  event.preventDefault();

  const dateEl   = document.getElementById('purchase-date');
  const descEl   = document.getElementById('purchase-desc');
  const amountEl = document.getElementById('purchase-amount');
  const btn      = document.getElementById('purchase-submit-btn');

  const v1 = validateField(dateEl,   { isDate: true, required: true }, 'purchase-date-group',   'purchase-date-error');
  const v3 = validateField(amountEl, { isPositiveNumber: true },        'purchase-amount-group', 'purchase-amount-error');
  if (!v1 || !v3) return;

  const entry = {
    id:          generateId(),
    date:        dateEl.value,
    description: descEl.value.trim(),
    amount:      parseFloat(amountEl.value),
  };

  btn.disabled = true;
  state.purchases.push(entry);
  saveLocalBackup();
  renderPurchases();
  renderOverview();

  descEl.value   = '';
  amountEl.value = '';

  await appendRow(state.spreadsheetId, 'Purchases', [entry.id, entry.date, entry.description, entry.amount]);
  btn.disabled = false;
}

async function deletePurchase(id) {
  state.purchases = state.purchases.filter(s => s.id !== id);
  saveLocalBackup();
  renderPurchases();
  renderOverview();
  await clearRow(state.spreadsheetId, 'Purchases', id);
}

function renderPurchases() {
  const tbody = document.getElementById('purchases-tbody');
  if (!tbody) return;

  if (state.purchases.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="4">لا توجد مشتريات مسجلة بعد</td></tr>';
    return;
  }

  const sorted = [...state.purchases].sort((a, b) => (b.id > a.id ? 1 : -1));
  tbody.innerHTML = sorted.map(s => `
    <tr>
      <td>${formatDate(s.date)}</td>
      <td>${escapeHtml(s.description) || '—'}</td>
      <td class="amount-negative">${formatAmount(s.amount)}</td>
      <td><button class="delete-btn" onclick="deletePurchase('${s.id}')">حذف</button></td>
    </tr>
  `).join('');
}

window.addPurchase = addPurchase;
window.deletePurchase = deletePurchase;

/* ─────────────────────────────────────────────
   EXPENSES TAB
───────────────────────────────────────────── */
async function addExpense(event) {
  event.preventDefault();

  const dateEl   = document.getElementById('expense-date');
  const descEl   = document.getElementById('expense-desc');
  const amountEl = document.getElementById('expense-amount');
  const btn      = document.getElementById('expense-submit-btn');

  const v1 = validateField(dateEl,   { isDate: true, required: true }, 'expense-date-group',   'expense-date-error');
  const v3 = validateField(amountEl, { isPositiveNumber: true },        'expense-amount-group', 'expense-amount-error');
  if (!v1 || !v3) return;

  const entry = {
    id:          generateId(),
    date:        dateEl.value,
    description: descEl.value.trim(),
    amount:      parseFloat(amountEl.value),
  };

  btn.disabled = true;
  state.expenses.push(entry);
  saveLocalBackup();
  renderExpenses();
  renderOverview();

  descEl.value   = '';
  amountEl.value = '';

  await appendRow(state.spreadsheetId, 'Expenses', [entry.id, entry.date, entry.description, entry.amount]);
  btn.disabled = false;
}

async function deleteExpense(id) {
  state.expenses = state.expenses.filter(s => s.id !== id);
  saveLocalBackup();
  renderExpenses();
  renderOverview();
  await clearRow(state.spreadsheetId, 'Expenses', id);
}

function renderExpenses() {
  const tbody = document.getElementById('expenses-tbody');
  if (!tbody) return;

  if (state.expenses.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="4">لا توجد مصروفات مسجلة بعد</td></tr>';
    return;
  }

  const sorted = [...state.expenses].sort((a, b) => (b.id > a.id ? 1 : -1));
  tbody.innerHTML = sorted.map(s => `
    <tr>
      <td>${formatDate(s.date)}</td>
      <td>${escapeHtml(s.description) || '—'}</td>
      <td class="amount-negative">${formatAmount(s.amount)}</td>
      <td><button class="delete-btn" onclick="deleteExpense('${s.id}')">حذف</button></td>
    </tr>
  `).join('');
}

window.addExpense = addExpense;
window.deleteExpense = deleteExpense;

/* ─────────────────────────────────────────────
   EMPLOYEES TAB
───────────────────────────────────────────── */
async function addEmployee(event) {
  event.preventDefault();

  const nameEl   = document.getElementById('emp-name');
  const salaryEl = document.getElementById('emp-salary');
  const btn      = document.getElementById('emp-submit-btn');

  const v1 = validateField(nameEl,   { required: true, minLength: 2 }, 'emp-name-group',   'emp-name-error');
  const v2 = validateField(salaryEl, { isPositiveNumber: true },        'emp-salary-group', 'emp-salary-error');
  if (!v1 || !v2) return;

  const today = getTodayString();
  const emp = {
    id:          generateId(),
    name:        nameEl.value.trim(),
    salary:      parseFloat(salaryEl.value),
    loanBalance: 0,
    lastUpdated: today,
  };

  btn.disabled = true;
  state.employees.push(emp);
  saveLocalBackup();
  renderEmployees();

  nameEl.value   = '';
  salaryEl.value = '';

  await appendRow(state.spreadsheetId, 'Employees', [
    emp.id, emp.name, emp.salary, emp.loanBalance, emp.lastUpdated,
  ]);
  btn.disabled = false;
}

async function giveLoan(employeeId, amount, note) {
  const emp = state.employees.find(e => e.id === employeeId);
  if (!emp) return;

  emp.loanBalance += amount;
  emp.lastUpdated  = getTodayString();
  saveLocalBackup();
  renderEmployees();
  renderOverview();

  // Update employee row
  await updateRow(state.spreadsheetId, 'Employees', employeeId, [
    emp.id, emp.name, emp.salary, emp.loanBalance, emp.lastUpdated,
  ]);

  // Also record as expense
  const expenseDesc = `سلفة موظف — ${emp.name}${note ? ' — ' + note : ''}`;
  const expEntry = {
    id:          generateId(),
    date:        emp.lastUpdated,
    description: expenseDesc,
    amount:      amount,
  };
  state.expenses.push(expEntry);
  saveLocalBackup();
  renderExpenses();

  await appendRow(state.spreadsheetId, 'Expenses', [
    expEntry.id, expEntry.date, expEntry.description, expEntry.amount,
  ]);
}

async function deductLoan(employeeId, amount) {
  const emp = state.employees.find(e => e.id === employeeId);
  if (!emp) return false;

  if (amount > emp.loanBalance) {
    return false; // validation done by caller
  }

  emp.loanBalance -= amount;
  emp.lastUpdated  = getTodayString();
  saveLocalBackup();
  renderEmployees();
  renderOverview();

  await updateRow(state.spreadsheetId, 'Employees', employeeId, [
    emp.id, emp.name, emp.salary, emp.loanBalance, emp.lastUpdated,
  ]);
  return true;
}

async function removeEmployee(employeeId) {
  state.employees = state.employees.filter(e => e.id !== employeeId);
  saveLocalBackup();
  renderEmployees();
  renderOverview();
  await clearRow(state.spreadsheetId, 'Employees', employeeId);
}

function renderEmployees() {
  const container = document.getElementById('employees-list');
  if (!container) return;

  if (state.employees.length === 0) {
    container.innerHTML = '<div class="empty-state">لا يوجد موظفون مسجلون بعد</div>';
    return;
  }

  container.innerHTML = '';

  state.employees.forEach(emp => {
    const template = document.getElementById('employee-card-template');
    const card = template.content.cloneNode(true).querySelector('.employee-card');

    card.dataset.empId = emp.id;
    card.querySelector('.employee-card__name').textContent = emp.name;
    card.querySelector('.emp-salary-display').textContent = formatAmount(emp.salary);
    card.querySelector('.emp-loan-display').textContent = formatAmount(emp.loanBalance);
    card.querySelector('.emp-updated-display').textContent = formatDate(emp.lastUpdated);

    // Remove button
    card.querySelector('.employee-remove-btn').addEventListener('click', () => {
      if (confirm(`هل أنت متأكد من حذف الموظف ${emp.name}؟`)) {
        removeEmployee(emp.id);
      }
    });

    // Loan button
    const loanBtn       = card.querySelector('.loan-btn');
    const loanAmountEl  = card.querySelector('.loan-amount-input');
    const loanNoteEl    = card.querySelector('.loan-note-input');
    const loanErrEl     = card.querySelector('.loan-error');

    loanBtn.addEventListener('click', async () => {
      loanErrEl.style.display = 'none';
      const amount = parseFloat(loanAmountEl.value);
      if (!amount || amount <= 0) {
        loanErrEl.textContent = 'يجب أن يكون المبلغ أكبر من صفر';
        loanErrEl.style.display = 'block';
        return;
      }
      loanBtn.disabled = true;
      const note = loanNoteEl.value.trim();
      await giveLoan(emp.id, amount, note);
      loanAmountEl.value = '';
      loanNoteEl.value   = '';
      loanBtn.disabled   = false;
    });

    // Deduct button
    const deductBtn      = card.querySelector('.deduct-btn');
    const deductAmountEl = card.querySelector('.deduct-amount-input');
    const deductErrEl    = card.querySelector('.deduct-error');

    deductBtn.addEventListener('click', async () => {
      deductErrEl.style.display = 'none';
      const amount = parseFloat(deductAmountEl.value);
      if (!amount || amount <= 0) {
        deductErrEl.textContent = 'يجب أن يكون المبلغ أكبر من صفر';
        deductErrEl.style.display = 'block';
        return;
      }
      if (amount > emp.loanBalance) {
        deductErrEl.textContent = `مبلغ الخصم أكبر من رصيد السلفة (${formatAmount(emp.loanBalance)})`;
        deductErrEl.style.display = 'block';
        return;
      }
      deductBtn.disabled = true;
      await deductLoan(emp.id, amount);
      deductAmountEl.value = '';
      deductBtn.disabled   = false;
    });

    container.appendChild(card);
  });
}

window.addEmployee = addEmployee;

/* ─────────────────────────────────────────────
   Utility
───────────────────────────────────────────── */
function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/* ─────────────────────────────────────────────
   Initialize Date Fields
───────────────────────────────────────────── */
function initDateFields() {
  const today = getTodayString();
  ['sale-date', 'purchase-date', 'expense-date'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = today;
  });
}

/* ─────────────────────────────────────────────
   App Bootstrap
───────────────────────────────────────────── */
async function bootstrap() {
  // Initialize date fields
  initDateFields();

  // Start on login page
  showPage('login');

  // Init auth (non-blocking — GIS loads async)
  initAuth();
}

// Run on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
