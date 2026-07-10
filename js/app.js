// ═══════════════════════════════════════════════════════
// 공부의 별 ⭐ — 메인 앱
// ═══════════════════════════════════════════════════════
import { sb, fetchAll } from './api.js';

/* ═════════ 상수 · 유틸 ═════════ */
const PALETTE = ['#CFC5FF','#C9EBD9','#FFD983','#FFD3DE','#BFE3F5','#F5CDBF','#D9EBC9','#E5C9EB'];
const STATUSES = ['예정','하는중','다함'];
const LV = ['#F1EDE6','#FFF3D1','#FFE9AE','#FFD983','#F2BE4E'];
const DOW = ['월','화','수','목','금','토','일'];
const GRAY = '#D8D2C6';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const uid = () => crypto.randomUUID();
const pad = n => String(n).padStart(2,'0');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const ymd = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const parseYmd = s => { const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d); };
const addDays = (d,n) => { const x = new Date(d); x.setDate(x.getDate()+n); return x; };
const todayStr = () => ymd(new Date());
const dateOfIso = iso => ymd(new Date(iso));
const dowIdx = d => (d.getDay()+6)%7;                 // 월=0 … 일=6
const mondayOf = (d,offsetWeeks=0) => addDays(d, -dowIdx(d) + offsetWeeks*7);

// 주 라벨: 그 주의 목요일이 속한 달 기준 "n월 m주차"
function weekLabel(mon){
  const thu = addDays(mon,3);
  return `${thu.getMonth()+1}월 ${Math.floor((thu.getDate()-1)/7)+1}주차`;
}
// 공부량 5단계 (분): 0 / ~1h / ~2h / ~3.5h / 그 이상
function level(min){ if(min<=0) return 0; if(min<=60) return 1; if(min<=120) return 2; if(min<=210) return 3; return 4; }
function fmtMin(min){
  min = Math.round(min);
  const h = Math.floor(min/60), m = min%60;
  if(h && m) return `${h}시간 ${m}분`;
  if(h) return `${h}시간`;
  return `${m}분`;
}
// 막대그래프용: 00시간 00분 고정 형식
function fmtHM(min){
  min = Math.round(min);
  const h = Math.floor(min/60), m = min%60;
  return h ? `${h}시간 ${pad(m)}분` : `${m}분`;
}

/* ═════════ 상태 ═════════ */
const S = { user:null, cats:[], subjects:[], todos:[], assignments:[], sessions:[], lectures:[], episodes:[], ddays:[] };
const UI = {
  filter:'전체', openSubj:new Set(), openLec:new Set(),
  pickFor:null, sheetTab:'subj',
  wkOffset:0, moOffset:0, selDay:null, poolSubj:null, weekScrolled:false,
};

const bySort = (a,b) => (a.sort_order - b.sort_order) || String(a.created_at).localeCompare(String(b.created_at));
const byCreated = (a,b) => String(a.created_at).localeCompare(String(b.created_at));
const catById  = id => S.cats.find(c => c.id === id);
const subjById = id => S.subjects.find(s => s.id === id);
const todoById = id => S.todos.find(t => t.id === id);
const lecById  = id => S.lectures.find(l => l.id === id);
const doingSubjects = () => S.subjects.slice().sort(bySort).filter(s => s.status === '하는중');
const subjColor = id => { const s = subjById(id); return s ? s.color : GRAY; };
const subjName  = id => { const s = subjById(id); return s ? s.name : '삭제된 과목'; };

/* ═════════ 저장 헬퍼 (낙관적 갱신 + 백그라운드 저장) ═════════ */
let toastTimer;
function toast(msg){
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}
// 실패 시 0.8초 → 1.6초 → 3.2초 간격으로 자동 재시도
function save(build){
  const run = n => Promise.resolve(build())
    .then(({error}) => {
      if(!error) return;
      if(error.code === '23505') return; // 이미 저장된 재시도 중복 → 성공 취급
      throw error;
    })
    .catch(e => {
      if(n < 3){ setTimeout(() => run(n+1), 800 * 2**n); }
      else{ console.error(e); toast('저장에 실패했어요 — 네트워크 확인 후 새로고침 해주세요'); }
    });
  run(0);
}
const ins = (table,rows) => save(() => sb.from(table).insert(rows));
const upd = (table,id,patch) => save(() => sb.from(table).update(patch).eq('id',id));
const del = (table,id) => save(() => sb.from(table).delete().eq('id',id));

/* 로컬 캐스케이드 삭제 (DB는 FK cascade가 처리) */
function removeTodoLocal(id){
  S.todos.filter(t => t.parent_id === id).forEach(c => removeTodoLocal(c.id));
  S.assignments = S.assignments.filter(a => a.todo_id !== id);
  S.todos = S.todos.filter(t => t.id !== id);
}
function removeLectureLocal(id){
  S.episodes = S.episodes.filter(e => e.lecture_id !== id);
  S.lectures = S.lectures.filter(l => l.id !== id);
}
function removeSubjectLocal(id){
  S.todos.filter(t => t.subject_id === id && !t.parent_id).forEach(t => removeTodoLocal(t.id));
  S.todos = S.todos.filter(t => t.subject_id !== id);
  S.lectures.filter(l => l.subject_id === id).forEach(l => removeLectureLocal(l.id));
  S.sessions.forEach(ss => { if(ss.subject_id === id) ss.subject_id = null; });
  S.subjects = S.subjects.filter(s => s.id !== id);
  UI.openSubj.delete(id);
  if(UI.poolSubj === id) UI.poolSubj = null;
  if(T.subjId === id){ T.subjId = null; persistTimer(); }
}
function removeCategoryLocal(id){
  S.subjects.filter(s => s.category_id === id).forEach(s => removeSubjectLocal(s.id));
  S.cats = S.cats.filter(c => c.id !== id);
}

/* ═════════ 통계 계산 ═════════ */
function minutesPerDay(){
  const m = new Map();
  for(const s of S.sessions){
    const d = dateOfIso(s.started_at);
    m.set(d, (m.get(d)||0) + s.duration_sec/60);
  }
  return m;
}
function minutesBySubject(filterFn){
  const m = new Map();
  for(const s of S.sessions){
    if(!filterFn(dateOfIso(s.started_at))) continue;
    const k = s.subject_id || 'deleted';
    m.set(k, (m.get(k)||0) + s.duration_sec/60);
  }
  return m;
}
function currentStreak(){
  const days = minutesPerDay();
  let d = new Date();
  if(!days.has(ymd(d))) d = addDays(d,-1);
  let n = 0;
  while(days.has(ymd(d))){ n++; d = addDays(d,-1); }
  return n;
}
function longestStreakInMonth(y,mo){
  const days = minutesPerDay();
  const last = new Date(y, mo+1, 0).getDate();
  let max = 0, run = 0;
  for(let d = 1; d <= last; d++){
    if(days.has(ymd(new Date(y,mo,d)))) { run++; max = Math.max(max,run); }
    else run = 0;
  }
  return max;
}

/* ═════════ 화면 전환 ═════════ */
function goScreen(id){
  $$('nav button').forEach(x => x.classList.toggle('on', x.dataset.scr === id));
  $$('.screen').forEach(s => s.classList.toggle('active', s.id === id));
  if(id === 'scr-timer' && !T.subjId){
    const recent = recentSubject();
    if(recent){ T.subjId = recent.id; persistTimer(); renderTimer(); }
  }
  if(id === 'scr-week' && UI.wkOffset === 0 && !UI.weekScrolled) scrollWeekToToday();
}
function recentSubject(){
  const doing = doingSubjects();
  for(let i = S.sessions.length-1; i >= 0; i--){
    const s = subjById(S.sessions[i].subject_id);
    if(s && s.status === '하는중') return s;
  }
  return doing[0] || null;
}

