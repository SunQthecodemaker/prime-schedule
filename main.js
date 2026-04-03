// main.js — 앱 진입점: 초기화, 로그인, 탭 전환

import { state }                          from './core/state.js';
import { signInEmployee, signInAdmin, signOut, restoreSession } from './core/auth.js';
import { goTo, switchTab }                from './core/router.js';

// ── 직원 포털 탭 ───────────────────────────────────────────
import { render as renderMySchedule }     from './employee/my-schedule.js';
import { render as renderMyLeave }        from './employee/my-leave.js';
import { render as renderMyDocs }         from './employee/my-docs.js';

// ── 관리자 포털 탭 ─────────────────────────────────────────
import { render as renderAdminSchedule }  from './admin/schedule.js';
import { render as renderAdminLeaves }    from './admin/leaves.js';
import { render as renderAdminEmployees } from './admin/employees.js';
import { render as renderAdminDocuments } from './admin/documents.js';

// dayjs 플러그인
dayjs.extend(window.dayjs_plugin_weekOfYear);
dayjs.extend(window.dayjs_plugin_isSameOrAfter);
dayjs.extend(window.dayjs_plugin_isSameOrBefore);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 유틸
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function toast(msg, type = 'info') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast toast-${type}`;
  el.classList.remove('hidden');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add('hidden'), 2800);
}

export function showLoginError(msg) {
  const el = document.getElementById('login-err');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function setLoading(formEl, loading) {
  const btn = formEl.querySelector('button[type=submit]');
  if (!btn) return;
  btn.disabled = loading;
  btn.textContent = loading ? '로그인 중…' : '로그인';
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 포털 진입
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function enterEmployeePortal() {
  document.getElementById('emp-user-name').textContent = state.user.name;
  goTo('v-employee');
  renderEmpTab('schedule');
}

function enterAdminPortal() {
  document.getElementById('admin-user-name').textContent = state.user.name;
  goTo('v-admin');
  renderAdminTab('schedule');
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 탭 렌더링
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

let _tabRendering = false;

async function renderEmpTab(tab) {
  if (_tabRendering) return;
  _tabRendering = true;
  switchTab('#emp-tab-nav', tab);
  const content = document.getElementById('emp-content');
  content.innerHTML = '';
  try {
    if (tab === 'schedule') await renderMySchedule(content);
    if (tab === 'leave')    await renderMyLeave(content);
    if (tab === 'docs')     await renderMyDocs(content);
  } finally { _tabRendering = false; }
}

async function renderAdminTab(tab) {
  if (_tabRendering) return;
  _tabRendering = true;
  switchTab('#admin-tab-nav', tab);
  const content = document.getElementById('admin-content');
  content.innerHTML = '';
  try {
    if (tab === 'schedule')  await renderAdminSchedule(content);
    if (tab === 'leaves')    await renderAdminLeaves(content);
    if (tab === 'employees') await renderAdminEmployees(content);
    if (tab === 'documents') await renderAdminDocuments(content);
  } finally { _tabRendering = false; }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 로그인 핸들러
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function handleEmpLogin(e) {
  e.preventDefault();
  document.getElementById('login-err').classList.add('hidden');
  const form = e.target;
  setLoading(form, true);

  const name = document.getElementById('inp-emp-name').value.trim();
  const pass = document.getElementById('inp-emp-pass').value;
  const result = await signInEmployee(name, pass);

  setLoading(form, false);
  if (result.error) { showLoginError(result.error); return; }
  enterEmployeePortal();
}

async function handleAdminLogin(e) {
  e.preventDefault();
  document.getElementById('login-err').classList.add('hidden');
  const form = e.target;
  setLoading(form, true);

  const email = document.getElementById('inp-admin-email').value.trim();
  const pass  = document.getElementById('inp-admin-pass').value;
  const result = await signInAdmin(email, pass);

  setLoading(form, false);
  if (result.error) { showLoginError(result.error); return; }
  enterAdminPortal();
}

async function handleLogout() {
  await signOut();
  goTo('v-login');
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 초기화
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function init() {
  // 로그인 폼
  document.getElementById('form-emp').addEventListener('submit', handleEmpLogin);
  document.getElementById('form-admin').addEventListener('submit', handleAdminLogin);

  // 로그아웃
  document.getElementById('emp-logout-btn').addEventListener('click', handleLogout);
  document.getElementById('admin-logout-btn').addEventListener('click', handleLogout);

  // 로그인 탭 전환
  document.querySelectorAll('.login-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.login-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('box-emp').classList.add('hidden');
      document.getElementById('box-admin').classList.add('hidden');
      document.getElementById(btn.dataset.target).classList.remove('hidden');
      document.getElementById('login-err').classList.add('hidden');
    });
  });

  // 직원 탭 클릭
  document.getElementById('emp-tab-nav').addEventListener('click', e => {
    const btn = e.target.closest('[data-tab]');
    if (btn) renderEmpTab(btn.dataset.tab);
  });

  // 관리자 탭 클릭
  document.getElementById('admin-tab-nav').addEventListener('click', e => {
    const btn = e.target.closest('[data-tab]');
    if (btn) renderAdminTab(btn.dataset.tab);
  });

  // 관리자 세션 복원
  const restored = await restoreSession();
  if (restored) { enterAdminPortal(); return; }

  // 기본: 로그인 화면
  goTo('v-login');
}

document.addEventListener('DOMContentLoaded', init);
