// core/state.js — Supabase 클라이언트 + 전역 상태

const SUPABASE_URL = 'https://chnqtrmlglqdmzqwsazm.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNobnF0cm1sZ2xxZG16cXdzYXptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ0ODUxOTksImV4cCI6MjA3MDA2MTE5OX0.HBvXKoFAQsIjyePoMgtOpYZePoOHO9dYekcAsY1G6gQ';

export const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

/**
 * 앱 전역 상태.
 * 모든 모듈이 이 객체를 공유합니다.
 */
export const state = {
  // ── 인증 ──────────────────────────────────────────────────
  user: null,          // employees 테이블 row (departments 포함)
  role: 'none',        // 'none' | 'employee' | 'admin'

  // ── 마스터 데이터 (로그인 시 1회 로드) ─────────────────────
  employees:     [],
  departments:   [],
  leaveRequests: [],

  // ── 스케줄 시트 (admin/schedule.js 에서 관리) ────────────────
  schedule: {
    date:      dayjs().format('YYYY-MM-DD'),
    view:      'all',   // 'all' | 'working' | 'off'
    schedules: [],
    holidays:  new Set(),
    layout:    null,
  },
};