/* ═════════ ① 홈 ═════════ */
function renderHome(){
  const now = new Date();
  $('#home-date').textContent = `${now.getMonth()+1}월 ${now.getDate()}일 ${DOW[dowIdx(now)]}요일`;
  const name = S.user?.user_metadata?.name;
  $('#home-greet').innerHTML = name
    ? `${esc(name)}님, 오늘도<br>별이랑 시작해요 ⭐`
    : `오늘도 별이랑<br>시작해요 ⭐`;

  // 공부 시작하기 (타이머 상태 연동)
  const running = !!T.startAt, paused = !running && T.base > 0;
  const curSubj = subjById(T.subjId);
  const recent = recentSubject();
  $('#go-title').textContent = running ? '공부하는 중' : paused ? '잠깐 쉬는 중' : '공부 시작하기';
  $('#go-recent').textContent = (running || paused) && curSubj
    ? curSubj.name
    : (recent ? `${recent.name} · 이어서 하기` : '');
  $('#go-time').style.display = (running || paused) ? '' : 'none';
  $('#go-face-focus').style.display = running ? '' : 'none';
  $('#go-face-idle').style.display = running ? 'none' : '';

  // 연속 스트릭 바
  const sbEl = $('#streak-bar');
  if(!S.sessions.length){
    sbEl.style.display = 'none';
  }else{
    sbEl.style.display = 'flex';
    const st = currentStreak();
    if(st > 0){
      sbEl.innerHTML = `<span class="sb-num">🔥 ${st}일 연속</span><span class="sb-msg">잘하고 있어요!</span>`;
    }else{
      let last = '';
      for(const s of S.sessions){ const d = dateOfIso(s.started_at); if(d > last) last = d; }
      const ld = parseYmd(last);
      sbEl.innerHTML = `<span class="sb-num">마지막 공부일 ${ld.getMonth()+1}.${ld.getDate()}</span><span class="sb-msg">정신 차리세요!</span>`;
    }
  }

  // D-day 미니 카드 2개 (다가오는 일정 순)
  const today = todayStr();
  const upcoming = S.ddays.filter(d => d.date >= today).sort((a,b) => a.date.localeCompare(b.date)).slice(0,2);
  [0,1].forEach(i => {
    const el = $(`[data-dmini="${i}"]`);
    const d = upcoming[i];
    if(!d){ el.innerHTML = ''; return; }
    const diff = Math.round((parseYmd(d.date) - parseYmd(today)) / 86400000);
    el.innerHTML = `<span class="dd">${diff === 0 ? 'D-day' : 'D-'+diff}</span><span class="nm">${esc(d.title)}</span>`;
  });

  // 이번 달 미니 히트맵
  $('#heat-lbl').textContent = `${now.getMonth()+1}월 공부 달력`;
  const per = minutesPerDay();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const days = new Date(now.getFullYear(), now.getMonth()+1, 0).getDate();
  let heat = '';
  let studyDays = 0;
  for(let b = 0; b < dowIdx(first); b++) heat += '<i style="visibility:hidden"></i>';
  for(let d = 1; d <= days; d++){
    const min = per.get(ymd(new Date(now.getFullYear(), now.getMonth(), d))) || 0;
    heat += `<i style="background:${LV[level(min)]}"></i>`;
    if(d <= now.getDate() && min > 0) studyDays++;
  }
  $('#heat').innerHTML = heat;
  $('#heat-foot').textContent = `${studyDays}일 공부 ${now.getDate() - studyDays}일 놀기`;

  // 오늘의 할일 (플랜의 오늘 배정과 동일 데이터)
  $('#home-todo-lbl').textContent = `오늘의 할일 · ${DOW[dowIdx(now)]}요일`;
  const asg = S.assignments.filter(a => a.date === today).sort(byCreated);
  const groups = new Map();
  for(const a of asg){
    const t = todoById(a.todo_id); if(!t) continue;
    const key = t.subject_id;
    if(!groups.has(key)) groups.set(key, []);
    groups.get(key).push({a, t});
  }
  $('#home-todos').innerHTML = groups.size ? [...groups.entries()].map(([sid, list]) => `
    <div class="subj-group">
      <div class="g-lbl"><i style="background:${subjColor(sid)}"></i>${esc(subjName(sid))}</div>
      ${list.map(({a,t}) => `<div class="todo-line">
        <button class="chk ${a.done?'on':''}" onclick="toggleAsg('${a.id}')" aria-label="완료 체크">✓</button>
        <span class="${a.done?'done-txt':''}">${esc(t.text)}</span></div>`).join('')}
    </div>`).join('')
    : '<p class="todo-empty">오늘의 할일을 추가해보세요</p>';
}

/* ═════════ D-day 시트 ═════════ */
function openDdaySheet(){ $('#ovl-dday').classList.add('show'); renderDdaySet(); }
function closeDdaySheet(){ $('#ovl-dday').classList.remove('show'); }
function renderDdaySet(){
  const list = S.ddays.slice().sort((a,b) => a.date.localeCompare(b.date));
  $('#dday-list').innerHTML = `<div class="cat-group">
    ${list.map(d => `
      <div class="swipe-wrap"><div class="swipe-del-bg">🗑</div>
      <div class="set-line" data-id="${d.id}">
        <span class="td-txt" contenteditable="true"
          onblur="ddayEdit(this,'${d.id}')"
          onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}">${esc(d.title)}</span>
        <input type="date" class="date-input" value="${d.date}" onchange="ddayDate(this,'${d.id}')" aria-label="날짜">
      </div></div>`).join('')}
    <div class="set-line ghost">
      <span class="gchk"></span>
      <span class="g-input" contenteditable="true" data-ph="일정 추가"
        onblur="ddayGhost(this)"
        onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}"></span>
      <input type="date" class="date-input" id="dday-new-date" value="${todayStr()}" aria-label="새 일정 날짜">
    </div>
  </div>`;
  $$('#dday-list .swipe-wrap').forEach(w => bindSwipe(w, line => {
    const id = line.dataset.id;
    S.ddays = S.ddays.filter(d => d.id !== id);
    del('ddays', id);
    renderDdaySet(); renderHome();
  }));
}
function ddayEdit(el, id){
  const v = el.textContent.trim();
  const d = S.ddays.find(x => x.id === id);
  if(d && v && v !== d.title){ d.title = v; upd('ddays', id, {title:v}); }
  renderDdaySet(); renderHome();
}
function ddayDate(el, id){
  const d = S.ddays.find(x => x.id === id);
  if(d && el.value){ d.date = el.value; upd('ddays', id, {date:el.value}); }
  renderDdaySet(); renderHome();
}
function ddayGhost(el){
  const v = el.textContent.trim();
  if(!v){ el.textContent = ''; return; }
  const date = $('#dday-new-date').value || todayStr();
  const row = { id:uid(), user_id:S.user.id, title:v, date };
  S.ddays.push({...row, created_at:new Date().toISOString()});
  ins('ddays', row);
  renderDdaySet(); renderHome();
}

