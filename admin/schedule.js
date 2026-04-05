// admin/schedule.js — 달력 스타일 스케줄 관리

import { state }                from '../core/state.js';
import { fetchMonthSchedules, fetchHolidays, fetchTeamLayout,
         upsertSchedules, addHoliday, removeHoliday, upsertTeamLayout } from '../core/db.js';
import { toast }                from '../main.js';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 상수
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const NORM_MAP = {
  '근무':'근무','근':'근무',
  '연차':'연차','연':'연차',
  '반차':'반차','반':'반차',
  '휴무':'휴무','휴가':'휴무','휴':'휴무',
  '휴직':'휴직','직':'휴직',
};
const STATUS_ABBR = { '근무':'', '연차':'연', '반차':'반', '휴무':'휴', '휴직':'직' };
const STATUS_CYCLE = ['근무', '휴무', '연차', '반차', '휴직'];
const TO_DB = { '근무':'근무','연차':'연차','반차':'반차','휴무':'휴무','휴직':'휴직' };

// 부서별 색상
const DEPT_COLORS = ['#6366f1','#ec4899','#f59e0b','#10b981','#3b82f6','#8b5cf6','#ef4444','#14b8a6'];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 모듈 상태
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
let mountEl    = null;
let rows       = [];           // [{employee, isWonJang}]
let dates      = [];           // [{date, dayNum, dow, ...}]
let cellData   = new Map();    // `${empId}_${dateStr}` → status
let leaves     = new Map();    // empId → Set<dateStr>
let unsaved    = new Map();    // `${empId}_${dateStr}` → {empId, date, status}
let deptColorMap = new Map();  // deptId → color string

let _popupEl   = null;
let _popupKey  = null;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 유틸
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function normStatus(v) {
  if (!v) return '근무';
  const s = String(v).trim();
  return NORM_MAP[s] ?? NORM_MAP[s[0]] ?? '근무';
}

function getStatus(empId, col) {
  if (leaves.get(empId)?.has(col.date)) return '연차';
  const key = `${empId}_${col.date}`;
  if (cellData.has(key)) return cellData.get(key);
  return (col.isWeekend || col.isHoliday) ? '휴무' : '근무';
}

