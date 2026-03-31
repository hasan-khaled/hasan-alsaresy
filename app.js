/**
 * app.js — Main application logic
 * No Google login required. Branch click → dashboard instantly.
 */

import {
  BRANCH_KEYS, SCRIPT_URL,
  initSpreadsheet, appendRow, updateRow, clearRow, syncAllData,
} from './sheets.js';

/* ─────────────────────────────────────────────
   Passcode
───────────────────────────────────────────── */
const PASSCODE       = '1406';  // sensitive actions (delete, deduct)
const LOGIN_PASSCODE = '1980';  // branch login

let _passcodeCallback = null;
let _passcodeExpected = PASSCODE;

// requirePasscode(callback)             — uses PASSCODE (1406)
// requirePasscode(expectedCode, callback) — uses supplied code
function requirePasscode(expectedOrCb, callback) {
  if (typeof expectedOrCb === 'function') {
    _passcodeExpected = PASSCODE;
    _passcodeCallback = expectedOrCb;
  } else {
    _passcodeExpected = expectedOrCb;
    _passcodeCallback = callback;
  }
  const overlay = document.getElementById('passcode-overlay');
  const input   = document.getElementById('passcode-input');
  const errEl   = document.getElementById('passcode-error');
  if (!overlay) return;
  errEl.style.display = 'none';
  input.value = '';
  overlay.style.display = 'flex';
  setTimeout(() => input.focus(), 100);

  // Allow pressing Enter to confirm
  input.onkeydown = (e) => { if (e.key === 'Enter') confirmPasscode(); };
}

function confirmPasscode() {
  const input = document.getElementById('passcode-input');
  const errEl = document.getElementById('passcode-error');
  if (input.value === _passcodeExpected) {
    document.getElementById('passcode-overlay').style.display = 'none';
    input.value = '';
    const cb = _passcodeCallback;
    _passcodeCallback = null;
    _passcodeExpected = PASSCODE;
    if (cb) cb();
  } else {
    errEl.style.display = 'block';
    input.value = '';
    input.focus();
  }
}

function cancelPasscode() {
  document.getElementById('passcode-overlay').style.display = 'none';
  document.getElementById('passcode-input').value = '';
  document.getElementById('passcode-error').style.display = 'none';
  _passcodeCallback = null;
}

window.confirmPasscode = confirmPasscode;
window.cancelPasscode  = cancelPasscode;

/* ─────────────────────────────────────────────
   Employee form toggle
───────────────────────────────────────────── */
function toggleEmployeeForm(forceClose) {
  const wrap = document.getElementById('employee-form-wrap');
  if (!wrap) return;
  const isOpen = wrap.style.display !== 'none';
  if (forceClose || isOpen) {
    wrap.style.display = 'none';
  } else {
    wrap.style.display = 'block';
    setTimeout(() => document.getElementById('emp-name')?.focus(), 80);
  }
}
window.toggleEmployeeForm = toggleEmployeeForm;

/* ─────────────────────────────────────────────
   Branch Configuration
───────────────────────────────────────────── */
const BRANCHES = {
  'حسن':   { nameAr: 'حسن',   backupKey: 'backup_حسن'   },
  'أحمد':  { nameAr: 'أحمد',  backupKey: 'backup_أحمد'  },
  'المحل': { nameAr: 'المحل', backupKey: 'backup_المحل' },
};

/* ─────────────────────────────────────────────
   App State
───────────────────────────────────────────── */
let state = {
  currentBranch: null,
  branchKey:     null,
  sales:         [],
  purchases:     [],
  expenses:      [],
  employees:     [],
};

/* ─────────────────────────────────────────────
   Arabic Utilities
───────────────────────────────────────────── */
const MONTHS_AR = [
  'يناير','فبراير','مارس','أبريل','مايو','يونيو',
  'يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر',
];

function formatDate(str) {
  if (!str) return '—';
  const parts = str.split('-');
  if (parts.length !== 3) return str;
  const [y, m, d] = parts;
  return `${parseInt(d, 10)} ${MONTHS_AR[parseInt(m, 10) - 1] || m} ${y}`;
}

