// ═══════════════════════════════════════════════════════
// 공부별 ⭐ Scriptable 위젯 (iPad/iPhone)
//
// 사용법:
//  1) App Store에서 Scriptable 설치
//  2) Scriptable → + → 이 파일 내용 전체 붙여넣기 → 이름 "공부별"
//  3) 아래 EMAIL / PASSWORD 에 앱 로그인 정보 입력
//  4) 홈 화면 길게 눌러 위젯 추가 → Scriptable 선택 → 크기 선택
//     → 위젯 길게 눌러 "위젯 편집" → Script: 공부별
//  크기별 화면: 소형=오늘 할일 / 중형=공부 요약 4카드 / 대형=월별 공부 달력
// ═══════════════════════════════════════════════════════

// ── 로그인 정보 (본인 기기에만 저장됩니다) ──
const EMAIL = "여기에 이메일";
const PASSWORD = "여기에 비밀번호";

const SB_URL = "https://guqfwrfnujrizryrhjtg.supabase.co";
const SB_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd1cWZ3cmZudWpyaXpyeXJoanRnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2ODEyNDEsImV4cCI6MjA5OTI1NzI0MX0.waCEIL3A23mHni7hQWiW_CiQggSdtGkqDFmQdk9dYDA";

// ── 앱과 동일한 디자인 토큰 ──
const C = {
  bg: "#FAF6F0", card: "#FFFFFF", ink: "#2B2440", sub: "#8C86A3",
  line: "#F1EDE6", ghost: "#C9C3B8",
  mintSoft: "#E4F6EC", lavSoft: "#EAE5FF", yellowSoft: "#FFF3D1", pinkSoft: "#FFE9EF",
  LV: ["#F1EDE6", "#FFF3D1", "#FFE9AE", "#FFD983", "#F2BE4E", "#F08A3C"],
};
const DOW = ["월", "화", "수", "목", "금", "토", "일"];

const pad = n => String(n).padStart(2, "0");
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dowIdx = d => (d.getDay() + 6) % 7;
function level(min) {
  if (min <= 0) return 0;
  if (min <= 120) return 1;
  if (min <= 240) return 2;
  if (min <= 360) return 3;
  if (min <= 480) return 4;
  return 5;
}
function fmtHM(min) {
  min = Math.floor(min);
  const h = Math.floor(min / 60), m = min % 60;
  return h ? `${h}시간 ${pad(m)}분` : `${m}분`;
}

// ── Supabase ──
async function getToken() {
  const KEY = "byeol_widget_token";
  if (Keychain.contains(KEY)) {
    try {
      const c = JSON.parse(Keychain.get(KEY));
      if (c.exp - 300 > Date.now() / 1000) return c.tok;
    } catch (e) { /* 재로그인 */ }
  }
  const req = new Request(`${SB_URL}/auth/v1/token?grant_type=password`);
  req.method = "POST";
  req.headers = { apikey: SB_ANON, "Content-Type": "application/json" };
  req.body = JSON.stringify({ email: EMAIL, password: PASSWORD });
  const r = await req.loadJSON();
  if (!r.access_token) throw new Error("로그인 실패 — 스크립트 상단의 이메일/비밀번호를 확인해주세요");
  const exp = r.expires_at || (Date.now() / 1000 + (r.expires_in || 3600) - 60);
  Keychain.set(KEY, JSON.stringify({ tok: r.access_token, exp }));
  return r.access_token;
}
async function api(path) {
  const tok = await getToken();
  const req = new Request(`${SB_URL}/rest/v1/${path}`);
  req.headers = { apikey: SB_ANON, Authorization: `Bearer ${tok}` };
  return await req.loadJSON();
}