function buildDeptColors() {
  deptColorMap.clear();
  let idx = 0;
  (state.departments || []).forEach(d => {
    deptColorMap.set(d.id, DEPT_COLORS[idx++ % DEPT_COLORS.length]);
  });
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
  state.schedule.holidays  = new Set((hRes.data||[]).map(h => h.date));
  state.schedule.layout    = lRes.data?.[0]?.layout_data || null;

  // cellData 맵
  cellData.clear();
  (state.schedule.schedules||[]).forEach(s => {
    cellData.set(`${s.employee_id}_${s.date}`, normStatus(s.status));
  });

  // 연차 맵
  leaves.clear();
  (state.leaveRequests||[]).forEach(r => {
    if (r.status !== 'approved' || !Array.isArray(r.dates)) return;
    if (!leaves.has(r.employee_id)) leaves.set(r.employee_id, new Set());
    r.dates.forEach(ds => leaves.get(r.employee_id).add(ds));
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 행/날짜 빌드 (기존 로직 유지)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function buildRows() {
  const emps    = (state.employees||[]).filter(e => !e.is_temp && !e.retired && !(e.email?.startsWith('temp-')));
  const deptMap = new Map((state.departments||[]).map(d => [d.id,d]));
  const layout  = state.schedule.layout;

  if (Array.isArray(layout) && layout[0]?.leader_id !== undefined) {
    const em=new Map(emps.map(e=>[e.id,e])); const out=[]; const seen=new Set();
    layout.forEach(t=>{
      const l=em.get(t.leader_id); if(l){out.push({employee:l,isWonJang:true});seen.add(l.id);}
      (t.members||[]).forEach(id=>{const m=em.get(id);if(m&&!seen.has(m.id)){out.push({employee:m,isWonJang:false});seen.add(m.id);}});
    });
    emps.forEach(e=>{if(!seen.has(e.id))out.push({employee:e,isWonJang:false});});
    return out;
  }
  if (Array.isArray(layout) && layout[0]?.members) {
    const em=new Map(emps.map(e=>[e.id,e])); const out=[]; const seen=new Set();
    layout[0].members.forEach(id=>{const e=em.get(id);if(!e)return;const dn=deptMap.get(e.department_id)?.name||'';out.push({employee:e,isWonJang:dn.includes('원장')});seen.add(id);});
    emps.forEach(e=>{if(!seen.has(e.id)){const dn=deptMap.get(e.department_id)?.name||'';out.push({employee:e,isWonJang:dn.includes('원장')});}});
    return out;
  }
  const ORDER=['원장','진료실','경영지원실','기공실'];
  const grp=new Map(); emps.forEach(e=>{const n=deptMap.get(e.department_id)?.name||'기타';if(!grp.has(n))grp.set(n,[]);grp.get(n).push(e);});
  const depts=[...ORDER,...Array.from(grp.keys()).filter(d=>!ORDER.includes(d))];
  const out=[];
  depts.forEach(n=>(grp.get(n)||[]).forEach(e=>out.push({employee:e,isWonJang:n.includes('원장')})));
  return out;
}

function buildDates() {
  const d=dayjs(state.schedule.date), n=d.daysInMonth(), hol=state.schedule.holidays, tod=dayjs().format('YYYY-MM-DD');
  return Array.from({length:n},(_,i)=>{
    const dt=d.date(i+1), ds=dt.format('YYYY-MM-DD'), dow=dt.day();
    return {date:ds,dayNum:i+1,dayLabel:'일월화수목금토'[dow],dow,
      isWeekend:dow===0||dow===6,isSunday:dow===0,isSaturday:dow===6,
      isHoliday:hol.has(ds),isToday:ds===tod};
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 달력 렌더링
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function renderCalendar() {
  if (!mountEl) return;
  closePopup();

  const d         = dayjs(state.schedule.date);
  const firstDow  = d.startOf('month').day();  // 0=일
  const vm        = state.schedule.view || 'all';
  const dayNames  = ['일','월','화','수','목','금','토'];

  let html = `<div class="cal-grid">`;

  // 요일 헤더
  dayNames.forEach((n, i) => {
    const cls = i === 0 ? 'cal-hdr cal-hdr-sun'
              : i === 6 ? 'cal-hdr cal-hdr-sat'
              : 'cal-hdr';
    html += `<div class="${cls}">${n}</div>`;
  });

  // 첫날 이전 빈 칸
  for (let i = 0; i < firstDow; i++) {
    html += `<div class="cal-day cal-day-empty"></div>`;
  }

  // 날짜 셀
  dates.forEach(col => {
    let dayCls = 'cal-day';
    if (col.isToday)                    dayCls += ' cal-day-today';
    if (col.isSunday || col.isHoliday)  dayCls += ' cal-day-sun';
    else if (col.isSaturday)            dayCls += ' cal-day-sat';

    let numCls = 'cal-date-num';
    if (col.isSunday || col.isHoliday)  numCls += ' cal-num-red';
    else if (col.isSaturday)            numCls += ' cal-num-blue';
    if (col.isToday)                    numCls += ' cal-num-today';

    html += `<div class="${dayCls}" data-date="${col.date}">`;
    html += `<div class="${numCls}">${col.dayNum}`;
    if (col.isHoliday && !col.isWeekend) html += `<span class="cal-holiday-dot"></span>`;
    html += `</div>`;
    html += `<div class="cal-chips">`;

    // 직원 칩
    rows.forEach(({ employee: e, isWonJang }) => {
      const status  = getStatus(e.id, col);
      const isLeave = leaves.get(e.id)?.has(col.date);

      // 보기 모드 필터
      if (vm === 'working' && status !== '근무') return;
      if (vm === 'off'     && status === '근무') return;

      const deptColor = deptColorMap.get(e.department_id) || '#94a3b8';
      const abbr      = STATUS_ABBR[status];

      let chipCls = `cal-chip cal-chip-${status === '근무' ? 'work'
                                       : status === '연차' ? 'annual'
                                       : status === '반차' ? 'half'
                                       : status === '휴무' ? 'off'
                                       : 'leave'}`;
      if (isWonJang)  chipCls += ' cal-chip-lead';
      if (isLeave)    chipCls += ' cal-chip-sys';  // 연차시스템 자동

      html += `<div class="${chipCls}"
        data-emp="${e.id}"
        data-date="${col.date}"
        data-sys="${isLeave ? '1' : '0'}"
        title="${e.name} · ${status}">`;
      html += `<span class="chip-dot" style="background:${deptColor}"></span>`;
      html += `<span class="chip-name">${e.name}</span>`;
      if (abbr) html += `<span class="chip-abbr">${abbr}</span>`;
      html += `</div>`;
    });

    html += `</div></div>`; // .cal-chips / .cal-day
  });

  html += `</div>`; // .cal-grid
  mountEl.innerHTML = html;

  // 이벤트: 칩 클릭
  mountEl.addEventListener('click', onCalClick);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 팝업 (상태 선택)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const STATUS_ICONS = {
  '근무':'✅', '연차':'🏖', '반차':'🌙', '휴무':'😴', '휴직':'⏸'
};

function openPopup(chipEl, empId, dateStr, isSys) {
  closePopup();

  const key = `${empId}_${dateStr}`;
  _popupKey  = key;

  const pop = document.createElement('div');
  pop.className = 'cal-popup';
  pop.innerHTML = STATUS_CYCLE.map(s =>
    `<button class="cal-pop-btn${isSys && s==='연차' ? ' cal-pop-disabled' : ''}"
      data-status="${s}"
      ${isSys && s==='연차' ? 'disabled title="연차시스템에서 자동 관리됩니다"' : ''}
    >${STATUS_ICONS[s]} ${s}</button>`
  ).join('');
  pop.addEventListener('click', e => {
    const btn = e.target.closest('[data-status]');
    if (!btn || btn.disabled) return;
    setStatus(empId, dateStr, btn.dataset.status, isSys);
    closePopup();
  });

  document.body.appendChild(pop);
  _popupEl = pop;

  // 위치
  const rect = chipEl.getBoundingClientRect();
  const pw = 140, ph = STATUS_CYCLE.length * 36 + 8;
  let top  = rect.bottom + window.scrollY + 4;
  let left = rect.left + window.scrollX;
  if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
  if (top + ph  > window.innerHeight + window.scrollY - 8) top = rect.top + window.scrollY - ph - 4;
  pop.style.top  = top + 'px';
  pop.style.left = left + 'px';

  // 외부 클릭 닫기
  setTimeout(() => {
    document.addEventListener('click', outsideClose, { once: true });
  }, 0);
}

function outsideClose(e) {
  if (_popupEl && !_popupEl.contains(e.target)) closePopup();
}

function closePopup() {
  if (_popupEl) { _popupEl.remove(); _popupEl = null; }
  document.removeEventListener('click', outsideClose);
  _popupKey = null;
}

function onCalClick(e) {
  const chip = e.target.closest('.cal-chip');
  if (!chip) return;
  const empId   = parseInt(chip.dataset.emp);
  const dateStr = chip.dataset.date;
  const isSys   = chip.dataset.sys === '1';
  openPopup(chip, empId, dateStr, isSys);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 상태 변경
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function setStatus(empId, dateStr, newStatus, isSys) {
  if (isSys && newStatus === '연차') return; // 시스템 연차는 변경 불가

  const key = `${empId}_${dateStr}`;
  cellData.set(key, newStatus);
  unsaved.set(key, { empId, date: dateStr, status: newStatus });
  updateSaveBtn();

  // 해당 칩만 업데이트
  const chip = mountEl?.querySelector(`.cal-chip[data-emp="${empId}"][data-date="${dateStr}"]`);
  if (chip) {
    const row   = rows.find(r => r.employee.id === empId);
    const col   = dates.find(d => d.date === dateStr);
    const abbr  = STATUS_ABBR[newStatus];
    const deptColor = deptColorMap.get(row?.employee?.department_id) || '#94a3b8';

    // 칩 클래스 재설정
    chip.className = `cal-chip cal-chip-${newStatus === '근무' ? 'work'
                                         : newStatus === '연차' ? 'annual'
                                         : newStatus === '반차' ? 'half'
                                         : newStatus === '휴무' ? 'off'
                                         : 'leave'}`;
    if (row?.isWonJang) chip.className += ' cal-chip-lead';
    chip.setAttribute('title', `${row?.employee?.name || ''} · ${newStatus}`);

    chip.innerHTML = `<span class="chip-dot" style="background:${deptColor}"></span>`
                   + `<span class="chip-name">${row?.employee?.name || ''}</span>`
                   + (abbr ? `<span class="chip-abbr">${abbr}</span>` : '');

    // 보기 모드 필터
    const vm = state.schedule.view || 'all';
    if (vm === 'working' && newStatus !== '근무') chip.style.display = 'none';
    else if (vm === 'off' && newStatus === '근무') chip.style.display = 'none';
    else chip.style.display = '';
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 저장 / 레이아웃
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
  } finally {
    updateSaveBtn();
  }
}

async function saveLayout() {
  const month = dayjs(state.schedule.date).format('YYYY-MM-01');
  const teams = []; let cur = null;
  rows.forEach(({ employee: e, isWonJang }) => {
    if (isWonJang) { cur = { leader_id: e.id, members: [] }; teams.push(cur); }
    else { (cur ?? (cur = teams[0] ?? (teams[0] = { leader_id: null, members: [] }))).members.push(e.id); }
  });
  const { error } = await upsertTeamLayout(month, teams);
  if (error) throw error;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 보기 모드 / 공휴일 / 주간검수
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function setView(vm) {
  state.schedule.view = vm;
  document.querySelectorAll('.view-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === vm)
  );
  renderCalendar();
}

async function toggleHoliday() {
  const ds = prompt('날짜 입력 (YYYY-MM-DD)\n※ 이미 등록된 날짜 입력 시 해제');
  if (!ds || !/^\d{4}-\d{2}-\d{2}$/.test(ds)) return;
  const hol = state.schedule.holidays;
  if (hol.has(ds)) {
    const { error } = await removeHoliday(ds);
    if (error) { toast(error.message, 'error'); return; }
    hol.delete(ds);
  } else {
    const { error } = await addHoliday(ds);
    if (error) { toast(error.message, 'error'); return; }
    hol.add(ds);
  }
  await refresh();
}

function weeklyCheck() {
  const warns = [];
  rows.forEach(({ employee: e }) => {
    const wm = new Map();
    dates.forEach(col => {
      if (col.isWeekend || col.isHoliday) return;
      const wk = dayjs(col.date).week();
      if (!wm.has(wk)) wm.set(wk, { biz: 0, work: 0 });
      const w = wm.get(wk); w.biz++;
      if (getStatus(e.id, col) === '근무') w.work++;
    });
    wm.forEach((w, wk) => {
      const exp = Math.min(w.biz, 5);
      if (w.work < exp) warns.push(`• ${e.name} ${wk}주: 근무 ${w.work}일 / 기대 ${exp}일`);
    });
  });
  if (!warns.length) toast('✅ 모든 직원 주간 근무 정상', 'success');
  else alert('⚠️ 주간 근무 미달\n\n' + warns.join('\n'));
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 내비게이션 / 새로고침
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
    rows  = buildRows();
    dates = buildDates();
    renderCalendar();
    unsaved.clear();
    updateSaveBtn();
  } catch (err) {
    mountEl.innerHTML = `<p style="color:red;padding:16px;">오류: ${err.message}</p>`;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 진입점
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export function render(container) {
  container.innerHTML = `
    <div class="sched-wrap">
      <div class="sheet-toolbar">
        <div class="view-toggle">
          <button class="view-btn active" data-mode="all">통합 보기</button>
          <button class="view-btn" data-mode="working">근무표</button>
          <button class="view-btn" data-mode="off">휴무표</button>
        </div>
        <div class="action-btns">
          <button id="sched-check-btn"   class="btn-secondary">⚠️ 주간 검수</button>
          <button id="sched-holiday-btn" class="btn-secondary">🗓 공휴일</button>
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
        <span class="badge-근">● 근무</span>
        <span class="badge-연">연 연차</span>
        <span class="badge-반">반 반차</span>
        <span class="badge-휴">휴 휴무</span>
        <span class="badge-직">직 휴직</span>
        <span class="legend-note">기울임꼴 = 연차시스템 자동반영</span>
      </div>
    </div>`;

  mountEl = container.querySelector('#sched-mount');
  document.getElementById('sched-month-title').textContent =
    dayjs(state.schedule.date).format('YYYY년 M월');

  container.querySelector('.view-toggle').addEventListener('click', e => {
    const b = e.target.closest('.view-btn');
    if (b) setView(b.dataset.mode);
  });
  document.getElementById('sched-prev').onclick    = () => navigate('prev');
  document.getElementById('sched-next').onclick    = () => navigate('next');
  document.getElementById('sched-today').onclick   = () => navigate('today');
  document.getElementById('sched-save-btn').onclick  = save;
  document.getElementById('sched-check-btn').onclick = weeklyCheck;
  document.getElementById('sched-holiday-btn').onclick = toggleHoliday;

  refresh();
}