function formatAmount(n) {
  const num = parseFloat(n) || 0;
  return num.toLocaleString('ar-EG', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }) + ' JD';
}

function generateId() {
  return Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

function getTodayString() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
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
    statusTimeout = setTimeout(() => { el.textContent = ''; el.className = ''; }, 3000);
  } else if (type === 'error') {
    el.textContent = '⚠ حدث خطأ أثناء الحفظ';
    statusTimeout = setTimeout(() => { el.textContent = ''; el.className = ''; }, 5000);
  }
}

function setStatusOffline() {
  const el = document.getElementById('status-text');
  if (!el) return;
  clearTimeout(statusTimeout);
  el.className = 'error';
  el.textContent = '⚠ لا يوجد اتصال — تم الحفظ محلياً';
}

window.__setStatus        = setStatus;
window.__setStatusOffline = setStatusOffline;

/* ─────────────────────────────────────────────
   Local Backup
───────────────────────────────────────────── */
function saveLocalBackup() {
  if (!state.currentBranch) return;
  const key = BRANCHES[state.currentBranch].backupKey;
  try {
    localStorage.setItem(key, JSON.stringify({
      sales: state.sales, purchases: state.purchases,
      expenses: state.expenses, employees: state.employees,
    }));
  } catch (e) { /* ignore */ }
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
  } catch (e) { /* ignore */ }
}

/* ─────────────────────────────────────────────
   Page & Tab Navigation
───────────────────────────────────────────── */
function showPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const t = document.getElementById(`page-${pageId}`);
  if (t) t.classList.add('active');
}

function switchTab(tabId, btnEl) {
  document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b  => b.classList.remove('active'));
  const c = document.getElementById(`tab-${tabId}`);
  if (c) c.classList.add('active');
  if (btnEl) btnEl.classList.add('active');
}
window.switchTab = switchTab;

/* ─────────────────────────────────────────────
   Form Validation
───────────────────────────────────────────── */
function validateField(inputEl, rules, groupId, errorSpanId, customMessage) {
  const group     = document.getElementById(groupId);
  const errorSpan = document.getElementById(errorSpanId);
  const value     = inputEl.value.trim();
  let errorMsg    = '';

  if (rules.required && value === '') {
    errorMsg = customMessage || 'هذا الحقل مطلوب';
  } else if (rules.minLength && value.length < rules.minLength) {
    errorMsg = customMessage || 'يجب أن يكون الاسم أكثر من حرفين';
  } else if (rules.isPositiveNumber) {
    const num = parseFloat(value);
    if (isNaN(num) || num <= 0) errorMsg = customMessage || 'يجب أن يكون المبلغ أكبر من صفر';
  } else if (rules.isDate && value === '') {
    errorMsg = customMessage || 'يرجى إدخال تاريخ صحيح';
  }

  if (errorMsg) {
    if (group)     group.classList.add('has-error');
    if (errorSpan) { errorSpan.textContent = errorMsg; errorSpan.style.display = 'block'; }
    return false;
  }
  if (group)     group.classList.remove('has-error');
  if (errorSpan) { errorSpan.textContent = ''; errorSpan.style.display = 'none'; }
  return true;
}

/* ─────────────────────────────────────────────
   LOGIN — No Google auth. Just pick a branch.
───────────────────────────────────────────── */
function selectBranch(branchName) {
  // Guard: Apps Script URL not set yet
  if (SCRIPT_URL === 'YOUR_APPS_SCRIPT_URL_HERE') {
    const errEl = document.getElementById('login-error');
    if (errEl) {
      errEl.textContent = '⚠ يرجى إضافة رابط Apps Script في ملف sheets.js أولاً.';
      errEl.style.display = 'block';
    }
    return;
  }

  // Require login passcode before entering any branch
  requirePasscode(LOGIN_PASSCODE, async () => {
    state.currentBranch = branchName;
    state.branchKey     = BRANCH_KEYS[branchName];

    // Update top bar
    const topbarBranch = document.getElementById('topbar-branch');
    if (topbarBranch) topbarBranch.textContent = `فرع: ${branchName}`;

    showPage('app');
    const overviewBtn = document.querySelector('.tab-btn[data-tab="overview"]');
    switchTab('overview', overviewBtn);

    // Show cached data instantly
    loadLocalBackup();
    renderAll();

    // Init sheet structure then pull latest from Sheets
    await initSpreadsheet(state.branchKey);
    await loadFromSheets();
  });
}
window.selectBranch = selectBranch;