/* ═════════ ② 위클리 플랜 ═════════ */
const MIN_WK = -52;
function renderWeek(){
  const isCur = UI.wkOffset === 0;
  const mon = mondayOf(new Date(), UI.wkOffset);
  $('#wk-lbl').textContent = weekLabel(mon);
  $('#wk-prev').disabled = UI.wkOffset <= MIN_WK;
  $('#wk-next').disabled = isCur;
  $('#pool-card').style.display = isCur ? 'block' : 'none';

  const today = todayStr();
  const per = new Map();
  for(const a of S.assignments){ if(!per.has(a.date)) per.set(a.date, []); per.get(a.date).push(a); }

  const row = $('#week-row');
  const prevScroll = row.scrollLeft;
  row.innerHTML = Array.from({length:7}, (_,i) => {
    const d = addDays(mon, i), ds = ymd(d);
    const isToday = ds === today;
    const list = (per.get(ds) || []).slice().sort(byCreated);
    const allDone = list.length > 0 && list.every(a => a.done);
    return `<div class="day-col ${isToday?'today':''} ${isCur?'':'past'}" data-date="${ds}">
      <div class="day-head"><span class="dow">${DOW[i]}</span><span class="date">${d.getMonth()+1}.${d.getDate()}${isToday?' · 오늘':''}</span>${allDone?'<span class="day-thumb">👍</span>':''}</div>
      ${list.map(a => {
        const t = todoById(a.todo_id); if(!t) return '';
        return `<div class="w-todo ${a.done?'done':''}" data-asg="${a.id}" style="background:${subjColor(t.subject_id)}30"
          role="button" aria-label="완료 토글">
          <span class="${a.done?'done-txt':''}">${esc(t.text)}</span>
        </div>`;
      }).join('')}
    </div>`;
  }).join('');
  if(isCur) row.querySelectorAll('.w-todo').forEach(bindWTodo);

  // 한 주 요약표: 요일별 할일 개수 (다 하면 흐리게), 탭하면 그 요일로 스크롤
  $('#week-sum').innerHTML = Array.from({length:7}, (_,i) => {
    const ds = ymd(addDays(mon, i));
    const list = per.get(ds) || [];
    const n = list.length;
    const allDone = n > 0 && list.every(a => a.done);
    return `<button class="ws-cell ${ds===today?'today':''}" data-wsi="${i}" aria-label="${DOW[i]}요일로 이동">
      <span class="ws-d">${DOW[i]}</span><span class="ws-n ${n ? (allDone?'dim':'') : 'zero'}">${n}</span></button>`;
  }).join('');
  $$('#week-sum .ws-cell').forEach(b => b.addEventListener('click', () => scrollWeekTo(+b.dataset.wsi, true)));

  // 첫 표시: 월=왼쪽 끝, 일=오른쪽 끝, 나머지 요일=오늘 칸이 화면 중앙. 이후에는 스크롤 유지
  // (화면이 숨겨진 상태에서는 스크롤이 적용되지 않으므로 플랜 탭 진입 시에도 시도)
  if(isCur && !UI.weekScrolled && $('#scr-week').classList.contains('active')){
    scrollWeekToToday();
  }else{
    row.scrollLeft = prevScroll;
  }

  if(isCur) renderPool();
}
function scrollWeekTo(i, smooth){
  const row = $('#week-row');
  const col = row.children[i];
  if(!col) return;
  let left;
  if(i === 0) left = 0;
  else if(i === 6) left = row.scrollWidth;
  else left = Math.max(0, (col.offsetLeft - row.offsetLeft) - (row.clientWidth - col.clientWidth)/2);
  if(smooth) row.scrollTo({left, behavior:'smooth'});
  else row.scrollLeft = left;
}
function scrollWeekToToday(){
  if(!$('#week-row').querySelector('.day-col.today')) return;
  scrollWeekTo(dowIdx(new Date()), false);
  UI.weekScrolled = true;
}
function toggleAsg(id){
  const a = S.assignments.find(x => x.id === id); if(!a) return;
  a.done = !a.done;
  upd('assignments', id, {done:a.done});
  // 할일 원본과 동기화
  const t = todoById(a.todo_id);
  if(t && t.done !== a.done){ t.done = a.done; upd('todos', t.id, {done:a.done}); }
  renderAll();
}
function removeAsg(id){
  S.assignments = S.assignments.filter(a => a.id !== id);
  del('assignments', id);
  renderAll();
}
// 드래그 중 화면 가장자리에 닿으면 주간 행 자동 스크롤
function edgeScrollWeek(ev){
  const row = $('#week-row');
  const r = row.getBoundingClientRect();
  if(ev.clientX > r.right - 48) row.scrollLeft += 14;
  else if(ev.clientX < r.left + 48) row.scrollLeft -= 14;
}
// 배정 카드: 탭 = 완료 토글, 수평 드래그 = 다른 요일로 이동
function bindWTodo(el){
  el.addEventListener('pointerdown', e => {
    const asgId = el.dataset.asg;
    const sx = e.clientX, sy = e.clientY;
    let dragging = false, ghost = null, canceled = false;
    el.setPointerCapture(e.pointerId);
    const mv = ev => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if(!dragging && Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy)*1.2){
        dragging = true;
        ghost = el.cloneNode(true); ghost.classList.add('ghost-drag');
        ghost.style.width = el.offsetWidth+'px';
        document.body.appendChild(ghost);
      }
      if(dragging){
        ev.preventDefault();
        ghost.style.left = ev.clientX+'px'; ghost.style.top = ev.clientY+'px';
        edgeScrollWeek(ev);
        $$('.day-col').forEach(c => c.classList.remove('hover'));
        const t = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.day-col:not(.past)');
        if(t) t.classList.add('hover');
      }
    };
    const cleanup = () => {
      el.removeEventListener('pointermove', mv);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancel);
      $$('.day-col').forEach(c => c.classList.remove('hover'));
      if(ghost) ghost.remove();
    };
    const cancel = () => { canceled = true; cleanup(); };
    const up = ev => {
      cleanup();
      if(canceled) return;
      if(!dragging){ toggleAsg(asgId); return; }
      const t = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.day-col:not(.past)');
      if(t){
        const date = t.dataset.date;
        const a = S.assignments.find(x => x.id === asgId);
        if(a && a.date !== date){ a.date = date; upd('assignments', asgId, {date}); renderAll(); }
      }
    };
    el.addEventListener('pointermove', mv);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', cancel);
  });
}

/* ── 할일 담기 풀 + 드래그 ── */
function poolItems(sid){
  // 미완료 리프 할일: 작은 할일이 없는 큰 할일 + 작은 할일
  const all = S.todos.filter(t => t.subject_id === sid && !t.done);
  return all.filter(t => t.parent_id || !all.some(c => c.parent_id === t.id))
    .sort(bySort);
}
// 이번 주 범위에서 이 할일의 배정 찾기 (할일 하나 = 요일 하나)
function weekAssignmentOf(todoId){
  const mon = ymd(mondayOf(new Date(), 0)), sun = ymd(addDays(mondayOf(new Date(), 0), 6));
  return S.assignments.find(a => a.todo_id === todoId && a.date >= mon && a.date <= sun);
}
function renderPool(){
  const doing = doingSubjects();
  if(!UI.poolSubj || !doing.some(s => s.id === UI.poolSubj)) UI.poolSubj = doing[0]?.id || null;
  $('#pool-chips').innerHTML = doing.map(s =>
    `<button class="chip ${s.id===UI.poolSubj?'on':''}" data-pool="${s.id}">
      <span class="dot" style="background:${s.color}"></span>${esc(s.name)}</button>`).join('');
  $$('#pool-chips [data-pool]').forEach(ch => ch.addEventListener('click', () => {
    UI.poolSubj = ch.dataset.pool; renderPool();
  }));
  $('#pool').innerHTML = UI.poolSubj ? poolItems(UI.poolSubj).map(t => {
    const asg = weekAssignmentOf(t.id);
    const monMid = parseYmd(ymd(mondayOf(new Date(), 0)));
    const dayLbl = asg ? DOW[Math.round((parseYmd(asg.date) - monMid) / 86400000)] : '';
    return `<span class="pool-item ${asg?'assigned':''}" data-todo="${t.id}">
      <span class="tag" style="background:${subjColor(UI.poolSubj)}"></span>${esc(t.text)}${asg?`<b class="pi-day">${dayLbl}</b>`:''}</span>`;
  }).join('') : '';
  bindPoolDrag();
}
// 알약: 탭 = 배정 해제(담긴 경우), 드래그 = 요일 배정/이동
function bindPoolDrag(){
  $$('.pool-item').forEach(it => {
    it.addEventListener('pointerdown', e => {
      const todoId = it.dataset.todo;
      const sx = e.clientX, sy = e.clientY;
      let dragging = false, ghost = null, canceled = false;
      const mv = ev => {
        if(!dragging && Math.hypot(ev.clientX-sx, ev.clientY-sy) > 10){
          dragging = true;
          ghost = it.cloneNode(true); ghost.classList.add('ghost-drag');
          document.body.appendChild(ghost);
        }
        if(dragging){
          ghost.style.left = ev.clientX+'px'; ghost.style.top = ev.clientY+'px';
          edgeScrollWeek(ev);
          $$('.day-col').forEach(c => c.classList.remove('hover'));
          const col = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.day-col:not(.past)');
          if(col) col.classList.add('hover');
        }
      };
      const cleanup = () => {
        it.removeEventListener('pointermove', mv);
        it.removeEventListener('pointerup', up);
        it.removeEventListener('pointercancel', cancel);
        $$('.day-col').forEach(c => c.classList.remove('hover'));
        if(ghost) ghost.remove();
      };
      const cancel = () => { canceled = true; cleanup(); };
      const up = ev => {
        cleanup();
        if(canceled) return;
        const existing = weekAssignmentOf(todoId);
        if(!dragging){
          // 탭: 담겨 있으면 해제
          if(existing) removeAsg(existing.id);
          return;
        }
        const col = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.day-col:not(.past)');
        if(!col) return;
        const date = col.dataset.date;
        if(existing){
          if(existing.date !== date){ existing.date = date; upd('assignments', existing.id, {date}); renderAll(); }
        }else{
          const row = { id:uid(), user_id:S.user.id, todo_id:todoId, date, done:false };
          S.assignments.push({...row, created_at:new Date().toISOString()});
          ins('assignments', row);
          renderAll();
        }
      };
      it.setPointerCapture(e.pointerId);
      it.addEventListener('pointermove', mv);
      it.addEventListener('pointerup', up);
      it.addEventListener('pointercancel', cancel);
    });
  });
}

