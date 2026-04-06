// core/db.js — 모든 Supabase 쿼리를 한 곳에서 관리
// 사용법: import { fetchEmployees, upsertSchedules, ... } from '../core/db.js'

import { supabase } from './state.js';

// ── 직원 ───────────────────────────────────────────────────
export const fetchEmployees = () =>
  supabase.from('employees').select('*, departments(*)').order('id');

export const fetchEmployee = (id) =>
  supabase.from('employees').select('*, departments(*)').eq('id', id).single();

export const createEmployee = (data) =>
  supabase.from('employees').insert([data]).select().single();

export const updateEmployee = (id, data) =>
  supabase.from('employees').update(data).eq('id', id);

export const deleteEmployee = (id) =>
  supabase.from('employees').delete().eq('id', id);

export const loginEmployee = (name, password) =>
  supabase.from('employees').select('*, departments(*)')
    .eq('name', name).eq('password', password).single();

// ── 부서 ───────────────────────────────────────────────────
export const fetchDepartments = () =>
  supabase.from('departments').select('*').order('id');

export const createDepartment = (data) =>
  supabase.from('departments').insert([data]).select().single();

export const updateDepartment = (id, data) =>
  supabase.from('departments').update(data).eq('id', id);

export const deleteDepartment = (id) =>
  supabase.from('departments').delete().eq('id', id);

// ── 연차 요청 ───────────────────────────────────────────────
export const fetchAllLeaves = () =>
  supabase.from('leave_requests').select('*').order('created_at', { ascending: false });

export const fetchMyLeaves = (empId) =>
  supabase.from('leave_requests').select('*')
    .eq('employee_id', empId).order('created_at', { ascending: false });

export const createLeave = (data) =>
  supabase.from('leave_requests').insert([data]).select().single();

export const updateLeave = (id, data) =>
  supabase.from('leave_requests').update(data).eq('id', id);

export const deleteLeave = (id) =>
  supabase.from('leave_requests').delete().eq('id', id);

// ── 스케줄 ──────────────────────────────────────────────────
export const fetchMonthSchedules = (start, end) =>
  supabase.from('schedules').select('*').gte('date', start).lte('date', end);

export const upsertSchedules = (rows) =>
  supabase.from('schedules').upsert(rows, { onConflict: 'employee_id,date' });

export const deleteSchedule = (empId, date) =>
  supabase.from('schedules').delete().eq('employee_id', empId).eq('date', date);

// ── 공휴일 ──────────────────────────────────────────────────
export const fetchHolidays = (start, end) =>
  supabase.from('company_holidays').select('date').gte('date', start).lte('date', end);

export const addHoliday = (date) =>
  supabase.from('company_holidays').insert({ date });

export const removeHoliday = (date) =>
  supabase.from('company_holidays').delete().eq('date', date);

// ── 팀 레이아웃 ─────────────────────────────────────────────
export const fetchTeamLayout = (monthKey) =>
  supabase.from('team_layouts').select('layout_data')
    .lte('month', monthKey).order('month', { ascending: false }).limit(1);

export const upsertTeamLayout = (month, layoutData) =>
  supabase.from('team_layouts').upsert(
    { month, layout_data: layoutData },
    { onConflict: 'month' }
  );

// ── 서류 템플릿 ─────────────────────────────────────────────
export const fetchDocTemplates = () =>
  supabase.from('document_templates').select('*').order('created_at', { ascending: false });

// ── 서류 요청 ───────────────────────────────────────────────
export const fetchDocRequests = () =>
  supabase.from('document_requests').select('*').order('created_at', { ascending: false });

export const fetchMyDocRequests = (empId) =>
  supabase.from('document_requests').select('*').eq('employee_id', empId);

export const createDocRequest = (data) =>
  supabase.from('document_requests').insert([data]).select().single();

export const updateDocRequest = (id, data) =>
  supabase.from('document_requests').update(data).eq('id', id);

// ── 월간 달력 (오프표) ──────────────────────────────────────
export const fetchMonthCalendar = (month) =>
  supabase.from('monthly_calendars').select('*').eq('month', month).single();

export const upsertMonthCalendar = (month, gridData, gridStyles) =>
  supabase.from('monthly_calendars').upsert(
    { month, grid_data: gridData, grid_styles: gridStyles, updated_at: new Date().toISOString() },
    { onConflict: 'month' }
  );

// ── 제출된 서류 ─────────────────────────────────────────────
export const fetchSubmittedDocs = () =>
  supabase.from('submitted_documents').select('*').order('created_at', { ascending: false });

export const fetchMySubmittedDocs = (empId) =>
  supabase.from('submitted_documents').select('*').eq('employee_id', empId);

export const submitDocument = (data) =>
  supabase.from('submitted_documents').insert([data]).select().single();

export const updateSubmittedDoc = (id, data) =>
  supabase.from('submitted_documents').update(data).eq('id', id);
