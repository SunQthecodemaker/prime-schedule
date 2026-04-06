// admin/documents.js — 서류 검토 및 요청 관리 (2단계: 중간관리자 1차 → 최고관리자 최종)

import { state }                           from '../core/state.js';
import { fetchDocRequests, fetchSubmittedDocs,
         updateSubmittedDoc, createDocRequest,
         fetchDocTemplates }               from '../core/db.js';
import { toast }                           from '../main.js';

const isAdmin   = () => state.role === 'admin';
const isManager = () => state.role === 'manager';

let activeTab = 'submitted'; // 'submitted' | 'request'

export async function render(container) {
  container.innerHTML = `
    <div class="tab-nav mb-4" style="border-bottom:1px solid var(--border);padding-bottom:0;">
      <button class="tab-btn${activeTab==='submitted'?' active':''}" data-tab="submitted">📥 제출된 서류</button>
      <button class="tab-btn${activeTab==='request'?' active':''}" data-tab="request">📤 서류 요청</button>
    </div>
    <div id="doc-panel"></div>`;

  container.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.tab;
      container.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === activeTab));
      renderPanel();
    });
  });

  await renderPanel();
}

async function renderPanel() {
  const el = document.getElementById('doc-panel');
  if (!el) return;

  if (activeTab === 'submitted') {
    await renderSubmitted(el);
  } else {
    await renderRequestTab(el);
  }
}

// ─── 제출된 서류 목록 ─────────────────────────────────────────
async function renderSubmitted(el) {
  el.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⏳</div><div>로딩 중…</div></div>';

  const { data, error } = await fetchSubmittedDocs();
  if (error) { el.innerHTML = `<div class="empty-state text-danger">${error.message}</div>`; return; }

  const list = (data || []).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  if (!list.length) {
    el.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📭</div><div class="empty-state-text">제출된 서류가 없습니다</div></div>';
    return;
  }

  const STATUS_LABEL = {
    pending:      '검토 대기',
    pre_approved: '1차 승인 (최고관리자 대기)',
    approved:     '최종 승인',
    rejected:     '반려',
  };
  const BADGE_CLASS = {
    pending:      'badge-pending',
    pre_approved: 'badge-pre',
    approved:     'badge-approved',
    rejected:     'badge-rejected',
  };

  el.innerHTML = list.map(doc => {
    const emp = (state.employees || []).find(e => e.id === doc.employee_id);

    let actionBtns = '';
    if (isManager()) {
      if (doc.status === 'pending') {
        actionBtns = `
          <div style="display:flex;flex-direction:column;gap:8px;min-width:120px;">
            <button class="btn-primary doc-pre-approve-btn" data-id="${doc.id}" style="padding:6px 14px;font-size:12px;">🔶 1차 승인</button>
            <button class="btn-danger  doc-reject-btn"      data-id="${doc.id}" style="padding:6px 14px;font-size:12px;">❌ 반려</button>
          </div>`;
      }
    } else {
      if (doc.status === 'pending') {
        actionBtns = `
          <div style="display:flex;flex-direction:column;gap:8px;min-width:120px;">
            <button class="btn-secondary doc-pre-approve-btn" data-id="${doc.id}" style="padding:6px 14px;font-size:12px;">🔶 1차 승인</button>
            <button class="btn-primary   doc-approve-btn"     data-id="${doc.id}" style="padding:6px 14px;font-size:12px;">✅ 최종 승인</button>
            <button class="btn-danger    doc-reject-btn"      data-id="${doc.id}" style="padding:6px 14px;font-size:12px;">❌ 반려</button>
          </div>`;
      } else if (doc.status === 'pre_approved') {
        actionBtns = `
          <div style="display:flex;flex-direction:column;gap:8px;min-width:120px;">
            <button class="btn-primary doc-approve-btn" data-id="${doc.id}" style="padding:6px 14px;font-size:12px;">✅ 최종 승인</button>
            <button class="btn-danger  doc-reject-btn"  data-id="${doc.id}" style="padding:6px 14px;font-size:12px;">❌ 반려</button>
          </div>`;
      }
    }

    return `
      <div class="card mb-3" data-docid="${doc.id}">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:12px;">
          <div style="flex:1;min-width:200px;">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
              <strong>${emp?.name || '(알 수 없음)'}</strong>
              <span class="badge ${BADGE_CLASS[doc.status] || ''}">${STATUS_LABEL[doc.status] || doc.status}</span>
              <span class="text-xs text-muted">${dayjs(doc.created_at).format('YYYY.MM.DD HH:mm')}</span>
            </div>
            <div class="text-sm mb-2"><span class="text-muted">서류명:</span> <strong>${doc.document_name || '-'}</strong></div>
            ${doc.file_url ? `
              <div class="text-sm mb-2">
                <span class="text-muted">첨부파일:</span>
                <a href="${doc.file_url}" target="_blank" style="color:var(--blue);text-decoration:underline;">파일 보기</a>
              </div>` : ''}
            ${doc.note ? `<div class="text-sm" style="color:var(--text-2);">메모: ${doc.note}</div>` : ''}
            ${doc.reviewer_note ? `<div class="text-xs text-muted mt-1">검토 의견: ${doc.reviewer_note}</div>` : ''}
          </div>
          ${actionBtns}
        </div>
      </div>`;
  }).join('');

  el.querySelectorAll('.doc-pre-approve-btn').forEach(btn =>
    btn.addEventListener('click', () => handleDocPreApprove(btn.dataset.id)));
  el.querySelectorAll('.doc-approve-btn').forEach(btn =>
    btn.addEventListener('click', () => handleDocApprove(btn.dataset.id)));
  el.querySelectorAll('.doc-reject-btn').forEach(btn =>
    btn.addEventListener('click', () => handleDocReject(btn.dataset.id)));
}