/* ═════════ ③ 타이머 ═════════ */
const TKEY = 'byeori-timer';
const T = { subjId:null, startAt:null, base:0, firstStart:null, iv:null };
function persistTimer(){
  localStorage.setItem(TKEY, JSON.stringify({subjId:T.subjId, startAt:T.startAt, base:T.base, firstStart:T.firstStart}));
}
function restoreTimer(){
  try{
    const s = JSON.parse(localStorage.getItem(TKEY));
    if(!s) return;
    if(s.subjId && !subjById(s.subjId)) s.subjId = null;
    Object.assign(T, {subjId:s.subjId, startAt:s.startAt, base:s.base||0, firstStart:s.firstStart});
    if(T.startAt) startTick();
  }catch{ /* ignore */ }
}
function startTick(){ clearInterval(T.iv); T.iv = setInterval(tick, 250); }
function stopTick(){ clearInterval(T.iv); T.iv = null; }
function elapsedSec(){ return Math.floor((T.base + (T.startAt ? Date.now()-T.startAt : 0)) / 1000); }
function tick(){
  const s = elapsedSec();
  const txt = `${pad(Math.floor(s/3600))}:${pad(Math.floor(s%3600/60))}:${pad(s%60)}`;
  $('#clock').textContent = txt;
  $('#go-time').textContent = txt;
  renderTimerStats();
}
function setFace(focus){
  $('#face-focus').style.display = focus ? '' : 'none';
  $('#face-idle').style.display = focus ? 'none' : '';
}
function renderTimer(){
  tick();
  const running = !!T.startAt, paused = !running && T.base > 0;
  $('#btn-start').textContent = running ? '일시정지' : paused ? '다시 시작' : '시작하기';
  $('#btn-end').style.display = (running || paused) ? 'inline-block' : 'none';
  if(running) $('#clock-label').textContent = '별이가 같이 집중하는 중 📚';
  else if(paused) $('#clock-label').textContent = '잠깐 쉬는 중이에요 ☕';
  setFace(running);
  $('#star-study').style.display = running ? '' : 'none';
  $('#star-break').style.display = paused ? '' : 'none';
  renderTimerChips();
}
function renderTimerChips(){
  const doing = doingSubjects();
  if(T.subjId && !doing.some(s => s.id === T.subjId) && !subjById(T.subjId)) T.subjId = null;
  $('#timer-chips').innerHTML = doing.map(s =>
    `<button class="chip ${s.id===T.subjId?'on':''}" data-subj="${s.id}">
      <span class="dot" style="background:${s.color}"></span>${esc(s.name)}</button>`).join('');
  $$('#timer-chips [data-subj]').forEach(c => c.addEventListener('click', () => {
    T.subjId = c.dataset.subj; persistTimer(); renderTimer();
  }));
  const sel = subjById(T.subjId);
  $('#hero-timer').style.background = sel ? sel.color + '40' : 'var(--yellow-soft)';
}
function longestStreakEver(){
  const days = [...minutesPerDay().keys()].sort();
  let max = 0, run = 0, prev = null;
  for(const d of days){
    run = (prev && (parseYmd(d) - parseYmd(prev)) === 86400000) ? run + 1 : 1;
    if(run > max) max = run;
    prev = d;
  }
  return max;
}
function renderTimerStats(){
  const today = todayStr();
  const per = minutesPerDay();
  const min = (per.get(today) || 0) + elapsedSec()/60;
  $('#tm-today').textContent = fmtMin(min);
  const st = currentStreak();
  $('#tm-streak').textContent = st > 0 ? `🔥 ${st}일` : '0일';
  // 최장 공부시간(하루 기준) / 최장 연속 공부일수
  let best = 0;
  per.forEach(v => { if(v > best) best = v; });
  best = Math.max(best, min);
  $('#tm-best').textContent = fmtMin(best);
  $('#tm-maxstreak').textContent = `${Math.max(longestStreakEver(), st)}일`;
}
function onStartPause(){
  if(!T.subjId){ $('#clock-label').textContent = '먼저 과목을 골라주세요'; return; }
  if(T.startAt){                    // 작동 중 → 일시정지
    T.base += Date.now() - T.startAt;
    T.startAt = null; stopTick();
  }else{                            // 시작 / 다시 시작
    T.startAt = Date.now();
    if(!T.firstStart) T.firstStart = T.startAt;
    startTick();
  }
  persistTimer(); renderTimer(); renderHome();
}
// 종료 버튼 → 기록/취소 확인 시트 (취소 = 이번 기록 삭제)
function onEnd(){
  const s = elapsedSec();
  const subj = subjById(T.subjId);
  $('#end-subj').innerHTML = subj
    ? `<span class="dot" style="background:${subj.color}"></span>${esc(subj.name)}` : '';
  $('#end-time').textContent = `${pad(Math.floor(s/3600))}:${pad(Math.floor(s%3600/60))}:${pad(s%60)}`;
  $('#ovl-end').classList.add('show');
}
function endDiscard(){
  stopTick();
  T.startAt = null; T.base = 0; T.firstStart = null;
  persistTimer();
  renderAll();
  $('#clock-label').textContent = '기록하지 않았어요';
}
function endSave(){
  if(T.startAt){ T.base += Date.now() - T.startAt; T.startAt = null; }
  stopTick();
  const dur = Math.floor(T.base/1000);
  if(dur > 0 && T.subjId){
    const row = {
      id: uid(), user_id: S.user.id, subject_id: T.subjId,
      started_at: new Date(T.firstStart || Date.now()-T.base).toISOString(),
      ended_at: new Date().toISOString(),
      duration_sec: dur,
    };
    S.sessions.push({...row, created_at:new Date().toISOString()});
    ins('sessions', row);
  }
  T.base = 0; T.firstStart = null;
  persistTimer();
  renderAll();
  $('#clock-label').textContent = '기록했어요! 오늘도 수고했어요 ⭐';
}

