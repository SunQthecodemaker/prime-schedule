// admin/leaves.js — 연차 승인 관리

import { state }                          from '../core/state.js';
import { fetchAllLeaves, updateLeave }    from '../core/db.js';
import { getLeaveDetails, calcUsedLeave } from '../core/leave-utils.js';
import { toast }                          from '../main.js';

let filterStatus = 'pending'; // 'all' | 'pending' | 'approved' | 'rejected'

export async function render(container) {
  container.innerHTML = `
    <div class="section-header mb-4">
      <div class="section-title">연차 승인 관리</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        ${['pending','approved','rejected','all'].map(s => `
          <button class="btn-secondary filter-btn${filterStatus===s?' active':''}" data-status="${s}">
            ${{ pending:'⏳ 대기', approved:'✅ 승인', rejected:'❌ 반려', all:'전체' }[s]}
          </button>`).join('')}
      </div>
    </div>
    <div id="leaves-list"></div>`;

  container.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      filterStatus = btn.dataset.status;
      container.querySelectorAll('.filter-btn').forEach(b => b.classList.toggle('active', b.dataset.status === filterStatus));
      renderList();
    });
  });

  await renderList();
}

async function renderList() {
  const el = document.getElementById('leaves-list');
  if (!el) return;

  el.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⏳</div><div>로딩 중…</div></div>';

  const { data, error } = await fetchAllLeaves();
  if (error) { el.innerHTML = `<div class="empty-state"><div class="empty-state-text text-danger">${error.message}</div></div>`; return; }

  let list = data || [];
  if (filterStatus !== 'all') list = list.filter(r => r.status === filterStatus);
  list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  if (!list.length) {
    el.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📭</div><div class="empty-state-text">해당하는 연차 신청이 없습니다</div></div>';
    return;
  }

  // 직원별 사용 연차 계산 (캐시)
  const usedCache = new Map();
  const getUsed = (emp) => {
    if (!emp) return 0;
    if (usedCache.has(emp.id)) return usedCache.get(emp.id);
    const details = getLeaveDetails(emp);
    const used = calcUsedLeave(state.leaveRequests, emp.id, details.periodStart, details.periodEnd);
    usedCache.set(emp.id, used);
    return used;
  };

  const STATUS_LABEL = { pending:'검토 대기', approved:'승인됨', rejected:'반려됨', cancelled:'취소됨' };
  const BADGE_CLASS  = { pending:'badge-pending', approved:'badge-approved', rejected:'badge-rejected', cancelled:'badge-pending' };

  el.innerHTML = list.map(r => {
    const emp     = (state.employees || []).find(e => e.id === r.employee_id);
    const empName = emp ? emp.name : '(알 수 없음)';
    const details = emp ? getLeaveDetails(emp) : null;
    const used    = emp ? getUsed(emp) : 0;
    const total   = details ? details.final : 0;
    const remain  = Math.max(0, total - used);

    return `
      <div class="card mb-3" data-id="${r.id}">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:12px;">
          <div style="flex:1;min-width:200px;">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
              <strong style="font-size:15px;">${empName}</strong>
              <span class="badge ${BADGE_CLASS[r.status]||''}">${STATUS_LABEL[r.status]||r.status}</span>
              <span class="text-xs text-muted">${dayjs(r.created_at).format('YYYY.MM.DD HH:mm')}</span>
            </div>
            <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:6px;">
              <span class="text-sm"><span class="text-muted">기간:</span> <strong>${(r.dates||[]).length}일</strong></span>
              <span class="text-sm"><span class="text-muted">잔여:</span> <strong style="color:var(--blue)">${remain}일 / ${total}일</strong></span>
            </div>
            <div style="font-size:12px;color:var(--text-3);line-height:1.6;">
              ${(r.dates||[]).map(d => `<span style="background:var(--bg-2);padding:1px 6px;border-radius:4px;margin-right:4px;">${d}</span>`).join('')}
            </div>
            ${r.reason ? `<div class="text-sm" style="margin-top:6px;color:var(--text-2);">사유: ${r.reason}</div>` : ''}
            ${r.reviewer_note ? `<div class="text-xs" style="margin-top:4px;color:var(--text-3);">관리자 메모: ${r.reviewer_note}</div>` : ''}
          </div>

          ${r.status === 'pending' ? `
          <div style="display:flex;flex-direction:column;gap:8px;min-width:140px;">
            <button class="btn-primary approve-btn" data-id="${r.id}" style="padding:8px 16px;">✅ 승인</button>
            <button class="btn-danger  reject-btn"  data-id="${r.id}" style="padding:8px 16px;">❌ 반려</button>
          </div>` : r.status === 'approved' ? `
          <div>
            <button class="btn-secondary revoke-btn" data-id="${r.id}" style="padding:6px 12px;font-size:12px;">승인 취소</button>
          </div>` : ''}
        </div>
      </div>`;
  }).join('');

  // 이벤트 바인딩
  el.querySelectorAll('.approve-btn').forEach(btn => {
    btn.addEventListener('click', () => handleApprove(btn.dataset.id));
  });
  el.querySelectorAll('.reject-btn').forEach(btn => {
    btn.addEventListener('click', () => handleReject(btn.dataset.id));
  });
  el.querySelectorAll('.revoke-btn').forEach(btn => {
    btn.addEventListener('click', () => handleRevoke(btn.dataset.id));
  });
}

async function handleApprove(id) {
  const { error } = await updateLeave(id, { status: 'approved' });
  if (error) { toast('승인 실패: ' + error.message, 'error'); return; }

  // state 업데이트
  const req = (state.leaveRequests || []).find(r => r.id == id);
  if (req) req.status = 'approved';

  toast('✅ 연차 신청이 승인되었습니다.', 'success');
  await renderList();
}

async function handleReject(id) {
  const note = prompt('반려 사유를 입력하세요 (선택사항):') ?? null;
  if (note === null && !confirm('사유 없이 반려하시겠습니까?')) return;

  const { error } = await updateLeave(id, { status: 'rejected', reviewer_note: note || null });
  if (error) { toast('반려 실패: ' + error.message, 'error'); return; }

  const req = (state.leaveRequests || []).find(r => r.id == id);
  if (req) { req.status = 'rejected'; if (note) req.reviewer_note = note; }

  toast('연차 신청이 반려되었습니다.', 'info');
  await renderList();
}

async function handleRevoke(id) {
  if (!confirm('승인을 취소하고 대기 상태로 되돌리시겠습니까?')) return;

  const { error } = await updateLeave(id, { status: 'pending', reviewer_note: null });
  if (error) { toast('취소 실패: ' + error.message, 'error'); return; }

  const req = (state.leaveRequests || []).find(r => r.id == id);
  if (req) { req.status = 'pending'; req.reviewer_note = null; }

  toast('승인이 취소되어 대기 상태로 변경되었습니다.', 'info');
  await renderList();
}
