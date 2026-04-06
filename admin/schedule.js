// admin/schedule.js — 달력형 오프표 (날짜칸 = 4×7 jSpreadsheet 셀)
//
// 구조: 6열 달력 (월~토), 각 날짜 = 4열×7행 jSpreadsheet 셀 블록
// 전체 시트: 24열(6일×4슬롯) × (주당8행: 날짜헤더1 + 직원7)
// 셀내용 = 직원이름(고정) / 배경색 = 근무상태
// Ctrl+C/X/V  = 상태값 복사/잘라내기/붙여넣기 (외부 Excel 포함)
// Ctrl+Z/Y    = 되돌리기/다시실행

import { state } from '../core/state.js';
import {
  fetchMonthSchedules, fetchHolidays, fetchTeamLayout,
  upsertSchedules, addHoliday, removeHoliday,
} from '../core/db.js';
import { toast } from '../main.js';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 상수
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const DAYS       = 6;
const SLOT_COLS  = 4;
const SLOT_ROWS  = 7;
const TOTAL_COLS = DAYS * SLOT_COLS;   // 24
const RPW        = SLOT_ROWS + 1;      // 8 (날짜헤더1 + 직원7)

const NORM = {
  '근무':'근','근':'근','연차':'연','연':'연','반차':'반','반':'반',
  '휴무':'휴','휴가':'휴','휴':'휴','휴직':'직','직':'직',
};
const TO_DB = { '근':'근무','연':'연차','반':'반차','휴':'휴무','직':'휴직','':'휴무' };