/* ═════════ ④ 기록 ═════════ */
function monthOf(offset){
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth()+offset, 1);
}
function minMonthOffset(){
  if(!S.sessions.length) return 0;
  const f = new Date(S.sessions[0].started_at);
  const now = new Date();
  return (f.getFullYear() - now.getFullYear())*12 + (f.getMonth() - now.getMonth());
}
function starSVG(fill, happy){
  const eyes = happy
    ? '<path d="M22 26 Q25 23 28 26" stroke="#2B2440" stroke-width="2.4" fill="none" stroke-linecap="round"/><path d="M32 26 Q35 23 38 26" stroke="#2B2440" stroke-width="2.4" fill="none" stroke-linecap="round"/>'
    : '<circle cx="24" cy="27" r="2.5" fill="#2B2440"/><circle cx="36" cy="27" r="2.5" fill="#2B2440"/>';
  return `<svg viewBox="0 0 60 58"><path d="M30 9 L35.9 20.9 L49 22.8 L39.5 32.1 L41.8 45.2 L30 39 L18.2 45.2 L20.5 32.1 L11 22.8 L24.1 20.9 Z"
    fill="${fill}" stroke="${fill}" stroke-width="15" stroke-linejoin="round"/>${eyes}
    <path d="M26 34 Q30 38 34 34" stroke="#2B2440" stroke-width="2.4" fill="none" stroke-linecap="round"/></svg>`;
}
function renderMonth(){
  const base = monthOf(UI.moOffset);
  const y = base.getFullYear(), mo = base.getMonth();
  const isCurMonth = UI.moOffset === 0;
  $('#mo-lbl').textContent = `${y}년 ${mo+1}월`;
  $('#mo-prev').disabled = UI.moOffset <= minMonthOffset();
  $('#mo-next').disabled = isCurMonth;

  const per = minutesPerDay();
  const days = new Date(y, mo+1, 0).getDate();
  const today = new Date();
  const inMonth = ds => { const d = parseYmd(ds); return d.getFullYear() === y && d.getMonth() === mo; };

  // 요약 3카드
  let totalMin = 0;
  per.forEach((v,k) => { if(inMonth(k)) totalMin += v; });
  const streak = isCurMonth
    ? [`🔥 ${currentStreak()}일`, '연속 스트릭']
    : [`${longestStreakInMonth(y,mo)}일`, '최장 스트릭'];
  const asgMonth = S.assignments.filter(a => inMonth(a.date) && a.date <= todayStr());
  const rate = asgMonth.length ? Math.round(asgMonth.filter(a => a.done).length / asgMonth.length * 100) + '%' : '—';
  const totalLbl = totalMin >= 60 ? `${Math.floor(totalMin/60)}시간` : `${Math.round(totalMin)}분`;
  $('#mo-stats').innerHTML = [
    [totalLbl,'총 공부시간'], streak, [rate,'할일 달성률'],
  ].map(([n,l]) => `<div class="card"><div class="num">${n}</div><div class="lbl">${l}</div></div>`).join('');

  // 별이 달력
  const g = $('#cal-grid');
  let html = DOW.map(d => `<span class="dow">${d}</span>`).join('');
  const blanks = dowIdx(new Date(y,mo,1));
  for(let b = 0; b < blanks; b++) html += '<div class="day empty"></div>';
  for(let d = 1; d <= days; d++){
    const dt = new Date(y,mo,d), ds = ymd(dt);
    if(dt > today && ds !== todayStr()){ html += `<div class="day num">${d}</div>`; continue; }
    const min = per.get(ds) || 0, v = level(min);
    if(v === 0){ html += '<div class="day"></div>'; continue; }
    html += `<div class="day clickable ${UI.selDay===d?'sel':''}" style="background:${LV[Math.max(1,v-1)]}55"
      onclick="pickDay(${d})" role="button" aria-label="${mo+1}월 ${d}일 기록">${starSVG(LV[v], d%3===0)}</div>`;
  }
  g.innerHTML = html;
  renderDayCard(y, mo);
}
function pickDay(d){ UI.selDay = UI.selDay === d ? null : d; renderMonth(); }
function barRows(map, fmt){
  const rows = [...map.entries()].map(([k,min]) => ({
    name: k === 'deleted' ? '삭제된 과목' : subjName(k),
    color: k === 'deleted' ? GRAY : subjColor(k),
    min,
  })).sort((a,b) => b.min - a.min);
  const max = Math.max(1, ...rows.map(r => r.min));
  return rows.map(r => `<div class="bar-row"><span class="name">${esc(r.name)}</span>
    <div class="bar-track"><div class="bar-fill" style="width:${Math.round(r.min/max*100)}%;background:${r.color}"></div></div>
    <span class="val">${fmt(r.min)}</span></div>`).join('');
}
function renderDayCard(y, mo){
  const box = $('#day-card');
  if(UI.selDay === null){
    const map = minutesBySubject(ds => { const d = parseYmd(ds); return d.getFullYear() === y && d.getMonth() === mo; });
    box.innerHTML = `<div class="day-title"><span class="tt">과목별 시간</span><span class="tot">${mo+1}월 전체</span></div>`
      + (map.size ? barRows(map, fmtHM) : '');
    return;
  }
  const ds = ymd(new Date(y, mo, UI.selDay));
  const map = minutesBySubject(x => x === ds);
  let total = 0; map.forEach(v => total += v);
  const doneAsg = S.assignments.filter(a => a.date === ds && a.done);
  box.innerHTML = `<div class="day-title"><span class="tt">과목별 시간</span>
      <span class="tot">${mo+1}월 ${UI.selDay}일 · 총 ${fmtMin(total)}
        <button class="day-edit" onclick="openSessSheet()">수정</button></span></div>`
    + barRows(map, fmtHM)
    + (doneAsg.length ? `<div class="day-done"><p class="dd-t">이날 한 일</p>
        ${doneAsg.map(a => { const t = todoById(a.todo_id); return t
          ? `<div class="todo-line"><button class="chk on" disabled>✓</button><span class="done-txt">${esc(t.text)}</span></div>` : ''; }).join('')}
      </div>` : '');
}

/* ── 공부 기록 수정 시트 ── */
const hmOf = iso => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
function openSessSheet(){
  const base = monthOf(UI.moOffset);
  UI.sessDate = ymd(new Date(base.getFullYear(), base.getMonth(), UI.selDay));
  renderSessSheet();
  $('#ovl-sess').classList.add('show');
}
function renderSessSheet(){
  const ds = UI.sessDate;
  const d = parseYmd(ds);
  $('#sess-title').textContent = `${d.getMonth()+1}월 ${d.getDate()}일 기록`;
  const list = S.sessions.filter(s => dateOfIso(s.started_at) === ds)
    .sort((a,b) => a.started_at.localeCompare(b.started_at));
  $('#sess-list').innerHTML = list.length ? `<div class="cat-group">
    ${list.map(s => `
      <div class="swipe-wrap"><div class="swipe-del-bg">🗑</div>
      <div class="set-line" data-sess-id="${s.id}">
        <span class="c-dot" style="background:${subjColor(s.subject_id)}" aria-hidden="true"></span>
        <span class="sess-name">${esc(subjName(s.subject_id))}</span>
        <input type="time" class="date-input" value="${hmOf(s.started_at)}" onchange="sessTime(this,'${s.id}','start')" aria-label="시작 시각">
        <span class="meta">~</span>
        <input type="time" class="date-input" value="${hmOf(s.ended_at)}" onchange="sessTime(this,'${s.id}','end')" aria-label="종료 시각">
        <span class="meta sess-dur">${fmtMin(s.duration_sec/60)}</span>
      </div></div>`).join('')}
  </div>` : '<div class="cat-group"><p class="todo-empty" style="padding:6px 4px">기록이 없어요</p></div>';
  $$('#sess-list .swipe-wrap').forEach(w => bindSwipe(w, line => {
    const id = line.dataset.sessId;
    S.sessions = S.sessions.filter(s => s.id !== id);
    del('sessions', id);
    renderSessSheet(); renderAll();
  }));
}
function sessTime(el, id, which){
  const s = S.sessions.find(x => x.id === id);
  if(!s || !el.value) return;
  const [y, m, dd] = UI.sessDate.split('-').map(Number);
  const [H, M] = el.value.split(':').map(Number);
  let start = new Date(s.started_at), end = new Date(s.ended_at);
  if(which === 'start') start = new Date(y, m-1, dd, H, M, 0);
  else end = new Date(y, m-1, dd, H, M, 0);
  if(end <= start) end = new Date(end.getTime() + 86400000); // 자정 넘김으로 간주
  s.started_at = start.toISOString();
  s.ended_at = end.toISOString();
  s.duration_sec = Math.round((end - start) / 1000);
  upd('sessions', id, {started_at:s.started_at, ended_at:s.ended_at, duration_sec:s.duration_sec});
  renderSessSheet(); renderAll();
}

/* ═════════ ⑤ 과목 관리 ═════════ */
function renderFilters(){
  $('#filters').innerHTML = ['전체','하는중','예정','다함','인강'].map(f =>
    `<button class="f-chip ${f===UI.filter?'on':''}" onclick="setFilter('${f}')">${f}</button>`).join('');
}
function setFilter(f){ UI.filter = f; renderFilters(); renderSubjects(); }

