// employee/my-docs.js — 서류 제출 (직원용)

import { state, supabase }               from '../core/state.js';
import { fetchMyDocRequests, fetchMySubmittedDocs, submitDocument, updateDocRequest } from '../core/db.js';
import { toast }                         from '../main.js';

export async function render(container) {
  container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⏳</div><div>로딩 중…</div></div>';
  await reload(container);
}

async function reload(container) {
  const [reqRes, subRes] = await Promise.all([
    fetchMyDocRequests(state.user.id),
    fetchMySubmittedDocs(state.user.id),
  ]);

  const requests  = reqRes.data  || [];
  const submitted = subRes.data  || [];

  // 대기 중인 요청 (아직 제출 안 한 것)
  const submittedReqIds = new Set(submitted.map(s => s.request_id));
  const pending = requests.filter(r => r.status === 'pending' && !submittedReqIds.has(r.id));

  container.innerHTML = `
    <!-- 제출 대기 요청 -->
    ${pending.length ? `
    <div class="card mb-4" style="border-left:4px solid var(--yellow);">
      <div class="card-title">📌 제출 요청 (${pending.length}건)</div>
      <div id="pending-requests"></div>
    </div>` : ''}

    <!-- 제출 내역 -->
    <div class="card" style="padding:0;overflow:hidden;">
      <div class="section-header" style="padding:14px 16px 0;">
        <div class="section-title">제출 내역</div>
      </div>
      <div id="submit-history" style="padding:0 4px 4px;"></div>
    </div>`;

  // 대기 요청 렌더
  if (pending.length) {
    const pendingEl = document.getElementById('pending-requests');
    pending.forEach(req => {
      const item = document.createElement('div');
      item.style.cssText = 'padding:10px;border:1px solid var(--border);border-radius:8px;margin-bottom:8px;';
      item.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
          <div>
            <div style="font-weight:600;font-size:14px;">${req.document_name || '서류'}</div>
            <div class="text-xs text-muted">요청일: ${dayjs(req.created_at).format('YYYY.MM.DD')}</div>
            ${req.note ? `<div class="text-xs" style="color:var(--text-2);margin-top:4px;">${req.note}</div>` : ''}
          </div>
          <button class="btn-primary submit-doc-btn" data-req-id="${req.id}" data-doc-name="${req.document_name||'서류'}">
            📤 제출하기
          </button>
        </div>`;
      pendingEl.appendChild(item);
    });

    pendingEl.querySelectorAll('.submit-doc-btn').forEach(btn => {
      btn.addEventListener('click', () => openSubmitModal(btn.dataset.reqId, btn.dataset.docName, container));
    });
  }

  // 제출 내역 렌더
  const histEl = document.getElementById('submit-history');
  if (!submitted.length) {
    histEl.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📭</div><div class="empty-state-text">제출 내역이 없습니다</div></div>';
    return;
  }

  const STATUS_MAP  = { pending:'검토 대기', approved:'승인', rejected:'반려' };
  const BADGE_MAP   = { pending:'badge-pending', approved:'badge-approved', rejected:'badge-rejected' };

  histEl.innerHTML = `
    <table class="data-table">
      <thead><tr><th>서류명</th><th>제출일</th><th>상태</th><th>비고</th></tr></thead>
      <tbody>
        ${submitted.map(s => `
          <tr>
            <td><strong>${s.document_name || '-'}</strong></td>
            <td>${dayjs(s.created_at).format('YYYY.MM.DD')}</td>
            <td><span class="badge ${BADGE_MAP[s.status]||'badge-pending'}">${STATUS_MAP[s.status]||s.status}</span></td>
            <td class="text-muted" style="font-size:11px;">${s.reviewer_note||'-'}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

// ─── 제출 모달 ────────────────────────────────────────────────
function openSubmitModal(reqId, docName, pageContainer) {
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000;display:flex;align-items:center;justify-content:center;padding:16px;';
  modal.innerHTML = `
    <div style="background:#fff;border-radius:12px;padding:24px;width:100%;max-width:440px;box-shadow:0 20px 40px rgba(0,0,0,.15);">
      <div style="font-size:16px;font-weight:700;margin-bottom:16px;">📄 ${docName} 제출</div>
      <div class="form-group mb-3">
        <label class="form-label">파일 첨부 (사진/PDF)</label>
        <input id="doc-file" type="file" accept="image/*,.pdf" class="form-input" />
      </div>
      <div class="form-group mb-3">
        <label class="form-label">메모 (선택사항)</label>
        <textarea id="doc-note" class="form-input" rows="2" placeholder="전달사항이 있으면 입력하세요"></textarea>
      </div>
      <div style="display:flex;gap:10px;">
        <button id="modal-cancel" class="btn-secondary" style="flex:1;">취소</button>
        <button id="modal-submit" class="btn-primary"   style="flex:2;">제출하기</button>
      </div>
    </div>`;

  document.body.appendChild(modal);

  modal.querySelector('#modal-cancel').onclick = () => modal.remove();
  modal.querySelector('#modal-submit').onclick  = async () => {
    const fileInput = modal.querySelector('#doc-file');
    const note      = modal.querySelector('#doc-note').value.trim();
    const btn       = modal.querySelector('#modal-submit');
    btn.disabled = true; btn.textContent = '제출 중…';

    let fileUrl = null;

    // 파일 업로드 (Supabase Storage)
    if (fileInput.files[0]) {
      const file = fileInput.files[0];
      const path = `${state.user.id}/${Date.now()}_${file.name}`;
      const { data: uploadData, error: uploadErr } = await supabase.storage
        .from('docs')
        .upload(path, file, { upsert: false });
      if (uploadErr) {
        toast('파일 업로드 실패: ' + uploadErr.message, 'error');
        btn.disabled = false; btn.textContent = '제출하기';
        return;
      }
      const { data: { publicUrl } } = supabase.storage.from('docs').getPublicUrl(path);
      fileUrl = publicUrl;
    }

    const { error } = await submitDocument({
      employee_id:   state.user.id,
      request_id:    reqId,
      document_name: docName,
      file_url:      fileUrl,
      note,
      status:        'pending',
    });

    if (error) { toast('제출 실패: ' + error.message, 'error'); btn.disabled = false; btn.textContent = '제출하기'; return; }

    // 요청 상태 업데이트
    await updateDocRequest(reqId, { status: 'submitted' });

    modal.remove();
    toast('✅ 서류 제출 완료', 'success');
    await reload(pageContainer);
  };
}
