// admin/schedule.js — 달력형 스케줄 관리
// 월~토 6열 달력 / 날짜칸 = 4열 직원 그리드 / 부서·근무 필터

import { state } from '../core/state.js';
import {
  fetchMonthSchedules, fetchHolidays, fetchTeamLayout,
  upsertSchedules, upsertTeamLayout,
} from '../core/db.js';
import { toast } from '../main.js';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 상수
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const DAY_NAMES = ['월','화','수','목','금','토'];

const NORM = {
  '근무':'근무','근':'근무',
  '연차':'연차','연':'연차',
  '반차':'반차','반':'반차',
  '휴무':'휴무','휴가':'휴무','휴':'휴무',
  '휴직':'휴직','직':'휴직',
};
const STATUS_ABBR = { '근무':'', '연차':'연', '반차':'반', '휴무':'휴', '직':'직', '휴직':'직' };
const STATUS_CSS  = {
  '근무': 'slot-work',
  '연차': 'slot-annual',
  '반차': 'slot-half',
  '휴무': 'slot-off',
  '휴직': 'slot-leave',
};
const TO_DB = { '근무':'근무','연차':'연차','반차':'반차','휴무':'휴무','휴직':'휴직' };
const STATUS_POPUP = [
  { s:'근무', icon:'✅' }, { s:'휴무', icon:'😴' },
  { s:'연차', icon:'🏖' }, { s:'반차', icon:'🌙' },
  { s:'휴직', icon:'⏸' },
];

// 부서별 색상 (dot)
const DEPT_COLORS = [
  '#6366f1','#ec4899','#f59e0b','#10b981',
  '#3b82f6','#8b5cf6','#ef4444','#14b8a6',
];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 모듈 상태
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
let mountEl     = null;
let rows        = [];         // [{employee, isWonJang}]
let cellData    = new Map();  // `${empId}_${date}` → status
let leaveSet    = new Map();  // empId → Set<dateStr>
let holidays    = new Set();
let unsaved     = new Map();
let deptColorMap= new Map();  // deptId → color

let filterDept  = 'all';      // 'all' | deptId
let filterMode  = 'all';      // 'all' | 'working' | 'off'

let _popup = null;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 유틸
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function normStatus(v) {
  if (!v) return '근무';
  const s = String(v).trim();
  return NORM[s] ?? NORM[s[0]] ?? '근무';
}

function getStatus(empId, dateStr, col) {
  if (leaveSet.get(empId)?.has(dateStr)) return '연차';
  const key = `${empId}_${dateStr}`;
  if (cellData.has(key)) return cellData.get(key);
  return (col.isWeekend || col.isHoliday) ? '휴무' : '근무';
}

function buildDeptColors() {
  deptColorMap.clear();
  (state.departments || []).forEach((d, i) => {
    deptColorMap.set(d.id, DEPT_COLORS[i % DEPT_COLORS.length]);
  });
}