function todoLineHtml(t, big){
  return `<div class="swipe-wrap"><div class="swipe-del-bg">🗑</div>
    <div class="todo-line ${big?'big-line':''}" data-id="${t.id}">
      <button class="chk ${t.done?'on':''}" onclick="tdChk(event,'${t.id}')" aria-label="완료 체크">✓</button>
      <span class="td-txt ${t.done?'done-txt':''}" contenteditable="true"
        onclick="event.stopPropagation()" onblur="tdEdit(this,'${t.id}')"
        onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}">${esc(t.text)}</span>
    </div></div>`;
}
function ghostLineHtml(sid, parentId){
  const sub = !!parentId;
  return `<div class="todo-line ghost">
    <span class="gchk"></span>
    <span class="g-input" contenteditable="true" data-ph="${sub?'작은 할일 추가':'할일 추가'}"
      onclick="event.stopPropagation()"
      onblur="tdGhost(this,'${sid}',${sub?`'${parentId}'`:'null'})"
      onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}"></span>
  </div>`;
}
function lecStats(L){
  const eps = S.episodes.filter(e => e.lecture_id === L.id).sort((a,b) => a.no - b.no);
  const on = eps.filter(e => e.done).length;
  return { eps, on, complete: L.total_count > 0 && on >= L.total_count };
}
function lecBlockHtml(L){
  const { eps, on } = lecStats(L);
  const open = UI.openLec.has(L.id);
  return `
    <div class="lec-head" onclick="toggleLec(event,'${L.id}')">
      <span class="t">🎧 ${esc(L.name)}</span>
      <span class="lec-prog">${on} / ${L.total_count}강</span>
    </div>
    <div class="lec-track"><div class="lec-fill" style="width:${Math.round(on/Math.max(1,L.total_count)*100)}%;background:${subjColor(L.subject_id)}"></div></div>
    <div class="lec-grid ${open?'show':''}">
      ${eps.map(e => `<button class="lec ${e.done?'on':''}" onclick="lecTgl(event,'${e.id}')">${e.no}강</button>`).join('')}
    </div>`;
}
// 인강 탭: 전체 인강 카드 (완주한 것도 '수강 완료!'로 표시)
function lectureCardHtml(L){
  const { eps, on, complete } = lecStats(L);
  const color = subjColor(L.subject_id);
  const open = UI.openLec.has(L.id);
  return `<div class="subj-card ${open?'open':''}" onclick="toggleLecCard(event,'${L.id}')">
    <div class="subj-top"><span class="tag" style="background:${color}"></span>
      <span class="nm">🎧 ${esc(L.name)}<small class="lec-subj">${esc(subjName(L.subject_id))}</small></span>
      <span class="lec-prog">${complete ? '수강 완료!' : `${on} / ${L.total_count}강`}</span></div>
    <div class="lec-track" style="margin:12px 0 2px"><div class="lec-fill" style="width:${Math.round(on/Math.max(1,L.total_count)*100)}%;background:${color}"></div></div>
    <div class="subj-detail">
      <div class="lec-grid show">
        ${eps.map(e => `<button class="lec ${e.done?'on':''}" onclick="lecTgl(event,'${e.id}')">${e.no}강</button>`).join('')}
      </div>
    </div>
  </div>`;
}
function toggleLecCard(e, id){
  if(e.target.closest('.lec')) return;
  UI.openLec.has(id) ? UI.openLec.delete(id) : UI.openLec.add(id);
  renderSubjects();
}
function renderSubjects(){
  const box = $('#subj-list');
  if(UI.filter === '인강'){
    box.innerHTML = `<div class="lec-tab">${S.lectures.slice().sort(byCreated).map(L => lectureCardHtml(L)).join('')}</div>`;
    return;
  }
  box.innerHTML = S.cats.slice().sort(bySort).map(cat => {
    let subs = S.subjects.filter(s => s.category_id === cat.id).sort(bySort);
    if(UI.filter !== '전체') subs = subs.filter(s => s.status === UI.filter);
    if(!subs.length) return '';
    return `<p class="cat-lbl">${esc(cat.name)}</p>` + subs.map(s => {
      const bigs = S.todos.filter(t => t.subject_id === s.id && !t.parent_id).sort(bySort);
      // 완주한 인강은 과목 카드에서는 숨김 (인강 탭에서 확인)
      const lecs = S.lectures.filter(l => l.subject_id === s.id).sort(byCreated).filter(L => !lecStats(L).complete);
      return `<div class="subj-card ${UI.openSubj.has(s.id)?'open':''}" onclick="toggleCard(event,'${s.id}')">
        <div class="subj-top"><span class="tag" style="background:${s.color}"></span>
          <span class="nm">${esc(s.name)}</span><span class="badge b-${s.status}">${s.status}</span></div>
        <div class="subj-detail">
          <div class="td-box">
            ${bigs.map(t => `
              <div class="todo-group">
                ${todoLineHtml(t, true)}
                <div class="sub-todos">
                  ${S.todos.filter(c => c.parent_id === t.id).sort(bySort).map(c => todoLineHtml(c, false)).join('')}
                  ${ghostLineHtml(s.id, t.id)}
                </div>
              </div>`).join('')}
            ${ghostLineHtml(s.id, null)}
          </div>
          ${lecs.map(L => lecBlockHtml(L)).join('')}
        </div>
      </div>`;
    }).join('');
  }).join('');
  box.querySelectorAll('.swipe-wrap').forEach(w => bindSwipe(w, line => {
    const id = line.dataset.id;
    removeTodoLocal(id);
    del('todos', id);
    renderAll();
  }));
}
function toggleCard(e, id){
  if(e.target.closest('.chk,.lec,.td-txt,.g-input,.ghost,.lec-head,.swipe-wrap')) return;
  UI.openSubj.has(id) ? UI.openSubj.delete(id) : UI.openSubj.add(id);
  renderSubjects();
}
function tdChk(e, id){
  e.stopPropagation();
  const t = todoById(id); if(!t) return;
  t.done = !t.done;
  upd('todos', id, {done:t.done});
  // 오늘 배정과 동기화
  S.assignments.filter(a => a.todo_id === id && a.date === todayStr()).forEach(a => {
    if(a.done !== t.done){ a.done = t.done; upd('assignments', a.id, {done:a.done}); }
  });
  renderAll();
}
function tdEdit(el, id){
  const t = todoById(id); if(!t) return;
  const v = el.textContent.trim();
  if(v && v !== t.text){ t.text = v; upd('todos', id, {text:v}); renderAll(); }
  else if(!v){ el.textContent = t.text; }
  // 변경 없으면 재렌더하지 않음 (작은 할일 입력칸으로 포커스 이동 유지)
}
function tdGhost(el, sid, parentId){
  const v = el.textContent.trim();
  if(!v){ el.textContent = ''; return; }
  const siblings = S.todos.filter(t => t.subject_id === sid && (parentId ? t.parent_id === parentId : !t.parent_id));
  const row = { id:uid(), user_id:S.user.id, subject_id:sid, parent_id:parentId, text:v, done:false,
    sort_order: siblings.length ? Math.max(...siblings.map(t => t.sort_order))+1 : 0 };
  S.todos.push({...row, created_at:new Date().toISOString()});
  ins('todos', row);
  renderAll();
}
function toggleLec(e, id){
  e.stopPropagation();
  UI.openLec.has(id) ? UI.openLec.delete(id) : UI.openLec.add(id);
  renderSubjects();
}
function lecTgl(e, id){
  e.stopPropagation();
  const ep = S.episodes.find(x => x.id === id); if(!ep) return;
  ep.done = !ep.done;
  upd('lecture_episodes', id, {done:ep.done});
  renderSubjects();
  if($('#ovl').classList.contains('show') && UI.sheetTab === 'lec') renderLecSet();
}

/* ═════════ 스와이프 삭제 ═════════ */
function bindSwipe(wrap, onDelete){
  const line = wrap.querySelector('.todo-line,.set-line');
  if(!line || line.classList.contains('ghost')) return;
  let sx = 0, sy = 0, dx = 0, swiping = false;
  line.addEventListener('pointerdown', e => {
    if(e.target.closest('.chk,.c-dot,.badge,.drag-h,.lec-n-edit,.date-input,.w-del')) return;
    sx = e.clientX; sy = e.clientY; dx = 0; swiping = false;
    const mv = ev => {
      dx = ev.clientX - sx; const dy = ev.clientY - sy;
      if(!swiping && Math.abs(dx) > 14 && Math.abs(dx) > Math.abs(dy)*1.4){
        swiping = true; wrap.classList.add('swiping');
        if(document.activeElement) document.activeElement.blur();
        line.setPointerCapture(ev.pointerId);
      }
      if(swiping){ ev.preventDefault(); line.style.transform = `translateX(${Math.min(0,dx)}px)`; }
    };
    const up = () => {
      line.removeEventListener('pointermove', mv); line.removeEventListener('pointerup', up);
      if(swiping && dx < -70) onDelete(line);
      else{ line.style.transform = ''; wrap.classList.remove('swiping'); }
    };
    line.addEventListener('pointermove', mv);
    line.addEventListener('pointerup', up);
  });
}

/* ═════════ 설정 시트 ═════════ */
function openSheet(){ UI.pickFor = null; setSheetTab('subj'); $('#ovl').classList.add('show'); }
function closeSheet(){ $('#ovl').classList.remove('show'); }
function setSheetTab(t){
  UI.sheetTab = t;
  $('#tab-subj').classList.toggle('on', t === 'subj');
  $('#tab-lec').classList.toggle('on', t === 'lec');
  $('#set-list').style.display = t === 'subj' ? 'block' : 'none';
  $('#lec-list').style.display = t === 'lec' ? 'block' : 'none';
  if(t === 'subj') renderSet(); else renderLecSet();
}