const STATUS_BG = {
  '근':  { bg:'#ffffff', color:'#1f2937' },
  '연':  { bg:'#dbeafe', color:'#1e40af' },
  '반':  { bg:'#e0f2fe', color:'#075985' },
  '휴':  { bg:'#fef9c3', color:'#78350f' },
  '직':  { bg:'#fce7f3', color:'#9d174d' },
  '':    { bg:'#f3f4f6', color:'#9ca3af' },
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 모듈 상태
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
let mountEl    = null;
let jsi        = null;
let empRows    = [];
let weekStarts = [];
let statusMap  = new Map(); // `${empId}_${date}` → '근'|'연'|'반'|'휴'|'직'|''
let leaveMap   = new Map();
let holidays   = new Set();
let unsaved    = new Map();
let curMonth   = 0;

// 히스토리 스택
let _baseMap   = new Map();  // DB 로드 시 초기 상태
let _histStack = [];
let _histIdx   = -1;

// 클립보드 내부 버퍼 (2D status 배열)
let _clipBuffer = null;

// 이벤트 바인딩된 엘리먼트
let _kbEl = null;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 유틸
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function L(n) { return n < 26 ? String.fromCharCode(65+n) : L(Math.floor(n/26)-1)+String.fromCharCode(65+(n%26)); }
const C = (col, row) => `${L(col)}${row + 1}`;

function norm(v) {
  if (!v) return '';
  const s = String(v).trim();
  return NORM[s] ?? NORM[s[0]] ?? '';
}

// 붙여넣기 전용: 인식 불가 값 → null (스킵)
function normPaste(v) {
  if (!v || !String(v).trim()) return null;
  const s = String(v).trim();
  const r = NORM[s] ?? NORM[s[0]];
  return r !== undefined ? r : null;
}

function getFirstMonday(d) {
  const first = d.startOf('month');
  const dow   = first.day();
  return first.subtract(dow === 0 ? 6 : dow - 1, 'day');
}

function buildWeekStarts(d) {
  const last  = d.endOf('month');
  let   ws    = getFirstMonday(d);
  const weeks = [];
  while ((ws.isBefore(last) || ws.month() === d.month()) && weeks.length < 6) {
    weeks.push(ws);
    ws = ws.add(1, 'week');
  }
  return weeks;
}

function decodeCell(x, y) {
  const weekIdx  = Math.floor(y / RPW);
  const rowInW   = y % RPW;
  if (rowInW === 0) return null;
  const slotRow  = rowInW - 1;
  const dayIdx   = Math.floor(x / SLOT_COLS);
  const slotCol  = x % SLOT_COLS;
  const slotIdx  = slotRow * SLOT_COLS + slotCol;
  const empIdx   = slotIdx;
  if (empIdx >= empRows.length) return null;
  if (!weekStarts[weekIdx]) return null;
  const day = weekStarts[weekIdx].add(dayIdx, 'day');
  return { weekIdx, dayIdx, slotIdx, empIdx, day, date: day.format('YYYY-MM-DD') };
}

function getStatus(empId, ds, dayIdx, inMonth) {
  if (!inMonth) return '';
  if (leaveMap.get(empId)?.has(ds)) return '연';
  if (statusMap.has(`${empId}_${ds}`)) return statusMap.get(`${empId}_${ds}`);
  return (dayIdx === 5 || holidays.has(ds)) ? '' : '근';
}

// 셀 스타일 문자열 생성 (공통 추출)
function cellStyle(emp, x, dayIdx, date, status) {
  const isSat   = dayIdx === 5;
  const isHol   = holidays.has(date);
  const isToday = date === dayjs().format('YYYY-MM-DD');
  const isSys   = leaveMap.get(emp.employee.id)?.has(date);
  const { bg, color } = STATUS_BG[status] ?? STATUS_BG[''];
  const dayTint  = isToday ? '#fffde7' : isSat ? '#eff6ff' : isHol ? '#fff1f2' : bg;
  const finalBg  = (status === '' || status === '근') ? dayTint : bg;
  let s = `background:${finalBg};color:${color};text-align:center;font-size:11.5px;`;
  if (emp.isWonJang) s += 'font-weight:700;';
  if (isSys) s += 'font-style:italic;';
  s += `border-right:${(x % SLOT_COLS === SLOT_COLS - 1) ? '2px solid #94a3b8' : '1px solid #f0f0f0'};border-bottom:1px solid #f0f0f0;`;
  return s;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 히스토리 (되돌리기 / 다시실행)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function _pushHistory() {
  _histStack.splice(_histIdx + 1);          // redo 분기 제거
  _histStack.push(new Map(statusMap));
  if (_histStack.length > 60) _histStack.shift(); else _histIdx++;
}

function _restoreSnap(snap) {
  statusMap = new Map(snap);
  // unsaved 재계산 (baseMap 대비 diff)
  unsaved.clear();
  for (const [key, status] of statusMap) {
    const base = _baseMap.get(key) ?? '';
    if ((status || '근') !== (base || '근')) {
      const sep   = key.indexOf('_');
      const empId = parseInt(key.slice(0, sep));
      const date  = key.slice(sep + 1);
      unsaved.set(key, { empId, date, status: status || '근' });
    }
  }
  const { styles } = buildGrid();
  if (jsi) jsi.setStyle(styles);
  updateSaveBtn();
}

function undoAction() {
  if (_histIdx <= 0) { toast('더 이상 되돌릴 수 없습니다', 'info'); return; }
  _histIdx--;
  _restoreSnap(_histStack[_histIdx]);
}

function redoAction() {
  if (_histIdx >= _histStack.length - 1) { toast('다시 실행할 항목이 없습니다', 'info'); return; }
  _histIdx++;
  _restoreSnap(_histStack[_histIdx]);
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
  holidays  = new Set((hRes.data || []).map(h => h.date));
  state.schedule.layout = lRes.data?.[0]?.layout_data || null;
  curMonth  = d.month();

  statusMap.clear();
  state.schedule.schedules.forEach(s => {
    statusMap.set(`${s.employee_id}_${s.date}`, norm(s.status) || '근');
  });

  leaveMap.clear();
  (state.leaveRequests || []).forEach(r => {
    if (r.status !== 'approved' || !Array.isArray(r.dates)) return;
    if (!leaveMap.has(r.employee_id)) leaveMap.set(r.employee_id, new Set());
    r.dates.forEach(ds => leaveMap.get(r.employee_id).add(ds));
  });

  // 히스토리 초기화
  _baseMap   = new Map(statusMap);
  _histStack = [new Map(statusMap)];
  _histIdx   = 0;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 직원 순서 (최대 28명)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function buildEmpRows() {
  const emps    = (state.employees || []).filter(e =>
    !e.is_temp && !e.retired && !(e.email?.startsWith('temp-'))
  );
  const deptMap = new Map((state.departments || []).map(d => [d.id, d]));
  const layout  = state.schedule.layout;

  let out = [];
  if (Array.isArray(layout) && layout[0]?.leader_id !== undefined) {
    const em   = new Map(emps.map(e => [e.id, e]));
    const seen = new Set();
    layout.forEach(t => {
      const l = em.get(t.leader_id);
      if (l) { out.push({ employee: l, isWonJang: true }); seen.add(l.id); }
      (t.members || []).forEach(id => {
        const m = em.get(id);
        if (m && !seen.has(m.id)) { out.push({ employee: m, isWonJang: false }); seen.add(m.id); }
      });
    });
    emps.forEach(e => { if (!seen.has(e.id)) out.push({ employee: e, isWonJang: false }); });
  } else {
    const ORDER = ['원장','진료실','경영지원실','기공실'];
    const grp   = new Map();
    emps.forEach(e => {
      const n = deptMap.get(e.department_id)?.name || '기타';
      if (!grp.has(n)) grp.set(n, []);
      grp.get(n).push(e);
    });
    const depts = [...ORDER, ...Array.from(grp.keys()).filter(k => !ORDER.includes(k))];
    depts.forEach(n => (grp.get(n) || []).forEach(e =>
      out.push({ employee: e, isWonJang: n.includes('원장') })
    ));
  }
  return out.slice(0, SLOT_COLS * SLOT_ROWS);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 그리드 데이터/스타일 빌드
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function buildGrid() {
  const today  = dayjs().format('YYYY-MM-DD');
  const data   = [];
  const styles = {};
  const rowH   = {};

  weekStarts.forEach((wkStart, wi) => {
    const dateRowY = wi * RPW;
    rowH[dateRowY] = 30;

    // ── 날짜 헤더행 ──────────────────────────────────
    const dateRow = [];
    for (let di = 0; di < DAYS; di++) {
      const day     = wkStart.add(di, 'day');
      const ds      = day.format('YYYY-MM-DD');
      const inMonth = day.month() === curMonth;
      const isSat   = di === 5;
      const isHol   = holidays.has(ds);
      const isToday = ds === today;

      const bg    = isToday ? '#fef08a' : isSat ? '#e0e7ff' : isHol ? '#ffe4e6' : '#fef9c3';
      const color = !inMonth ? '#9ca3af' : isSat ? '#1d4ed8' : isHol ? '#dc2626' : '#374151';
      const label = inMonth ? String(day.date()) : day.format('M/D');

      for (let sc = 0; sc < SLOT_COLS; sc++) {
        const x = di * SLOT_COLS + sc;
        dateRow.push(sc === 0 ? label : '');
        styles[C(x, dateRowY)] =
          `background:${bg};color:${color};font-weight:700;` +
          `text-align:${sc === 0 ? 'left' : 'center'};` +
          `font-size:${sc === 0 ? '13' : '11'}px;` +
          `border-right:${(sc === SLOT_COLS - 1) ? '2px solid #94a3b8' : '1px solid #e5e7eb'};` +
          `border-bottom:2px solid #64748b;padding-left:${sc === 0 ? '4' : '0'}px;`;
      }
    }
    data.push(dateRow);

    // ── 직원 행 (7행) ────────────────────────────────
    for (let sr = 0; sr < SLOT_ROWS; sr++) {
      const y = dateRowY + sr + 1;
      rowH[y]  = 26;
      const row = [];

      for (let di = 0; di < DAYS; di++) {
        const day     = wkStart.add(di, 'day');
        const ds      = day.format('YYYY-MM-DD');
        const inMonth = day.month() === curMonth;
        const isSat   = di === 5;
        const isHol   = holidays.has(ds);
        const isToday = ds === today;

        for (let sc = 0; sc < SLOT_COLS; sc++) {
          const x       = di * SLOT_COLS + sc;
          const slotIdx = sr * SLOT_COLS + sc;
          const emp     = empRows[slotIdx];
          row.push(emp ? emp.employee.name : '');

          let s;
          if (!emp || !inMonth) {
            const dayBg = !inMonth ? '#f8fafc'
                        : isToday  ? '#fffde7'
                        : isSat    ? '#f0f4ff'
                        : isHol    ? '#fff5f5'
                        : '#fafafa';
            s = `background:${dayBg};color:#d1d5db;`;
          } else {
            const status = getStatus(emp.employee.id, ds, di, inMonth);
            s = cellStyle(emp, x, di, ds, status);
          }
          styles[C(x, y)] = s;
        }
      }
      data.push(row);
    }
  });

  return { data, styles, rowH };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// jSpreadsheet 생성
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function createSheet(el) {
  if (jsi) { try { jspreadsheet.destroy(el); } catch(_) {} jsi = null; }
  el.innerHTML = '';

  const { data, styles, rowH } = buildGrid();
  const label = dayjs(state.schedule.date).format('YYYY년 M월');

  const columns = [];
  for (let di = 0; di < DAYS; di++) {
    for (let sc = 0; sc < SLOT_COLS; sc++) {
      columns.push({
        title: sc === 0 ? ['월','화','수','목','금','토'][di] : '',
        width: 50,
        type: 'text',
        readOnly: true,
        align: 'center',
      });
    }
  }

  const sheets = jspreadsheet(el, {
    worksheets: [{
      data,
      columns,
      nestedHeaders: [[{ title: label, colspan: TOTAL_COLS }]],
      rows: rowH,
      style: styles,
      tableWidth: '100%',
      allowDeleteColumn: false, allowInsertColumn: false,
      allowDeleteRow:    false, allowInsertRow:    false,
      columnDrag: false, rowDrag: false,
      columnSorting: false, search: false, pagination: false,
      freezeRows: 0, freezeColumns: 0,
    }],
    contextMenu: ctxMenu,
  });
  jsi = sheets[0];

  styleHeaders(label);
  _bindKeyboard(el);
}

function styleHeaders(label) {
  requestAnimationFrame(() => {
    const trs = mountEl?.querySelectorAll('thead tr');
    if (!trs) return;

    const top = trs[0]?.querySelectorAll('td');
    if (top?.[1]) {
      Object.assign(top[1].style, {
        background: '#1e3a5f', color: '#fff', fontWeight: '700',
        fontSize: '14px', textAlign: 'center', padding: '6px',
      });
    }

    const dayRow = trs[1]?.querySelectorAll('td');
    if (!dayRow) return;
    const dayNames = ['월','화','수','목','금','토'];
    dayRow.forEach((td, i) => {
      if (i === 0) return;
      const di = Math.floor((i - 1) / SLOT_COLS);
      const sc = (i - 1) % SLOT_COLS;
      if (sc === 0) {
        const isSat = di === 5;
        Object.assign(td.style, {
          background: '#1e3a5f',
          color: isSat ? '#93c5fd' : '#fff',
          fontWeight: '700', fontSize: '12px', textAlign: 'center',
          borderRight: '2px solid #94a3b8',
        });
        td.textContent = dayNames[di] || '';
      } else {
        Object.assign(td.style, {
          background: '#1e3a5f', color: '#1e3a5f',
          borderRight: di < 5 && sc === SLOT_COLS - 1 ? '2px solid #94a3b8' : '1px solid #2d4a6f',
        });
        td.textContent = '';
      }
    });
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 클립보드 & 키보드 바인딩
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function _bindKeyboard(el) {
  if (_kbEl) {
    _kbEl.removeEventListener('copy',    _onCopy,    true);
    _kbEl.removeEventListener('cut',     _onCut,     true);
    _kbEl.removeEventListener('paste',   _onPaste,   true);
    _kbEl.removeEventListener('keydown', _onKeydown, true);
  }
  _kbEl = el;
  el.addEventListener('copy',    _onCopy,    true);
  el.addEventListener('cut',     _onCut,     true);
  el.addEventListener('paste',   _onPaste,   true);
  el.addEventListener('keydown', _onKeydown, true);
}

function _selRange() {
  const sel = jsi?.getSelected?.();
  if (!sel?.length) return null;
  const xs = sel.map(s => s.x), ys = sel.map(s => s.y);
  return { x1: Math.min(...xs), x2: Math.max(...xs), y1: Math.min(...ys), y2: Math.max(...ys) };
}

// 선택 영역의 상태값 2D 배열 추출
function _selStatusGrid() {
  const range = _selRange();
  if (!range) return null;
  const { x1, x2, y1, y2 } = range;
  const rows = [];
  for (let y = y1; y <= y2; y++) {
    const row = [];
    for (let x = x1; x <= x2; x++) {
      const info = decodeCell(x, y);
      if (!info || info.day.month() !== curMonth) { row.push(''); continue; }
      const emp = empRows[info.empIdx];
      if (!emp) { row.push(''); continue; }
      const key = `${emp.employee.id}_${info.date}`;
      row.push(statusMap.has(key)
        ? (statusMap.get(key) || '근')
        : getStatus(emp.employee.id, info.date, info.dayIdx, true));
    }
    rows.push(row);
  }
  return rows;
}

function _onCopy(e) {
  if (!jsi) return;
  e.preventDefault(); e.stopPropagation();
  const rows = _selStatusGrid();
  if (!rows) return;
  _clipBuffer = rows;
  e.clipboardData.setData('text/plain', rows.map(r => r.join('\t')).join('\n'));
  toast('📋 복사됨', 'info');
}

function _onCut(e) {
  if (!jsi) return;
  e.preventDefault(); e.stopPropagation();
  const rows = _selStatusGrid();
  if (!rows) return;
  _clipBuffer = rows;
  e.clipboardData.setData('text/plain', rows.map(r => r.join('\t')).join('\n'));

  // 선택 영역 초기화
  _pushHistory();
  const range = _selRange();
  const { x1, x2, y1, y2 } = range;
  const styleUpdates = {};
  for (let y = y1; y <= y2; y++) {
    for (let x = x1; x <= x2; x++) {
      const info = decodeCell(x, y);
      if (!info || info.day.month() !== curMonth) continue;
      const emp = empRows[info.empIdx];
      if (!emp || leaveMap.get(emp.employee.id)?.has(info.date)) continue;
      styleUpdates[C(x, y)] = cellStyle(emp, x, info.dayIdx, info.date, '');
      statusMap.set(`${emp.employee.id}_${info.date}`, '');
      unsaved.set(`${emp.employee.id}_${info.date}`, { empId: emp.employee.id, date: info.date, status: '근' });
    }
  }
  if (Object.keys(styleUpdates).length) { jsi.setStyle(styleUpdates); updateSaveBtn(); }
  toast('✂ 잘라내기 완료', 'info');
}

function _onPaste(e) {
  if (!jsi) return;
  e.preventDefault(); e.stopPropagation();
  const text = e.clipboardData?.getData('text/plain') || '';
  const grid = text.trim()
    ? text.split(/\r?\n/).filter(r => r.trim()).map(r => r.split('\t'))
    : _clipBuffer;
  if (grid) _doPaste(grid);
}

function _onKeydown(e) {
  if (!jsi) return;
  const ctrl = e.ctrlKey || e.metaKey;
  if (!ctrl) return;
  if (e.key === 'z' || e.key === 'Z') { e.preventDefault(); e.stopPropagation(); undoAction(); }
  if (e.key === 'y' || e.key === 'Y') { e.preventDefault(); e.stopPropagation(); redoAction(); }
}

function _doPaste(grid) {
  const range = _selRange();
  if (!range) return;
  const { x1, y1 } = range;

  _pushHistory();
  const styleUpdates = {};

  for (let ri = 0; ri < grid.length; ri++) {
    for (let ci = 0; ci < grid[ri].length; ci++) {
      const x = x1 + ci, y = y1 + ri;
      const status = normPaste((grid[ri][ci] || '').trim());
      if (status === null) continue;  // 인식 불가 스킵

      const info = decodeCell(x, y);
      if (!info || info.day.month() !== curMonth) continue;
      const emp = empRows[info.empIdx];
      if (!emp || leaveMap.get(emp.employee.id)?.has(info.date)) continue;

      styleUpdates[C(x, y)] = cellStyle(emp, x, info.dayIdx, info.date, status);
      statusMap.set(`${emp.employee.id}_${info.date}`, status);
      unsaved.set(`${emp.employee.id}_${info.date}`, { empId: emp.employee.id, date: info.date, status: status || '근' });
    }
  }

  if (Object.keys(styleUpdates).length) {
    jsi.setStyle(styleUpdates);
    updateSaveBtn();
    toast('📋 붙여넣기 완료', 'success');
  } else {
    _histStack.pop();
    if (_histIdx > 0) _histIdx--;
  }
}

// 컨텍스트 메뉴용 복사 (clipboardData 없이 navigator.clipboard 사용)
function _copyToClipboard() {
  const rows = _selStatusGrid();
  if (!rows) return;
  _clipBuffer = rows;
  navigator.clipboard.writeText(rows.map(r => r.join('\t')).join('\n')).catch(() => {});
  toast('📋 복사됨', 'info');
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 컨텍스트 메뉴 & 상태 적용
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function ctxMenu(ws, x, y, e, items) {
  return [
    { title: '✅ 근무',                onclick: () => applyStatus('근') },
    { title: '🏖 연차',                onclick: () => applyStatus('연') },
    { title: '🌙 반차',                onclick: () => applyStatus('반') },
    { title: '😴 휴무',                onclick: () => applyStatus('휴') },
    { title: '⏸ 휴직',                onclick: () => applyStatus('직') },
    { title: '✖ 초기화',              onclick: () => applyStatus('') },
    { type: 'line' },
    { title: '📋 복사 (Ctrl+C)',       onclick: _copyToClipboard },
    { title: '✂ 잘라내기 (Ctrl+X)',   onclick: () => document.execCommand('cut') },
    { title: '📋 붙여넣기 (Ctrl+V)',  onclick: () => { if (_clipBuffer) _doPaste(_clipBuffer); } },
    { type: 'line' },
    { title: '↩ 되돌리기 (Ctrl+Z)',   onclick: undoAction },
    { title: '↪ 다시실행 (Ctrl+Y)',   onclick: redoAction },
  ];
}

function applyStatus(status) {
  const sel = jsi?.getSelected?.();
  if (!sel?.length) return;
  const xs = sel.map(s => s.x), ys = sel.map(s => s.y);
  const x1 = Math.min(...xs), x2 = Math.max(...xs);
  const y1 = Math.min(...ys), y2 = Math.max(...ys);

  _pushHistory();
  const styleUpdates = {};

  for (let y = y1; y <= y2; y++) {
    for (let x = x1; x <= x2; x++) {
      const info = decodeCell(x, y);
      if (!info) continue;
      const { empIdx, dayIdx, day, date } = info;
      const emp = empRows[empIdx];
      if (!emp) continue;
      if (leaveMap.get(emp.employee.id)?.has(date) && status === '연') continue;
      if (day.month() !== curMonth) continue;

      styleUpdates[C(x, y)] = cellStyle(emp, x, dayIdx, date, status);
      statusMap.set(`${emp.employee.id}_${date}`, status);
      unsaved.set(`${emp.employee.id}_${date}`, { empId: emp.employee.id, date, status: status || '근' });
    }
  }
  if (Object.keys(styleUpdates).length) jsi.setStyle(styleUpdates);
  updateSaveBtn();
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 저장 / 공휴일 / 내비게이션
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
    _baseMap = new Map(statusMap); // 저장 후 베이스라인 업데이트
    updateSaveBtn();
    toast(`✅ ${payload.length}건 저장 완료`, 'success');
  } catch (err) {
    toast('저장 실패: ' + err.message, 'error');
  } finally { updateSaveBtn(); }
}

async function toggleHoliday() {
  const ds = prompt('날짜 입력 (YYYY-MM-DD)\n※ 이미 등록된 날짜면 해제');
  if (!ds || !/^\d{4}-\d{2}-\d{2}$/.test(ds)) return;
  if (holidays.has(ds)) {
    const { error } = await removeHoliday(ds);
    if (error) { toast(error.message, 'error'); return; }
    holidays.delete(ds);
  } else {
    const { error } = await addHoliday(ds);
    if (error) { toast(error.message, 'error'); return; }
    holidays.add(ds);
  }
  await refresh();
}

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
  mountEl.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⏳</div><div>로딩 중…</div></div>';
  try {
    await loadMonth();
    empRows    = buildEmpRows();
    weekStarts = buildWeekStarts(dayjs(state.schedule.date));
    createSheet(mountEl);
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
    <div class="sheet-wrap" style="height:calc(100vh - 56px - 44px - 40px);">
      <div class="sheet-toolbar">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <button id="sched-undo-btn" class="btn-secondary" style="font-size:12px;padding:4px 10px;" title="되돌리기 (Ctrl+Z)">↩ 되돌리기</button>
          <button id="sched-redo-btn" class="btn-secondary" style="font-size:12px;padding:4px 10px;" title="다시실행 (Ctrl+Y)">↪ 다시실행</button>
          <span style="font-size:11px;color:var(--text-3);border-left:1px solid var(--border);padding-left:10px;margin-left:2px;">
            우클릭: 상태변경 &nbsp;|&nbsp; Ctrl+C/X/V: 복사/잘라내기/붙여넣기 &nbsp;|&nbsp; 외부 Excel 붙여넣기 지원
          </span>
        </div>
        <div class="action-btns">
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
      <div id="sched-mount" class="sheet-mount"></div>
      <div class="sheet-legend">
        <span class="legend-label">범례</span>
        <span class="badge-근">■ 근무</span>
        <span class="badge-연">■ 연차</span>
        <span class="badge-반">■ 반차</span>
        <span class="badge-휴">■ 휴무</span>
        <span class="badge-직">■ 휴직</span>
        <span class="legend-note">기울임꼴 = 연차시스템 자동반영</span>
      </div>
    </div>`;

  mountEl = container.querySelector('#sched-mount');
  document.getElementById('sched-month-title').textContent =
    dayjs(state.schedule.date).format('YYYY년 M월');

  document.getElementById('sched-prev').onclick        = () => navigate('prev');
  document.getElementById('sched-next').onclick        = () => navigate('next');
  document.getElementById('sched-today').onclick       = () => navigate('today');
  document.getElementById('sched-save-btn').onclick    = save;
  document.getElementById('sched-holiday-btn').onclick = toggleHoliday;
  document.getElementById('sched-undo-btn').onclick    = undoAction;
  document.getElementById('sched-redo-btn').onclick    = redoAction;

  refresh();
}
