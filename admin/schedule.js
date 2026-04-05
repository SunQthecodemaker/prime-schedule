// admin/schedule.js — 엑셀 스타일 스케줄 관리 (jSpreadsheet CE)

import { state }                from '../core/state.js';
import { fetchMonthSchedules, fetchHolidays, fetchTeamLayout,
         upsertSchedules, addHoliday, removeHoliday, upsertTeamLayout } from '../core/db.js';
import { toast }                from '../main.js';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 상수
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const NORM = { '근무':'근','근':'근','연차':'연','연':'연','반차':'반','반':'반',
               '휴무':'휴','휴가':'휴','휴':'휴','휴직':'직','직':'직' };
const TO_DB = { '근':'근무','연':'연차','반':'반차','휴':'휴무','직':'휴직','':'휴무' };
const S_CSS = {
  '근': 'background:#fff;color:#111;',
  '연': 'background:#dbeafe;color:#1e40af;font-weight:700;',
  '반': 'background:#e0f2fe;color:#075985;',
  '휴': 'background:#fef9c3;color:#78350f;',
  '직': 'background:#fce7f3;color:#9d174d;',
  '':  'background:#f9fafb;color:#d1d5db;',
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 모듈 상태
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
let mountEl  = null;
let jsi      = null;
let rows     = [];   // [{employee, isWonJang}]
let dates    = [];   // [{date, dayNum, dayLabel, ...}]
let leaves   = new Map(); // empId → Set<dateStr>
let unsaved  = new Map();
let busy     = false;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 유틸
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function L(n) { return n < 26 ? String.fromCharCode(65+n) : L(Math.floor(n/26)-1)+String.fromCharCode(65+(n%26)); }
const C = (col,row) => `${L(col)}${row+1}`;
function norm(v) { if(!v) return ''; const s=String(v).trim(); return NORM[s]??NORM[s[0]]??''; }
function colBg(col) {
  if (col.isToday)                   return '#fffde7';
  if (col.isSunday||col.isHoliday)  return '#fff1f2';
  if (col.isSaturday)               return '#eff6ff';
  return '#fff';
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

  // 연차 맵
  leaves.clear();
  (state.leaveRequests||[]).forEach(r => {
    if (r.status !== 'approved' || !Array.isArray(r.dates)) return;
    if (!leaves.has(r.employee_id)) leaves.set(r.employee_id, new Set());
    r.dates.forEach(d => leaves.get(r.employee_id).add(d));
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 행/열 빌드
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function buildRows() {
  const emps    = (state.employees||[]).filter(e => !e.is_temp && !e.retired && !(e.email?.startsWith('temp-')));
  const deptMap = new Map((state.departments||[]).map(d => [d.id,d]));
  const layout  = state.schedule.layout;

  if (Array.isArray(layout) && layout[0]?.leader_id !== undefined) {
    const em = new Map(emps.map(e=>[e.id,e])); const out=[]; const seen=new Set();
    layout.forEach(t => {
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

function buildData(rowList, dateList) {
  const sm=new Map(); (state.schedule.schedules||[]).forEach(s=>sm.set(`${s.employee_id}_${s.date}`,s.status));
  return rowList.map(({employee:e})=>{
    const el=leaves.get(e.id); const row=[e.name];
    dateList.forEach(col=>{
      if(el?.has(col.date)){row.push('연');return;}
      const raw=sm.get(`${e.id}_${col.date}`);
      if(raw!==undefined){row.push(norm(raw)||'근');return;}
      row.push(col.isWeekend||col.isHoliday?'':'근');
    });
    const work=row.slice(1).filter(v=>v==='근').length;
    const off=row.slice(1).filter(v=>['연','반','휴','직'].includes(v)).length;
    row.push(work||'',off||''); return row;
  });
}

function buildStyles(rowList, dateList, data, vm) {
  const styles={}, n=dateList.length;
  rowList.forEach(({employee:e,isWonJang},ri)=>{
    styles[C(0,ri)]=isWonJang?'background:#f0fdf4;color:#065f46;font-weight:700;':'background:#f8fafc;color:#374151;';
    dateList.forEach((col,ci)=>{
      const ci1=ci+1, val=data[ri][ci1];
      let s;
      if(vm==='working'&&val!=='근') s='background:#f1f5f9;color:#cbd5e1;';
      else if(vm==='off'&&(val==='근'||val==='')) s='background:#f1f5f9;color:#cbd5e1;';
      else if(val&&val!=='근') s=S_CSS[val]??S_CSS[''];
      else s=`background:${colBg(col)};color:${val==='근'?'#374151':'#d1d5db'};`;
      if(leaves.get(e.id)?.has(col.date)) s+='font-style:italic;';
      if(isWonJang) s+='font-weight:700;';
      styles[C(ci1,ri)]=s;
    });
    styles[C(n+1,ri)]='background:#f0fdf4;color:#065f46;font-weight:700;text-align:center;';
    styles[C(n+2,ri)]='background:#fef9c3;color:#78350f;font-weight:700;text-align:center;';
  });
  return styles;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// jSpreadsheet 생성
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function createSheet(el, rowList, dateList, data) {
  if (jsi) { try{ jspreadsheet.destroy(el); }catch(_){} jsi=null; }
  el.innerHTML='';

  const vm     = state.schedule.view;
  const styles = buildStyles(rowList, dateList, data, vm);
  const label  = dayjs(state.schedule.date).format('YYYY년 M월');

  // jSpreadsheet CE v5: worksheets 배열로 감싸고, 콜백은 최상위에
  const sheets = jspreadsheet(el, {
    worksheets: [{
      data,
      columns: [
        {title:'직원명',width:90,type:'text',readOnly:true,align:'center'},
        ...dateList.map(col=>({title:`${col.dayNum}\n${col.dayLabel}`,width:34,type:'text',align:'center'})),
        {title:'근무',width:42,type:'text',readOnly:true,align:'center'},
        {title:'휴무',width:42,type:'text',readOnly:true,align:'center'},
      ],
      nestedHeaders:[[{title:'직원',colspan:1},{title:label,colspan:dateList.length},{title:'합계',colspan:2}]],
      freezeColumns:1, style:styles, tableWidth:'100%',
      allowDeleteColumn:false,allowInsertColumn:false,allowDeleteRow:false,allowInsertRow:false,
      columnDrag:false, rowDrag:true, columnSorting:false, search:false, pagination:false,
    }],
    onchange: onCellChange,
    onmoverow: onMoveRow,
    contextMenu: ctxMenu,
  });
  jsi = sheets[0];

  // 연차 셀 readOnly
  rowList.forEach(({employee:e},ri)=>{
    leaves.get(e.id)?.forEach(ds=>{
      const ci=dateList.findIndex(d=>d.date===ds);
      if(ci>=0) jsi.setReadOnly(C(ci+1,ri),true);
    });
  });

  colorHeaders(dateList);
  rows=rowList; dates=dateList;
}

function colorHeaders(dateList) {
  requestAnimationFrame(()=>{
    const trs=mountEl?.querySelectorAll('thead tr');
    const tds=trs?.[trs.length-1]?.querySelectorAll('td');
    if(!tds) return;
    dateList.forEach((col,ci)=>{
      const td=tds[ci+2]; if(!td) return;
      if(col.isToday){td.style.background='#fef3c7';td.style.fontWeight='700';}
      else if(col.isSunday||col.isHoliday){td.style.color='#ef4444';td.style.background='#fff1f2';}
      else if(col.isSaturday){td.style.color='#3b82f6';td.style.background='#eff6ff';}
    });
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 이벤트 핸들러
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function onCellChange(inst, cell, x, y, value) {
  if(busy) return;
  if(x===0||x>dates.length) return;
  const col=dates[x-1], row=rows[y]; if(!col||!row) return;
  if(leaves.get(row.employee.id)?.has(col.date)){busy=true;jsi.setValue(C(x,y),'연',false);busy=false;return;}
  const n=norm(value);
  if(n!==value){busy=true;jsi.setValue(C(x,y),n,false);busy=false;}
  const vm=state.schedule.view;
  let s;
  if(vm==='working'&&n!=='근')s='background:#f1f5f9;color:#cbd5e1;';
  else if(vm==='off'&&(n==='근'||n===''))s='background:#f1f5f9;color:#cbd5e1;';
  else if(n&&n!=='근')s=S_CSS[n]??S_CSS[''];
  else s=`background:${colBg(col)};color:${n==='근'?'#374151':'#d1d5db'};`;
  if(row.isWonJang)s+='font-weight:700;';
  jsi.setStyle({[C(x,y)]:s});
  unsaved.set(`${row.employee.id}_${col.date}`,{empId:row.employee.id,date:col.date,status:n||'근'});
  updateSaveBtn(); refreshSummary(y);
}

function onMoveRow(ws,from,to) {  // v5: 첫 파라미터 worksheet 추가
  const [m]=rows.splice(from,1); rows.splice(to,0,m);
  saveLayout().catch(e=>console.warn('레이아웃 저장 실패:',e));
}

function ctxMenu(ws,x,y,e,items) {  // v5: 첫 파라미터 worksheet 추가
  if(x===0||x>dates.length) return items;
  return [
    {title:'✅ 근무',onclick:()=>fill('근')},{title:'🏖 연차',onclick:()=>fill('연')},
    {title:'🌙 반차',onclick:()=>fill('반')},{title:'😴 휴무',onclick:()=>fill('휴')},
    {title:'⏸ 휴직',onclick:()=>fill('직')},{title:'✖ 초기화',onclick:()=>fill('')},
    {type:'line'},...items,
  ];
}

function fill(status) {
  // v5: selectedCell → getSelected() 반환값은 [{x,y}, ...] 배열
  const sel=jsi?.getSelected?.(); if(!sel||!sel.length) return;
  const xs=sel.map(s=>s.x), ys=sel.map(s=>s.y);
  const x1=Math.min(...xs), x2=Math.max(...xs);
  const y1=Math.min(...ys), y2=Math.max(...ys);
  for(let y=y1;y<=y2;y++)
    for(let x=x1;x<=x2;x++){
      if(x===0||x>dates.length) continue;
      if(leaves.get(rows[y]?.employee?.id)?.has(dates[x-1]?.date)) continue;
      jsi.setValue(C(x,y),status,true);
    }
}

function refreshSummary(ri) {
  const n=dates.length; let work=0,off=0;
  for(let ci=1;ci<=n;ci++){const v=jsi.getValue(C(ci,ri));if(v==='근')work++;else if(['연','반','휴','직'].includes(v))off++;}
  busy=true;
  jsi.setValue(C(n+1,ri),work||'',false);
  jsi.setValue(C(n+2,ri),off||'',false);
  busy=false;
}

function updateSaveBtn() {
  const btn=document.getElementById('sched-save-btn'); if(!btn) return;
  const n=unsaved.size;
  btn.disabled=n===0; btn.textContent=n>0?`💾 저장 (${n}건)`:'💾 저장';
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 저장 / 레이아웃
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function save() {
  if(!unsaved.size) return;
  const btn=document.getElementById('sched-save-btn');
  if(btn){btn.disabled=true;btn.textContent='저장 중…';}
  try {
    const payload=Array.from(unsaved.values()).map(({empId,date,status})=>({
      employee_id:empId,date,status:TO_DB[status]||'근무',grid_position:0,sort_order:0,
    }));
    const {error}=await upsertSchedules(payload);
    if(error) throw error;
    unsaved.clear(); updateSaveBtn();
    toast(`✅ ${payload.length}건 저장 완료`,'success');
  } catch(err){ toast('저장 실패: '+err.message,'error'); }
  finally{ updateSaveBtn(); }
}

async function saveLayout() {
  const month=dayjs(state.schedule.date).format('YYYY-MM-01');
  const teams=[]; let cur=null;
  rows.forEach(({employee:e,isWonJang})=>{
    if(isWonJang){cur={leader_id:e.id,members:[]};teams.push(cur);}
    else{(cur??(cur=teams[0]??(teams[0]={leader_id:null,members:[]}))).members.push(e.id);}
  });
  const {error}=await upsertTeamLayout(month,teams);
  if(error) throw error;
}

function setView(vm) {
  state.schedule.view=vm;
  document.querySelectorAll('.view-btn').forEach(b=>b.classList.toggle('active',b.dataset.mode===vm));
  if(!jsi) return;
  jsi.setStyle(buildStyles(rows,dates,jsi.getData(),vm));
}

async function toggleHoliday() {
  const ds=prompt('날짜 입력 (YYYY-MM-DD)\n※ 이미 등록된 날짜 입력 시 해제'); if(!ds||!/^\d{4}-\d{2}-\d{2}$/.test(ds)) return;
  const hol=state.schedule.holidays;
  if(hol.has(ds)){const{error}=await removeHoliday(ds);if(error){toast(error.message,'error');return;}hol.delete(ds);}
  else{const{error}=await addHoliday(ds);if(error){toast(error.message,'error');return;}hol.add(ds);}
  await refresh();
}

function weeklyCheck() {
  const warns=[]; if(!jsi) return;
  rows.forEach(({employee:e},ri)=>{
    const wm=new Map();
    dates.forEach((col,ci)=>{
      if(col.isWeekend||col.isHoliday) return;
      const wk=dayjs(col.date).week();
      if(!wm.has(wk))wm.set(wk,{biz:0,work:0});
      const w=wm.get(wk); w.biz++;
      if(jsi.getValue(C(ci+1,ri))==='근')w.work++;
    });
    wm.forEach((w,wk)=>{const exp=Math.min(w.biz,5);if(w.work<exp)warns.push(`• ${e.name} ${wk}주: 근무 ${w.work}일 / 기대 ${exp}일`);});
  });
  if(!warns.length){toast('✅ 모든 직원 주간 근무 정상','success');}
  else alert('⚠️ 주간 근무 미달\n\n'+warns.join('\n'));
}

async function navigate(dir) {
  if(unsaved.size&&!confirm('저장 안 된 변경사항이 있습니다. 이동할까요?'))return;
  unsaved.clear();
  const cur=dayjs(state.schedule.date);
  state.schedule.date=(dir==='prev'?cur.subtract(1,'month'):dir==='next'?cur.add(1,'month'):dayjs()).format('YYYY-MM-DD');
  await refresh();
}

async function refresh() {
  const title=document.getElementById('sched-month-title');
  if(title) title.textContent=dayjs(state.schedule.date).format('YYYY년 M월');
  if(!mountEl){return;}
  mountEl.innerHTML='<div class="empty-state"><div class="empty-state-icon">⏳</div><div>로딩 중…</div></div>';
  try {
    await loadMonth();
    const r=buildRows(), d=buildDates(), data=buildData(r,d);
    createSheet(mountEl,r,d,data);
    unsaved.clear(); updateSaveBtn();
  } catch(err){mountEl.innerHTML=`<p style="color:red;padding:16px;">오류: ${err.message}</p>`;}
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 진입점
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export function render(container) {
  container.innerHTML = `
    <div class="sheet-wrap" style="height:calc(100vh - 56px - 44px - 40px);">
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
      <div id="sched-mount" class="sheet-mount"></div>
      <div class="sheet-legend">
        <span class="legend-label">범례</span>
        <span class="badge-근">근 = 근무</span>
        <span class="badge-연">연 = 연차</span>
        <span class="badge-반">반 = 반차</span>
        <span class="badge-휴">휴 = 휴무</span>
        <span class="badge-직">직 = 휴직</span>
        <span class="legend-note">기울임꼴 = 연차시스템 자동반영</span>
      </div>
    </div>`;

  mountEl = container.querySelector('#sched-mount');
  document.getElementById('sched-month-title').textContent = dayjs(state.schedule.date).format('YYYY년 M월');

  container.querySelector('.view-toggle').addEventListener('click', e=>{const b=e.target.closest('.view-btn');if(b)setView(b.dataset.mode);});
  document.getElementById('sched-prev').onclick    = () => navigate('prev');
  document.getElementById('sched-next').onclick    = () => navigate('next');
  document.getElementById('sched-today').onclick   = () => navigate('today');
  document.getElementById('sched-save-btn').onclick = save;
  document.getElementById('sched-check-btn').onclick = weeklyCheck;
  document.getElementById('sched-holiday-btn').onclick = toggleHoliday;

  refresh();
}