/* ── 과목 설정 탭 ── */
function renderSet(){
  const box = $('#set-list');
  box.innerHTML = S.cats.slice().sort(bySort).map(cat => `
    <div class="cat-group" data-cat="${cat.id}">
      <div class="swipe-wrap"><div class="swipe-del-bg">🗑</div>
        <div class="set-line cat-line" data-cat-id="${cat.id}">
          <span class="td-txt" contenteditable="true"
            onblur="catEdit(this,'${cat.id}')"
            onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}">${esc(cat.name)}</span>
        </div></div>
      ${S.subjects.filter(s => s.category_id === cat.id).sort(bySort).map(s => `
        <div class="swipe-wrap"><div class="swipe-del-bg">🗑</div>
        <div class="set-line" data-subj-id="${s.id}">
          <span class="drag-h" onpointerdown="startSubjDrag(event,'${s.id}')" aria-hidden="true">⠿</span>
          <button class="c-dot" style="background:${s.color}" onclick="togglePick(event,'${s.id}')" aria-label="색상 변경"></button>
          <span class="td-txt" contenteditable="true"
            onclick="event.stopPropagation()" onblur="subjEdit(this,'${s.id}')"
            onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}">${esc(s.name)}</span>
          <button class="badge b-${s.status}" onclick="cycleStatus(event,'${s.id}')">${s.status}</button>
        </div></div>
        ${UI.pickFor === s.id ? `
        <div class="sw-row">${PALETTE.map(c =>
          `<button class="sw ${c===s.color?'sel':''}" style="background:${c}" onclick="pickColor(event,'${s.id}','${c}')" aria-label="색상"></button>`).join('')}
        </div>` : ''}`).join('')}
      <div class="set-line ghost">
        <span class="gchk"></span>
        <span class="g-input" contenteditable="true" data-ph="과목 추가"
          onblur="subjGhost(this,'${cat.id}')"
          onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}"></span>
      </div>
    </div>`).join('') + `
    <div class="cat-group">
      <div class="set-line ghost">
        <span class="gchk"></span>
        <span class="g-input" contenteditable="true" data-ph="대분류 추가"
          onblur="catGhost(this)"
          onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}"></span>
      </div>
    </div>`;
  box.querySelectorAll('.swipe-wrap').forEach(w => bindSwipe(w, line => {
    if(line.dataset.subjId){
      removeSubjectLocal(line.dataset.subjId);
      del('subjects', line.dataset.subjId);
    }else if(line.dataset.catId){
      removeCategoryLocal(line.dataset.catId);
      del('categories', line.dataset.catId);
    }
    renderAll(); renderSet();
  }));
}
function catEdit(el, id){
  const c = catById(id); const v = el.textContent.trim();
  if(c && v && v !== c.name){ c.name = v; upd('categories', id, {name:v}); }
  renderAll(); renderSet();
}
function catGhost(el){
  const v = el.textContent.trim();
  if(!v){ el.textContent = ''; return; }
  const row = { id:uid(), user_id:S.user.id, name:v,
    sort_order: S.cats.length ? Math.max(...S.cats.map(c => c.sort_order))+1 : 0 };
  S.cats.push({...row, created_at:new Date().toISOString()});
  ins('categories', row);
  renderAll(); renderSet();
}
function subjEdit(el, id){
  const s = subjById(id); const v = el.textContent.trim();
  if(s && v && v !== s.name){ s.name = v; upd('subjects', id, {name:v}); }
  renderAll(); renderSet();
}
function subjGhost(el, catId){
  const v = el.textContent.trim();
  if(!v){ el.textContent = ''; return; }
  const inCat = S.subjects.filter(s => s.category_id === catId);
  const row = { id:uid(), user_id:S.user.id, category_id:catId, name:v,
    color: PALETTE[S.subjects.length % PALETTE.length], status:'예정',
    sort_order: inCat.length ? Math.max(...inCat.map(s => s.sort_order))+1 : 0 };
  S.subjects.push({...row, created_at:new Date().toISOString()});
  ins('subjects', row);
  renderAll(); renderSet();
}
function cycleStatus(e, id){
  e.stopPropagation();
  const s = subjById(id); if(!s) return;
  s.status = STATUSES[(STATUSES.indexOf(s.status)+1) % STATUSES.length];
  upd('subjects', id, {status:s.status});
  renderAll(); renderSet();
}
function togglePick(e, id){
  e.stopPropagation();
  UI.pickFor = UI.pickFor === id ? null : id;
  renderSet();
}
function pickColor(e, id, c){
  e.stopPropagation();
  const s = subjById(id); if(!s) return;
  s.color = c; UI.pickFor = null;
  upd('subjects', id, {color:c});
  renderAll(); renderSet();
}
let sDrag = null, sFromId = null;
function startSubjDrag(e, id){
  e.stopPropagation(); e.preventDefault();
  sFromId = id;
  const line = e.target.closest('.set-line');
  sDrag = line.cloneNode(true); sDrag.classList.add('ghost-drag');
  sDrag.style.width = line.offsetWidth+'px'; sDrag.style.background = '#fff';
  sDrag.style.borderRadius = '10px'; sDrag.style.padding = '6px 10px';
  document.body.appendChild(sDrag); moveSubj(e);
  e.target.setPointerCapture(e.pointerId);
  e.target.addEventListener('pointermove', moveSubj);
  e.target.addEventListener('pointerup', dropSubj, {once:true});
}
function moveSubj(e){
  if(sDrag){ sDrag.style.left = e.clientX+'px'; sDrag.style.top = e.clientY+'px'; }
  $$('.cat-group').forEach(g => g.classList.remove('hover'));
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const grp = el && el.closest('.cat-group[data-cat]');
  if(grp) grp.classList.add('hover');
}
function dropSubj(e){
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const grp = el && el.closest('.cat-group[data-cat]');
  if(grp && sFromId){
    const to = grp.dataset.cat;
    const s = subjById(sFromId);
    if(s && s.category_id !== to){
      const inCat = S.subjects.filter(x => x.category_id === to);
      s.category_id = to;
      s.sort_order = inCat.length ? Math.max(...inCat.map(x => x.sort_order))+1 : 0;
      upd('subjects', s.id, {category_id:to, sort_order:s.sort_order});
      renderAll();
    }
  }
  $$('.cat-group').forEach(g => g.classList.remove('hover'));
  if(sDrag){ sDrag.remove(); sDrag = null; }
  sFromId = null;
  renderSet();
}

