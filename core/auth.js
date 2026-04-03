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
 * 직원 로그인 (이름 + 비밀번호)
 * @returns {{ user, role } | { error }}
 */
export async function signInEmployee(name, password) {
  const { data: emp, error } = await loginEmployee(name, password);
  if (error || !emp) return { error: '이름 또는 비밀번호가 틀렸습니다.' };

  state.user = emp;
  state.role = 'employee';
  await loadMasterData();
  return { user: emp, role: 'employee' };
}

/**
 * 관리자 로그인 (이메일 + 비밀번호 → Supabase Auth)
 * @returns {{ user, role } | { error }}
 */
export async function signInAdmin(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };

  // Auth 성공 → employees 테이블에서 실제 직원 정보 조회
  const { data: emp, error: empErr } = await supabase
    .from('employees').select('*, departments(*)')
    .eq('email', data.user.email).single();

  if (empErr || !emp) {
    await supabase.auth.signOut();
    return { error: '관리자 계정 정보를 찾을 수 없습니다.' };
  }

  state.user = emp;
  state.role = 'admin';
  await loadMasterData();
  return { user: emp, role: 'admin' };
}

/**
 * 로그아웃
 */
export async function signOut() {
  if (state.role === 'admin') await supabase.auth.signOut().catch(() => {});
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
  state.role = 'admin';
  await loadMasterData();
  return true;
}