/* ─────────────────────────────────────────────
   Logout — back to branch selection
───────────────────────────────────────────── */
function logout() {
  state.currentBranch = null;
  state.branchKey     = null;
  state.sales = []; state.purchases = []; state.expenses = []; state.employees = [];
  showPage('login');
}
window.logout = logout;

/* ─────────────────────────────────────────────
   Load from Google Sheets
───────────────────────────────────────────── */
async function loadFromSheets() {
  const data = await syncAllData(state.branchKey);
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

  const combined = [
    ...state.sales.map(s     => ({ ...s, type: 'sales' })),
    ...state.purchases.map(s => ({ ...s, type: 'purchases' })),
    ...state.expenses.map(s  => ({ ...s, type: 'expenses' })),
  ].sort((a, b) => (b.id > a.id ? 1 : -1)).slice(0, 10);

  const tbody = document.getElementById('recent-tbody');
  if (!tbody) return;
  if (combined.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="4">لا توجد إدخالات بعد</td></tr>';
    return;
  }
  tbody.innerHTML = combined.map(entry => {
    const badge = {
      sales:     '<span class="type-badge type-badge--sales">مبيعات</span>',
      purchases: '<span class="type-badge type-badge--purchases">مشتريات</span>',
      expenses:  '<span class="type-badge type-badge--expenses">مصروفات</span>',
    }[entry.type] || '';
    const amtClass = entry.type === 'sales' ? 'amount-positive' : 'amount-negative';
    return `<tr>
      <td>${formatDate(entry.date)}</td>
      <td>${badge}</td>
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

  const v1 = validateField(dateEl,   { isDate: true, required: true }, 'sale-date-group',   'sale-date-error');
  const v3 = validateField(amountEl, { isPositiveNumber: true },        'sale-amount-group', 'sale-amount-error');
  if (!v1 || !v3) return;

  const entry = { id: generateId(), date: dateEl.value, description: descEl.value.trim(), amount: parseFloat(amountEl.value) };
  btn.disabled = true;
  state.sales.push(entry);
  saveLocalBackup(); renderSales(); renderOverview();
  descEl.value = ''; amountEl.value = '';
  await appendRow(state.branchKey, 'Sales', [entry.id, entry.date, entry.description, entry.amount]);
  btn.disabled = false;
}
window.addSale = addSale;

async function deleteSale(id) {
  state.sales = state.sales.filter(s => s.id !== id);
  saveLocalBackup(); renderSales(); renderOverview();
  await clearRow(state.branchKey, 'Sales', id);
}
window.deleteSale = deleteSale;

function renderSales() {
  const tbody = document.getElementById('sales-tbody');
  if (!tbody) return;
  if (state.sales.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="4">لا توجد مبيعات مسجلة بعد</td></tr>'; return;
  }
  tbody.innerHTML = [...state.sales].sort((a, b) => (b.id > a.id ? 1 : -1)).map(s => `
    <tr>
      <td>${formatDate(s.date)}</td>
      <td>${escapeHtml(s.description) || '—'}</td>
      <td class="amount-positive">${formatAmount(s.amount)}</td>
      <td><button class="delete-btn" onclick="deleteSale('${s.id}')">حذف</button></td>
    </tr>`).join('');
}

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

  const entry = { id: generateId(), date: dateEl.value, description: descEl.value.trim(), amount: parseFloat(amountEl.value) };
  btn.disabled = true;
  state.purchases.push(entry);
  saveLocalBackup(); renderPurchases(); renderOverview();
  descEl.value = ''; amountEl.value = '';
  await appendRow(state.branchKey, 'Purchases', [entry.id, entry.date, entry.description, entry.amount]);
  btn.disabled = false;
}
window.addPurchase = addPurchase;

async function deletePurchase(id) {
  state.purchases = state.purchases.filter(s => s.id !== id);
  saveLocalBackup(); renderPurchases(); renderOverview();
  await clearRow(state.branchKey, 'Purchases', id);
}
window.deletePurchase = deletePurchase;

function renderPurchases() {
  const tbody = document.getElementById('purchases-tbody');
  if (!tbody) return;
  if (state.purchases.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="4">لا توجد مشتريات مسجلة بعد</td></tr>'; return;
  }
  tbody.innerHTML = [...state.purchases].sort((a, b) => (b.id > a.id ? 1 : -1)).map(s => `
    <tr>
      <td>${formatDate(s.date)}</td>
      <td>${escapeHtml(s.description) || '—'}</td>
      <td class="amount-negative">${formatAmount(s.amount)}</td>
      <td><button class="delete-btn" onclick="deletePurchase('${s.id}')">حذف</button></td>
    </tr>`).join('');
}

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

  const entry = { id: generateId(), date: dateEl.value, description: descEl.value.trim(), amount: parseFloat(amountEl.value) };
  btn.disabled = true;
  state.expenses.push(entry);
  saveLocalBackup(); renderExpenses(); renderOverview();
  descEl.value = ''; amountEl.value = '';
  await appendRow(state.branchKey, 'Expenses', [entry.id, entry.date, entry.description, entry.amount]);
  btn.disabled = false;
}
window.addExpense = addExpense;

function deleteExpense(id) {
  requirePasscode(async () => {
    state.expenses = state.expenses.filter(s => s.id !== id);
    saveLocalBackup(); renderExpenses(); renderOverview();
    await clearRow(state.branchKey, 'Expenses', id);
  });
}
window.deleteExpense = deleteExpense;

function renderExpenses() {
  const tbody = document.getElementById('expenses-tbody');
  if (!tbody) return;
  if (state.expenses.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="4">لا توجد مصروفات مسجلة بعد</td></tr>'; return;
  }
  tbody.innerHTML = [...state.expenses].sort((a, b) => (b.id > a.id ? 1 : -1)).map(s => `
    <tr>
      <td>${formatDate(s.date)}</td>
      <td>${escapeHtml(s.description) || '—'}</td>
      <td class="amount-negative">${formatAmount(s.amount)}</td>
      <td><button class="delete-btn" onclick="deleteExpense('${s.id}')">حذف</button></td>
    </tr>`).join('');
}

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
  const emp   = { id: generateId(), name: nameEl.value.trim(), salary: parseFloat(salaryEl.value), loanBalance: 0, lastUpdated: today };
  btn.disabled = true;
  state.employees.push(emp);
  saveLocalBackup(); renderEmployees();
  nameEl.value = ''; salaryEl.value = '';
  toggleEmployeeForm(true); // collapse form after save
  await appendRow(state.branchKey, 'Employees', [emp.id, emp.name, emp.salary, emp.loanBalance, emp.lastUpdated]);
  btn.disabled = false;
}
window.addEmployee = addEmployee;

async function giveLoan(employeeId, amount, note) {
  const emp = state.employees.find(e => e.id === employeeId);
  if (!emp) return;
  emp.loanBalance += amount;
  emp.lastUpdated  = getTodayString();
  saveLocalBackup(); renderEmployees(); renderOverview();
  await updateRow(state.branchKey, 'Employees', employeeId,
    [emp.id, emp.name, emp.salary, emp.loanBalance, emp.lastUpdated]);
  const expEntry = { id: generateId(), date: emp.lastUpdated,
    description: `سلفة موظف — ${emp.name}${note ? ' — ' + note : ''}`, amount };
  state.expenses.push(expEntry);
  saveLocalBackup(); renderExpenses();
  await appendRow(state.branchKey, 'Expenses', [expEntry.id, expEntry.date, expEntry.description, expEntry.amount]);
}

async function deductLoan(employeeId, amount) {
  const emp = state.employees.find(e => e.id === employeeId);
  if (!emp || amount > emp.loanBalance) return false;
  emp.loanBalance -= amount;
  emp.lastUpdated  = getTodayString();
  saveLocalBackup(); renderEmployees(); renderOverview();
  await updateRow(state.branchKey, 'Employees', employeeId,
    [emp.id, emp.name, emp.salary, emp.loanBalance, emp.lastUpdated]);
  return true;
}

function removeEmployee(employeeId) {
  // Intentionally does NOT clear the row from the sheet — data is preserved.
  state.employees = state.employees.filter(e => e.id !== employeeId);
  saveLocalBackup(); renderEmployees(); renderOverview();
}

function renderEmployees() {
  const container = document.getElementById('employees-list');
  if (!container) return;
  if (state.employees.length === 0) {
    container.innerHTML = '<div class="empty-state">لا يوجد موظفون مسجلون بعد</div>'; return;
  }
  container.innerHTML = '';
  state.employees.forEach(emp => {
    const template = document.getElementById('employee-card-template');
    const card     = template.content.cloneNode(true).querySelector('.employee-card');
    card.dataset.empId = emp.id;
    card.querySelector('.employee-card__name').textContent  = emp.name;
    card.querySelector('.emp-salary-display').textContent   = formatAmount(emp.salary);
    card.querySelector('.emp-loan-display').textContent     = formatAmount(emp.loanBalance);
    card.querySelector('.emp-updated-display').textContent  = formatDate(emp.lastUpdated);

    card.querySelector('.employee-remove-btn').addEventListener('click', () => {
      requirePasscode(() => {
        if (confirm(`هل أنت متأكد من حذف الموظف ${emp.name}؟`)) removeEmployee(emp.id);
      });
    });

    const loanBtn      = card.querySelector('.loan-btn');
    const loanAmountEl = card.querySelector('.loan-amount-input');
    const loanNoteEl   = card.querySelector('.loan-note-input');
    const loanErrEl    = card.querySelector('.loan-error');
    loanBtn.addEventListener('click', async () => {
      loanErrEl.style.display = 'none';
      const amount = parseFloat(loanAmountEl.value);
      if (!amount || amount <= 0) { loanErrEl.textContent = 'يجب أن يكون المبلغ أكبر من صفر'; loanErrEl.style.display = 'block'; return; }
      loanBtn.disabled = true;
      await giveLoan(emp.id, amount, loanNoteEl.value.trim());
      loanAmountEl.value = ''; loanNoteEl.value = '';
      loanBtn.disabled = false;
    });

    const deductBtn      = card.querySelector('.deduct-btn');
    const deductAmountEl = card.querySelector('.deduct-amount-input');
    const deductErrEl    = card.querySelector('.deduct-error');
    deductBtn.addEventListener('click', () => {
      deductErrEl.style.display = 'none';
      const amount = parseFloat(deductAmountEl.value);
      if (!amount || amount <= 0) { deductErrEl.textContent = 'يجب أن يكون المبلغ أكبر من صفر'; deductErrEl.style.display = 'block'; return; }
      if (amount > emp.loanBalance) { deductErrEl.textContent = `مبلغ الخصم أكبر من رصيد السلفة (${formatAmount(emp.loanBalance)})`; deductErrEl.style.display = 'block'; return; }
      requirePasscode(async () => {
        deductBtn.disabled = true;
        await deductLoan(emp.id, amount);
        deductAmountEl.value = '';
        deductBtn.disabled = false;
      });
    });

    container.appendChild(card);
  });
}

/* ─────────────────────────────────────────────
   Utilities
───────────────────────────────────────────── */
function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
            .replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

/* ─────────────────────────────────────────────
   Bootstrap
───────────────────────────────────────────── */
function bootstrap() {
  const today = getTodayString();
  ['sale-date','purchase-date','expense-date'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = today;
  });
  showPage('login');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