/* ── 인강 설정 탭 ── */
function renderLecSet(){
  const box = $('#lec-list');
  const lecs = S.lectures.slice().sort(byCreated);
  box.innerHTML = `
    ${lecs.length ? `<div class="cat-group">
      ${lecs.map(L => `
        <div class="swipe-wrap"><div class="swipe-del-bg">🗑</div>
        <div class="set-line" data-lec-id="${L.id}">
          <span class="c-dot" style="background:${subjColor(L.subject_id)}" aria-hidden="true"></span>
          <span class="td-txt" contenteditable="true"
            onclick="event.stopPropagation()" onblur="lecEdit(this,'${L.id}')"
            onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}">${esc(L.name)}</span>
          <span class="meta">${esc(subjName(L.subject_id))}</span>
          <input class="lec-n-edit" type="number" value="${L.total_count}" min="1" max="200"
            onclick="event.stopPropagation()" onchange="lecTotal(this,'${L.id}')" aria-label="총 강수">강
        </div></div>`).join('')}
    </div>` : ''}
    <div class="set-sec">
      <p class="t">인강 추가</p>
      <div class="set-row"><input id="in-lec" placeholder="인강 이름"></div>
      <div class="set-row">
        <select id="sel-subj" aria-label="소속 과목">${S.subjects.slice().sort(bySort).map(s =>
          `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>
        <input id="in-lec-n" type="number" placeholder="총 강수" min="1" max="200" style="flex:0 0 84px">
        <button class="set-add" onclick="addLecSet()">추가</button>
      </div>
    </div>`;
  box.querySelectorAll('.swipe-wrap').forEach(w => bindSwipe(w, line => {
    const id = line.dataset.lecId;
    removeLectureLocal(id);
    del('lectures', id);
    renderSubjects(); renderLecSet();
  }));
}
function lecEdit(el, id){
  const L = lecById(id); const v = el.textContent.trim();
  if(L && v && v !== L.name){ L.name = v; upd('lectures', id, {name:v}); }
  renderSubjects(); renderLecSet();
}
function lecTotal(el, id){
  const n = parseInt(el.value);
  const L = lecById(id);
  if(!L) return;
  if(!(n >= 1)){ el.value = L.total_count; return; }
  L.total_count = n;
  upd('lectures', id, {total_count:n});
  // 초과분 삭제, 부족분 생성 (기존 체크 유지)
  const eps = S.episodes.filter(e => e.lecture_id === id);
  const over = eps.filter(e => e.no > n);
  if(over.length){
    S.episodes = S.episodes.filter(e => !(e.lecture_id === id && e.no > n));
    save(() => sb.from('lecture_episodes').delete().eq('lecture_id', id).gt('no', n));
  }
  const missing = [];
  for(let i = 1; i <= n; i++)
    if(!eps.some(e => e.no === i))
      missing.push({ id:uid(), user_id:S.user.id, lecture_id:id, no:i, done:false });
  if(missing.length){
    S.episodes.push(...missing.map(m => ({...m, created_at:new Date().toISOString()})));
    ins('lecture_episodes', missing);
  }
  renderSubjects(); renderLecSet();
}
function addLecSet(){
  const nm = $('#in-lec').value.trim();
  const n = parseInt($('#in-lec-n').value);
  const sid = $('#sel-subj').value;
  if(!nm || !(n >= 1) || !sid) return;
  const lec = { id:uid(), user_id:S.user.id, subject_id:sid, name:nm, total_count:n };
  S.lectures.push({...lec, created_at:new Date().toISOString()});
  ins('lectures', lec);
  const eps = Array.from({length:n}, (_,i) => ({ id:uid(), user_id:S.user.id, lecture_id:lec.id, no:i+1, done:false }));
  S.episodes.push(...eps.map(e => ({...e, created_at:new Date().toISOString()})));
  ins('lecture_episodes', eps);
  renderSubjects(); renderLecSet();
}

/* ═════════ 전체 렌더 ═════════ */
function renderAll(){
  renderHome();
  renderWeek();
  renderTimer();
  renderMonth();
  renderFilters();
  renderSubjects();
}

/* ═════════ 부트스트랩 ═════════ */
async function loadAll(){
  const [cats, subjects, todos, assignments, sessions, lectures, episodes, ddays] = await Promise.all([
    fetchAll('categories'), fetchAll('subjects'), fetchAll('todos'),
    fetchAll('assignments'), fetchAll('sessions', 'started_at'),
    fetchAll('lectures'), fetchAll('lecture_episodes'), fetchAll('ddays'),
  ]);
  Object.assign(S, {cats, subjects, todos, assignments, sessions, lectures, episodes, ddays});
}
function showLogin(msg){
  $('#app').style.display = 'none';
  $('#login').style.display = '';
  $('#login-err').textContent = msg || '';
}
async function loadAllRetry(){
  for(let i = 0; ; i++){
    try{ return await loadAll(); }
    catch(e){
      if(i >= 2) throw e;
      await new Promise(r => setTimeout(r, 1500)); // 테이블 생성 직후 스키마 캐시 반영 지연 대비
    }
  }
}
async function boot(){
  const { data:{ session } } = await sb.auth.getSession();
  if(!session){ showLogin(); return; }
  S.user = session.user;
  try{
    await loadAllRetry();
  }catch(e){
    console.error(e);
    const detail = e?.message || e?.error_description || String(e);
    showLogin(`데이터를 불러오지 못했어요 — ${detail}\n(로그인은 되어 있어요. 새로고침하면 다시 시도합니다)`);
    return;
  }
  $('#login').style.display = 'none';
  $('#app').style.display = '';
  $('#memo').innerText = S.user.user_metadata?.memo || '';
  restoreTimer();
  renderAll();
  goScreen('scr-home');
}

/* ═════════ 이벤트 바인딩 ═════════ */
$$('nav button').forEach(b => b.addEventListener('click', () => goScreen(b.dataset.scr)));
$('#go-timer').addEventListener('click', () => goScreen('scr-timer'));
$$('.dmini').forEach(b => b.addEventListener('click', openDdaySheet));
// 자유 메모: 유저 메타데이터에 저장 (blur 시)
$('#memo').addEventListener('blur', () => {
  const v = $('#memo').innerText.replace(/\n+$/,'').trim();
  if((S.user?.user_metadata?.memo || '') === v) return;
  S.user.user_metadata = {...(S.user.user_metadata || {}), memo: v};
  save(() => sb.auth.updateUser({ data: { memo: v } }));
});
$('#memo').addEventListener('keydown', e => { if(e.key === 'Escape') e.target.blur(); });
$('#btn-dday-close').addEventListener('click', closeDdaySheet);
$('#ovl-dday').addEventListener('click', e => { if(e.target === $('#ovl-dday')) closeDdaySheet(); });
$('#btn-sess-close').addEventListener('click', () => $('#ovl-sess').classList.remove('show'));
$('#ovl-sess').addEventListener('click', e => { if(e.target === $('#ovl-sess')) $('#ovl-sess').classList.remove('show'); });
$('#wk-prev').addEventListener('click', () => { if(UI.wkOffset > MIN_WK){ UI.wkOffset--; renderWeek(); } });
$('#wk-next').addEventListener('click', () => { if(UI.wkOffset < 0){ UI.wkOffset++; renderWeek(); } });
$('#mo-prev').addEventListener('click', () => { if(UI.moOffset > minMonthOffset()){ UI.moOffset--; UI.selDay = null; renderMonth(); } });
$('#mo-next').addEventListener('click', () => { if(UI.moOffset < 0){ UI.moOffset++; UI.selDay = null; renderMonth(); } });
$('#btn-start').addEventListener('click', onStartPause);
$('#btn-end').addEventListener('click', onEnd);
$('#btn-end-save').addEventListener('click', () => { $('#ovl-end').classList.remove('show'); endSave(); });
$('#btn-end-cancel').addEventListener('click', () => { $('#ovl-end').classList.remove('show'); endDiscard(); });
$('#ovl-end').addEventListener('click', e => { if(e.target === $('#ovl-end')) $('#ovl-end').classList.remove('show'); });
$('#btn-set').addEventListener('click', openSheet);
$('#btn-sheet-close').addEventListener('click', closeSheet);
$('#ovl').addEventListener('click', e => { if(e.target === $('#ovl')) closeSheet(); });
$('#tab-subj').addEventListener('click', () => setSheetTab('subj'));
$('#tab-lec').addEventListener('click', () => setSheetTab('lec'));
$('#btn-logout').addEventListener('click', async () => { await sb.auth.signOut(); location.reload(); });
$('#login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('#login-btn');
  btn.disabled = true; $('#login-err').textContent = '';
  const { error } = await sb.auth.signInWithPassword({
    email: $('#login-email').value.trim(),
    password: $('#login-pw').value,
  });
  btn.disabled = false;
  if(error){ $('#login-err').textContent = '이메일 또는 비밀번호가 맞지 않아요'; return; }
  boot();
});

/* 인라인 핸들러 노출 */
Object.assign(window, {
  toggleAsg, removeAsg, pickDay, setFilter, toggleCard, tdChk, tdEdit, tdGhost,
  toggleLec, toggleLecCard, lecTgl, catEdit, catGhost, subjEdit, subjGhost, cycleStatus,
  togglePick, pickColor, startSubjDrag, lecEdit, lecTotal, addLecSet,
  ddayEdit, ddayDate, ddayGhost, openSessSheet, sessTime,
});

/* 작은 할일 입력칸: 해당 할일 그룹에 포커스가 있을 때만 표시 */
{
  const list = $('#subj-list');
  let ghostHideTimer;
  list.addEventListener('focusin', e => {
    const g = e.target.closest('.todo-group');
    clearTimeout(ghostHideTimer);
    $$('#subj-list .todo-group.show').forEach(x => { if(x !== g) x.classList.remove('show'); });
    if(g) g.classList.add('show');
  });
  list.addEventListener('focusout', () => {
    ghostHideTimer = setTimeout(() =>
      $$('#subj-list .todo-group.show').forEach(x => x.classList.remove('show')), 250);
  });
}

boot();
