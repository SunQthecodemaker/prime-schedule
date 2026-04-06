// admin/schedule.js — 달력형 오프표 (Excel 동일 구조, jSpreadsheet CE v5)
//
// 구조: 6열(월~토) × (주당 4행: 날짜행 1 + 내용행 3)
// 엑셀 복사-붙여넣기 지원 / 자유 텍스트 편집

import { state } from '../core/state.js';
import {
  fetchHolidays,
  fetchMonthCalendar,
  upsertMonthCalendar,
} from '../core/db.js';
import { toast } from '../main.js';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 상수
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const COLS       = 6;                          // 월~토
const COL_DAYS   = ['월','화','수','목','금','토'];
const ROWS_PER_W = 4;                          // 날짜행 1 + 내용행 3
const CONTENT_ROWS = ROWS_PER_W - 1;          // 3

// 열 너비
const COL_W = [190, 190, 190, 190, 190, 160];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 모듈 상태
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
let mountEl  = null;
let jsi      = null;
let weekList = [];      // [{ weekStart: dayjs, dateRowIdx: number }]
let holidays = new Set();
let changed  = false;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 유틸
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function L(n) { return n < 26 ? String.fromCharCode(65+n) : L(Math.floor(n/26)-1)+String.fromCharCode(65+(n%26)); }
const C = (col, row) => `${L(col)}${row + 1}`;

// 해당 월의 월요일부터 시작하는 첫 주 월요일
function getFirstMonday(d) {
  const first = d.startOf('month');
  const dow   = first.day(); // 0=일
  const toMon = dow === 0 ? 6 : dow - 1;
  return first.subtract(toMon, 'day');
}

