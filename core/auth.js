// core/auth.js — 로그인 / 로그아웃 / 세션 복원 / 마스터 데이터 로드

import { supabase, state } from './state.js';
import { loginEmployee, fetchEmployees, fetchDepartments, fetchAllLeaves } from './db.js';

/**
 * 로그인 후 공통으로 필요한 마스터 데이터를 로드합니다.
 */
export async function loadMasterData() {
  const [empRes, deptRes, leaveRes] = await Promise.all([
    fetchEmployees(),
    fetchDepartments(),
    fetchAllLeaves(),
  ]);

  if (empRes.error)   throw empRes.error;
  if (deptRes.error)  throw deptRes.error;
  if (leaveRes.error) throw leaveRes.error;

  state.employees    = empRes.data   || [];
  state.departments  = deptRes.data  || [];
  state.leaveRequests = leaveRes.data || [];
}

/**
 * 직원 로그인 (이름 또는 이메일 + 비밀번호)
 * - 이메일 형식이면 Supabase Auth 시도 → 실패 시 DB 직접 조회(fallback)
 * - 이름 형식이면 기존 이름+비밀번호 방식
 * @returns {{ user, role } | { error }}
 */
export async function signInEmployee(nameOrEmail, password) {
  const isEmail = nameOrEmail.includes('@');

  function parseRole(emp) {
    if (emp.role === 'admin')   return 'admin';
    if (emp.role === 'manager') return 'manager';
    return 'employee';
  }

  if (isEmail) {
    // 1) Supabase Auth 시도 (이메일이 Auth에 등록된 경우)
    const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
      email: nameOrEmail, password
    });
    if (!authErr && authData.user) {
      const { data: emp } = await supabase
        .from('employees').select('*, departments(*)')
        .eq('email', nameOrEmail).single();
      if (emp) {
        state.user = emp;
        state.role = parseRole(emp);
        await loadMasterData();
        return { user: emp, role: state.role };
      }
    }
    // 2) Auth 미등록 → DB 이메일+비밀번호 직접 조회 (fallback)
    const { data: emp } = await supabase
      .from('employees').select('*, departments(*)')
      .eq('email', nameOrEmail).eq('password', password).single();
    if (emp) {
      state.user = emp;
      state.role = parseRole(emp);
      await loadMasterData();
      return { user: emp, role: state.role };
    }
    return { error: '이메일 또는 비밀번호가 틀렸습니다.' };
  } else {
    // 이름으로 로그인 (기존 방식)
    const { data: emp, error } = await loginEmployee(nameOrEmail, password);
    if (error || !emp) return { error: '이름 또는 비밀번호가 틀렸습니다.' };
    state.user = emp;
    state.role = parseRole(emp);
    await loadMasterData();
    return { user: emp, role: state.role };
  }
}

/**
 * 관리자 로그인 (이메일 + 비밀번호 → Supabase Auth)
 * signInEmployee와 통합됐으므로 role=admin 이면 관리자 포털로 진입
 */
export async function signInAdmin(email, password) {
  const result = await signInEmployee(email, password);
  if (result.error) return result;
  if (result.role !== 'admin' && result.role !== 'manager') {
    await signOut();
    return { error: '관리자 계정이 아닙니다.' };
  }
  return result;
}

/**
 * 비밀번호 재설정 이메일 발송
 */
export async function sendPasswordReset(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + window.location.pathname,
  });
  if (error) return { error: error.message };
  return { ok: true };
}

/**
 * 로그아웃
 */
export async function signOut() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) await supabase.auth.signOut().catch(() => {});
  state.user = null;
  state.role = 'none';
  state.employees    = [];
  state.departments  = [];
  state.leaveRequests = [];
}

/**
 * 페이지 새로고침 시 Supabase 세션(관리자)을 복원합니다.
 * 직원은 세션이 없으므로 복원 불가 → false 반환
 * @returns {boolean} 세션 복원 성공 여부
 */
export async function restoreSession() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return false;

  const { data: emp } = await supabase
    .from('employees').select('*, departments(*)')
    .eq('email', session.user.email).single();

  if (!emp) { await supabase.auth.signOut(); return false; }

  state.user = emp;
  state.role = emp.role === 'admin' ? 'admin' : emp.role === 'manager' ? 'manager' : 'employee';
  await loadMasterData();
  return true;
}