async function handleDocPreApprove(id) {
  const { error } = await updateSubmittedDoc(id, {
    status: 'pre_approved',
    reviewer_note: `1차 승인: ${state.user.name}`,
  });
  if (error) { toast('1차 승인 실패: ' + error.message, 'error'); return; }
  toast('🔶 1차 승인 완료 — 최고관리자 최종 승인 대기 중', 'info');
  const el = document.getElementById('doc-panel');
  if (el) await renderSubmitted(el);
}

async function handleDocApprove(id) {
  const { error } = await updateSubmittedDoc(id, { status: 'approved' });
  if (error) { toast('승인 실패: ' + error.message, 'error'); return; }
  toast('✅ 서류가 최종 승인되었습니다.', 'success');
  const el = document.getElementById('doc-panel');
  if (el) await renderSubmitted(el);
}

async function handleDocReject(id) {
  const note = prompt('반려 사유를 입력하세요 (선택사항):') ?? null;
  if (note === null && !confirm('사유 없이 반려하시겠습니까?')) return;
  const { error } = await updateSubmittedDoc(id, { status: 'rejected', reviewer_note: note || null });
  if (error) { toast('반려 실패: ' + error.message, 'error'); return; }
  toast('서류가 반려되었습니다.', 'info');
  const el = document.getElementById('doc-panel');
  if (el) await renderSubmitted(el);
}

// ─── 서류 요청 탭 ────────────────────────────────────────────
async function renderRequestTab(el) {
  const emps = (state.employees || []).filter(e => !e.retired);

  // 기존 요청 목록 로드
  const { data: reqData } = await fetchDocRequests();
  const requests = (reqData || []).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  el.innerHTML = `
    <!-- 새 요청 폼 -->
    <div class="card mb-4">
      <div class="card-title">📤 새 서류 요청</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
        <div class="form-group">
          <label class="form-label">직원 선택 <span style="color:red;">*</span></label>
          <select id="req-emp" class="form-input">
            <option value="">-- 직원 선택 --</option>
            <option value="all">전체 직원</option>
            ${emps.map(e => `<option value="${e.id}">${e.name}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">서류명 <span style="color:red;">*</span></label>
          <input id="req-docname" class="form-input" placeholder="예: 근로계약서, 재직증명서 등" />
        </div>
      </div>
      <div class="form-group mb-3">
        <label class="form-label">메모 (선택사항)</label>
        <textarea id="req-note" class="form-input" rows="2" placeholder="직원에게 전달할 내용"></textarea>
      </div>
      <button id="send-req-btn" class="btn-primary">요청 전송</button>
    </div>

    <!-- 기존 요청 목록 -->
    <div class="card" style="padding:0;overflow:hidden;">
      <div style="background:var(--bg-2);padding:10px 16px;font-weight:600;font-size:13px;color:var(--text-2);border-bottom:1px solid var(--border);">
        요청 내역 (${requests.length}건)
      </div>
      <div id="req-list" style="padding:4px;"></div>
    </div>`;

  // 요청 전송 버튼
  el.querySelector('#send-req-btn').addEventListener('click', async () => {
    const empVal  = el.querySelector('#req-emp').value;
    const docName = el.querySelector('#req-docname').value.trim();
    const note    = el.querySelector('#req-note').value.trim() || null;
    const btn     = el.querySelector('#send-req-btn');

    if (!empVal)  { toast('직원을 선택하세요.', 'error'); return; }
    if (!docName) { toast('서류명을 입력하세요.', 'error'); return; }

    btn.disabled = true; btn.textContent = '전송 중…';

    const targets = empVal === 'all' ? emps.map(e => e.id) : [+empVal];
    let success = 0, fail = 0;

    for (const empId of targets) {
      const { error } = await createDocRequest({ employee_id: empId, document_name: docName, note, status: 'pending' });
      if (error) fail++; else success++;
    }

    btn.disabled = false; btn.textContent = '요청 전송';

    if (fail === 0) toast(`✅ ${success}명에게 서류 요청을 전송했습니다.`, 'success');
    else toast(`${success}건 성공, ${fail}건 실패`, fail === targets.length ? 'error' : 'info');

    el.querySelector('#req-docname').value = '';
    el.querySelector('#req-note').value    = '';
    el.querySelector('#req-emp').value     = '';

    await renderRequestTab(el);
  });

  // 요청 목록 렌더
  const listEl = el.querySelector('#req-list');
  if (!requests.length) {
    listEl.innerHTML = '<div class="empty-state" style="padding:20px;"><div class="empty-state-text">요청 내역이 없습니다</div></div>';
    return;
  }

  const STATUS_LABEL = { pending:'대기', submitted:'제출됨', cancelled:'취소' };
  const BADGE_CLASS  = { pending:'badge-pending', submitted:'badge-approved', cancelled:'badge-rejected' };

  listEl.innerHTML = `
    <table class="data-table">
      <thead><tr><th>직원</th><th>서류명</th><th>요청일</th><th>상태</th><th>메모</th></tr></thead>
      <tbody>
        ${requests.map(r => {
          const emp = (state.employees || []).find(e => e.id === r.employee_id);
          return `
            <tr>
              <td><strong>${emp?.name || '-'}</strong></td>
              <td>${r.document_name || '-'}</td>
              <td style="font-size:11px;">${dayjs(r.created_at).format('MM.DD HH:mm')}</td>
              <td><span class="badge ${BADGE_CLASS[r.status]||'badge-pending'}">${STATUS_LABEL[r.status]||r.status}</span></td>
              <td style="font-size:11px;color:var(--text-3);max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${r.note||'-'}</td>
            </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}