// ── 세션 → 일별 분 맵 ──
function perDay(sessions) {
  const m = {};
  for (const s of sessions) {
    const d = ymd(new Date(s.started_at));
    m[d] = (m[d] || 0) + s.duration_sec / 60;
  }
  return m;
}
function currentStreak(per) {
  let d = new Date(), n = 0;
  if (!per[ymd(d)]) d.setDate(d.getDate() - 1);
  while (per[ymd(d)]) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
function longestStreak(per) {
  const days = Object.keys(per).sort();
  let max = 0, run = 0, prev = null;
  for (const d of days) {
    const p = prev ? new Date(prev) : null;
    if (p) p.setDate(p.getDate() + 1);
    run = (p && ymd(p) === d) ? run + 1 : 1;
    if (run > max) max = run;
    prev = d;
  }
  return max;
}

// ═══ 소형: 오늘 할일 ═══
async function todoWidget() {
  const today = ymd(new Date());
  const rows = await api(
    `assignments?select=done,title,sort_order,created_at,todo:todos(text,subject:subjects(color))` +
    `&date=eq.${today}&order=sort_order.asc,created_at.asc`);
  const w = new ListWidget();
  w.backgroundColor = new Color(C.card);
  w.setPadding(12, 14, 12, 12);
  w.addSpacer(); // 위아래 유동 스페이서 → 내용 세로 가운데 정렬
  const t = w.addText("오늘의 할일");
  t.font = Font.boldRoundedSystemFont(11);
  t.textColor = new Color(C.ink, 0.55);
  w.addSpacer(7);
  if (!rows.length) {
    const e = w.addText("오늘의 할일을 추가해보세요");
    e.font = Font.mediumSystemFont(11);
    e.textColor = new Color(C.ghost);
  } else {
    for (const a of rows.slice(0, 5)) {
      const line = w.addStack();
      line.centerAlignContent();
      const dot = line.addText(a.done ? "✓" : "●");
      dot.font = Font.boldSystemFont(a.done ? 11 : 8);
      dot.textColor = a.done ? new Color(C.sub) : new Color(a.todo?.subject?.color || "#D8D2C6");
      line.addSpacer(6);
      const txt = line.addText(a.todo?.text || a.title || "");
      txt.font = Font.mediumSystemFont(12);
      txt.textColor = a.done ? new Color(C.sub) : new Color(C.ink);
      txt.lineLimit = 1;
      w.addSpacer(5);
    }
    if (rows.length > 5) {
      const more = w.addText(`+${rows.length - 5}`);
      more.font = Font.mediumSystemFont(10);
      more.textColor = new Color(C.ghost);
    }
  }
  w.addSpacer();
  return w;
}

// ═══ 중형: 공부 요약 4카드 ═══
async function statsWidget() {
  const sessions = await api(`sessions?select=started_at,duration_sec&order=started_at.asc`);
  const per = perDay(sessions);
  const today = ymd(new Date());
  const todayMin = per[today] || 0;
  let best = 0;
  for (const k in per) if (per[k] > best) best = per[k];
  const cur = currentStreak(per);
  const cards = [
    { num: fmtHM(todayMin), lbl: "오늘 공부한 시간", bg: C.mintSoft },
    { num: cur > 0 ? `🔥 ${cur}일` : "0일", lbl: "연속 공부", bg: C.lavSoft },
    { num: fmtHM(best), lbl: "최장 공부시간", bg: C.yellowSoft },
    { num: `${longestStreak(per)}일`, lbl: "최장 연속 공부", bg: C.pinkSoft },
  ];
  const w = new ListWidget();
  w.backgroundColor = new Color(C.bg);
  w.setPadding(12, 12, 12, 12);
  for (let r = 0; r < 2; r++) {
    const row = w.addStack();
    row.layoutHorizontally();
    for (let c = 0; c < 2; c++) {
      const card = cards[r * 2 + c];
      const s = row.addStack();
      s.layoutVertically();
      s.backgroundColor = new Color(card.bg);
      s.cornerRadius = 16;
      s.setPadding(10, 12, 10, 12);
      s.addSpacer(); // 유동 스페이서 → 카드가 위젯 높이/너비를 나눠 갖고 내용은 가운데
      const numRow = s.addStack();
      numRow.addSpacer();
      const num = numRow.addText(card.num);
      num.font = Font.boldRoundedSystemFont(19);
      num.textColor = new Color(C.ink);
      num.lineLimit = 1;
      num.minimumScaleFactor = 0.5;
      numRow.addSpacer();
      s.addSpacer(3);
      const lblRow = s.addStack();
      lblRow.addSpacer();
      const lbl = lblRow.addText(card.lbl);
      lbl.font = Font.mediumSystemFont(11);
      lbl.textColor = new Color(C.sub);
      lblRow.addSpacer();
      s.addSpacer();
      if (c === 0) row.addSpacer(10);
    }
    if (r === 0) w.addSpacer(10);
  }
  return w;
}

// ═══ 대형: 공부 달력 (홈 히트맵과 같은 형식) ═══
async function calendarWidget() {
  const now = new Date();
  const y = now.getFullYear(), mo = now.getMonth();
  const from = new Date(y, mo, 1).toISOString();
  const to = new Date(y, mo + 1, 1).toISOString();
  const sessions = await api(
    `sessions?select=started_at,duration_sec&started_at=gte.${from}&started_at=lt.${to}`);
  const per = perDay(sessions);
  let totalMin = 0, studyDays = 0;
  for (const k in per) { totalMin += per[k]; if (per[k] > 0) studyDays++; }

  const w = new ListWidget();
  w.backgroundColor = new Color(C.card);
  w.setPadding(16, 16, 13, 16);

  const head = w.addStack();
  head.centerAlignContent();
  const title = head.addText(`${mo + 1}월 공부 달력`);
  title.font = Font.boldRoundedSystemFont(16);
  title.textColor = new Color(C.ink);
  head.addSpacer();
  const tot = head.addText(`총 ${fmtHM(totalMin)}`);
  tot.font = Font.mediumSystemFont(12);
  tot.textColor = new Color(C.sub);
  w.addSpacer(12);

  const days = new Date(y, mo + 1, 0).getDate();
  const blanks = dowIdx(new Date(y, mo, 1));
  const cells = [];
  for (let b = 0; b < blanks; b++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(d);
  while (cells.length % 7) cells.push(null);

  // 달력 그리드를 이미지로 그려서 칸이 항상 정사각형을 유지 (가로에 맞춰 비율 고정 축소/확대)
  const PX = 90, GAPX = 10, RAD = 20; // 고해상도 캔버스 기준 px
  const rowsN = cells.length / 7;
  const ctx = new DrawContext();
  ctx.opaque = false;
  ctx.respectScreenScale = true;
  ctx.size = new Size(7 * PX + 6 * GAPX, rowsN * PX + (rowsN - 1) * GAPX);
  ctx.setTextAlignedCenter();
  const todayStr = ymd(now);
  for (let i = 0; i < cells.length; i++) {
    const d = cells[i];
    if (d === null) continue;
    const x = (i % 7) * (PX + GAPX), yTop = Math.floor(i / 7) * (PX + GAPX);
    const ds = ymd(new Date(y, mo, d));
    if (ds > todayStr) {
      ctx.setFont(Font.mediumSystemFont(30));
      ctx.setTextColor(new Color(C.ghost));
      ctx.drawTextInRect(String(d), new Rect(x, yTop + (PX - 36) / 2, PX, 36));
    } else {
      const p = new Path();
      p.addRoundedRect(new Rect(x, yTop, PX, PX), RAD, RAD);
      ctx.addPath(p);
      ctx.setFillColor(new Color(C.LV[level(per[ds] || 0)]));
      ctx.fillPath();
    }
  }
  const img = w.addImage(ctx.getImage());
  img.applyFittingContentMode();
  img.centerAlignImage();

  w.addSpacer();
  const foot = w.addStack();
  foot.addSpacer();
  const f = foot.addText(`${studyDays}일 공부 ${now.getDate() - studyDays}일 놀기`);
  f.font = Font.mediumSystemFont(12);
  f.textColor = new Color(C.sub);
  return w;
}

// ═══ 실행 ═══
async function build() {
  const fam = args.widgetParameter || config.widgetFamily || "large";
  if (fam.includes("small") || fam === "할일") return await todoWidget();
  if (fam.includes("medium") || fam === "요약") return await statsWidget();
  return await calendarWidget();
}

let widget;
try {
  widget = await build();
} catch (e) {
  widget = new ListWidget();
  widget.backgroundColor = new Color(C.bg);
  widget.setPadding(16, 16, 16, 16);
  const t = widget.addText(String(e.message || e));
  t.font = Font.mediumSystemFont(11);
  t.textColor = new Color("#C4536A");
}
widget.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);

if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  // 앱에서 실행하면 대형 미리보기
  await widget.presentLarge();
}
Script.complete();
