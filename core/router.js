// core/router.js — 화면(View) 전환 관리

/**
 * 앱의 최상위 화면 목록.
 * HTML에 id="v-login", id="v-employee", id="v-admin" 이 존재해야 합니다.
 */
const VIEWS = ['v-login', 'v-employee', 'v-admin'];

/**
 * 특정 화면으로 이동합니다. 나머지는 숨깁니다.
 * @param {'v-login'|'v-employee'|'v-admin'} viewId
 */
export function goTo(viewId) {
  VIEWS.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('hidden', id !== viewId);
  });
}

/**
 * 탭 전환 헬퍼.
 * tabGroupSelector: 탭 버튼들을 감싼 부모 선택자
 * contentId: 탭 콘텐츠가 렌더링될 요소 id
 * activeTabId: 활성화할 버튼의 data-tab 값
 */
export function switchTab(tabGroupSelector, activeTabId) {
  document.querySelectorAll(`${tabGroupSelector} [data-tab]`).forEach(btn => {
    btn.classList.toggle('tab-active', btn.dataset.tab === activeTabId);
  });
}