// 날짜 표시 문자열
function dateLabel(day, curMonth) {
  if (day.month() !== curMonth) return day.format('MM월 DD일');
  return String(day.date());
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 그리드 데이터 생성
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function buildGrid(savedData) {
  const d         = dayjs(state.schedule.date);
  const curMonth  = d.month();
  const lastDay   = d.endOf('month');
  let   weekStart = getFirstMonday(d);

  weekList = [];
  const rows   = [];
  const styles = {};

  let rowIdx = 0;
  while (weekStart.isBefore(lastDay) || weekStart.month() === curMonth) {
    weekList.push({ weekStart, dateRowIdx: rowIdx });

    // ─ 날짜 행 ─
    const dateRow = [];
    for (let c = 0; c < COLS; c++) {
      const day = weekStart.add(c, 'day');
      dateRow.push(dateLabel(day, curMonth));

      // 스타일
      const isSat     = c === 5;
      const ds        = day.format('YYYY-MM-DD');
      const isHol     = holidays.has(ds);
      const isOtherM  = day.month() !== curMonth;
      const isToday   = ds === dayjs().format('YYYY-MM-DD');

      let bg    = isToday   ? '#fff9c4' : '#fef3c7';
      let color = isSat     ? '#1d4ed8'
                : isHol     ? '#dc2626'
                : isOtherM  ? '#9ca3af'
                : '#374151';
      styles[C(c, rowIdx)] = `background:${bg};color:${color};font-weight:700;text-align:center;font-size:13px;`;
    }
    rows.push(dateRow);
    rowIdx++;

    // ─ 내용 행 3개 ─
    for (let r = 0; r < CONTENT_ROWS; r++) {
      const savedRowIdx = (weekList.length - 1) * ROWS_PER_W + 1 + r;
      const row = savedData?.[savedRowIdx]
        ? [...savedData[savedRowIdx]]
        : Array(COLS).fill('');
      rows.push(row);

      for (let c = 0; c < COLS; c++) {
        const day    = weekStart.add(c, 'day');
        const isSat  = c === 5;
        const isOtherM = day.month() !== curMonth;
        let bg = isOtherM ? '#f8fafc' : '#ffffff';
        if (isSat) bg = isOtherM ? '#f0f4ff' : '#f5f8ff';
        styles[C(c, rowIdx)] = `background:${bg};vertical-align:top;font-size:12px;`;
      }
      rowIdx++;
    }

    weekStart = weekStart.add(1, 'week');
    if (weekList.length >= 6) break;
  }

  return { rows, styles };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// jSpreadsheet 생성
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function createSheet(el, rows, styles) {
  if (jsi) { try { jspreadsheet.destroy(el); } catch(_){} jsi = null; }
  el.innerHTML = '';

  const totalRows = rows.length;

  // 행 높이: 날짜행=32, 내용행=62
  const rowHeights = {};
  for (let r = 0; r < totalRows; r++) {
    rowHeights[r] = (r % ROWS_PER_W === 0) ? 32 : 62;
  }

  // 날짜행 readOnly 지정 (col 전체)
  const readOnlyCells = {};
  weekList.forEach(({ dateRowIdx }) => {
    for (let c = 0; c < COLS; c++) {
      readOnlyCells[C(c, dateRowIdx)] = true;
    }
  });

  const label = dayjs(state.schedule.date).format('YYYY년 M월 오프표');

  const sheets = jspreadsheet(el, {
    worksheets: [{
      data: rows,
      columns: COL_DAYS.map((title, i) => ({
        title,
        width: COL_W[i],
        type: 'text',
        align: 'center',
        wordWrap: true,
      })),
      nestedHeaders: [[{ title: label, colspan: COLS }]],
      rows: rowHeights,
      style: styles,
      tableWidth: '100%',
      allowDeleteColumn: false,
      allowInsertColumn: false,
      columnDrag: false,
      columnSorting: false,
      search: false,
      pagination: false,
    }],
    onchange: () => { changed = true; updateSaveBtn(); },
    contextMenu: () => [],
  });

  jsi = sheets[0];

  // 날짜행 readOnly 적용
  weekList.forEach(({ dateRowIdx }) => {
    for (let c = 0; c < COLS; c++) {
      try { jsi.setReadOnly(C(c, dateRowIdx), true); } catch(_) {}
    }
  });

  // 헤더 스타일 (요일)
  requestAnimationFrame(() => {
    const trs = mountEl?.querySelectorAll('thead tr');
    const tds = trs?.[trs.length - 1]?.querySelectorAll('td');
    if (!tds) return;
    COL_DAYS.forEach((_, i) => {
      const td = tds[i + 1]; if (!td) return;
      td.style.background  = '#1e3a5f';
      td.style.color       = i === 5 ? '#93c5fd' : '#ffffff';
      td.style.fontWeight  = '700';
      td.style.fontSize    = '13px';
      td.style.textAlign   = 'center';
    });
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 저장
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function updateSaveBtn() {
  const btn = document.getElementById('sched-save-btn');
  if (!btn) return;
  btn.disabled    = !changed;
  btn.textContent = changed ? '💾 저장 *' : '💾 저장';
}

async function save() {
  if (!jsi || !changed) return;
  const btn = document.getElementById('sched-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = '저장 중…'; }

  try {
    const gridData   = jsi.getData();
    const gridStyles = jsi.getStyle();
    const month      = dayjs(state.schedule.date).format('YYYY-MM-01');

    const { error } = await upsertMonthCalendar(month, gridData, gridStyles);
    if (error) throw error;

    changed = false;
    updateSaveBtn();
    toast('✅ 저장 완료', 'success');
  } catch (err) {
    toast('저장 실패: ' + err.message, 'error');
  } finally {
    updateSaveBtn();
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 내비게이션 / 새로고침
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function navigate(dir) {
  if (changed && !confirm('저장 안 된 변경사항이 있습니다. 이동할까요?')) return;
  changed = false;
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
    const d     = dayjs(state.schedule.date);
    const start = d.startOf('month').format('YYYY-MM-DD');
    const end   = d.endOf('month').format('YYYY-MM-DD');
    const month = d.format('YYYY-MM-01');

    const [hRes, calRes] = await Promise.all([
      fetchHolidays(start, end),
      fetchMonthCalendar(month),
    ]);

    holidays = new Set((hRes.data || []).map(h => h.date));

    // 저장된 그리드 데이터 (없으면 null)
    const savedData   = calRes.data?.grid_data   || null;
    const savedStyles = calRes.data?.grid_styles  || null;

    const { rows, styles } = buildGrid(savedData);

    // 저장된 셀 스타일 위에 덮어쓰기 (사용자가 직접 색칠한 경우)
    const mergedStyles = savedStyles
      ? { ...styles, ...savedStyles }
      : styles;

    createSheet(mountEl, rows, mergedStyles);
    changed = false;
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
        <div style="font-size:13px;color:var(--text-2);">
          📋 엑셀에서 복사 후 셀 클릭 → <kbd>Ctrl+V</kbd> 로 붙여넣기 가능
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
      <div id="sched-mount" class="sheet-mount"></div>
      <div class="sheet-legend">
        <span class="legend-label">💡 사용법</span>
        <span style="color:var(--text-2);font-size:11px;">셀 클릭 후 자유롭게 입력 · 셀 범위 선택 후 Ctrl+C/V · 엑셀 내용 직접 붙여넣기 가능</span>
      </div>
    </div>`;

  mountEl = container.querySelector('#sched-mount');
  document.getElementById('sched-month-title').textContent =
    dayjs(state.schedule.date).format('YYYY년 M월');

  document.getElementById('sched-prev').onclick  = () => navigate('prev');
  document.getElementById('sched-next').onclick  = () => navigate('next');
  document.getElementById('sched-today').onclick = () => navigate('today');
  document.getElementById('sched-save-btn').onclick = save;

  refresh();
}
