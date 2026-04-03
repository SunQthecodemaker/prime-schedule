// employee/my-leave.js — 연차 신청 & 내역 조회

import { state }                     from '../core/state.js';
import { fetchMyLeaves, createLeave, deleteLeave } from '../core/db.js';
import { getLeaveDetails, calcUsedLeave, getWorkDays } from '../core/leave-utils.js';
import { toast }                     from '../main.js';

let calDate    = dayjs();
let selectedDs = new Set(); // 선택한 날짜들

export async function render(container) {
  const details = getLeaveDetails(state.user);
  const used    = calcUsedLeave(state.leaveRequests, state.user.id, details.periodStart, details.periodEnd);
  const remain  = Math.max(0, details.final - used);

  container.innerHTML = `
    <!-- 연차 요약 -->
    <div class="stat-grid mb-4">
      <div class="stat-card blue">
        <div class="stat-label">확정 연차</div>
        <div class="stat-value" style="color:var(--blue)">${details.final}일</div>
        <div class="text-xs text-muted">${details.note}</div>
      </div>
      <div class="stat-card green">
        <div class="stat-label">사용 연차</div>
        <div class="stat-value" style="color:var(--green)">${used}일</div>
      </div>
      <div class="stat-card yellow">
        <div class="stat-label">잔여 연차</div>
        <div class="stat-value" style="color:var(--yellow)">${remain}일</div>
      </div>
      <div class="stat-card purple">
        <div class="stat-label">갱신일</div>
        <div class="stat-value" style="font-size:16px;color:var(--purple)">${details.periodEnd || '-'}</div>
      </div>
    </div>

    <!-- 신청 영역 -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;" class="leave-grid">

      <!-- 왼쪽: 캘린더 -->
      <div class="card" style="padding:0;overflow:hidden;">
        <div class="sheet-nav" style="padding:8px 14px;">
          <button id="lc-prev"  class="btn-secondary" style="padding:5px 10px;font-size:12px;">◀</button>
          <span id="lc-title"   class="month-title" style="font-size:14px;"></span>
          <button id="lc-next"  class="btn-secondary" style="padding:5px 10px;font-size:12px;">▶</button>
        </div>
        <div id="lc-body" style="padding:10px;"></div>
      </div>

      <!-- 오른쪽: 신청 폼 -->
      <div class="card">
        <div class="card-title">✏️ 연차 신청</div>
        <div id="selected-dates-info" class="text-sm text-muted mb-3">
          달력에서 날짜를 클릭해서 선택하세요.
        </div>
        <div class="form-group mb-3">
          <label class="form-label">사유</label>
          <textarea id="leave-reason" class="form-input" placeholder="연차 사유 (선택사항)" rows="3"></textarea>
        </div>
        <button id="submit-leave-btn" class="btn-primary w-full" disabled>연차 신청</button>
        <div id="leave-hint" class="text-xs text-muted mt-3" style="line-height:1.6;">
          • 날짜 클릭으로 선택 / 재클릭으로 해제<br>
          • 주말·공휴일은 선택 불가<br>
          • 이미 승인된 날짜는 취소 후 재신청
        </div>
      </div>
    </div>

    <!-- 신청 내역 -->
    <div class="card" style="padding:0;overflow:hidden;">
      <div class="section-header" style="padding:14px 16px 0;">
        <div class="section-title">신청 내역</div>
      </div>
      <div id="leave-history" style="padding:0 4px 4px;"></div>
    </div>`;

  // 이벤트
  document.getElementById('lc-prev').onclick = () => { calDate = calDate.subtract(1,'month'); renderCal(); };
  document.getElementById('lc-next').onclick = () => { calDate = calDate.add(1,'month'); renderCal(); };
  document.getElementById('submit-leave-btn').onclick = handleSubmit;

  // 반응형: 작은 화면에서 1열
  const grid = container.querySelector('.leave-grid');
  if (window.innerWidth < 768) grid.style.gridTemplateColumns = '1fr';

  selectedDs.clear();
  renderCal();
  await renderHistory();
}

