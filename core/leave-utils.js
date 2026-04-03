// core/leave-utils.js — 연차 계산 로직
// 기존 leave-utils.js 에서 정리하여 이식

/**
 * 직원의 현재 연차 상세 정보를 계산합니다.
 *
 * @param {Object} employee  - employees 테이블 row
 * @param {string} [refDate] - 기준 날짜 (YYYY-MM-DD), 기본값 오늘
 * @returns {{
 *   legal: number,          총 법정 연차
 *   adjustment: number,     수동 조정분
 *   carriedOver: number,    이월 연차 (소수점)
 *   final: number,          최종 확정 연차
 *   periodStart: string,    현재 기간 시작
 *   periodEnd: string,      현재 기간 종료
 *   note: string            비고
 * }}
 */
export function getLeaveDetails(employee, refDate) {
  const ref   = dayjs(refDate || undefined);
  const entry = dayjs(employee.entry_date);

  if (!entry.isValid()) {
    return { legal:0, adjustment:0, carriedOver:0, final:0, periodStart:'', periodEnd:'', note:'입사일 없음' };
  }

  const monthsWorked = ref.diff(entry, 'month');

  // ── 1년 미만: 월차 ──────────────────────────────────────
  if (monthsWorked < 12) {
    const legal = monthsWorked; // 만 1개월마다 1일
    return {
      legal,
      adjustment: employee.leave_adjustment || 0,
      carriedOver: 0,
      final: Math.max(0, legal + (employee.leave_adjustment || 0)),
      periodStart: entry.format('YYYY-MM-DD'),
      periodEnd: entry.add(1, 'year').subtract(1, 'day').format('YYYY-MM-DD'),
      note: `입사 ${monthsWorked}개월 (월차)`,
    };
  }

  // ── 1년 이상: 연차 ──────────────────────────────────────
  // 갱신 기준일 결정
  const renewalBase = employee.leave_renewal_date
    ? dayjs(employee.leave_renewal_date)
    : entry;

  // 현재 기간의 시작(갱신일)
  let periodStart = renewalBase.clone();
  while (periodStart.add(1, 'year').isBefore(ref) || periodStart.add(1, 'year').isSame(ref, 'day')) {
    periodStart = periodStart.add(1, 'year');
  }
  const periodEnd = periodStart.add(1, 'year').subtract(1, 'day');

  // 근속 연수 (기간 시작 시점 기준)
  const yearsAt = periodStart.diff(entry, 'year');

  // 법정 연차: 15일 기본 + 2년마다 +1일 (최대 25일)
  const extra = Math.floor((yearsAt - 1) / 2);
  const legalBase = Math.min(15 + extra, 25);

  // 주 근무일수 비례 (기본 5일)
  const weeklyDays = employee.weekly_work_days || 5;
  const ratio = weeklyDays / 5;
  const legal = Math.floor(legalBase * ratio * 10) / 10; // 소수점 1자리

  return {
    legal,
    adjustment:  employee.leave_adjustment || 0,
    carriedOver: employee.carried_over_leave || 0,
    final: Math.max(0, Math.floor(legal + (employee.leave_adjustment || 0) + (employee.carried_over_leave || 0))),
    periodStart: periodStart.format('YYYY-MM-DD'),
    periodEnd:   periodEnd.format('YYYY-MM-DD'),
    note: `입사 ${yearsAt}년차`,
  };
}

/**
 * 연차 요청 배열에서 해당 직원의 승인된 연차 사용 일수를 계산합니다.
 * @param {Object[]} leaveRequests
 * @param {number}   empId
 * @param {string}   periodStart
 * @param {string}   periodEnd
 */
export function calcUsedLeave(leaveRequests, empId, periodStart, periodEnd) {
  return leaveRequests
    .filter(r => r.employee_id === empId && r.status === 'approved')
    .reduce((sum, r) => {
      if (!Array.isArray(r.dates)) return sum;
      const inPeriod = r.dates.filter(d => d >= periodStart && d <= periodEnd);
      return sum + inPeriod.length;
    }, 0);
}

/**
 * 날짜 범위에서 실제 근무일(주말·공휴일 제외) 배열을 반환합니다.
 * @param {string}   start
 * @param {string}   end
 * @param {Set}      holidays  공휴일 Set<string>
 * @returns {string[]}
 */
export function getWorkDays(start, end, holidays = new Set()) {
  const days = [];
  let cur = dayjs(start);
  const last = dayjs(end);
  while (cur.isBefore(last) || cur.isSame(last, 'day')) {
    const ds  = cur.format('YYYY-MM-DD');
    const dow = cur.day();
    if (dow !== 0 && dow !== 6 && !holidays.has(ds)) days.push(ds);
    cur = cur.add(1, 'day');
  }
  return days;
}