// 해당 월의 첫 월요일 (월~토 캘린더용)
function getFirstMonday(d) {
  const first = d.startOf('month');
  const dow   = first.day(); // 0=일, 1=월 ...
  const diff  = dow === 0 ? 6 : dow - 1;
  return first.subtract(diff, 'day');
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DB 로딩
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function loadMonth() {
  const d     = dayjs(state.schedule.date);
  const start = d.startOf('month').format('YYYY-MM-DD');
  const end   = d.endOf('month').format('YYYY-MM-DD');
  const mk    = d.format('YYYY-MM-01');

  const [sRes, hRes, lRes] = await Promise.all([
    fetchMonthSchedules(start, end),
    fetchHolidays(start, end),
    fetchTeamLayout(mk),
  ]);

  if (sRes.error) throw sRes.error;
  if (hRes.error) throw hRes.error;

  state.schedule.schedules = sRes.data || [];
  holidays = new Set((hRes.data || []).map(h => h.date));
  state.schedule.layout    = lRes.data?.[0]?.layout_data || null;

  cellData.clear();
  (state.schedule.schedules || []).forEach(s => {
    cellData.set(`${s.employee_id}_${s.date}`, normStatus(s.status));
  });

  leaveSet.clear();
  (state.leaveRequests || []).forEach(r => {
    if (r.status !== 'approved' || !Array.isArray(r.dates)) return;
    if (!leaveSet.has(r.employee_id)) leaveSet.set(r.employee_id, new Set());
    r.dates.forEach(ds => leaveSet.get(r.employee_id).add(ds));
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 직원 순서 빌드 (기존 로직 유지)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function buildRows() {
  const emps    = (state.employees || []).filter(e =>
    !e.is_temp && !e.retired && !(e.email?.startsWith('temp-'))
  );
  const deptMap = new Map((state.departments || []).map(d => [d.id, d]));
  const layout  = state.schedule.layout;

  if (Array.isArray(layout) && layout[0]?.leader_id !== undefined) {
    const em = new Map(emps.map(e => [e.id, e]));
    const out = []; const seen = new Set();
    layout.forEach(t => {
      const l = em.get(t.leader_id);
      if (l) { out.push({ employee: l, isWonJang: true }); seen.add(l.id); }
      (t.members || []).forEach(id => {
        const m = em.get(id);
        if (m && !seen.has(m.id)) { out.push({ employee: m, isWonJang: false }); seen.add(m.id); }
      });
    });
    emps.forEach(e => { if (!seen.has(e.id)) out.push({ employee: e, isWonJang: false }); });
    return out;
  }

  const ORDER = ['원장','진료실','경영지원실','기공실'];
  const grp   = new Map();
  emps.forEach(e => {
    const n = deptMap.get(e.department_id)?.name || '기타';
    if (!grp.has(n)) grp.set(n, []);
    grp.get(n).push(e);
  });
  const depts = [...ORDER, ...Array.from(grp.keys()).filter(d => !ORDER.includes(d))];
  const out   = [];
  depts.forEach(n => (grp.get(n) || []).forEach(e =>
    out.push({ employee: e, isWonJang: n.includes('원장') })
  ));
  return out;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 달력 렌더링
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function renderCalendar() {
  if (!mountEl) return;
  closePopup();

  const d        = dayjs(state.schedule.date);
  const curMonth = d.month();
  const lastDay  = d.endOf('month');
  const today    = dayjs().format('YYYY-MM-DD');
  let   wkStart  = getFirstMonday(d);

  // 부서 필터 적용된 직원 목록
  const visibleRows = filterDept === 'all'
    ? rows
    : rows.filter(r => String(r.employee.department_id) === String(filterDept));

  let html = `<div class="cal-outer">`;

  // ── 요일 헤더
  html += `<div class="cal-hdr-row">`;
  DAY_NAMES.forEach((n, i) => {
    html += `<div class="cal-hdr-cell${i === 5 ? ' cal-hdr-sat' : ''}">${n}</div>`;
  });
  html += `</div>`;

  // ── 주 블록
  let weekCount = 0;
  while (wkStart.isBefore(lastDay) || wkStart.month() === curMonth) {
    html += `<div class="cal-week-row">`;

    for (let di = 0; di < 6; di++) {  // 월~토
      const day = wkStart.add(di, 'day');
      const ds  = day.format('YYYY-MM-DD');
      const inMonth  = day.month() === curMonth;
      const isSat    = di === 5;
      const isHol    = holidays.has(ds);
      const isToday  = ds === today;

      let dayCls = 'cal-day-cell';
      if (!inMonth) dayCls += ' cal-day-other';
      if (isToday)  dayCls += ' cal-day-today';
      if (isSat)    dayCls += ' cal-day-sat';
      if (isHol)    dayCls += ' cal-day-hol';

      let numCls = 'cal-day-num';
      if (isSat || isHol) numCls += ' num-sat';
      if (!inMonth)       numCls += ' num-other';

      const col = { date: ds, isWeekend: isSat, isHoliday: isHol };

      // 직원 슬롯 필터링
      const slotsData = visibleRows
        .map(({ employee: e, isWonJang }) => {
          const status = getStatus(e.id, ds, col);
          if (filterMode === 'working' && status !== '근무') return null;
          if (filterMode === 'off'     && status === '근무') return null;
          return { e, isWonJang, status };
        })
        .filter(Boolean);

      html += `<div class="${dayCls}">`;
      html += `<div class="${numCls}">${inMonth ? day.date() : day.format('M/D')}`;
      if (isHol && inMonth) html += `<span class="hol-dot"></span>`;
      html += `</div>`;

      // 4열 그리드
      html += `<div class="cal-4grid">`;
      slotsData.forEach(({ e, isWonJang, status }) => {
        const deptColor = deptColorMap.get(e.department_id) || '#94a3b8';
        const abbr      = STATUS_ABBR[status] || '';
        const isSys     = leaveSet.get(e.id)?.has(ds);

        let slotCls = `cal-slot ${STATUS_CSS[status] || 'slot-work'}`;
        if (isWonJang) slotCls += ' slot-lead';
        if (isSys)     slotCls += ' slot-sys';

        html += `<div class="${slotCls}"
          data-emp="${e.id}" data-date="${ds}" data-sys="${isSys ? 1 : 0}"
          title="${e.name} · ${status}">`;
        html += `<span class="slot-dot" style="background:${deptColor}"></span>`;
        html += `<span class="slot-name">${e.name}</span>`;
        if (abbr) html += `<span class="slot-abbr">${abbr}</span>`;
        html += `</div>`;
      });

      // 빈 슬롯 (4열 맞춤)
      const rem = (4 - slotsData.length % 4) % 4;
      for (let i = 0; i < rem; i++) html += `<div class="cal-slot slot-empty"></div>`;

      html += `</div>`; // .cal-4grid
      html += `</div>`; // .cal-day-cell
    }

    html += `</div>`; // .cal-week-row
    wkStart = wkStart.add(1, 'week');
    if (++weekCount >= 6) break;
  }

  html += `</div>`; // .cal-outer
  mountEl.innerHTML = html;

  mountEl.addEventListener('click', onSlotClick);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 상태 변경 팝업
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function onSlotClick(e) {
  const slot = e.target.closest('.cal-slot[data-emp]');
  if (!slot) return;
  const empId   = parseInt(slot.dataset.emp);
  const dateStr = slot.dataset.date;
  const isSys   = slot.dataset.sys === '1';
  openPopup(slot, empId, dateStr, isSys);
}

function openPopup(anchor, empId, dateStr, isSys) {
  closePopup();

  const pop = document.createElement('div');
  pop.className = 'sched-popup';
  pop.innerHTML = STATUS_POPUP.map(({ s, icon }) =>
    `<button class="pop-btn${isSys && s === '연차' ? ' pop-disabled' : ''}"
      data-status="${s}"
      ${isSys && s === '연차' ? 'disabled title="연차시스템 자동 관리"' : ''}
    >${icon} ${s}</button>`
  ).join('');

  pop.addEventListener('click', ev => {
    const btn = ev.target.closest('[data-status]');
    if (!btn || btn.disabled) return;
    applyStatus(empId, dateStr, btn.dataset.status, isSys);
    closePopup();
  });

  document.body.appendChild(pop);
  _popup = pop;

  const rect = anchor.getBoundingClientRect();
  const pw = 140, ph = STATUS_POPUP.length * 38 + 8;
  let top  = rect.bottom + window.scrollY + 4;
  let left = rect.left   + window.scrollX;
  if (left + pw > window.innerWidth - 8)  left = window.innerWidth - pw - 8;
  if (top  + ph > window.innerHeight + window.scrollY - 8) top = rect.top + window.scrollY - ph - 4;
  pop.style.top  = `${top}px`;
  pop.style.left = `${left}px`;

  setTimeout(() => document.addEventListener('click', outsideClose, { once: true }), 0);
}

function outsideClose(e) {
  if (_popup && !_popup.contains(e.target)) closePopup();
}

function closePopup() {
  _popup?.remove(); _popup = null;
  document.removeEventListener('click', outsideClose);
}

function applyStatus(empId, dateStr, newStatus, isSys) {
  if (isSys && newStatus === '연차') return;

  const key = `${empId}_${dateStr}`;
  cellData.set(key, newStatus);
  unsaved.set(key, { empId, date: dateStr, status: newStatus });
  updateSaveBtn();

  // 해당 슬롯 직접 업데이트
  const slot = mountEl?.querySelector(`.cal-slot[data-emp="${empId}"][data-date="${dateStr}"]`);
  if (slot) {
    const row       = rows.find(r => r.employee.id === empId);
    const deptColor = deptColorMap.get(row?.employee?.department_id) || '#94a3b8';
    const abbr      = STATUS_ABBR[newStatus] || '';
    const isSys2    = leaveSet.get(empId)?.has(dateStr);

    // 필터 적용
    if (filterMode === 'working' && newStatus !== '근무') { slot.style.display = 'none'; return; }
    if (filterMode === 'off'     && newStatus === '근무') { slot.style.display = 'none'; return; }
    slot.style.display = '';

    slot.className = `cal-slot ${STATUS_CSS[newStatus] || 'slot-work'}`;
    if (row?.isWonJang) slot.className += ' slot-lead';
    if (isSys2)         slot.className += ' slot-sys';
    slot.setAttribute('title', `${row?.employee?.name || ''} · ${newStatus}`);
    slot.innerHTML =
      `<span class="slot-dot" style="background:${deptColor}"></span>` +
      `<span class="slot-name">${row?.employee?.name || ''}</span>` +
      (abbr ? `<span class="slot-abbr">${abbr}</span>` : '');
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 저장
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function updateSaveBtn() {
  const btn = document.getElementById('sched-save-btn');
  if (!btn) return;
  const n = unsaved.size;
  btn.disabled    = n === 0;
  btn.textContent = n > 0 ? `💾 저장 (${n}건)` : '💾 저장';
}

async function save() {
  if (!unsaved.size) return;
  const btn = document.getElementById('sched-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = '저장 중…'; }
  try {
    const payload = Array.from(unsaved.values()).map(({ empId, date, status }) => ({
      employee_id: empId, date,
      status: TO_DB[status] || '근무',
      grid_position: 0, sort_order: 0,
    }));
    const { error } = await upsertSchedules(payload);
    if (error) throw error;
    unsaved.clear();
    updateSaveBtn();
    toast(`✅ ${payload.length}건 저장 완료`, 'success');
  } catch (err) {
    toast('저장 실패: ' + err.message, 'error');
  } finally { updateSaveBtn(); }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 네비게이션 / 새로고침
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function navigate(dir) {
  if (unsaved.size && !confirm('저장 안 된 변경사항이 있습니다. 이동할까요?')) return;
  unsaved.clear();
  const cur = dayjs(state.schedule.date);
  state.schedule.date = (
    dir === 'prev'  ? cur.subtract(1, 'month') :
    dir === 'next'  ? cur.add(1, 'month') :
    dayjs()
  ).format('YYYY-MM-DD');
  await refresh();
}

async function refresh() {
  const title = document.getElementById('sched-month-title');
  if (title) title.textContent = dayjs(state.schedule.date).format('YYYY년 M월');
  if (!mountEl) return;
  mountEl.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⏳</div><div>로딩 중…</div></div>`;
  try {
    await loadMonth();
    buildDeptColors();
    rows = buildRows();
    renderCalendar();
    unsaved.clear();
    updateSaveBtn();
  } catch (err) {
    mountEl.innerHTML = `<p style="color:red;padding:16px;">오류: ${err.message}</p>`;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 필터 UI 빌드
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function buildDeptFilter() {
  const depts = state.departments || [];
  return `
    <div class="filter-group">
      <button class="filter-btn active" data-dept="all">전체</button>
      ${depts.map(d =>
        `<button class="filter-btn" data-dept="${d.id}">${d.name}</button>`
      ).join('')}
    </div>`;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 진입점
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export function render(container) {
  container.innerHTML = `
    <div class="sched-wrap">
      <div class="sched-toolbar">
        <div class="toolbar-left">
          ${buildDeptFilter()}
          <div class="view-toggle" style="margin-left:8px;">
            <button class="view-btn active" data-mode="all">전체</button>
            <button class="view-btn" data-mode="working">근무</button>
            <button class="view-btn" data-mode="off">휴무</button>
          </div>
        </div>
        <div class="action-btns">
          <button id="sched-save-btn" disabled class="btn-primary">💾 저장</button>
        </div>
      </div>

      <div class="sheet-nav">
        <button id="sched-prev"  class="btn-secondary" style="font-size:12px;padding:5px 10px;">◀ 이전달</button>
        <h2 id="sched-month-title" class="month-title"></h2>
        <button id="sched-next"  class="btn-secondary" style="font-size:12px;padding:5px 10px;">다음달 ▶</button>
        <button id="sched-today" class="btn-secondary" style="font-size:12px;padding:5px 10px;">오늘</button>
      </div>

      <div id="sched-mount" class="cal-mount"></div>

      <div class="sheet-legend">
        <span class="legend-label">범례</span>
        <span class="badge-근">근무</span>
        <span class="badge-연">연 연차</span>
        <span class="badge-반">반 반차</span>
        <span class="badge-휴">휴 휴무</span>
        <span class="badge-직">직 휴직</span>
        <span class="legend-note">기울임꼴 = 연차시스템 자동반영 · 슬롯 클릭으로 상태 변경</span>
      </div>
    </div>`;

  mountEl = container.querySelector('#sched-mount');
  document.getElementById('sched-month-title').textContent =
    dayjs(state.schedule.date).format('YYYY년 M월');

  // 부서 필터
  container.querySelector('.filter-group').addEventListener('click', e => {
    const btn = e.target.closest('[data-dept]');
    if (!btn) return;
    filterDept = btn.dataset.dept;
    container.querySelectorAll('.filter-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.dept === filterDept)
    );
    renderCalendar();
  });

  // 근무/휴무 필터
  container.querySelector('.view-toggle').addEventListener('click', e => {
    const btn = e.target.closest('[data-mode]');
    if (!btn) return;
    filterMode = btn.dataset.mode;
    container.querySelectorAll('.view-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.mode === filterMode)
    );
    renderCalendar();
  });

  document.getElementById('sched-prev').onclick   = () => navigate('prev');
  document.getElementById('sched-next').onclick   = () => navigate('next');
  document.getElementById('sched-today').onclick  = () => navigate('today');
  document.getElementById('sched-save-btn').onclick = save;

  refresh();
}
