// employee/my-schedule.js — 직원 본인의 이번 달 스케줄 조회

import { state }                          from '../core/state.js';
import { fetchMonthSchedules, fetchHolidays } from '../core/db.js';

const STATUS_LABEL = { 근무:'근', 근:'근', 연차:'연', 연:'연', 반차:'반', 반:'반', 휴무:'휴', 휴가:'휴', 휴:'휴', 휴직:'직', 직:'직' };
const DOT_CLASS    = { 근:'dot-근', 연:'dot-연', 반:'dot-반', 휴:'dot-휴', 직:'dot-직' };

let currentDate = dayjs();

export async function render(container) {
  container.innerHTML = `
    <div class="card" style="padding:0;overflow:hidden;">
      <div class="sheet-nav">
        <button id="sc-prev" class="btn-secondary">◀ 이전달</button>
        <h2 id="sc-title" class="month-title" style="font-size:16px;"></h2>
        <button id="sc-next" class="btn-secondary">다음달 ▶</button>
        <button id="sc-today" class="btn-secondary">오늘</button>
      </div>
      <div id="sc-body" style="padding:16px;"></div>
    </div>`;

  document.getElementById('sc-prev').onclick  = () => { currentDate = currentDate.subtract(1,'month'); reload(); };
  document.getElementById('sc-next').onclick  = () => { currentDate = currentDate.add(1,'month'); reload(); };
  document.getElementById('sc-today').onclick = () => { currentDate = dayjs(); reload(); };

  await reload();
}

async function reload() {
  const title  = document.getElementById('sc-title');
  const body   = document.getElementById('sc-body');
  if (!title || !body) return;

  title.textContent = currentDate.format('YYYY년 M월');
  body.innerHTML    = '<div class="empty-state"><div class="empty-state-icon">⏳</div><div>로딩 중…</div></div>';

  const start = currentDate.startOf('month').format('YYYY-MM-DD');
  const end   = currentDate.endOf('month').format('YYYY-MM-DD');

  const [schedRes, holRes] = await Promise.all([
    fetchMonthSchedules(start, end),
    fetchHolidays(start, end),
  ]);

  const schedules = (schedRes.data || []).filter(s => s.employee_id === state.user.id);
  const holidays  = new Set((holRes.data || []).map(h => h.date));

  // 스케줄 맵 빌드
  const schedMap = new Map();
  schedules.forEach(s => schedMap.set(s.date, s.status));

  // 승인된 연차 맵
  const leaveSet = new Set(
    (state.leaveRequests || [])
      .filter(r => r.employee_id === state.user.id && r.status === 'approved')
      .flatMap(r => r.dates || [])
  );

  body.innerHTML = buildCalendar(currentDate, schedMap, leaveSet, holidays);
}

function buildCalendar(month, schedMap, leaveSet, holidays) {
  const firstDay = month.startOf('month');
  const lastDay  = month.endOf('month');
  const startDow = firstDay.day(); // 0=일
  const today    = dayjs().format('YYYY-MM-DD');
  const days     = ['일','월','화','수','목','금','토'];

  let html = `<table class="mini-cal">
    <thead><tr>${days.map((d,i) =>
      `<th class="${i===0?'day-sun':i===6?'day-sat':''}">${d}</th>`
    ).join('')}</tr></thead><tbody><tr>`;

  // 첫 주 빈칸
  for (let i = 0; i < startDow; i++) html += '<td></td>';

  let col = startDow;
  for (let d = 1; d <= lastDay.date(); d++) {
    const ds  = month.date(d).format('YYYY-MM-DD');
    const dow = (startDow + d - 1) % 7;
    if (dow === 0 && d !== 1) html += '</tr><tr>';

    const isToday   = ds === today;
    const isHoliday = holidays.has(ds);
    const isSun     = dow === 0;
    const isSat     = dow === 6;

    // 상태 결정: 연차 우선
    let statusCode = '';
    if (leaveSet.has(ds))  statusCode = '연';
    else if (schedMap.has(ds)) statusCode = STATUS_LABEL[schedMap.get(ds)] || '';

    const dotHtml = statusCode
      ? `<div><span class="sched-dot ${DOT_CLASS[statusCode]||''}">${statusCode}</span></div>`
      : '';

    const numClass = isHoliday || isSun ? 'day-sun' : isSat ? 'day-sat' : '';
    const cellClass = isToday ? 'today-cell' : '';

    html += `<td>
      <div class="${cellClass}" style="padding:4px 2px;text-align:center;">
        <div class="${numClass}" style="font-size:12px;font-weight:600;">${d}</div>
        ${dotHtml}
      </div>
    </td>`;

    col = dow;
  }

  // 마지막 주 빈칸
  if (col < 6) for (let i = col + 1; i <= 6; i++) html += '<td></td>';
  html += '</tr></tbody></table>';

  // 이달 통계
  let work = 0, leave = 0, off = 0;
  for (let d = 1; d <= lastDay.date(); d++) {
    const ds = month.date(d).format('YYYY-MM-DD');
    if (leaveSet.has(ds)) { leave++; continue; }
    const raw = schedMap.get(ds);
    if (!raw) continue;
    const code = STATUS_LABEL[raw] || '';
    if (code === '근') work++;
    else if (['휴','반','직'].includes(code)) off++;
  }

  const summary = `
    <div class="stat-grid" style="margin-top:16px;margin-bottom:0;">
      <div class="stat-card blue">
        <div class="stat-label">이달 근무</div>
        <div class="stat-value" style="color:var(--blue)">${work}일</div>
      </div>
      <div class="stat-card green">
        <div class="stat-label">연차 사용</div>
        <div class="stat-value" style="color:var(--green)">${leave}일</div>
      </div>
      <div class="stat-card yellow">
        <div class="stat-label">기타 휴무</div>
        <div class="stat-value" style="color:var(--yellow)">${off}일</div>
      </div>
    </div>`;

  return html + summary;
}