// ─── 캘린더 렌더링 ──────────────────────────────────────────
function renderCal() {
  const title = document.getElementById('lc-title');
  const body  = document.getElementById('lc-body');
  if (!title || !body) return;

  title.textContent = calDate.format('YYYY년 M월');

  const firstDow  = calDate.startOf('month').day();
  const lastDay   = calDate.daysInMonth();
  const today     = dayjs().format('YYYY-MM-DD');

  // 승인/대기 날짜 수집
  const approvedSet = new Set();
  const pendingSet  = new Set();
  (state.leaveRequests || [])
    .filter(r => r.employee_id === state.user.id)
    .forEach(r => {
      (r.dates || []).forEach(d => {
        if (r.status === 'approved') approvedSet.add(d);
        if (r.status === 'pending')  pendingSet.add(d);
      });
    });

  const days = ['일','월','화','수','목','금','토'];
  let html = `<table class="leave-cal">
    <thead><tr>${days.map(d => `<th>${d}</th>`).join('')}</tr></thead>
    <tbody><tr>`;

  for (let i = 0; i < firstDow; i++) html += '<td></td>';

  let col = firstDow;
  for (let d = 1; d <= lastDay; d++) {
    const ds  = calDate.date(d).format('YYYY-MM-DD');
    const dow = (firstDow + d - 1) % 7;
    if (dow === 0 && d !== 1) html += '</tr><tr>';

    const isSun = dow === 0, isSat = dow === 6;
    const isWeekend  = isSun || isSat;
    const isApproved = approvedSet.has(ds);
    const isPending  = pendingSet.has(ds);
    const isSelected = selectedDs.has(ds);
    const isToday    = ds === today;

    let cls = 'leave-day';
    if (isToday)    cls += ' today';
    if (isApproved) cls += ' approved';
    else if (isPending)  cls += ' pending';
    else if (isSelected) cls += ' selected';
    else if (isSun)  cls += ' sun';
    else if (isSat)  cls += ' sat';

    const clickable = !isWeekend && !isApproved && !isPending;
    html += `<td>
      <div class="${cls}" ${clickable ? `data-date="${ds}"` : ''} style="${!clickable?'cursor:default;opacity:.6;':''}">
        ${d}
      </div>
    </td>`;
    col = dow;
  }

  if (col < 6) for (let i = col + 1; i <= 6; i++) html += '<td></td>';
  html += '</tr></tbody></table>';

  body.innerHTML = html;

  // 날짜 클릭 이벤트
  body.querySelectorAll('[data-date]').forEach(el => {
    el.addEventListener('click', () => {
      const ds = el.dataset.date;
      if (selectedDs.has(ds)) { selectedDs.delete(ds); el.classList.remove('selected'); }
      else                    { selectedDs.add(ds);    el.classList.add('selected'); }
      updateSelectedInfo();
    });
  });
}

function updateSelectedInfo() {
  const info = document.getElementById('selected-dates-info');
  const btn  = document.getElementById('submit-leave-btn');
  if (!info || !btn) return;

  const sorted = Array.from(selectedDs).sort();
  if (!sorted.length) {
    info.textContent = '달력에서 날짜를 클릭해서 선택하세요.';
    btn.disabled = true;
    return;
  }
  info.innerHTML = `<strong>${sorted.length}일</strong> 선택됨<br>
    <span style="font-size:11px;color:var(--text-3);">${sorted.join(', ')}</span>`;
  btn.disabled = false;
}

// ─── 연차 신청 제출 ──────────────────────────────────────────
async function handleSubmit() {
  const dates  = Array.from(selectedDs).sort();
  const reason = document.getElementById('leave-reason').value.trim();
  if (!dates.length) return;

  const btn = document.getElementById('submit-leave-btn');
  btn.disabled = true; btn.textContent = '신청 중…';

  const { data, error } = await createLeave({
    employee_id: state.user.id,
    dates,
    reason: reason || null,
    status: 'pending',
  });

  btn.textContent = '연차 신청';
  if (error) { toast('신청 실패: ' + error.message, 'error'); btn.disabled = false; return; }

  // state 업데이트
  state.leaveRequests.unshift(data);
  selectedDs.clear();
  document.getElementById('leave-reason').value = '';
  toast(`✅ ${dates.length}일 연차 신청 완료 (승인 대기)`, 'success');
  renderCal();
  updateSelectedInfo();
  await renderHistory();
}

// ─── 신청 내역 ────────────────────────────────────────────────
async function renderHistory() {
  const container = document.getElementById('leave-history');
  if (!container) return;

  const myLeaves = (state.leaveRequests || [])
    .filter(r => r.employee_id === state.user.id)
    .slice(0, 30);

  if (!myLeaves.length) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📭</div><div class="empty-state-text">신청 내역이 없습니다</div></div>';
    return;
  }

  const STATUS_MAP = { pending:'대기', approved:'승인', rejected:'반려', cancelled:'취소' };
  const BADGE_MAP  = { pending:'badge-pending', approved:'badge-approved', rejected:'badge-rejected', cancelled:'badge-pending' };

  container.innerHTML = `
    <table class="data-table">
      <thead><tr>
        <th>신청일</th><th>날짜</th><th>일수</th><th>사유</th><th>상태</th><th></th>
      </tr></thead>
      <tbody>
        ${myLeaves.map(r => `
          <tr>
            <td>${dayjs(r.created_at).format('MM.DD')}</td>
            <td style="font-size:11px;">${(r.dates||[]).slice(0,3).join(', ')}${(r.dates||[]).length>3?' …':''}</td>
            <td><strong>${(r.dates||[]).length}일</strong></td>
            <td style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${r.reason||'-'}</td>
            <td><span class="badge ${BADGE_MAP[r.status]||''}">${STATUS_MAP[r.status]||r.status}</span></td>
            <td>${r.status==='pending'
              ? `<button class="btn-danger" style="padding:4px 8px;font-size:11px;" data-id="${r.id}">취소</button>`
              : ''}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;

  container.querySelectorAll('[data-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('연차 신청을 취소하시겠습니까?')) return;
      const { error } = await deleteLeave(btn.dataset.id);
      if (error) { toast('취소 실패: ' + error.message, 'error'); return; }
      state.leaveRequests = state.leaveRequests.filter(r => r.id != btn.dataset.id);
      toast('연차 신청이 취소되었습니다.', 'info');
      renderCal();
      await renderHistory();
    });
  });
}
