// admin/employees.js — 직원 관리

import { state }                          from '../core/state.js';
import { fetchEmployees, fetchDepartments,
         createEmployee, updateEmployee, deleteEmployee } from '../core/db.js';
import { getLeaveDetails, calcUsedLeave } from '../core/leave-utils.js';
import { toast }                          from '../main.js';

export async function render(container) {
  container.innerHTML = `
    <div class="section-header mb-4">
      <div class="section-title">직원 관리</div>
      <button id="add-emp-btn" class="btn-primary">+ 직원 추가</button>
    </div>
    <div id="emp-list"></div>`;

  document.getElementById('add-emp-btn').addEventListener('click', () => openEmpModal(null, container));
  await renderList(container);
}

async function renderList(pageContainer) {
  const el = document.getElementById('emp-list');
  if (!el) return;

  const emps  = state.employees || [];
  const depts = state.departments || [];

  if (!emps.length) {
    el.innerHTML = '<div class="empty-state"><div class="empty-state-icon">👥</div><div class="empty-state-text">등록된 직원이 없습니다</div></div>';
    return;
  }

  const deptMap = Object.fromEntries(depts.map(d => [d.id, d.name]));

  // 직원별 연차 정보
  const rows = emps.map(emp => {
    const details = getLeaveDetails(emp);
    const used    = calcUsedLeave(state.leaveRequests, emp.id, details.periodStart, details.periodEnd);
    const remain  = Math.max(0, details.final - used);
    return { emp, details, used, remain };
  });

  // 그룹 정렬: 부서별
  const grouped = {};
  rows.forEach(r => {
    const dName = deptMap[r.emp.department_id] || '미지정';
    if (!grouped[dName]) grouped[dName] = [];
    grouped[dName].push(r);
  });

  el.innerHTML = Object.entries(grouped).map(([deptName, members]) => `
    <div class="card mb-4" style="padding:0;overflow:hidden;">
      <div style="background:var(--bg-2);padding:10px 16px;font-weight:600;font-size:13px;color:var(--text-2);border-bottom:1px solid var(--border);">
        ${deptName} (${members.length}명)
      </div>
      <table class="data-table">
        <thead><tr>
          <th>이름</th><th>입사일</th><th>주근무</th>
          <th>확정연차</th><th>사용</th><th>잔여</th><th>갱신일</th><th>상태</th><th></th>
        </tr></thead>
        <tbody>
          ${members.map(({ emp, details, used, remain }) => `
            <tr class="${emp.retired ? 'text-muted' : ''}">
              <td><strong>${emp.name}</strong>${emp.is_temp ? ' <span class="badge badge-pending" style="font-size:10px;">임시</span>' : ''}</td>
              <td style="font-size:12px;">${emp.entry_date ? dayjs(emp.entry_date).format('YYYY.MM.DD') : '-'}</td>
              <td>${emp.weekly_work_days ?? 5}일</td>
              <td><strong>${details.final}</strong>일</td>
              <td style="color:var(--green)">${used}일</td>
              <td style="color:var(--blue);font-weight:600;">${remain}일</td>
              <td style="font-size:11px;">${details.periodEnd || '-'}</td>
              <td>${emp.retired
                ? '<span class="badge badge-rejected">퇴사</span>'
                : '<span class="badge badge-approved">재직</span>'}</td>
              <td style="white-space:nowrap;">
                <button class="btn-secondary edit-btn" data-id="${emp.id}" style="padding:4px 10px;font-size:11px;margin-right:4px;">수정</button>
                ${!emp.retired
                  ? `<button class="btn-danger retire-btn" data-id="${emp.id}" style="padding:4px 10px;font-size:11px;">퇴사</button>`
                  : `<button class="btn-secondary restore-btn" data-id="${emp.id}" style="padding:4px 10px;font-size:11px;">복직</button>`}
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`).join('');

  el.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const emp = emps.find(e => e.id == btn.dataset.id);
      if (emp) openEmpModal(emp, pageContainer);
    });
  });

  el.querySelectorAll('.retire-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const emp = emps.find(e => e.id == btn.dataset.id);
      if (!emp) return;
      if (!confirm(`${emp.name} 직원을 퇴사 처리하시겠습니까?`)) return;
      const { error } = await updateEmployee(emp.id, { retired: true });
      if (error) { toast('처리 실패: ' + error.message, 'error'); return; }
      emp.retired = true;
      toast(`${emp.name} 직원이 퇴사 처리되었습니다.`, 'info');
      renderList(pageContainer);
    });
  });

  el.querySelectorAll('.restore-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const emp = emps.find(e => e.id == btn.dataset.id);
      if (!emp) return;
      const { error } = await updateEmployee(emp.id, { retired: false });
      if (error) { toast('처리 실패: ' + error.message, 'error'); return; }
      emp.retired = false;
      toast(`${emp.name} 직원이 복직 처리되었습니다.`, 'success');
      renderList(pageContainer);
    });
  });
}

// ─── 직원 추가/수정 모달 ──────────────────────────────────────
function openEmpModal(emp, pageContainer) {
  const depts   = state.departments || [];
  const isEdit  = !!emp;

  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000;display:flex;align-items:center;justify-content:center;padding:16px;overflow-y:auto;';

  modal.innerHTML = `
    <div style="background:#fff;border-radius:12px;padding:24px;width:100%;max-width:520px;box-shadow:0 20px 40px rgba(0,0,0,.15);max-height:90vh;overflow-y:auto;">
      <div style="font-size:16px;font-weight:700;margin-bottom:20px;">${isEdit ? '✏️ 직원 정보 수정' : '➕ 직원 추가'}</div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div class="form-group">
          <label class="form-label">이름 <span style="color:red;">*</span></label>
          <input id="f-name" class="form-input" value="${emp?.name || ''}" placeholder="홍길동" />
        </div>
        <div class="form-group">
          <label class="form-label">부서</label>
          <select id="f-dept" class="form-input">
            <option value="">미지정</option>
            ${depts.map(d => `<option value="${d.id}" ${emp?.department_id==d.id?'selected':''}>${d.name}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">입사일</label>
          <input id="f-entry" type="date" class="form-input" value="${emp?.entry_date || ''}" />
        </div>
        <div class="form-group">
          <label class="form-label">주 근무일수</label>
          <select id="f-wdays" class="form-input">
            ${[3,4,5].map(n => `<option value="${n}" ${(emp?.weekly_work_days||5)==n?'selected':''}>${n}일</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">이메일</label>
          <input id="f-email" type="email" class="form-input" value="${emp?.email || ''}" placeholder="선택사항" />
        </div>
        <div class="form-group">
          <label class="form-label">${isEdit ? '비밀번호 변경 (빈칸=유지)' : '비밀번호 *'}</label>
          <input id="f-pass" type="password" class="form-input" placeholder="${isEdit ? '변경 시 입력' : '초기 비밀번호'}" />
        </div>
      </div>

      <div style="border-top:1px solid var(--border);margin:16px 0;padding-top:16px;">
        <div style="font-size:13px;font-weight:600;color:var(--text-2);margin-bottom:12px;">연차 설정</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div class="form-group">
            <label class="form-label">연차 조정 (일)</label>
            <input id="f-ladj" type="number" step="0.5" class="form-input" value="${emp?.leave_adjustment ?? 0}" />
            <div class="text-xs text-muted mt-1">기본 연차에 더하거나 빼는 값</div>
          </div>
          <div class="form-group">
            <label class="form-label">이월 연차 (일)</label>
            <input id="f-carry" type="number" step="0.5" class="form-input" value="${emp?.carried_over_leave ?? 0}" />
          </div>
          <div class="form-group">
            <label class="form-label">연차 갱신일</label>
            <input id="f-renewal" type="date" class="form-input" value="${emp?.leave_renewal_date || ''}" />
            <div class="text-xs text-muted mt-1">비워두면 입사일 기준 자동</div>
          </div>
          <div class="form-group">
            <label class="form-label">임시직 여부</label>
            <label style="display:flex;align-items:center;gap:8px;padding-top:10px;">
              <input id="f-temp" type="checkbox" ${emp?.is_temp ? 'checked' : ''} />
              <span class="text-sm">임시직 (연차 발생 없음)</span>
            </label>
          </div>
        </div>
      </div>

      <div style="display:flex;gap:10px;margin-top:4px;">
        <button id="modal-cancel" class="btn-secondary" style="flex:1;">취소</button>
        <button id="modal-save"   class="btn-primary"   style="flex:2;">${isEdit ? '저장' : '추가'}</button>
      </div>
    </div>`;

  document.body.appendChild(modal);

  modal.querySelector('#modal-cancel').onclick = () => modal.remove();

  modal.querySelector('#modal-save').onclick = async () => {
    const name  = modal.querySelector('#f-name').value.trim();
    const dept  = modal.querySelector('#f-dept').value || null;
    const entry = modal.querySelector('#f-entry').value || null;
    const wdays = +modal.querySelector('#f-wdays').value;
    const email = modal.querySelector('#f-email').value.trim() || null;
    const pass  = modal.querySelector('#f-pass').value;
    const ladj  = parseFloat(modal.querySelector('#f-ladj').value) || 0;
    const carry = parseFloat(modal.querySelector('#f-carry').value) || 0;
    const renew = modal.querySelector('#f-renewal').value || null;
    const isTemp = modal.querySelector('#f-temp').checked;

    if (!name) { toast('이름을 입력하세요.', 'error'); return; }
    if (!isEdit && !pass) { toast('비밀번호를 입력하세요.', 'error'); return; }

    const btn = modal.querySelector('#modal-save');
    btn.disabled = true; btn.textContent = '저장 중…';

    const payload = {
      name, email,
      department_id:    dept ? +dept : null,
      entry_date:       entry,
      weekly_work_days: wdays,
      leave_adjustment: ladj,
      carried_over_leave: carry,
      leave_renewal_date: renew,
      is_temp:          isTemp,
    };
    if (pass) payload.password = pass;

    let error;
    if (isEdit) {
      ({ error } = await updateEmployee(emp.id, payload));
      if (!error) {
        Object.assign(emp, payload);
        toast('✅ 직원 정보가 수정되었습니다.', 'success');
      }
    } else {
      const res = await createEmployee(payload);
      error = res.error;
      if (!error && res.data) {
        state.employees.push(res.data);
        toast('✅ 직원이 추가되었습니다.', 'success');
      }
    }

    if (error) { toast('저장 실패: ' + error.message, 'error'); btn.disabled = false; btn.textContent = '저장'; return; }

    modal.remove();
    renderList(pageContainer);
  };
}
