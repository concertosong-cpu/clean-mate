// localStorage가 막혀있는 환경(파일로 직접 열었을 때 등)에서도 앱이 죽지 않도록 안전하게 감싸는 래퍼.
// 실패하면 메모리에만 저장 (새로고침하면 사라지지만, 최소한 앱은 정상 작동함)
const __memoryStore = {};
function lsGet(key){
  try { return localStorage.getItem(key); }
  catch(e){ return (key in __memoryStore) ? __memoryStore[key] : null; }
}
function lsSet(key, value){
  try { localStorage.setItem(key, value); }
  catch(e){ __memoryStore[key] = value; }
}
function lsRemove(key){
  try { localStorage.removeItem(key); }
  catch(e){ delete __memoryStore[key]; }
}

// ===== 백엔드 연결 (Supabase) - 1단계: 활동 로그 / 근태 요청만 실제로 여러 기기에서 공유됨 =====
// 지금은 실 로그인 인증이 없어서, 공개 키로 누구나 읽고 쓸 수 있게 열어둔 상태예요 (내부 소규모 사용 기준 임시 조치).
// 나머지 기능(캘린더/체크리스트/직원정보 등)은 다음 단계에서 순차적으로 이 방식으로 옮길 예정입니다.
const SUPABASE_URL = "https://hhjxbqcpzccadtptbdqf.supabase.co";
const SUPABASE_KEY = "sb_publishable_UQzy0xJ92YZwxi51D_iU9Q_QyJ48E8B";
let sb = null;
try {
  if (typeof window !== "undefined" && window.supabase && window.supabase.createClient){
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  }
} catch(e){ console.warn("Supabase init failed - running on local storage only.", e); }

// 로그인한 크루 — 로그인 화면에서 이름을 입력하면 저장됨 (개인별 PIN 인증 전 단계)
let MY_NAME = lsGet("my-name") || "";
let MY_SITE = lsGet("my-site") || "";


// =====================================================================
// 데이터 계층: 로컬(폰)에 먼저 저장하고, 서버(Supabase)가 있으면 같이 저장/동기화
// =====================================================================
// --- 근무지(사이트) ---
function loadSites(){ return JSON.parse(lsGet("sites") || "[]"); }
function saveSites(list){ lsSet("sites", JSON.stringify(list)); }
function siteNames(){ return loadSites().map(x => x.name); }
function siteCoords(name){ const st = loadSites().find(x => x.name === name); return (st && st.lat && st.lng) ? { lat: st.lat, lng: st.lng } : null; }
function upsertSite(site){
  const list = loadSites(); const i = list.findIndex(x => x.name === site.name);
  if (i >= 0) list[i] = { ...list[i], ...site }; else list.push(site);
  saveSites(list);
  if (sb) sb.from("sites").upsert({ name: site.name, address: site.address || null, type: site.type || null, lat: site.lat || null, lng: site.lng || null, note: site.note || null }, { onConflict: "name" })
    .then(({ error }) => { if (error) console.warn("sites server save failed:", error.message); });
}
function syncSitesFromServer(done){
  if (!sb){ if (done) done(); return; }
  sb.from("sites").select("*").then(({ data, error }) => {
    if (!error && data && data.length) saveSites(data.map(r => ({ name: r.name, address: r.address, type: r.type, lat: r.lat, lng: r.lng, note: r.note })));
    if (done) done();
  });
}
// --- 크루 ---
let crewList = JSON.parse(lsGet("crew-list") || "[]");
function saveCrew(){ lsSet("crew-list", JSON.stringify(crewList)); }
function upsertCrew(c){
  const i = crewList.findIndex(x => x.name === c.name);
  if (i >= 0) crewList[i] = { ...crewList[i], ...c }; else crewList.push({ status: "off", ...c });
  saveCrew();
  if (sb) sb.from("crew").upsert({ name: c.name, phone: c.phone || null, address: c.address || null, site: c.site || null, start_date: c.startDate || null, active: c.active !== false }, { onConflict: "name" })
    .then(({ error }) => { if (error) console.warn("crew server save failed:", error.message); });
}
function syncCrewFromServer(done){
  if (!sb){ if (done) done(); return; }
  sb.from("crew").select("*").eq("active", true).then(({ data, error }) => {
    if (!error && data){
      data.forEach(r => {
        const i = crewList.findIndex(x => x.name === r.name);
        const row = { name: r.name, phone: r.phone, address: r.address, site: r.site, startDate: r.start_date };
        if (i >= 0) crewList[i] = { ...crewList[i], ...row }; else crewList.push({ status: "off", ...row });
      });
      saveCrew();
    }
    if (done) done();
  });
}
// --- 공지 핀 ---
function loadNotice(){ return JSON.parse(lsGet("notice") || "null"); }
function saveNotice(n){
  lsSet("notice", JSON.stringify(n));
  if (sb){
    sb.from("notices").update({ active: false }).eq("active", true).then(() => {
      if (n && n.text) sb.from("notices").insert({ text: n.text, author: n.by }).then(({ error }) => { if (error) console.warn("notices server save failed:", error.message); });
    });
  }
}
function syncNoticeFromServer(done){
  if (!sb){ if (done) done(); return; }
  sb.from("notices").select("*").eq("active", true).order("created_at", { ascending: false }).limit(1).then(({ data, error }) => {
    if (!error && data){ lsSet("notice", JSON.stringify(data.length ? { text: data[0].text, by: data[0].author, at: data[0].created_at } : null)); }
    if (done) done();
  });
}
// --- 출퇴근 기록 ---
// 한 건 = { crew, site, type:'in'|'out', at(ISO), lat, lng, dist }
function loadClockRecords(){ return JSON.parse(lsGet("clock-records") || "[]"); }
function saveClockRecord(rec){
  const list = loadClockRecords(); list.push(rec); lsSet("clock-records", JSON.stringify(list));
  const queue = JSON.parse(lsGet("pending-sync") || "[]"); queue.push(rec); lsSet("pending-sync", JSON.stringify(queue));
  flushPendingSync();
}
function flushPendingSync(){
  if (!sb || !navigator.onLine) return;
  const queue = JSON.parse(lsGet("pending-sync") || "[]");
  if (queue.length === 0) return;
  const rows = queue.filter(r => r.type === "in" || r.type === "out").map(r => ({ crew_name: r.crew, site: r.site, type: r.type, at: r.at, lat: r.lat || null, lng: r.lng || null, distance_m: r.dist != null ? Math.round(r.dist) : null }));
  lsSet("pending-sync", "[]");
  if (!rows.length) return;
  sb.from("clock_records").insert(rows).then(({ error }) => {
    if (error){ console.warn("clock_records server save failed — will retry:", error.message); const q = JSON.parse(lsGet("pending-sync") || "[]"); lsSet("pending-sync", JSON.stringify(q.concat(queue))); }
  });
}
window.addEventListener("online", flushPendingSync);
// 서버의 기록을 받아서 로컬과 합침 (같은 사람·같은 시각은 하나로)
function syncClockRecordsFromServer(days, done){
  if (!sb){ if (done) done(); return; }
  const since = new Date(Date.now() - days * 86400000).toISOString();
  sb.from("clock_records").select("*").gte("at", since).order("at", { ascending: true }).then(({ data, error }) => {
    if (!error && data){
      const local = loadClockRecords();
      const key = r => r.crew + "|" + r.type + "|" + new Date(r.at).toISOString().slice(0, 16);
      const seen = new Set(local.map(key));
      data.forEach(r => { const rec = { crew: r.crew_name, site: r.site, type: r.type, at: r.at, lat: r.lat, lng: r.lng, dist: r.distance_m }; if (!seen.has(key(rec))){ local.push(rec); seen.add(key(rec)); } });
      local.sort((a, b) => new Date(a.at) - new Date(b.at));
      lsSet("clock-records", JSON.stringify(local));
    }
    if (done) done();
  });
}
// 기록에서 "지금 근무중" 계산: 오늘 마지막 기록이 'in'인 사람
function workingNow(){
  const today = formatDate(new Date());
  const last = {};
  loadClockRecords().forEach(r => { if (formatDate(new Date(r.at)) === today) last[r.crew] = r; });
  return Object.values(last).filter(r => r.type === "in").map(r => ({ name: r.crew, site: r.site, clockIn: new Date(r.at).toTimeString().slice(0, 5) }));
}
// 특정 크루의 월별 근무시간(시간 단위)과 근무한 날짜 목록
function hoursFor(crew, year, month){
  const recs = loadClockRecords().filter(r => r.crew === crew).sort((a, b) => new Date(a.at) - new Date(b.at));
  let open = null, hours = 0; const days = {};
  recs.forEach(r => {
    const d = new Date(r.at);
    if (r.type === "in") open = d;
    else if (r.type === "out" && open){
      if (open.getFullYear() === year && open.getMonth() === month){
        const h = Math.min(16, (d - open) / 3600000); hours += h;
        const day = open.getDate(); days[day] = (days[day] || 0) + h;
      }
      open = null;
    }
  });
  return { hours: Math.round(hours * 10) / 10, days };
}

let langIsKo = (lsGet("app-lang") || "en") === "ko"; // 기본 영어
// 미리보기 모드: 파일로 직접 열었거나 Claude 미리보기 주소일 때. 서버·GPS가 막힌 환경이라 확인용으로만 씀
const IS_PREVIEW = location.protocol === "file:" || /claude|localhost|127\.0\.0\.1/.test(location.hostname);
function T(key){ const d = langIsKo ? i18n.ko : i18n.en; return d[key] || i18n.ko[key] || key; }
const i18n = {
  ko: {
    since:"시작", working:"근무중", offToday:"오늘 휴무", noSiteTitle:"배정된 근무지가 없습니다", noSiteMsg:"관리자가 근무지를 배정하면 출근할 수 있습니다. 메뉴 → 설정에서 직접 선택할 수도 있습니다.",
    clockInQ:"출근하시겠습니까?", clockInBtn:"출근", clockOutQ:"퇴근하시겠습니까?", clockOutBtn:"퇴근", arrived:"도착 확인", siteNoCoords:"사이트 좌표 미등록",
    farTitle:"회사와 거리가 멉니다", farMsg:"현재 위치가 {site}에서 {dist} 떨어져 있습니다. 사이트 반경 {m}m 이내에서 출근할 수 있습니다.",
    gpsOn:"위치 확인 사용 중 · 사이트 반경 100m 이내 출근 가능", gpsPrompt:"위치 권한 필요 · 탭하여 허용", gpsDenied:"위치 사용 안 함 · 탭하여 설정 방법 확인", gpsUnsupported:"이 브라우저는 위치 기능을 지원하지 않습니다", gpsChecking:"위치 확인 중…",
    pillOn:"켜짐", pillPrompt:"탭해서 켜기", pillOff:"꺼짐", pillNo:"지원 안 됨",
    todaySite:"오늘 근무지", noSiteShort:"미배정", monthTotal:"이번 달 누적", greetingHi:"안녕하세요, {name}님", greetingNoName:"안녕하세요",
    beforeWork:"근무 전", workingStatus:"근무중", noRecord:"아직 출근 기록 없음", recordedIn:"출근 기록됨", recordedOut:"퇴근 기록됨",
    monthHours:"이번 달 근무 시간", lastMonth:"지난달", workDays:"근무일", otDays:"오버타임", days:"일",
    legendWork:"근무", legendOT:"오버타임", legendNote:"메모", legendIssue:"이슈", calHint:"날짜를 선택하면 해당일의 근무 기록과 메모가 표시됩니다. 이슈가 등록된 날짜는 ! 로 표시됩니다.",
    noWork:"근무 없음", work:"근무", companyNotice:"회사 공지", memo:"메모", issue:"이슈", sharedNote:"동료·관리자 공유", editMemo:"메모 수정", addMemo:"+ 메모 남기기",
    dow:["일","월","화","수","목","금","토"], monthNames:["1월","2월","3월","4월","5월","6월","7월","8월","9월","10월","11월","12월"],
    reqTitle:"근태 신청", reqOvertime:"오버타임", reqLeave:"휴가", reqSick:"병가", reqCover:"대체근무", reqDate:"날짜", reqHours:"시간", reqWho:"대신 근무할 동료", reqNote:"사유 (선택)", reqSend:"신청 보내기", reqSent:"신청이 접수되었습니다. 관리자 승인 후 반영됩니다.",
    checklistLink:"사이트 체크리스트 보기 →", noJobs:"금일 배정된 근무지가 없습니다", jobRegular:"정기 청소",
    yearsTitle:"연차", monthsSuffix:"개월차", yearsSuffix:"년차", veteran:"베테랑",
    logoutQ:"로그아웃 하시겠습니까?", noticeLabel:"공지", coinsShort:"P",
    loginTitle:"이름과 PIN 4자리를 입력하십시오", qCalendar:"캘린더", qCheck:"체크", qRequest:"근태 신청", qChat:"관리자 채팅",
    clockedInMsg:"출근이 기록되었습니다.", clockedOutMsg:"퇴근이 기록되었습니다. 수고하셨습니다.", forgotPin:"PIN 분실 안내", changePin:"PIN 변경", curPin:"현재 PIN", newPin:"새 PIN 4자리", newPin2:"새 PIN 확인", save:"저장", close:"닫기"
  },
  en: {
    since:"since", working:"On shift", offToday:"Off today", noSiteTitle:"No site assigned yet", noSiteMsg:"Clock-in becomes available once a manager assigns your site. A site can also be selected in Menu → Settings.",
    clockInQ:"Do you want to clock in?", clockInBtn:"Clock in", clockOutQ:"Do you want to clock out?", clockOutBtn:"Clock out", arrived:"reached", siteNoCoords:"site has no GPS pin yet",
    farTitle:"Too far from the site", farMsg:"You are {dist} from {site}. Please get within {m}m of the site and press Clock in again.",
    gpsOn:"Location on · clock in within 100m of site", gpsPrompt:"Location needed — tap to enable", gpsDenied:"Location off — tap to see how to enable", gpsUnsupported:"This browser does not support location services", gpsChecking:"Checking location…",
    pillOn:"On", pillPrompt:"Tap to enable", pillOff:"Off", pillNo:"Unsupported",
    todaySite:"Today's site", noSiteShort:"Unassigned", monthTotal:"This month", greetingHi:"Hi, {name}", greetingNoName:"Hi there",
    beforeWork:"Not clocked in", workingStatus:"On shift", noRecord:"No clock-in yet", recordedIn:"clocked in", recordedOut:"clocked out",
    monthHours:"Hours this month", lastMonth:"Last month", workDays:"Days worked", otDays:"Overtime", days:"d",
    legendWork:"Worked", legendOT:"Overtime", legendNote:"Note", legendIssue:"Issue", calHint:"Tap a date to see that day's shift and notes below. Days with an issue show a ! mark.",
    noWork:"No shift", work:"Shift", companyNotice:"Company notice", memo:"Note", issue:"Issue", sharedNote:"shared with team & managers", editMemo:"Edit note", addMemo:"+ Add note",
    dow:["Sun","Mon","Tue","Wed","Thu","Fri","Sat"], monthNames:["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"],
    reqTitle:"Request", reqOvertime:"Overtime", reqLeave:"Leave", reqSick:"Sick leave", reqCover:"Cover", reqDate:"Date", reqHours:"Hours", reqWho:"Colleague to cover", reqNote:"Reason (optional)", reqSend:"Send request", reqSent:"Sent. It applies once a manager approves.",
    checklistLink:"Site checklist →", noJobs:"No site assigned for today", jobRegular:"Regular clean",
    yearsTitle:"Tenure", monthsSuffix:" mo", yearsSuffix:" yr", veteran:"veteran",
    logoutQ:"Log out?", noticeLabel:"Notice", coinsShort:"P",
    loginTitle:"Enter your name and 4-digit PIN", qCalendar:"Calendar", qCheck:"Checklist", qRequest:"Request", qChat:"Chat",
    clockedInMsg:"Clock-in recorded.", clockedOutMsg:"Clock-out recorded. Thank you for today.", forgotPin:"PIN assistance", changePin:"Change PIN", curPin:"Current PIN", newPin:"New 4-digit PIN", newPin2:"Confirm new PIN", save:"Save", close:"Close"
  },
  _ko: {
    appName: "에릭네 청소가게",
    startEmployee: "크루로 시작하기",
    startAdmin: "관리자로 시작하기",
    greeting: "안녕하세요",
    greetingSub: "금일 근무 현황",
    beforeWork: "근무 전",
    clockIn: "출근하기", clockOut: "퇴근하기",
    firstVisit: " 오늘 첫 방문지: Bondi 자택",
    onTheWay: "이동중 →",
    schedule: "스케줄",
    overtime: "오버타임",
    todaySchedule: "오늘 일정",
    calendarTitle: "캘린더",
    registerTitle: "등록",
    btnOvertime: "오버타임 등록",
    btnLeave: "휴가·병가 신청",
    btnSubstitute: "대체근무 신청",
    btnColleague: "동료 스케줄 보기",
    myCharacter: "내 프로필",
    tabHat: "모자",
    tabTool: "청소도구",
    tabBg: "배경",
    toolItems: "청소도구 아이템 (5종)",
    adminHome: "관리자 홈",
    adminApprovals: "승인 대기",
    languageLabel: "언어",
    timezoneLabel: "근무지 시간대 (Time zone)",
    changePassword: "비밀번호 변경",
    logout: "로그아웃",
    groupAttendance: "출퇴근 및 근태",
    attendanceRequest: "근태 신청 (휴가·오버타임·대체근무)",
    myClockHistory: "내 출퇴근 이력",
    leaveSick: "휴가·병가",
    substitute: "대체근무",
    colleagueSchedule: "동료 스케줄",
    groupMyInfo: "내 정보",
    sos: "SOS",
    settingsRow: "설정 (언어·시간대)",
    groupContact: "문의",
    chatWithAdmin: "관리자와 채팅",
    chatTitle: "관리자와 채팅",
    menuTitle: "메뉴",
    settingsTitle: "설정",
    statusDone: "완료",
    statusWait: "대기"
  },
  _en: {
    appName: "CleanMate",
    startEmployee: "Start as staff",
    startAdmin: "Start as admin",
    greeting: "Hello",
    greetingSub: "Today's work status",
    beforeWork: "Not clocked in",
    clockIn: "Clock in", clockOut: "Clock out",
    firstVisit: " First stop today: Bondi house",
    onTheWay: "On the way →",
    schedule: "Schedule",
    overtime: "Overtime",
    todaySchedule: "Today's jobs",
    calendarTitle: "Calendar",
    registerTitle: "Requests",
    btnOvertime: "Log overtime",
    btnLeave: "Leave / sick leave",
    btnSubstitute: "Request cover",
    btnColleague: "See team schedule",
    myCharacter: "My profile",
    tabHat: "Hats",
    tabTool: "Cleaning gear",
    tabBg: "Background",
    toolItems: "Cleaning gear (5 items)",
    adminHome: "Admin home",
    adminApprovals: "Pending approvals",
    languageLabel: "Language",
    timezoneLabel: "Work site time zone",
    changePassword: "Change password",
    logout: "Log out",
    groupAttendance: "Attendance",
    attendanceRequest: "Requests (leave · overtime · cover)",
    myClockHistory: "My clock-in history",
    leaveSick: "Leave / sick leave",
    substitute: "Request cover",
    colleagueSchedule: "Team schedule",
    groupMyInfo: "My info",
    sos: "SOS",
    settingsRow: "Settings (language · time zone)",
    groupContact: "Contact",
    chatWithAdmin: "Chat with admin",
    chatTitle: "Chat with admin",
    menuTitle: "Menu",
    settingsTitle: "Settings",
    statusDone: "Done",
    statusWait: "Pending"
  }
};

Object.assign(i18n.ko, i18n._ko); Object.assign(i18n.en, i18n._en);

// ===== v5.1 전체 번역 키 (모든 화면 영어 기본 + 한국어 옵션) =====
Object.assign(i18n.ko, {
  loginSub:"출퇴근 기록과 현장 체크리스트를 하나의 시스템에서 관리합니다.", phName:"이름", loginBtn:"로그인",
  adminLoginSub:"관리자 및 매니저 전용 화면", adminPwTitle:"관리자 비밀번호", forgotPw:"비밀번호 분실 안내", backLabel:"← 뒤로",
  joinNote:"초대 링크로 접속한 경우 회사코드가 자동 입력됩니다. 아래 정보를 입력하십시오.",
  genderLabel:"성별", genderF:"여성", genderM:"남성", genderX:"선택 안 함",
  phBirth:"생년월일", phAddress:"거주지 (예: Bondi, NSW)", phAddress2:"거주지", phPhone:"핸드폰번호", phGuardian:"보호자 연락처 (선택)",
  startDateLabel:"근무 시작일", phJoinPin:"사용할 PIN 4자리", phJoinPin2:"PIN 확인", joinSubmit:"가입 완료",
  offlineNote:"출퇴근 기록은 기기에 우선 저장되며, 연결이 복구되면 자동으로 전송됩니다.",
  phChat:"메시지 입력...", sendBtn:"전송", chatEmpty:"관리자에게 전달할 내용을 입력하십시오",
  mySiteLabel:"내 근무지", gpsSectionLabel:"GPS 출근 확인", locPermLabel:"위치 권한",
  gpsSettingsNote:"출근은 사이트 반경 100m 이내에서만 가능합니다. 위치 권한이 꺼져 있으면 이 화면에서 허용할 수 있습니다.",
  tzSyd:"시드니 (NSW/VIC/QLD)", tzPer:"퍼스 (WA)", tzAde:"애들레이드 (SA)", tzBri:"브리즈번 (QLD)",
  tzPreviewLabel:"현재 근무지 기준 시각:", accountLabel:"계정",
  profileTitle:"내 프로필", profileInfoLabel:"프로필 정보", profileSaved:"프로필이 저장되었습니다.",
  colleagueSheetTitle:"이번 주 동료 스케줄", colleagueNote:"동일 근무지의 동료만 표시됩니다",
  noMatesMsg:"해당 근무지에 배정된 다른 동료가 없습니다",
  statApprovals:"승인 대기", statJoins:"가입대기", statWorking:"근무중", workingNowLabel:"지금 근무중인 크루",
  allSites:"전체 사이트", scopeSites:"담당 사이트: ",
  roleOwner:"최고관리자", roleSiteowner:"작은사장님", roleManager:"매니저", roleSupervisor:"슈퍼바이저", previewSuffix:" (미리보기)",
  rankCeo:"대표", rankCoCeo:"공동대표", managersTitle:"매니저", supervisorsTitle:"슈퍼바이저", ownersTitle:"최고관리자",
  noManagers:"지정된 매니저가 없습니다", noSupervisors:"지정된 슈퍼바이저가 없습니다",
  previewHint:"관리자 홈의 직급 배지를 선택하면 직급별 화면을 미리 볼 수 있습니다 (최고관리자 → 작은사장님 → 매니저 → 슈퍼바이저).",
  adminMenuNote:"승인 대기, 가입 대기, 크루 현황은 홈 화면의 지표를 선택하여 확인합니다.",
  groupOps:"업무 관리", noticePinRow:"공지 핀 (크루 홈 맨 위)", checklistAdminRow:"체크리스트 관리", sitesRow:"근무지 (GPS 등록)", activityLogRow:"활동 로그",
  groupData:"자료 정리", exportAllRow:"전체 자료 엑셀로 내보내기",
  exportAllNote:"크루 현황, 근태 요청, 가입 신청, 체크리스트, 활동 로그가 시트별로 구성된 엑셀 파일 1개로 저장됩니다.",
  adminPwRow:"관리자 비밀번호 변경",
  approvalsTitle:"승인 대기", excelBtn:"엑셀",
  laborNote:"호주 근로기준: 5시간 이상 연속 근무 시 휴게시간이 필요하며, 주 근무시간을 초과하는 신청은 신중히 검토하십시오. (관리자 전용 안내)",
  joinAdminTitle:"가입승인", tabPending:"가입대기", tabRejected:"거절 이력 (1년 보관)",
  crewStatusTitle:"크루 현황", addCrewBtn:"+ 크루 추가", inviteBtn:"문자로 초대",
  sitesTitle:"근무지",
  sitesNote:"근무지를 등록하고 GPS 좌표를 입력하면 크루는 해당 지점 반경 100m 이내에서만 출근할 수 있습니다. 크루 배정은 크루 현황에서 변경합니다.",
  addSiteBtn:"+ 새 근무지 등록",
  adminCalTitle:"전체 캘린더", crewShift:"크루 근무", legBusiness:"사업·미팅", legPersonal:"개인", tabAll:"전체",
  adminCalHint:"날짜를 선택하면 해당일의 일정과 크루가 등록한 메모 및 이슈가 표시됩니다.", addEventBtn:"+ 일정 추가",
  activityLogTitle:"활동 로그", activityLogNote:"PIN 초기화, 초대 문자 발송 등 주요 작업의 수행자와 시각이 기록됩니다.",
  noActivity:"아직 기록된 활동이 없습니다",
  checklistAdminTitle:"체크리스트 관리",
  checklistAdminNote:"근무지별·요일별 체크리스트를 등록하면 크루가 홈 화면의 근무 카드에서 확인할 수 있습니다.",
  siteLabel:"사이트", dayLabel:"요일", itemsLabel:"항목", addItemBtn:"+ 항목 추가",
  noItems:"등록된 항목이 없습니다", deleteLabel:"삭제",
  noSiteTitle2:"등록된 근무지 없음", noSiteMsg2:"메뉴 → 근무지에서 근무지를 먼저 등록하십시오.",
  addItemTitle:"{site} · {day} 항목 추가", promptItemPh:"예: 주방 싱크대 광내기",
  checklistSheetTitle:"{site} 체크리스트 · {day}",
  noChecklistMsg:"해당 근무지에 등록된 체크리스트가 없습니다. 관리자에게 문의하십시오.",
  eventSheetTitle:"일정 추가", phEventTitle:"제목 (예: 거래처 미팅, Bondi 신규 계약 방문)", typeLabel:"종류",
  audienceLabel:"공개 범위", audOwner:"작은사장님만", audManager:"매니저까지", audCrew:"크루 전체",
  phNote2:"예: 3층 창고 열쇠 불일치 / 고객 카펫 추가 요청",
  issueToggleLabel:"이슈로 표시 (문제·사고·클레임, 관리자에게 즉시 공유)", deleteNoteBtn:"메모 삭제",
  sitePickerTitle:"내 근무지 고르기",
  siteSheetTitle:"근무지 등록", phSiteName:"이름 (예: Coles Bondi Junction)", phSiteAddress:"주소",
  typeCommercial:"상업시설", typeHouse:"주택", gpsCoordsLabel:"GPS 좌표 (출근 기준점)", phLat:"위도", phLng:"경도",
  useHereBtn:"현재 위치 사용 (현장에서 실행)", phSiteNote:"비고 (열쇠 위치, 알람 코드, 주의사항)",
  crewSheetTitle:"크루 정보", phCrewName:"이름 (로그인 시 사용하는 이름과 동일하게)", phCrewAddress:"거주지 주소",
  assignedSiteLabel:"배정 사이트", deleteCrewBtn:"크루 목록에서 삭제",
  noticeSheetTitle:"공지 핀", phNotice:"예: 금요일 급여 지급일이 토요일로 변경되었습니다",
  noticeSheetNote:"크루 홈 상단에 고정 표시됩니다. 내용을 비우고 저장하면 해제됩니다.",
  noticePosted:"공지가 크루 홈 상단에 등록되었습니다", noticeRemoved:"공지가 해제되었습니다",
  apwTitle:"관리자 비밀번호 변경", curPw:"현재 비밀번호", newPw:"새 비밀번호 (6자 이상)", newPw2:"새 비밀번호 확인",
  promptTitle:"입력", ok:"확인", cancel:"취소", noticeTitle:"안내",
  inviteSheetTitle:"문자로 크루 초대", phInvitePhone:"초대할 크루 전화번호", sendInviteBtn:"초대 문자 보내기",
  stPending:"대기", stApproved:"승인", stRejected:"거절", approveBtn:"승인", rejectBtn:"거절",
  nameHpRequired:"이름과 연락처는 필수 입력 항목입니다.", pinTwice:"PIN 4자리를 동일하게 두 번 입력하십시오.",
  joinReceivedMsg:"{name}님의 가입 신청이 접수되었습니다. 관리자 승인 후 로그인할 수 있습니다.",
  noBirth:"생년월일 미입력", noAddr:"거주지 미입력", startHope:"근무시작 희망일",
  noJoinPending:"대기중인 가입 신청이 없습니다", rejectedLabel:"거절됨", decidedByFmt:"{name} 처리", noRejected:"거절 이력이 없습니다",
  decideJoinQ:"이 가입 신청을 {d} 처리하시겠습니까?", decideReqQ:"이 요청을 {d} 처리하시겠습니까?",
  pwRequired:"비밀번호를 입력하십시오.", checking:"확인 중…", pwWrong:"비밀번호가 일치하지 않습니다.",
  defaultPwWarn:"기본 비밀번호(2222)를 사용 중입니다. 메뉴 → 관리자 비밀번호 변경에서 반드시 변경하십시오.",
  forgotPwMsg:"관리 담당자에게 요청하십시오. Supabase의 app_settings 표에서 admin_password_hash 행을 삭제하면 2222로 초기화됩니다.",
  pwMin6:"비밀번호는 6자 이상이어야 합니다.", pwMismatch:"새 비밀번호가 일치하지 않습니다.", pwCurWrong:"현재 비밀번호가 일치하지 않습니다.", pwChanged:"관리자 비밀번호가 변경되었습니다",
  noSitesYet:"등록된 근무지가 없습니다",
  gpsOnToast:"위치 확인이 사용 중입니다. 사이트 반경 100m 이내에서 출근하십시오.",
  gpsUnsupTitle:"위치 기능 미지원", gpsUnsupMsg:"Chrome 브라우저에서 실행하십시오.",
  gpsOffTitle:"위치 권한 꺼짐",
  gpsOffMsg:"iPhone: 설정 → Chrome(또는 Safari) → 위치 → '앱을 사용하는 동안'으로 변경하십시오.\nAndroid: 주소창 좌측 자물쇠 → 권한 → 위치 → 허용으로 변경한 뒤 앱을 다시 실행하십시오.",
  gpsEnabled:"위치 확인이 사용 설정되었습니다", gpsDeniedTitle:"위치 권한 거부됨",
  gpsDeniedMsg:"출근 기록에는 위치 정보가 필요합니다. 설정 화면에서 위치 권한 허용 방법을 확인하십시오.",
  gpsFailTitle:"위치를 확인할 수 없습니다", gpsFailUnsupMsg:"이 브라우저는 위치 정보를 지원하지 않습니다. Chrome에서 실행하십시오.",
  errPerm:"위치 권한이 꺼져 있습니다. 기기 설정에서 해당 브라우저의 위치 권한을 허용하십시오.",
  errTimeout:"위치 확인에 시간이 지연되고 있습니다. 실외에서 다시 시도하십시오.",
  errGeneric:"위치를 확인할 수 없습니다. 잠시 후 다시 시도하십시오.",
  previewClockQ:"미리보기 모드입니다. 위치 확인을 생략하고 출근 처리하시겠습니까? (배포판에서는 100m 확인이 적용됩니다)",
  promoteMgrQ:"{name}님을 매니저로 지정하시겠습니까? (승인 권한이 부여됩니다)", assignLabel:"지정",
  promoteMgrDone:"{name}님이 매니저로 지정되었습니다.",
  promoteSupQ:"{name}님을 슈퍼바이저로 지정하시겠습니까? (현장 조회 권한이 부여됩니다)",
  promoteSupDone:"{name}님이 슈퍼바이저로 지정되었습니다.",
  resetPinQ:"{name}님의 PIN을 1111로 초기화하시겠습니까? 다음 로그인 시 본인이 새 PIN을 설정합니다.",
  resetLabel:"초기화", resetPinDone:"{name}님의 PIN이 1111로 초기화되었습니다",
  needManagerUp:"슈퍼바이저에게는 \"{a}\" 권한이 없습니다. 매니저 이상만 수행할 수 있습니다.",
  needOwner:"\"{a}\"은(는) 최고관리자만 수행할 수 있습니다.",
  actJoin:"가입승인 처리", actPromoteMgr:"매니저 지정", actPromoteSup:"슈퍼바이저 지정", actResetPin:"PIN 초기화",
  actEditCrew:"크루 정보 수정", actDecideReq:"근태 요청 승인/거절", actNotice:"공지 등록", actAddEvent:"일정 추가",
  actChangeAdminPw:"관리자 비밀번호 변경", actInvite:"문자 초대 발송", actSiteEdit:"근무지 등록", actExportAll:"전체 자료 내보내기",
  srvPreview:"미리보기 모드 · 서버 및 GPS 미연결 상태입니다. 데이터는 이 기기에만 저장됩니다",
  srvChecking:"서버 확인 중…", srvOk:"서버 연결됨 · 여러 기기에서 데이터가 동기화됩니다",
  srvNoTables:"서버에 테이블이 없습니다 · SQL Editor에서 supabase-ALL-IN-ONE.sql을 실행하십시오",
  srvNoNet:"서버에 연결할 수 없습니다 · 인터넷 연결 또는 외부 접속 차단을 확인하십시오",
  srvDenied:"서버가 접근을 거부했습니다 · Supabase 접근 정책(RLS)을 확인하십시오",
  srvFail:"서버 조회 실패: ", srvUnknown:"알 수 없는 오류",
  peopleSuffix:"명", clockInAt:"{t} 출근",
  noWorkingCrew:"현재 근무 중인 크루가 없습니다", noWorkingCrewSub:"크루가 출근하면 이 목록에 표시됩니다",
  inductionSoonBtn:"Induction 만료 임박 {n}명 — 눌러서 보기", expiredLabel:"만료됨",
  indExpired:"Induction 만료됨 ({d})", indDue:"Induction 만료 {d} (D-{n})",
  nameRequired:"이름을 입력하십시오.", savedName:"{name} 저장됨",
  deleteCrewQ:"{name}님을 크루 목록에서 제외하시겠습니까? (출퇴근 기록은 유지됩니다)",
  noCrewMsg:"등록된 크루가 없습니다.<br>\"+ 크루 추가\"로 직접 등록하거나, 가입 신청을 승인하면 이 목록에 표시됩니다.",
  editSuffix:"수정 ›", siteUnassigned:"사이트 미배정", workingSince:"근무중 ({t} 출근)", startPrefix:"시작 ", offDuty:"대기",
  resetPinBtn:"PIN 초기화", promoteMgrBtn:"매니저로 지정", promoteSupBtn:"슈퍼바이저로 지정",
  countEvents:"{n}건", crewIssue:"크루 이슈", crewMemo:"크루 메모", allDay:"종일",
  noEventsDay:"해당 날짜에 등록된 일정이 없습니다", workedDayFmt:"출근 {n}명: {names}",
  titleDateRequired:"제목과 날짜를 입력하십시오.", deleteEventQ:"\"{label}\" 일정을 삭제하시겠습니까?",
  reqLeaveSick:"휴가/병가", noPendingReq:"대기중인 승인 요청이 없습니다",
  phoneRequired:"전화번호를 입력하십시오.",
  inviteSentMsg:"{phone}로 초대 링크를 전송했습니다.<br>{url}<br>링크를 통해 제출된 신청은 가입 대기 목록에 등록됩니다. (1시간 후 만료)",
  noGeoToast:"이 브라우저는 위치 기능을 지원하지 않습니다", gettingLoc:"현재 위치 확인 중…",
  locSet:"현재 위치가 입력되었습니다 (현장에서 실행해야 정확합니다)", locFail:"위치를 가져오지 못했습니다",
  siteNameRequired:"근무지 이름을 입력하십시오.",
  deleteSiteQ:"\"{name}\" 근무지를 삭제하시겠습니까? 배정된 크루는 미배정 상태가 됩니다.", deletedToast:"삭제되었습니다",
  noAddress2:"주소 없음", crewCountFmt:"크루 {n}명", gpsSet:"GPS 등록됨", gpsMissing:"GPS 좌표 없음 — 수정에서 '현재 위치 사용'",
  noSitesMsg:"등록된 근무지가 없습니다. 아래 버튼으로 근무지를 등록하십시오.<br>현장에서 \"현재 위치 사용\"을 실행하면 GPS 출근 기준점이 설정됩니다.",
  exportBlocked:"이 화면에서는 파일 저장이 제한됩니다.\nChrome 또는 Safari 브라우저에서 실행하면 저장할 수 있습니다.",
  indOk:"정상", ind30:"30일 이내", ind7:"7일 이내",
  navHome:"홈", navCalendar:"캘린더", navMenu:"메뉴",
  newHere:"신규 가입", joinBtn:"가입 신청", orLabel:"또는", adminBtn:"관리자", joinTitle:"가입 신청"
});
Object.assign(i18n.en, {
  loginSub:"Attendance records and site checklists, managed in one system.", phName:"Name", loginBtn:"Log in",
  adminLoginSub:"For management and supervisors", adminPwTitle:"Admin password", forgotPw:"Password assistance", backLabel:"← Back",
  joinNote:"If accessed via an invite link, the company code is entered automatically. Complete the details below.",
  genderLabel:"Gender", genderF:"Female", genderM:"Male", genderX:"Prefer not to say",
  phBirth:"Date of birth", phAddress:"Address (e.g. Bondi, NSW)", phAddress2:"Address", phPhone:"Mobile number", phGuardian:"Emergency contact (optional)",
  startDateLabel:"Start date", phJoinPin:"Choose a 4-digit PIN", phJoinPin2:"Confirm PIN", joinSubmit:"Submit application",
  offlineNote:"Clock records are stored on this device and synchronised automatically once the connection is restored.",
  phChat:"Type a message...", sendBtn:"Send", chatEmpty:"Enter a message for your manager",
  mySiteLabel:"My site", gpsSectionLabel:"GPS clock-in", locPermLabel:"Location permission",
  gpsSettingsNote:"Clock-in is permitted within 100 m of the assigned site. Location access can be enabled on this screen.",
  tzSyd:"Sydney (NSW/VIC/QLD)", tzPer:"Perth (WA)", tzAde:"Adelaide (SA)", tzBri:"Brisbane (QLD)",
  tzPreviewLabel:"Current site time:", accountLabel:"Account",
  profileTitle:"My profile", profileInfoLabel:"Profile details", profileSaved:"Profile saved.",
  colleagueSheetTitle:"Team schedule this week", colleagueNote:"Only crew assigned to your site are listed",
  noMatesMsg:"No other crew assigned to this site",
  statApprovals:"Approvals", statJoins:"Join requests", statWorking:"On shift", workingNowLabel:"Crew on shift now",
  allSites:"All sites", scopeSites:"My sites: ",
  roleOwner:"Owner", roleSiteowner:"Site owner", roleManager:"Manager", roleSupervisor:"Supervisor", previewSuffix:" (preview)",
  rankCeo:"Owner", rankCoCeo:"Co-owner", managersTitle:"Managers", supervisorsTitle:"Supervisors", ownersTitle:"Owners",
  noManagers:"No managers assigned", noSupervisors:"No supervisors assigned",
  previewHint:"Select the role badge on the admin home to preview each role's view (Owner → Site owner → Manager → Supervisor).",
  adminMenuNote:"Approvals, join requests and crew status are accessed from the metrics on the home screen.",
  groupOps:"Operations", noticePinRow:"Notice pin (top of crew home)", checklistAdminRow:"Checklists", sitesRow:"Sites (GPS)", activityLogRow:"Activity log",
  groupData:"Data & exports", exportAllRow:"Export all data to Excel",
  exportAllNote:"Exports a single Excel file containing crew, requests, applications, checklists and activity log sheets.",
  adminPwRow:"Change admin password",
  approvalsTitle:"Approvals", excelBtn:"Excel",
  laborNote:"AU standard: a break is required after five continuous hours of work. Requests exceeding weekly hours require careful review. (Management only)",
  joinAdminTitle:"Join approvals", tabPending:"Pending", tabRejected:"Rejected (kept 1 yr)",
  crewStatusTitle:"Crew", addCrewBtn:"+ Add crew", inviteBtn:"Invite by SMS",
  sitesTitle:"Sites",
  sitesNote:"Once a site is registered with GPS coordinates, crew may clock in only within 100 m of that point. Site assignment is managed on the Crew screen.",
  addSiteBtn:"+ Add site",
  adminCalTitle:"Company calendar", crewShift:"Crew shifts", legBusiness:"Business", legPersonal:"Personal", tabAll:"All",
  adminCalHint:"Select a date to view that day's events and crew notes.", addEventBtn:"+ Add event",
  activityLogTitle:"Activity log", activityLogNote:"PIN resets, SMS invites and other key actions are recorded with the operator and timestamp.",
  noActivity:"No activity recorded yet",
  checklistAdminTitle:"Checklists",
  checklistAdminNote:"Checklists registered per site and weekday appear on the crew home job card.",
  siteLabel:"Site", dayLabel:"Day", itemsLabel:"Items", addItemBtn:"+ Add item",
  noItems:"No items yet", deleteLabel:"Delete",
  noSiteTitle2:"No sites registered", noSiteMsg2:"Register a site first in Menu → Sites.",
  addItemTitle:"Add item · {site} ({day})", promptItemPh:"e.g. Polish the kitchen sink",
  checklistSheetTitle:"{site} checklist · {day}",
  noChecklistMsg:"No checklist is registered for this site. Contact your manager.",
  eventSheetTitle:"Add event", phEventTitle:"Title (e.g. client meeting, Bondi contract visit)", typeLabel:"Type",
  audienceLabel:"Visibility", audOwner:"Owners only", audManager:"Managers and up", audCrew:"All crew",
  phNote2:"e.g. Level 3 storage key does not fit / customer requested additional carpet cleaning",
  issueToggleLabel:"Flag as an issue (problems, incidents, claims — shared with management immediately)", deleteNoteBtn:"Delete note",
  sitePickerTitle:"Pick my site",
  siteSheetTitle:"Site", phSiteName:"Name (e.g. Coles Bondi Junction)", phSiteAddress:"Address",
  typeCommercial:"Commercial", typeHouse:"House", gpsCoordsLabel:"GPS coordinates (clock-in point)", phLat:"Latitude", phLng:"Longitude",
  useHereBtn:"Use current location (on site)", phSiteNote:"Notes (keys, alarm code, cautions)",
  crewSheetTitle:"Crew details", phCrewName:"Name (identical to the login name)", phCrewAddress:"Home address",
  assignedSiteLabel:"Assigned site", deleteCrewBtn:"Remove from crew list",
  noticeSheetTitle:"Notice pin", phNotice:"e.g. Friday payday has moved to Saturday",
  noticeSheetNote:"Displayed at the top of the crew home. Save with no content to remove it.",
  noticePosted:"The notice has been posted to the crew home", noticeRemoved:"The notice has been removed",
  apwTitle:"Change admin password", curPw:"Current password", newPw:"New password (6+ characters)", newPw2:"Confirm new password",
  promptTitle:"Input", ok:"OK", cancel:"Cancel", noticeTitle:"Notice",
  inviteSheetTitle:"Invite crew by SMS", phInvitePhone:"Crew phone number", sendInviteBtn:"Send invite SMS",
  stPending:"Pending", stApproved:"Approved", stRejected:"Rejected", approveBtn:"Approve", rejectBtn:"Reject",
  nameHpRequired:"Name and mobile number are required fields.", pinTwice:"Enter the same 4-digit PIN in both fields.",
  joinReceivedMsg:"The application for {name} has been received. Login is available after approval.",
  noBirth:"No date of birth", noAddr:"No address", startHope:"preferred start",
  noJoinPending:"No pending applications", rejectedLabel:"Rejected", decidedByFmt:"by {name}", noRejected:"No rejected applications",
  decideJoinQ:"Confirm {d} for this application?", decideReqQ:"Confirm {d} for this request?",
  pwRequired:"Enter the password.", checking:"Checking…", pwWrong:"The password does not match.",
  defaultPwWarn:"The default password (2222) is in use. Change it in Menu → Change admin password.",
  forgotPwMsg:"Contact the system administrator. Deleting the admin_password_hash row in the Supabase app_settings table resets it to 2222.",
  pwMin6:"The password must be at least 6 characters.", pwMismatch:"The new passwords do not match.", pwCurWrong:"Current password is wrong.", pwChanged:"Admin password has been changed",
  noSitesYet:"No sites registered",
  gpsOnToast:"Location services are enabled. Clock in within 100 m of your site.",
  gpsUnsupTitle:"Location not supported", gpsUnsupMsg:"Open the app in Chrome.",
  gpsOffTitle:"Location permission is disabled",
  gpsOffMsg:"iPhone: Settings → Chrome (or Safari) → Location → 'While Using the App'.\nAndroid: address bar lock icon → Permissions → Location → Allow, then restart the app.",
  gpsEnabled:"Location access enabled", gpsDeniedTitle:"Location permission denied",
  gpsDeniedMsg:"Location data is required for clock-in. See Settings → Location permission for instructions.",
  gpsFailTitle:"Location unavailable", gpsFailUnsupMsg:"This browser does not support location services. Use Chrome.",
  errPerm:"Location permission is disabled. Allow location for this browser in your phone settings.",
  errTimeout:"Location retrieval is taking longer than expected. Try again outdoors.",
  errGeneric:"Location could not be determined. Try again shortly.",
  previewClockQ:"Preview mode. Proceed with clock-in without the location check? (The 100 m check applies in the deployed app)",
  promoteMgrQ:"Assign {name} as a manager? (approval permissions granted)", assignLabel:"Assign",
  promoteMgrDone:"{name} is now a manager.",
  promoteSupQ:"Assign {name} as a supervisor? (site view access granted)",
  promoteSupDone:"{name} is now a supervisor.",
  resetPinQ:"Reset the PIN for {name} to 1111? A new PIN is set at their next login.",
  resetLabel:"Reset", resetPinDone:"The PIN for {name} has been reset to 1111",
  needManagerUp:"Supervisors are not permitted to {a}. Manager level or above is required.",
  needOwner:"Only the owner may {a}.",
  actJoin:"process join approvals", actPromoteMgr:"assign managers", actPromoteSup:"assign supervisors", actResetPin:"reset PINs",
  actEditCrew:"edit crew details", actDecideReq:"approve or reject requests", actNotice:"post notices", actAddEvent:"add events",
  actChangeAdminPw:"change the admin password", actInvite:"send SMS invites", actSiteEdit:"manage sites", actExportAll:"export all data",
  srvPreview:"Preview mode · server and GPS unavailable. Data is stored on this device only",
  srvChecking:"Checking server…", srvOk:"Server connected · data synchronised across devices",
  srvNoTables:"Server tables not found · run supabase-ALL-IN-ONE.sql in the SQL Editor",
  srvNoNet:"Server unreachable · check the internet connection or external access restrictions",
  srvDenied:"Server access denied · review the Supabase RLS policies",
  srvFail:"Server check failed: ", srvUnknown:"unknown error",
  peopleSuffix:" crew", clockInAt:"in at {t}",
  noWorkingCrew:"No crew currently on shift", noWorkingCrewSub:"Crew are listed here once they clock in",
  inductionSoonBtn:"{n} inductions expiring soon — tap to view", expiredLabel:"Expired",
  indExpired:"Induction expired ({d})", indDue:"Induction due {d} (D-{n})",
  nameRequired:"Enter a name.", savedName:"{name} saved",
  deleteCrewQ:"Remove {name} from the crew list? (Attendance records are retained)",
  noCrewMsg:"No crew registered.<br>Add crew with \"+ Add crew\", or approve a join application to add them here.",
  editSuffix:"Edit ›", siteUnassigned:"No site assigned", workingSince:"On shift (in at {t})", startPrefix:"started ", offDuty:"Off",
  resetPinBtn:"Reset PIN", promoteMgrBtn:"Make manager", promoteSupBtn:"Make supervisor",
  countEvents:"{n} events", crewIssue:"Crew issue", crewMemo:"Crew note", allDay:"All day",
  noEventsDay:"No events registered for this date", workedDayFmt:"{n} clocked in: {names}",
  titleDateRequired:"Enter a title and date.", deleteEventQ:"Delete the event \"{label}\"?",
  reqLeaveSick:"Leave/Sick", noPendingReq:"No pending requests",
  phoneRequired:"Enter a phone number.",
  inviteSentMsg:"An invite link has been sent to {phone}.<br>{url}<br>Applications submitted through the link appear under Join approvals. (Expires in 1 hour)",
  noGeoToast:"This browser does not support location services", gettingLoc:"Retrieving current location…",
  locSet:"Current location captured (record on site for accuracy)", locFail:"Location could not be retrieved",
  siteNameRequired:"Enter a site name.",
  deleteSiteQ:"Delete the site \"{name}\"? Assigned crew will become unassigned.", deletedToast:"Deleted",
  noAddress2:"No address", crewCountFmt:"{n} crew", gpsSet:"GPS set", gpsMissing:"No GPS — tap Edit and 'Use current location'",
  noSitesMsg:"No sites registered. Register your first site below.<br>Tap \"Use current location\" while standing at the site to set the clock-in point.",
  exportBlocked:"File downloads are restricted in this view.\nOpen the app in Chrome or Safari to download.",
  indOk:"OK", ind30:"Within 30 days", ind7:"Within 7 days",
  navHome:"Home", navCalendar:"Calendar", navMenu:"Menu",
  newHere:"New user", joinBtn:"Join", orLabel:"or", adminBtn:"Admin", joinTitle:"Join"
});
function fmtT(key, vars){ let s = T(key); for (const k in (vars || {})) s = s.split("{" + k + "}").join(vars[k]); return s; }
function stLabel(v){ return ({ "대기": T("stPending"), "승인": T("stApproved"), "거절": T("stRejected") })[v] || v; }
function dayShort(d){ return langIsKo ? CHECKLIST_DAY_LABELS[d] : ({ mon:"Mon", tue:"Tue", wed:"Wed", thu:"Thu", fri:"Fri", sat:"Sat", sun:"Sun" })[d] || d; }
function dayFull(d){ return langIsKo ? CHECKLIST_DAY_LABELS[d] + "요일" : dayShort(d); }
function monthTitle(y, m){ return langIsKo ? `${y}년 ${m + 1}월` : `${T("monthNames")[m]} ${y}`; }
function fullDate(dt){ return langIsKo ? dt.getFullYear() + "년 " + (dt.getMonth() + 1) + "월 " + dt.getDate() + "일" : `${T("dow")[dt.getDay()]}, ${T("monthNames")[dt.getMonth()]} ${dt.getDate()}, ${dt.getFullYear()}`; }
function audLabel(a){ return ({ owner: T("audOwner"), manager: T("audManager"), crew: T("audCrew") })[a] || ""; }
function evTypeLabel(t){ return ({ shift: T("crewShift"), business: T("legBusiness"), personal: T("legPersonal") })[t] || ""; }
function reqTypeLabel(t){ return ({ overtime: T("reqOvertime"), leave: T("reqLeaveSick"), substitute: T("reqCover") })[t] || t; }
function trWord(v){ return ({ "병가": T("reqSick"), "휴가": T("reqLeave"), sick: T("reqSick"), leave: T("reqLeave") })[v] || v; }


// ===== 브라우저 팝업(alert/confirm/prompt) 대체 =====
// 미리보기·일부 앱내 브라우저에서는 alert/confirm 창이 안 떠서 버튼이 안 눌리는 것처럼 보임.
// 알림은 토스트로, 확인은 아래에서 올라오는 시트로 보여줌.
function toast(msg, ms){
  let el = document.getElementById("app-toast");
  if (!el){
    el = document.createElement("div"); el.id = "app-toast"; el.className = "app-toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), ms || 3200);
}
window.alert = function(msg){ toast(String(msg)); };
let _confirmYes = null;
function appConfirm(msg, onYes, yesLabel, variant){
  const ov = document.getElementById("confirm-overlay");
  if (!ov){ if (window.confirm(msg)) onYes(); return; }
  document.getElementById("confirm-text").textContent = msg;
  const yes = document.getElementById("confirm-yes");
  yes.textContent = yesLabel || (langIsKo ? "확인" : "Confirm");
  yes.className = "action-btn primary" + (variant === "danger" ? " danger" : "");
  _confirmYes = onYes;
  ov.classList.add("active");
}
function confirmYes(){ const f = _confirmYes; closeConfirm(); if (f) f(); }
function closeConfirm(){ _confirmYes = null; document.getElementById("confirm-overlay").classList.remove("active"); }
function closeConfirmIfBg(e){ if (e.target.id === "confirm-overlay") closeConfirm(); }
function appNotice(title, msg){
  document.getElementById("notice-title").textContent = title;
  document.getElementById("notice-text").textContent = msg;
  document.getElementById("notice-overlay").classList.add("active");
}
function closeNotice(){ document.getElementById("notice-overlay").classList.remove("active"); }
function closeNoticeIfBg(e){ if (e.target.id === "notice-overlay") closeNotice(); }
let _promptOk = null;
function appPrompt(title, placeholder, onOk){
  document.getElementById("prompt-title").textContent = title;
  const inp = document.getElementById("prompt-input"); inp.value = ""; inp.placeholder = placeholder || "";
  _promptOk = onOk;
  document.getElementById("prompt-overlay").classList.add("active");
  setTimeout(() => inp.focus(), 100);
}
function promptOk(){ const f = _promptOk, v = document.getElementById("prompt-input").value; closePrompt(); if (f) f(v); }
function closePrompt(){ _promptOk = null; document.getElementById("prompt-overlay").classList.remove("active"); }
function closePromptIfBg(e){ if (e.target.id === "prompt-overlay") closePrompt(); }


const views =["role", "admin-login", "join", "home", "profile", "calendar", "admin", "admin-approvals", "admin-joins", "admin-staff", "admin-sites", "admin-calendar", "admin-log", "admin-menu", "admin-checklist", "menu", "settings", "chat"];
const adminViews = ["admin", "admin-approvals", "admin-joins", "admin-staff", "admin-sites", "admin-calendar", "admin-log", "admin-menu", "admin-checklist"];
let clockedIn = false;
let clockTimerStart = null;
let clockInterval = null;

function goTo(name){
  views.forEach(v => document.getElementById("view-" + v).classList.remove("active"));
  document.getElementById("view-" + name).classList.add("active");

  const nav = document.getElementById("navbar");
  const adminNav = document.getElementById("admin-navbar");
  const isAdminView = adminViews.includes(name);

  if (isAdminView){
    nav.style.display = "none";
    adminNav.style.display = "flex";
    document.querySelectorAll(".admin-nav-item").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.aview === name);
    });
  } else if (name === "role" || name === "admin-login" || name === "settings" || name === "join" || name === "chat" || name === "profile"){
    nav.style.display = "none";
    adminNav.style.display = "none";
  } else {
    nav.style.display = "flex";
    adminNav.style.display = "none";
    document.querySelectorAll(".nav-item:not(.admin-nav-item)").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.view === name);
    });
  }

  if (isAdminView && typeof applyAdminRoleUI === "function") applyAdminRoleUI();
  if (name === "admin") renderAdminDashboard();
  if (name === "admin-approvals") renderAdminApprovals();
  if (name === "admin-joins") renderJoinApprovals();
  if (name === "admin-calendar") { renderAdminCalendar("all"); renderAdminCalendarGrid(); }
  if (name === "admin-log") renderActivityLog();
  if (name === "chat") renderChat();
  if (name === "admin-staff") renderCrewStatusList();
  if (name === "profile") loadProfileForm();
  if (name === "home"){ renderHome(); renderInductionBanner(); refreshGpsStatus(); }
  if (name === "admin-checklist") renderAdminChecklist();
  if (name === "admin-sites") renderSiteList();
  if (name === "menu"){ const n = document.getElementById("menu-profile-name"), su = document.getElementById("menu-profile-sub"); if (n) n.textContent = MY_NAME || "-"; if (su) su.textContent = (MY_SITE ? MY_SITE + " · " : "") + "CleanMate " + (langIsKo ? "크루" : "crew"); }
  if (name === "admin-login"){
    const input = document.getElementById("admin-password-input");
    if (input) input.value = "";
  }
}

function pad(n){ return n.toString().padStart(2, "0"); }

function submitJoin(){
  const name = document.getElementById("j-name").value.trim();
  const phone = document.getElementById("j-phone").value.trim();
  const pin = document.getElementById("j-pin").value.trim();
  const pin2 = document.getElementById("j-pin2").value.trim();
  if (!name || !phone){
    alert(T("nameHpRequired"));
    return;
  }
  if (pin.length < 4 || pin !== pin2){
    alert(T("pinTwice"));
    return;
  }
  const applicant = {
    name, phone,
    gender: document.getElementById("j-gender").value,
    birth: document.getElementById("j-birth").value,
    address: document.getElementById("j-address").value.trim(),
    guardian: document.getElementById("j-guardian").value.trim(),
    startDate: document.getElementById("j-startdate").value,
    status: "대기"
  };
  const applicants = JSON.parse(lsGet("join-applicants") || "[]");
  applicants.push(applicant);
  lsSet("join-applicants", JSON.stringify(applicants));
  renderJoinApprovals();
  alert(fmtT("joinReceivedMsg", { name }));
  goTo("role");

  if (sb){
    sb.from("join_applicants").insert({
      name: applicant.name,
      phone: applicant.phone,
      gender: applicant.gender,
      birth: applicant.birth,
      address: applicant.address,
      guardian: applicant.guardian,
      start_date: applicant.startDate || null,
      status: "대기"
    }).select().single().then(({ data: row, error }) => {
      if (error){ console.warn("join_applicants server save failed (kept locally):", error.message); return; }
      const cur = JSON.parse(lsGet("join-applicants") || "[]");
      const target = cur.find(a => !a.sbId && a.name === applicant.name && a.phone === applicant.phone);
      if (target && row){
        target.sbId = row.id;
        lsSet("join-applicants", JSON.stringify(cur));
      }
    });
  }
}

function renderJoinApprovals(){
  const list = document.getElementById("join-approvals");
  const rejected = document.getElementById("join-rejected");
  if (!list) return;

  const draw = (applicants) => {
    const pendingHtml = applicants.map((a, i) => {
      if (a.status !== "대기") return "";
      return `
      <div class="job-card">
        <div class="job-info">
          <div class="job-addr">${a.name} (${a.phone})</div>
          <div class="job-meta">${a.birth || T("noBirth")} · ${a.address || T("noAddr")} · ${T("startHope")} ${a.startDate || "-"}</div>
        </div>
        <div style="display:flex; gap:6px;">
          <button class="login-btn" style="padding:5px 10px; font-size:11px;" onclick="decideJoinReal(${i}, '승인')">${T("approveBtn")}</button>
          <button class="login-btn" style="padding:5px 10px; font-size:11px;" onclick="decideJoinReal(${i}, '거절')">${T("rejectBtn")}</button>
        </div>
      </div>`;
    }).join("");
    list.innerHTML = pendingHtml || `<div class="job-card"><div class="job-info"><div class="job-addr">${T("noJoinPending")}</div></div></div>`;

    if (rejected){
      const rejectedHtml = applicants.map(a => {
        if (a.status !== "거절") return "";
        return `
        <div class="job-card">
          <div class="job-info">
            <div class="job-addr">${a.name} (${a.phone})</div>
            <div class="job-meta">${T("rejectedLabel")} · ${a.address || "-"} ${a.decidedBy ? "· " + fmtT("decidedByFmt", { name: a.decidedBy }) : ""}</div>
          </div>
          <div class="job-status status-wait">${T("stRejected")}</div>
        </div>`;
      }).join("");
      rejected.innerHTML = rejectedHtml || `<div class="job-card"><div class="job-info"><div class="job-addr">${T("noRejected")}</div></div></div>`;
    }
  };

  const applicants = JSON.parse(lsGet("join-applicants") || "[]");
  draw(applicants);

  if (sb){
    sb.from("join_applicants").select("*").order("created_at", { ascending: true })
      .then(({ data, error }) => {
        if (error){ console.warn("join_applicants server fetch failed (showing local only):", error.message); return; }
        if (!data) return;
        const merged = data.map(row => ({
          sbId: row.id,
          name: row.name,
          phone: row.phone,
          gender: row.gender,
          birth: row.birth,
          address: row.address,
          guardian: row.guardian,
          startDate: row.start_date,
          status: row.status,
          decidedBy: row.decided_by
        }));
        lsSet("join-applicants", JSON.stringify(merged));
        draw(merged);
      });
  }
}

function showJoinSubTab(name, btn){
  btn.parentElement.querySelectorAll(".admin-tab").forEach(t => t.classList.remove("active"));
  btn.classList.add("active");
  document.getElementById("join-approvals").style.display = (name === "pending") ? "block" : "none";
  document.getElementById("join-rejected").style.display = (name === "rejected") ? "block" : "none";
}

function decideJoinReal(index, decision){
  if (!requireManagerUp(T("actJoin"))) return;
  appConfirm(fmtT("decideJoinQ", { d: stLabel(decision) }), () => decideJoinDo(index, decision), stLabel(decision), decision === "거절" ? "danger" : "");
}
function decideJoinDo(index, decision){
  const applicants = JSON.parse(lsGet("join-applicants") || "[]");
  if (!applicants[index]) return;
  applicants[index].status = decision;
  applicants[index].decidedBy = currentRoleLabel();
  lsSet("join-applicants", JSON.stringify(applicants));
  logActivity(`Join ${decision === "승인" ? "approved" : "rejected"}: ${applicants[index].name}`);
  if (decision === "승인"){ const a = applicants[index]; upsertCrew({ name: a.name, phone: a.phone, address: a.address, startDate: a.startDate || a.start_date, site: "" }); }
  renderJoinApprovals();
  renderAdminDashboard();

  if (sb && applicants[index].sbId){
    sb.from("join_applicants").update({ status: decision, decided_by: currentRoleLabel() })
      .eq("id", applicants[index].sbId)
      .then(({ error }) => { if (error) console.warn("join_applicants server update failed (applied locally):", error.message); });
  }
}

// =====================================================================
// 인증: 크루는 이름 + 개인 PIN, 관리자는 비밀번호. 둘 다 서버에 "해시"(원문을 알 수 없게 바꾼 값)로 저장.
// 처음엔 기본값(크루 1111 / 관리자 2222)으로 들어오고, 바로 바꾸도록 안내.
// =====================================================================
const CREW_DEFAULT_PIN = "1111";
const ADMIN_DEFAULT_PASSWORD = "2222";
async function sha256(text){
  if (window.crypto && crypto.subtle){
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
  }
  let h = 0; for (let i = 0; i < text.length; i++){ h = (h * 31 + text.charCodeAt(i)) | 0; } return "x" + (h >>> 0).toString(16); // 아주 오래된 브라우저용 대체
}
const pinHash = (name, pin) => sha256("cleanmate|" + name.trim().toLowerCase() + "|" + pin);
const adminHash = (pw) => sha256("cleanmate|admin|" + pw);
function getCrewPin(){ return CREW_DEFAULT_PIN; } // (이전 버전 호환)
function getAdminPassword(){ return ADMIN_DEFAULT_PASSWORD; }

// 서버 호출이 멈춰 있으면(외부 접속 차단 등) 4초 뒤 포기하고 오프라인 방식으로 진행
function withTimeout(promise, ms){
  return Promise.race([promise, new Promise(res => setTimeout(() => res({ __timeout: true }), ms || 4000))]);
}
// 서버에서 크루 한 명 가져오기 (없으면 null, 서버 연결 불가면 undefined)
async function fetchCrewRow(name){
  if (!sb) return undefined;
  try {
    const r = await withTimeout(sb.from("crew").select("*").eq("name", name).maybeSingle());
    if (!r || r.__timeout || r.error) return undefined;
    return r.data;
  } catch(e){ return undefined; }
}
async function setCrewPin(name, pin, mustChange){
  const h = await pinHash(name, pin);
  lsSet("pin-hash:" + name, h);
  if (sb) await withTimeout(sb.from("crew").update({ pin_hash: h, must_change_pin: !!mustChange }).eq("name", name));
  return h;
}
let mustChangePin = false;

async function loginWithPin(){
  const nameEl = document.getElementById("login-name");
  const name = (nameEl ? nameEl.value : MY_NAME).trim();
  if (!name){ alert(langIsKo ? "이름을 입력하십시오." : "Please enter your name."); return; }
  const pin = document.getElementById("pin-input").value.trim();
  if (pin.length !== 4 || isNaN(pin)){ alert(langIsKo ? "PIN 4자리를 입력하십시오." : "Enter your 4-digit PIN."); return; }
  const btn = document.querySelector("#view-role .role-btn.employee"); if (btn){ btn.disabled = true; btn.textContent = T("checking"); }
  const restoreBtn = () => { if (btn){ btn.disabled = false; btn.textContent = "Log in"; } };
  const entered = await pinHash(name, pin);
  const defaultHash = await pinHash(name, CREW_DEFAULT_PIN);
  const row = await fetchCrewRow(name);
  let ok = false; mustChangePin = false;
  if (row === null){
    restoreBtn();
    appNotice(langIsKo ? "등록되지 않은 이름" : "Name not registered",
      langIsKo ? `"${name}"은(는) 크루 목록에 없습니다. 관리자가 등록한 이름과 동일하게 입력했는지 확인하거나, 신규 가입 신청을 진행하십시오.` : `"${name}" is not on the crew list. Confirm the spelling used by your manager, or submit a join application.`);
    return;
  }
  if (row){ // 서버 연결됨
    if (!row.pin_hash){ ok = (entered === defaultHash); if (ok){ await setCrewPin(name, CREW_DEFAULT_PIN, true); mustChangePin = true; } }
    else { ok = (entered === row.pin_hash); mustChangePin = !!row.must_change_pin; lsSet("pin-hash:" + name, row.pin_hash); }
  } else { // 오프라인·미리보기: 마지막으로 확인된 해시 또는 기본값
    const cached = lsGet("pin-hash:" + name);
    ok = cached ? (entered === cached) : (entered === defaultHash);
    if (!cached && ok && !IS_PREVIEW) mustChangePin = true; // 미리보기에선 강제하지 않음
  }
  restoreBtn();
  if (!ok){ alert(langIsKo ? "PIN이 일치하지 않습니다." : "Wrong PIN."); return; }
  lsSet("session-active", "1");
  MY_NAME = name; lsSet("my-name", name);
  document.getElementById("pin-input").value = "";
  syncCrewFromServer(() => { syncSitesFromServer(() => {
    const me = crewList.find(c => c.name === MY_NAME);
    if (me && me.site){ MY_SITE = me.site; lsSet("my-site", MY_SITE); }
    goTo("home");
    if (mustChangePin) openPinSheet(true);
    else if (!MY_SITE && siteNames().length) openSitePicker();
  }); });
}
function resetCrewPinToDefault(){
  appNotice(langIsKo ? "PIN 분실 안내" : "PIN assistance",
    langIsKo ? "관리자에게 요청하십시오. 관리자가 크루 현황에서 PIN 초기화를 실행하면 1111로 초기화되며, 다음 로그인 시 새 PIN을 설정합니다." : "Contact your manager. A reset from the Crew list restores the PIN to 1111, and a new PIN is set at the next login.");
}

// --- PIN 변경 시트 ---
function openPinSheet(forced){
  document.getElementById("pin-cur").value = ""; document.getElementById("pin-new").value = ""; document.getElementById("pin-new2").value = "";
  document.getElementById("pin-sheet-note").textContent = forced
    ? (langIsKo ? "기본 PIN(1111)을 사용 중입니다. 본인만 아는 4자리로 변경하십시오." : "The default PIN (1111) is in use. Set a new 4-digit PIN.")
    : (langIsKo ? "새 PIN은 본인만 알 수 있도록 관리하십시오." : "Keep the new PIN confidential.");
  document.getElementById("pin-overlay").classList.add("active");
}
function closePinSheet(){ document.getElementById("pin-overlay").classList.remove("active"); }
function closePinSheetIfBg(e){ if (e.target.id === "pin-overlay") closePinSheet(); }
async function savePinSheet(){
  const cur = document.getElementById("pin-cur").value.trim(), next = document.getElementById("pin-new").value.trim(), next2 = document.getElementById("pin-new2").value.trim();
  if (next.length !== 4 || isNaN(next)){ alert(langIsKo ? "새 PIN은 숫자 4자리여야 합니다." : "The new PIN must be 4 digits."); return; }
  if (next !== next2){ alert(langIsKo ? "새 PIN이 일치하지 않습니다." : "The new PINs do not match."); return; }
  if (next === CREW_DEFAULT_PIN){ alert(langIsKo ? "1111은 기본값이므로 사용할 수 없습니다." : "1111 is the default value and cannot be used."); return; }
  const curHash = await pinHash(MY_NAME, cur);
  const row = await fetchCrewRow(MY_NAME);
  const stored = (row && row.pin_hash) || lsGet("pin-hash:" + MY_NAME) || await pinHash(MY_NAME, CREW_DEFAULT_PIN);
  if (curHash !== stored){ alert(langIsKo ? "현재 PIN이 일치하지 않습니다." : "Current PIN is wrong."); return; }
  await setCrewPin(MY_NAME, next, false);
  mustChangePin = false;
  logActivity("Changed own PIN");
  closePinSheet(); toast(langIsKo ? "PIN이 변경되었습니다" : "PIN has been changed");
  if (!MY_SITE && siteNames().length) openSitePicker();
}
function changePinPrompt(){ openPinSheet(false); }

// --- 관리자 비밀번호 ---
async function fetchAdminHash(){
  if (!sb) return undefined;
  try { const r = await withTimeout(sb.from("app_settings").select("value").eq("key", "admin_password_hash").maybeSingle()); if (!r || r.__timeout || r.error) return undefined; return r.data ? r.data.value : null; } catch(e){ return undefined; }
}
async function loginAdmin(){
  const input = document.getElementById("admin-password-input");
  const pw = input ? input.value.trim() : "";
  if (!pw){ alert(T("pwRequired")); return; }
  const abtn = document.querySelector("#view-admin-login .role-btn.employee"); if (abtn){ abtn.disabled = true; abtn.textContent = T("checking"); }
  const entered = await adminHash(pw), def = await adminHash(ADMIN_DEFAULT_PASSWORD);
  const server = await fetchAdminHash();
  let ok, needChange = false;
  if (server){ ok = entered === server; lsSet("admin-hash", server); }
  else if (server === null){ ok = entered === def; needChange = ok; }
  else { const cached = lsGet("admin-hash"); ok = cached ? entered === cached : entered === def; needChange = ok && !cached; }
  if (abtn){ abtn.disabled = false; abtn.textContent = T("loginBtn"); }
  if (!ok){ alert(T("pwWrong")); return; }
  lsSet("admin-session-active", "1");
  input.value = "";
  goTo("admin");
  if (needChange) setTimeout(() => { toast(T("defaultPwWarn"), 6000); }, 600);
}
function resetAdminPasswordToDefault(){
  appNotice(T("forgotPw"), T("forgotPwMsg"));
}
function openAdminPwSheet(){
  if (!requireOwner(T("actChangeAdminPw"))) return;
  ["apw-cur","apw-new","apw-new2"].forEach(id => document.getElementById(id).value = "");
  document.getElementById("apw-overlay").classList.add("active");
}
function closeAdminPwSheet(){ document.getElementById("apw-overlay").classList.remove("active"); }
function closeAdminPwSheetIfBg(e){ if (e.target.id === "apw-overlay") closeAdminPwSheet(); }
async function saveAdminPwSheet(){
  const cur = document.getElementById("apw-cur").value.trim(), next = document.getElementById("apw-new").value.trim(), next2 = document.getElementById("apw-new2").value.trim();
  if (next.length < 6){ alert(T("pwMin6")); return; }
  if (next !== next2){ alert(T("pwMismatch")); return; }
  const curHash = await adminHash(cur);
  const server = await fetchAdminHash();
  const stored = server || lsGet("admin-hash") || await adminHash(ADMIN_DEFAULT_PASSWORD);
  if (curHash !== stored){ alert(T("pwCurWrong")); return; }
  const h = await adminHash(next);
  lsSet("admin-hash", h);
  if (sb) await withTimeout(sb.from("app_settings").upsert({ key: "admin_password_hash", value: h }, { onConflict: "key" }));
  logActivity("Changed admin password");
  closeAdminPwSheet(); toast(T("pwChanged"));
}
function changeAdminPasswordPrompt(){ openAdminPwSheet(); }

// 사이트 고르기 (관리자가 배정 안 했을 때 크루가 직접)
function openSitePicker(){
  const names = siteNames();
  const box = document.getElementById("site-picker-list");
  if (!box) return;
  box.innerHTML = names.length ? names.map(n => `<button class="sheet-btn" onclick="pickSite('${escapeHtml(n)}')">${escapeHtml(n)}${n === MY_SITE ? " " : ""}</button>`).join("")
    : `<div class="chat-empty">${T("noSitesYet")}</div>`;
  document.getElementById("site-picker-overlay").classList.add("active");
}
function pickSite(n){
  MY_SITE = n; lsSet("my-site", n);
  if (MY_NAME) upsertCrew({ name: MY_NAME, site: n });
  closeSitePicker(); renderHome(); renderCalendar();
}
function closeSitePicker(){ document.getElementById("site-picker-overlay").classList.remove("active"); }
function closeSitePickerIfBg(e){ if (e.target.id === "site-picker-overlay") closeSitePicker(); }
// 이전에 "내 설정"에서 개인 PIN을 바꿔둔 기록이 남아있으면 그게 우선 적용되어 기본값이 안 먹힐 수 있음.
// 로그인이 안 될 때 이 버튼으로 기본값으로 되돌릴 수 있게 해둠.

// 관리자 로그인 (비밀번호 방식) - 데모용 기본값, 실제 서버 연동 시 인증 API로 교체
// 이전에 관리자 비밀번호를 바꿔둔 기록이 남아있으면 그게 우선 적용되어 기본값이 안 먹힐 수 있음.
// 로그인이 안 될 때 이 버튼으로 기본값으로 되돌릴 수 있게 해둠.

// 관리자 비밀번호 변경 (설정 아님 - 관리자 메뉴에서 최고관리자만)

function captureLocation(label){
  if (!("geolocation" in navigator)){
    console.warn("Geolocation not supported in this browser");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const record = {
        label,
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        time: new Date().toISOString()
      };
      const log = JSON.parse(lsGet("gps-log") || "[]");
      log.push(record);
      lsSet("gps-log", JSON.stringify(log));
    },
    (err) => { console.warn("Geolocation failed", err.message); },
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

function tickClock(){
  const now = new Date();
  document.getElementById("clock-time").textContent =
    pad(now.getHours()) + " : " + pad(now.getMinutes()) + " : " + pad(now.getSeconds());
}
setInterval(tickClock, 1000);

function notifyAdmin(message){
  // 실제 서버 연동 시 여기서 관리자에게 푸시 알림 전송
  console.log("[Admin notify]", message);
}


// 출근 버튼을 눌렀을 때 5초간 보여주는 응원 문구 (랜덤 1개). 전부 자체 제작 문장 + 저작권 없는 옛 격언.

// ===== 출퇴근 (GPS 100m 확인) =====
// 사이트 좌표 (데모). 관리자 "근무지 배정"에서 등록한 실제 좌표로 교체 예정
// 사이트 좌표는 관리자가 "근무지 배정"에서 등록한 값(siteCoords)을 씀
const GEOFENCE_METERS = 100;
// GPS 확인은 항상 켜져 있음 (끄는 옵션 없음). 폰의 위치 권한 상태만 보여주고, 꺼져 있으면 켜도록 안내
function gpsCheckEnabled(){ return true; }
let gpsPermState = "unknown"; // granted / prompt / denied / unsupported
function refreshGpsStatus(){
  const apply = (state) => {
    gpsPermState = state;
    const map = {
      granted:     { cls: "on",  home: T("gpsOn"), pill: T("pillOn") },
      prompt:      { cls: "",    home: T("gpsPrompt"), pill: T("pillPrompt") },
      denied:      { cls: "off", home: T("gpsDenied"), pill: T("pillOff") },
      unsupported: { cls: "off", home: T("gpsUnsupported"), pill: T("pillNo") }
    }[state] || { cls: "", home: T("gpsChecking"), pill: "…" };
    const home = document.getElementById("gps-status-home");
    if (home){ home.textContent = map.home; home.className = "gps-line " + map.cls; }
    const pill = document.getElementById("gps-status-settings");
    if (pill){ pill.textContent = map.pill; pill.className = "gps-pill " + map.cls; }
  };
  if (!("geolocation" in navigator)){ apply("unsupported"); return; }
  if (navigator.permissions && navigator.permissions.query){
    navigator.permissions.query({ name: "geolocation" }).then(res => {
      apply(res.state);
      res.onchange = () => apply(res.state);
    }).catch(() => apply("prompt"));
  } else {
    apply("prompt"); // iOS 구버전 등: 물어봐야 알 수 있음
  }
}
function handleGpsTap(){
  if (gpsPermState === "granted"){ toast(T("gpsOnToast")); return; }
  if (gpsPermState === "unsupported"){ appNotice(T("gpsUnsupTitle"), T("gpsUnsupMsg")); return; }
  if (gpsPermState === "denied"){
    appNotice(T("gpsOffTitle"), T("gpsOffMsg"));
    return;
  }
  // prompt 상태: 실제로 위치를 요청해서 폰의 허용 창을 띄움
  navigator.geolocation.getCurrentPosition(
    () => { toast(T("gpsEnabled")); refreshGpsStatus(); },
    (err) => { refreshGpsStatus(); if (err.code === 1) appNotice(T("gpsDeniedTitle"), T("gpsDeniedMsg")); },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}
// 두 좌표 사이 거리(m) — 지구를 공으로 보고 계산하는 공식(하버사인)
function distanceMeters(a, b){
  const R = 6371000, toRad = x => x * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat/2)**2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function fmtDistance(m){ return m >= 1000 ? (m/1000).toFixed(1) + "km" : Math.round(m) + "m"; }

function toggleClock(){
  const goingIn = !clockedIn;
  if (!goingIn){
    appConfirm(T("clockOutQ"), () => doClock(false), T("clockOutBtn"));
    return;
  }
  if (!("geolocation" in navigator)){
    appNotice(T("gpsFailTitle"), T("gpsFailUnsupMsg"));
    return;
  }
  const btn = document.getElementById("clock-btn");
  const prev = btn.textContent;
  btn.textContent = T("gpsChecking");
  btn.disabled = true;
  if (!MY_SITE){ appNotice(T("noSiteTitle"), T("noSiteMsg")); btn.textContent = prev; btn.disabled = false; return; }
  const site = siteCoords(MY_SITE);
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      btn.textContent = prev; btn.disabled = false;
      const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      if (!site){
        // 관리자가 아직 좌표를 안 넣은 사이트: 위치만 기록하고 출근 허용
        appConfirm(T("clockInQ") + " (" + T("siteNoCoords") + ")", () => doClock(true, here, null), T("clockInBtn"));
        return;
      }
      const dist = distanceMeters(here, site);
      if (dist <= GEOFENCE_METERS){
        appConfirm(`${MY_SITE} ${T("arrived")} (${fmtDistance(dist)}). ${T("clockInQ")}`, () => doClock(true, here, dist), T("clockInBtn"));
      } else {
        appNotice(T("farTitle"), T("farMsg").replace("{site}", MY_SITE).replace("{dist}", fmtDistance(dist)).replace("{m}", GEOFENCE_METERS));
      }
    },
    (err) => {
      btn.textContent = prev; btn.disabled = false;
      if (IS_PREVIEW){ appConfirm(T("previewClockQ"), () => doClock(true, null, null), T("clockInBtn")); return; }
      const why = err.code === 1 ? T("errPerm") : err.code === 3 ? T("errTimeout") : T("errGeneric");
      appNotice(T("gpsFailTitle"), why);
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 15000 }
  );
}

function doClock(goingIn, here, dist){
  const btn = document.getElementById("clock-btn");
  const status = document.getElementById("clock-status");
  const record = document.getElementById("clock-record");
  clockedIn = goingIn;
  const now = new Date();
  const timeStr = pad(now.getHours()) + ":" + pad(now.getMinutes());

  if (clockedIn){
    btn.textContent = T("clockOut");
    btn.classList.add("working");
    status.textContent = T("workingStatus");
    if (record) record.textContent = timeStr + " " + T("recordedIn") + " · " + MY_SITE;
    saveClockRecord({ crew: MY_NAME, site: MY_SITE, type: "in", at: now.toISOString(), lat: here ? here.lat : null, lng: here ? here.lng : null, dist });
    lsSet("clocked-in", "1");
    notifyAdmin(`[Clock-in] ${MY_NAME} at ${MY_SITE} (${timeStr})`);
    toast(T("clockedInMsg"));
  } else {
    btn.textContent = T("clockIn");
    btn.classList.remove("working");
    status.textContent = T("beforeWork");
    if (record) record.textContent = timeStr + " " + T("recordedOut") + " · " + MY_SITE;
    saveClockRecord({ crew: MY_NAME, site: MY_SITE, type: "out", at: now.toISOString() });
    lsSet("clocked-in", "0");
    notifyAdmin(`[Clock-out] ${MY_NAME} at ${MY_SITE} (${timeStr})`);
    toast(T("clockedOutMsg"));
    renderCalendar();
  }
}

function renderWeekRow(){
  const row = document.getElementById("week-row");
  if (!row) return;
  const dows = T("dow");
  const today = new Date();
  const todayDow = today.getDay();
  const worked = hoursFor(MY_NAME, today.getFullYear(), today.getMonth()).days;
  row.innerHTML = "";
  for (let i = -todayDow; i <= (6 - todayDow); i++){
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const el = document.createElement("div");
    el.className = "week-day";
    if (i === 0) el.classList.add("today");
    else if (d.getMonth() === today.getMonth() && worked[d.getDate()]) el.classList.add("worked");
    el.innerHTML = `<div class="dow">${dows[d.getDay()]}</div><div class="num">${d.getDate()}</div>`;
    row.appendChild(el);
  }
}

function openMenu(){ document.getElementById("quick-menu-overlay").classList.add("active"); }
function closeMenu(){ document.getElementById("quick-menu-overlay").classList.remove("active"); }
function closeMenuIfBg(e){ if (e.target.id === "quick-menu-overlay") closeMenu(); }

function openSettings(){ goTo("settings"); refreshGpsStatus(); const el = document.getElementById("settings-site-name"); if (el) el.textContent = MY_SITE || T("noSiteShort"); }

function setLang(lang){
  document.getElementById("lang-ko-chip").classList.toggle("active", lang === "ko");
  document.getElementById("lang-en-chip").classList.toggle("active", lang === "en");
  langIsKo = (lang === "ko");
  applyLang();
  lsSet("app-lang", lang);
}

function applyLang(){
  const dict = langIsKo ? i18n.ko : i18n.en;
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.dataset.i18n;
    if (dict[key] && typeof dict[key] === "string") el.textContent = dict[key];
  });
  document.querySelectorAll("[data-i18n-ph]").forEach(el => { const k = el.dataset.i18nPh; if (dict[k]) el.placeholder = dict[k]; });
  if (typeof renderHome === "function") renderHome();
  if (typeof renderCalendar === "function") renderCalendar();
  if (typeof refreshGpsStatus === "function") refreshGpsStatus();
  // 관리자 화면도 현재 언어로 다시 그림 (모든 목록/배지/상태 문구)
  ["renderAdminDashboard", "applyAdminRoleUI", "renderManagerList", "renderSupervisorList",
   "renderCrewStatusList", "renderSiteList", "renderAdminApprovals", "renderJoinApprovals",
   "renderAdminChecklist", "renderAdminCalendarGrid", "renderActivityLog", "renderChat"].forEach(fn => {
    try { if (typeof window[fn] === "function") window[fn](); } catch(e){}
  });
  try { if (typeof renderAdminCalendar === "function") renderAdminCalendar("all"); } catch(e){}
  const _td = document.getElementById("today-date"); if (_td) _td.textContent = fullDate(new Date());
  const _atd = document.getElementById("admin-today-date"); if (_atd) _atd.textContent = fullDate(new Date());
  try { if (typeof openSettings === "function" && document.getElementById("settings-site-name")) document.getElementById("settings-site-name").textContent = MY_SITE || T("noSiteShort"); } catch(e){}
}

// 글꼴 선택 (기본 / 그리운 프롬솔 / HS 활공명조) - 선택값은 저장되어 다음에 열어도 유지됨
// 기본(system) = 영문 Manrope(깔끔한 산세리프) + 한글 마루부리 조합

// 동료 스케줄: 같은 사이트 사람만. 다른 사이트 크루는 보이지 않음 (전 직원은 관리자 화면에서만)
function openColleagues(){
  closeMenu();
  const list = document.getElementById("colleague-list");
  const mates = crewList.filter(c => c.site === MY_SITE && c.name !== MY_NAME);
  list.innerHTML = mates.map(c => {
    const w = workingNow().find(x => x.name === c.name);
    const days = c.startDate ? T("since") + " " + c.startDate : "";
    const status = w ? `${T("working")} · ${w.clockIn}` : T("offToday");
    return `
    <div class="colleague-row">
      <div class="colleague-avatar"></div>
      <div>
        <div class="colleague-name">${c.name}</div>
        <div style="font-size:10px; color:#8A9490;">${days}</div>
      </div>
      <div class="colleague-time">${status}</div>
    </div>`;
  }).join("") || `<div class="chat-empty">${T("noMatesMsg")}</div>`;
  document.getElementById("colleague-overlay").classList.add("active");
}
function closeColleagues(){ document.getElementById("colleague-overlay").classList.remove("active"); }
function closeColleaguesIfBg(e){ if (e.target.id === "colleague-overlay") closeColleagues(); }


function promoteManager(name){
  if (!requireOwner(T("actPromoteMgr"))) return;
  appConfirm(fmtT("promoteMgrQ", { name }), () => promoteManagerDo(name), T("assignLabel"));
}
function promoteManagerDo(name){
  const managers = JSON.parse(lsGet("managers") || "[]");
  if (!managers.includes(name)) managers.push(name);
  lsSet("managers", JSON.stringify(managers));
  renderManagerList();
  logActivity(`Made ${name} a manager`);
  alert(fmtT("promoteMgrDone", { name }));
}
function renderManagerList(){
  const el = document.getElementById("manager-list");
  if (!el) return;
  const managers = JSON.parse(lsGet("managers") || "[]");
  const titleEl = el.previousElementSibling;
  if (titleEl) titleEl.textContent = `${T("managersTitle")} (${managers.length})`;
  el.innerHTML = managers.length
    ? managers.map(m => `<div class="rank-list-row"> ${m}</div>`).join("")
    : `<div class="rank-empty">${T("noManagers")}</div>`;
}
renderManagerList();

function promoteSupervisor(name){
  if (!requireOwner(T("actPromoteSup"))) return;
  appConfirm(fmtT("promoteSupQ", { name }), () => promoteSupervisorDo(name), T("assignLabel"));
}
function promoteSupervisorDo(name){
  const supervisors = JSON.parse(lsGet("supervisors") || "[]");
  if (!supervisors.includes(name)) supervisors.push(name);
  lsSet("supervisors", JSON.stringify(supervisors));
  renderSupervisorList();
  logActivity(`Made ${name} a supervisor`);
  alert(fmtT("promoteSupDone", { name }));
}
function renderSupervisorList(){
  const el = document.getElementById("supervisor-list");
  if (!el) return;
  const supervisors = JSON.parse(lsGet("supervisors") || "[]");
  const titleEl = el.previousElementSibling;
  if (titleEl) titleEl.textContent = `${T("supervisorsTitle")} (${supervisors.length})`;
  el.innerHTML = supervisors.length
    ? supervisors.map(m => `<div class="rank-list-row"> ${m}</div>`).join("")
    : `<div class="rank-empty">${T("noSupervisors")}</div>`;
}
renderSupervisorList();

function resetPin(name){
  if (!requireManagerUp(T("actResetPin"))) return;
  appConfirm(fmtT("resetPinQ", { name }), async () => {
    await setCrewPin(name, CREW_DEFAULT_PIN, true);
    logActivity(`Reset PIN for ${name}`);
    toast(fmtT("resetPinDone", { name }));
  }, T("resetLabel"));
}

// 관리자 직급: 최고관리자(owner) → 매니저(manager) → 슈퍼바이저(supervisor) 3단계
// owner: 전체 권한 / manager: 승인·가입승인·체크리스트 관리 등 (근무지배정·활동로그·승인대기·비번변경 제외)
// supervisor: 조회 위주 (승인/거절, PIN재설정, 초대, 매니저·슈퍼바이저 지정 불가)
const ADMIN_ROLE_ORDER = ["owner", "siteowner", "manager", "supervisor"];
// 직급별로 볼 수 있는 사이트. null = 전체. (데모: 작은사장님·매니저·슈퍼바이저는 Bondi + Manly 담당)
const ADMIN_SITES = {
  owner: null,
  siteowner: ["Coles Bondi", "Manly DC"],
  manager: ["Coles Bondi", "Manly DC"],
  supervisor: ["Coles Bondi", "Manly DC"]
};
function allowedSites(){ return ADMIN_SITES[currentAdminRole] === undefined ? null : ADMIN_SITES[currentAdminRole]; }
function canSeeSite(site){ const a = allowedSites(); return a === null || !site || a.includes(site); }
function visibleCrew(){ return crewList.filter(c => canSeeSite(c.site)); }
let currentAdminRole = "owner";
function toggleAdminRole(){
  const idx = ADMIN_ROLE_ORDER.indexOf(currentAdminRole);
  currentAdminRole = ADMIN_ROLE_ORDER[(idx + 1) % ADMIN_ROLE_ORDER.length];
  applyAdminRoleUI();
  if (document.getElementById("view-admin").classList.contains("active")) renderAdminDashboard();
  if (document.getElementById("view-admin-staff").classList.contains("active")) renderCrewStatusList();
  if (document.getElementById("view-admin-approvals").classList.contains("active")) renderAdminApprovals();
  if (document.getElementById("view-admin-joins").classList.contains("active")) renderJoinApprovals();
}
function applyAdminRoleUI(){
  const badge = document.getElementById("role-badge");
  const isOwner = currentAdminRole === "owner" || currentAdminRole === "siteowner"; // 작은사장님은 자기 사이트 안에서 최고관리자와 같은 권한
  const isManagerUp = isOwner || currentAdminRole === "manager";
  const labels = { owner: T("roleOwner"), siteowner: T("roleSiteowner") + T("previewSuffix"), manager: T("roleManager") + T("previewSuffix"), supervisor: T("roleSupervisor") + T("previewSuffix") };
  if (badge) badge.textContent = labels[currentAdminRole];
  const scope = document.getElementById("admin-scope");
  if (scope){ const a = allowedSites(); scope.textContent = a ? T("scopeSites") + a.join(" · ") : T("allSites"); }
  document.querySelectorAll(".owner-only").forEach(el => {
    el.style.display = isOwner ? "" : "none";
  });
  document.querySelectorAll(".manager-up").forEach(el => {
    el.style.display = isManagerUp ? "" : "none";
  });
}
// 역할 이름(한글) - 로그/기록에 사용
function currentRoleLabel(){
  return { owner: T("roleOwner"), siteowner: T("roleSiteowner"), manager: T("roleManager"), supervisor: T("roleSupervisor") }[currentAdminRole] || T("roleOwner");
}
// 버튼이 화면에서 숨겨져 있어도 직접 호출되는 걸 막기 위한 최소 권한 가드
function requireManagerUp(actionLabel){
  if (currentAdminRole === "supervisor"){
    alert(fmtT("needManagerUp", { a: actionLabel }));
    return false;
  }
  return true;
}
function requireOwner(actionLabel){
  if (currentAdminRole !== "owner" && currentAdminRole !== "siteowner"){
    alert(fmtT("needOwner", { a: actionLabel }));
    return false;
  }
  return true;
}

// Induction(안전교육 등) 만료일 = 입사일 + 1년. 만료 30일/7일 전부터 알림 표시.
function inductionExpiry(startDateStr){
  const d = new Date(startDateStr);
  if (isNaN(d.getTime())) return null;
  d.setFullYear(d.getFullYear() + 1);
  return d;
}
function daysUntilInduction(startDateStr){
  const exp = inductionExpiry(startDateStr);
  if (!exp) return null;
  const today = new Date();
  const todayMid = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const expMid = new Date(exp.getFullYear(), exp.getMonth(), exp.getDate());
  return Math.round((expMid - todayMid) / 86400000);
}
function formatDate(d){
  return d.getFullYear() + "-" + pad(d.getMonth()+1) + "-" + pad(d.getDate());
}
function inductionStatusFor(startDateStr){
  const days = daysUntilInduction(startDateStr);
  if (days === null) return null;
  const exp = inductionExpiry(startDateStr);
  let level = "ok";
  if (days < 0) level = "expired";
  else if (days <= 7) level = "urgent";
  else if (days <= 30) level = "warning";
  return { days, expiryText: formatDate(exp), level };
}

// 홈 화면 상단에 로그인한 크루의 induction 만료 임박 배너 표시
function renderHome(){
  const g = document.getElementById("greeting-text");
  if (g) g.textContent = MY_NAME ? T("greetingHi").replace("{name}", MY_NAME) : T("greetingNoName");
  const sl = document.getElementById("site-label");
  if (sl) sl.innerHTML = `${T("todaySite")} · <b>${MY_SITE || T("noSiteShort")}</b>`;
  const ml = document.getElementById("month-label"); if (ml) ml.textContent = T("monthTotal");
  const n = loadNotice(), nb = document.getElementById("notice-pin");
  if (nb){ if (n && n.text){ nb.style.display = "flex"; nb.innerHTML = `<b>${T("noticeLabel")}</b><span>${escapeHtml(n.text)}</span>`; } else nb.style.display = "none"; }
  const jobs = document.getElementById("today-jobs"), cnt = document.getElementById("today-jobs-count");
  if (jobs){
    if (!MY_SITE){ jobs.innerHTML = `<div class="chat-empty" style="margin:10px 0 20px;">${T("noJobs")}</div>`; if (cnt) cnt.textContent = ""; }
    else {
      const st = loadSites().find(x => x.name === MY_SITE) || {};
      const w = workingNow().find(x => x.name === MY_NAME);
      jobs.innerHTML = `<div class="job-card">
        <div class="job-time">${w ? w.clockIn : "—"}</div>
        <div class="job-info">
          <div class="job-addr" onclick="openMap('${escapeHtml(st.address || MY_SITE)}')">${escapeHtml(MY_SITE)}</div>
          <div class="job-meta">${escapeHtml(st.address || st.type || T("jobRegular"))}</div>
          <div class="job-checklist-link" onclick="openChecklist('${escapeHtml(MY_SITE)}')">${T("checklistLink")}</div>
        </div>
        <div class="job-status ${w ? "status-done" : "status-wait"}">${w ? T("working") : T("beforeWork")}</div>
      </div>`;
      if (cnt) cnt.textContent = "1";
    }
  }
  // 출근 상태 복원
  const btn = document.getElementById("clock-btn"), status = document.getElementById("clock-status");
  const w = workingNow().find(x => x.name === MY_NAME); clockedIn = !!w;
  if (btn){ btn.textContent = clockedIn ? T("clockOut") : T("clockIn"); btn.classList.toggle("working", clockedIn); }
  if (status) status.textContent = clockedIn ? T("workingStatus") : T("beforeWork");
  const rec = document.getElementById("clock-record"); if (rec && !clockedIn) rec.textContent = T("noRecord");
  if (rec && clockedIn) rec.textContent = w.clockIn + " " + T("recordedIn") + " · " + MY_SITE;
  renderWeekRow();
  const h = hoursFor(MY_NAME, new Date().getFullYear(), new Date().getMonth());
  const mh = document.getElementById("month-hours-line"); if (mh) mh.textContent = h.hours + "h · " + Object.keys(h.days).length + T("days");
}
function renderInductionBanner(){
  const el = document.getElementById("induction-banner");
  if (!el) return;
  const me = crewList.find(c => c.name === MY_NAME);
  const ind = me ? inductionStatusFor(me.startDate) : null;
  if (!ind || ind.level === "ok"){
    el.style.display = "none";
    return;
  }
  el.className = "induction-banner " + ind.level;
  el.style.display = "block";
  el.textContent = ind.level === "expired"
    ? (langIsKo ? `Induction(안전교육)이 만료됐습니다 (${ind.expiryText}). 관리자에게 재교육 일정을 문의하십시오.` : `Your induction expired on ${ind.expiryText}. Please ask your manager about renewal.`)
    : (langIsKo ? ` Induction(안전교육) 갱신일이 ${ind.expiryText}(D-${ind.days})로 예정되어 있습니다.` : `Induction renewal due ${ind.expiryText} (D-${ind.days}).`);
}

let inductionOpen = false;
function toggleInductionList(){ inductionOpen = !inductionOpen; renderAdminDashboard(); }
// 서버(Supabase) 연결 상태 진단 — "서버 조회 실패"의 원인을 화면에 사람 말로 보여줌
function checkServerStatus(){
  const el = document.getElementById("server-status");
  if (!el) return;
  if (!sb || IS_PREVIEW){ el.textContent = T("srvPreview"); el.className = "server-status"; return; }
  el.textContent = T("srvChecking"); el.className = "server-status";
  sb.from("activity_log").select("id").limit(1).then(({ error }) => {
    if (!error){ el.textContent = T("srvOk"); el.className = "server-status ok"; return; }
    const m = (error.message || "") + " " + (error.code || "");
    if (/does not exist|PGRST205|42P01|schema cache/i.test(m)){
      el.textContent = T("srvNoTables");
    } else if (/Failed to fetch|NetworkError|Load failed/i.test(m)){
      el.textContent = T("srvNoNet");
    } else if (/permission|RLS|policy|401|403/i.test(m)){
      el.textContent = T("srvDenied");
    } else {
      el.textContent = T("srvFail") + (error.message || T("srvUnknown"));
    }
    el.className = "server-status bad";
  });
}
function renderAdminDashboard(){
  checkServerStatus();
  if (!renderAdminDashboard._synced){ renderAdminDashboard._synced = true; syncClockRecordsFromServer(40, () => renderAdminDashboard()); syncCrewFromServer(); syncSitesFromServer(); }
  const requests = JSON.parse(lsGet("requests") || "[]");
  const applicants = JSON.parse(lsGet("join-applicants") || "[]");
  const working = workingNow().filter(w => canSeeSite(w.site));
  document.getElementById("stat-approvals").textContent = requests.filter(r => r.status === "대기").length;
  document.getElementById("stat-joins").textContent = applicants.filter(a => a.status === "대기").length;
  document.getElementById("stat-working").textContent = working.length;

  // 관리자 인사말: "에릭 사장님, 오늘 N명 나갔어요"
  const greetEl = document.getElementById("admin-greeting");
  if (greetEl){
    greetEl.innerHTML = langIsKo
      ? "에릭 대표님<br>금일 근무 인원 " + working.length + "명"
      : "Hello Eric<br>" + working.length + " crew on duty today";
  }

  const dateEl = document.getElementById("admin-today-date");
  if (dateEl){
    const d = new Date();
    dateEl.textContent = fullDate(d);
  }

  const countEl = document.getElementById("working-count-small");
  if (countEl) countEl.textContent = working.length + T("peopleSuffix");

  const list = document.getElementById("working-now-list");
  if (list){
    list.innerHTML = working.map(c => `
      <div class="job-card">
        <div class="job-info">
          <div class="job-addr">${c.name}</div>
          <div class="job-meta">${c.site} · ${fmtT("clockInAt", { t: c.clockIn })}</div>
        </div>
        <div class="job-status status-done">${T("workingStatus")}</div>
      </div>
    `).join("") || `<div class="job-card"><div class="job-info"><div class="job-addr">${T("noWorkingCrew")}</div><div class="job-meta">${T("noWorkingCrewSub")}</div></div></div>`;
  }

  const inductionSoon = visibleCrew()
    .map(c => ({ c, ind: inductionStatusFor(c.startDate) }))
    .filter(x => x.ind && (x.ind.level === "expired" || x.ind.level === "urgent" || x.ind.level === "warning"));
  const alertBlock = document.getElementById("induction-alert-block");
  const alertList = document.getElementById("induction-alert-list");
  if (alertBlock && alertList){
    const toggleBtn = document.getElementById("induction-toggle");
    if (inductionSoon.length === 0){
      alertBlock.style.display = "none";
      if (toggleBtn) toggleBtn.style.display = "none";
    } else {
      if (toggleBtn){ toggleBtn.style.display = ""; toggleBtn.textContent = fmtT("inductionSoonBtn", { n: inductionSoon.length }); }
      alertBlock.style.display = inductionOpen ? "block" : "none";
      alertList.innerHTML = inductionSoon.map(({c, ind}) => `
        <div class="job-card">
          <div class="job-info">
            <div class="job-addr">${c.name}</div>
            <div class="job-meta">${c.site}</div>
          </div>
          <div class="job-status" style="background:${ind.level === 'warning' ? 'var(--honeydew)' : '#EAD8D6'}; color:${ind.level === 'warning' ? '#5C5B2C' : '#8A3B30'};">
            ${ind.level === "expired" ? T("expiredLabel") : "D-" + ind.days}
          </div>
        </div>
      `).join("");
    }
  }
}

// 관리자 캘린더 달력 — 크루 근무(초록점) / 사업·미팅(검정점) / 개인(분홍점) / 크루 이슈(! 표시)
function renderAdminCalendarGrid(){
  const grid = document.getElementById("admin-calendar-grid");
  if (!grid) return;
  grid.innerHTML = "";
  const dows = T("dow");
  dows.forEach(d => {
    const el = document.createElement("div");
    el.className = "cal-dow";
    el.textContent = d;
    grid.appendChild(el);
  });
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const startOffset = new Date(calYear, calMonth, 1).getDay();
  const events = visibleAdminEvents().filter(e => e.date && e.date.startsWith(`${calYear}-${pad(calMonth + 1)}`));
  const t = document.getElementById("admin-cal-month-title"); if (t) t.textContent = monthTitle(calYear, calMonth);
  const notes = loadNotes();

  for (let i = 0; i < startOffset; i++){
    grid.appendChild(document.createElement("div"));
  }
  for (let d = 1; d <= daysInMonth; d++){
    const el = document.createElement("div");
    el.className = "cal-day";
    const dayEvents = events.filter(e => eventDay(e) === d);
    const types = new Set(dayEvents.map(e => e.type));
    if (dayEvents.length === 0 && !notes[d]) el.classList.add("off");
    el.textContent = d;
    const dots = document.createElement("span");
    dots.className = "cal-dots";
    ["shift","business","personal"].forEach(t => {
      if (types.has(t)){ const i = document.createElement("i"); i.className = "d-" + t; dots.appendChild(i); }
    });
    el.appendChild(dots);
    if (notes[d] && notes[d].issue) el.classList.add("has-issue");
    else if (notes[d]) el.classList.add("has-note");
    if (d === selectedAdminDay) el.classList.add("selected");
    el.onclick = () => selectAdminCalendarDay(d);
    grid.appendChild(el);
  }
}

let crewSheetEditing = null;
function openCrewSheet(name){
  if (!requireManagerUp(T("actEditCrew"))) return;
  const c = name ? crewList.find(x => x.name === name) : null;
  crewSheetEditing = name || null;
  document.getElementById("crew-name").value = c ? c.name : "";
  document.getElementById("crew-phone").value = c ? (c.phone || "") : "";
  document.getElementById("crew-address").value = c ? (c.address || "") : "";
  document.getElementById("crew-start").value = c ? (c.startDate || "") : "";
  const sel = document.getElementById("crew-site");
  sel.innerHTML = `<option value="">${T("siteUnassigned")}</option>` + siteNames().map(n => `<option value="${escapeHtml(n)}" ${c && c.site === n ? "selected" : ""}>${escapeHtml(n)}</option>`).join("");
  document.getElementById("crew-delete-btn").style.display = c ? "flex" : "none";
  document.getElementById("crew-overlay").classList.add("active");
}
function closeCrewSheet(){ document.getElementById("crew-overlay").classList.remove("active"); }
function closeCrewSheetIfBg(e){ if (e.target.id === "crew-overlay") closeCrewSheet(); }
function saveCrewSheet(){
  const name = document.getElementById("crew-name").value.trim();
  if (!name){ alert(T("nameRequired")); return; }
  if (crewSheetEditing && crewSheetEditing !== name){ crewList = crewList.filter(x => x.name !== crewSheetEditing); saveCrew(); }
  upsertCrew({ name, phone: document.getElementById("crew-phone").value.trim(), address: document.getElementById("crew-address").value.trim(),
    startDate: document.getElementById("crew-start").value, site: document.getElementById("crew-site").value });
  logActivity(`Crew ${crewSheetEditing ? "updated" : "added"}: ${name}`);
  closeCrewSheet(); renderCrewStatusList(); toast(fmtT("savedName", { name }));
}
function deleteCrewSheet(){
  const name = crewSheetEditing; if (!name) return;
  appConfirm(fmtT("deleteCrewQ", { name }), () => {
    crewList = crewList.filter(x => x.name !== name); saveCrew();
    if (sb) sb.from("crew").update({ active: false }).eq("name", name).then(() => {});
    logActivity(`Crew removed: ${name}`); closeCrewSheet(); renderCrewStatusList();
  }, T("deleteLabel"), "danger");
}
function renderCrewStatusList(){
  const container = document.getElementById("crew-status-list");
  if (!container) return;
  const wn = workingNow();
  if (!visibleCrew().length){ container.innerHTML = `<div class="chat-empty" style="margin:30px 0;">${T("noCrewMsg")}</div>`; return; }
  container.innerHTML = visibleCrew().map(c => {
    const w = wn.find(x => x.name === c.name); c.status = w ? "working" : "off"; c.clockIn = w ? w.clockIn : "";
    const ind = inductionStatusFor(c.startDate);
    const indColor = { expired: "#B4453A", urgent: "#B4453A", warning: "#7A5A20", ok: "#8A9490" };
    const indText = ind
      ? (ind.level === "expired"
          ? fmtT("indExpired", { d: ind.expiryText })
          : fmtT("indDue", { d: ind.expiryText, n: ind.days }))
      : "";
    return `
    <div class="job-card">
      <div class="job-info">
        <div class="job-addr" onclick="openCrewSheet('${c.name}')" style="cursor:pointer;">${c.name} <span style="font-size:11px; color:var(--text-muted); font-weight:500;">${T("editSuffix")}</span></div>
        <div class="job-meta">${c.site || T("siteUnassigned")} · ${c.status === "working" ? fmtT("workingSince", { t: c.clockIn }) : T("beforeWork")}</div>
        <div class="job-meta">${c.phone ? c.phone + " · " : ""}${c.address ? c.address + " · " : ""}${T("startPrefix")}${c.startDate || "-"}</div>
        ${ind ? `<div class="job-meta" style="color:${indColor[ind.level]}; font-weight:600;">${indText}</div>` : ""}
      </div>
      <div style="display:flex; flex-direction:column; align-items:flex-end; gap:6px;">
        <div class="job-status ${c.status === 'working' ? 'status-done' : 'status-wait'}">${c.status === "working" ? T("workingStatus") : T("offDuty")}</div>
        <button class="login-btn manager-up" style="padding:4px 10px; font-size:10px;" onclick="resetPin('${c.name}')">${T("resetPinBtn")}</button>
        <button class="login-btn owner-only" style="padding:4px 10px; font-size:10px;" onclick="promoteManager('${c.name}')">${T("promoteMgrBtn")}</button>
        <button class="login-btn owner-only" style="padding:4px 10px; font-size:10px;" onclick="promoteSupervisor('${c.name}')">${T("promoteSupBtn")}</button>
      </div>
    </div>
  `;
  }).join("");
}

// ===== 사이트별 요일 체크리스트 =====
function CHECKLIST_SITES_(){ return siteNames(); }
const CHECKLIST_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const CHECKLIST_DAY_LABELS = { mon:"월", tue:"화", wed:"수", thu:"목", fri:"금", sat:"토", sun:"일" };
function todayChecklistDay(){
  return CHECKLIST_DAYS[(new Date().getDay() + 6) % 7]; // JS getDay: 일=0 → mon을 0으로 재정렬
}
let checklistAdminSite = siteNames()[0] || "";
let checklistAdminDay = todayChecklistDay();

function getChecklistItems(site, day){
  const all = JSON.parse(lsGet("checklists") || "{}");
  return all[site + "|" + day] || [];
}
function saveChecklistItems(site, day, items){
  const all = JSON.parse(lsGet("checklists") || "{}");
  all[site + "|" + day] = items;
  lsSet("checklists", JSON.stringify(all));

  if (sb){
    sb.from("checklist_items").upsert({
      site_day: site + "|" + day,
      site,
      weekday: day,
      items
    }, { onConflict: "site_day" })
      .then(({ error }) => { if (error) console.warn("checklist_items server save failed (kept locally):", error.message); });
  }
}
// 서버(Supabase)에 저장된 전체 체크리스트를 불러와 로컬과 병합 (다른 관리자가 다른 기기에서 등록한 항목 반영용)
function syncChecklistsFromServer(onDone){
  if (!sb){ if (onDone) onDone(); return; }
  sb.from("checklist_items").select("*")
    .then(({ data, error }) => {
      if (error){ console.warn("checklist_items server fetch failed (using local only):", error.message); if (onDone) onDone(); return; }
      if (data && data.length){
        const all = JSON.parse(lsGet("checklists") || "{}");
        data.forEach(row => { all[row.site_day] = row.items || []; });
        lsSet("checklists", JSON.stringify(all));
      }
      if (onDone) onDone();
    });
}

function renderAdminChecklist(){
  if (!checklistAdminSite || !siteNames().includes(checklistAdminSite)) checklistAdminSite = siteNames()[0] || "";
  const siteRow = document.getElementById("checklist-site-row");
  const dayRow = document.getElementById("checklist-day-row");
  if (!siteRow || !dayRow) return;
  siteRow.innerHTML = CHECKLIST_SITES_().map(s =>
    `<button class="settings-chip ${s === checklistAdminSite ? 'active' : ''}" onclick="selectChecklistSite('${s}', this)">${s}</button>`
  ).join("");
  dayRow.innerHTML = CHECKLIST_DAYS.map(d =>
    `<div class="admin-tab ${d === checklistAdminDay ? 'active' : ''}" onclick="selectChecklistDay('${d}', this)">${dayShort(d)}</div>`
  ).join("");
  renderChecklistItemList();
  syncChecklistsFromServer(renderChecklistItemList); // 다른 관리자가 다른 기기에서 등록한 항목도 반영
}
function selectChecklistSite(site, btn){
  checklistAdminSite = site;
  btn.parentElement.querySelectorAll(".settings-chip").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  renderChecklistItemList();
}
function selectChecklistDay(day, btn){
  checklistAdminDay = day;
  btn.parentElement.querySelectorAll(".admin-tab").forEach(t => t.classList.remove("active"));
  btn.classList.add("active");
  renderChecklistItemList();
}
function renderChecklistItemList(){
  const list = document.getElementById("checklist-item-list");
  if (!list) return;
  const items = getChecklistItems(checklistAdminSite, checklistAdminDay);
  list.innerHTML = items.length
    ? items.map((item, i) => `
      <div class="job-card">
        <div class="job-info"><div class="job-addr">${item}</div></div>
        <button class="login-btn" style="padding:4px 10px; font-size:11px;" onclick="removeChecklistItem(${i})">${T("deleteLabel")}</button>
      </div>`).join("")
    : `<div class="job-card"><div class="job-info"><div class="job-addr">${T("noItems")}</div></div></div>`;
}
function addChecklistItem(){
  if (!checklistAdminSite){ appNotice(T("noSiteTitle2"), T("noSiteMsg2")); return; }
  appPrompt(fmtT("addItemTitle", { site: checklistAdminSite, day: dayFull(checklistAdminDay) }), T("promptItemPh"), (text) => addChecklistItemDo(text));
}
function addChecklistItemDo(text){
  if (!text || !text.trim()) return;
  const items = getChecklistItems(checklistAdminSite, checklistAdminDay);
  items.push(text.trim());
  saveChecklistItems(checklistAdminSite, checklistAdminDay, items);
  logActivity(`Checklist item added: ${checklistAdminSite} (${checklistAdminDay})`);
  renderChecklistItemList();
}
function removeChecklistItem(index){
  const items = getChecklistItems(checklistAdminSite, checklistAdminDay);
  items.splice(index, 1);
  saveChecklistItems(checklistAdminSite, checklistAdminDay, items);
  renderChecklistItemList();
}

// 크루용: 오늘 배정된 사이트의 체크리스트 확인 + 체크
let checklistOpenSite = null;
function openChecklist(site){
  checklistOpenSite = site;
  const day = todayChecklistDay();
  const items = getChecklistItems(site, day);
  const progress = JSON.parse(lsGet("checklist-progress") || "{}");
  const todayKey = formatDate(new Date()) + "|" + site;
  const checked = progress[todayKey] || [];

  document.getElementById("checklist-sheet-title").textContent = fmtT("checklistSheetTitle", { site, day: dayFull(day) });
  const list = document.getElementById("checklist-progress-list");
  list.innerHTML = items.length
    ? items.map((item, i) => `
      <label class="colleague-row" style="cursor:pointer;">
        <input type="checkbox" ${checked.includes(i) ? "checked" : ""} onchange="toggleChecklistItem(${i})" style="width:18px; height:18px; flex-shrink:0;">
        <div style="${checked.includes(i) ? 'text-decoration:line-through; color:var(--text-muted);' : ''}">${item}</div>
      </label>`).join("")
    : '<div class="chat-empty">해당 근무지에 등록된 체크리스트가 없습니다. 관리자에게 문의하십시오.</div>';
  document.getElementById("checklist-overlay").classList.add("active");

  // 관리자가 다른 기기에서 방금 등록한 항목이 있을 수 있으니 서버에서 최신 목록을 받아 다시 그림
  syncChecklistsFromServer(() => {
    if (checklistOpenSite === site) openChecklistRedrawOnly(site);
  });
}
// openChecklist와 동일하게 그리되, 무한 재귀(서버 재조회)는 하지 않는 버전
function openChecklistRedrawOnly(site){
  const day = todayChecklistDay();
  const items = getChecklistItems(site, day);
  const progress = JSON.parse(lsGet("checklist-progress") || "{}");
  const todayKey = formatDate(new Date()) + "|" + site;
  const checked = progress[todayKey] || [];
  const list = document.getElementById("checklist-progress-list");
  if (!list) return;
  list.innerHTML = items.length
    ? items.map((item, i) => `
      <label class="colleague-row" style="cursor:pointer;">
        <input type="checkbox" ${checked.includes(i) ? "checked" : ""} onchange="toggleChecklistItem(${i})" style="width:18px; height:18px; flex-shrink:0;">
        <div style="${checked.includes(i) ? 'text-decoration:line-through; color:var(--text-muted);' : ''}">${item}</div>
      </label>`).join("")
    : '<div class="chat-empty">해당 근무지에 등록된 체크리스트가 없습니다. 관리자에게 문의하십시오.</div>';
}
function toggleChecklistItem(index){
  if (!checklistOpenSite) return;
  const progress = JSON.parse(lsGet("checklist-progress") || "{}");
  const todayKey = formatDate(new Date()) + "|" + checklistOpenSite;
  let checked = progress[todayKey] || [];
  if (checked.includes(index)) checked = checked.filter(i => i !== index);
  else checked.push(index);
  progress[todayKey] = checked;
  lsSet("checklist-progress", JSON.stringify(progress));
  openChecklist(checklistOpenSite); // 체크 상태(취소선) 즉시 반영
}
function closeChecklist(){ document.getElementById("checklist-overlay").classList.remove("active"); }
function closeChecklistIfBg(e){ if (e.target.id === "checklist-overlay") closeChecklist(); }

// 매니저에게 개인업무 캘린더 공개 여부

// 활동 로그 (PIN재설정, 초대문자 등 민감 작업 기록)
// 로컬에 즉시 저장(화면 반응 빠르게) + 백그라운드로 Supabase에도 저장(다른 기기와 공유)
function logActivity(message){
  const log = JSON.parse(lsGet("activity-log") || "[]");
  const actor = currentRoleLabel();
  log.push({ message, actor, time: new Date().toLocaleString("ko-KR") });
  lsSet("activity-log", JSON.stringify(log));

  if (sb){
    sb.from("activity_log").insert({ actor_name: actor, message })
      .then(({ error }) => { if (error) console.warn("activity_log server save failed (kept locally):", error.message); });
  }
}
function renderActivityLog(){
  const list = document.getElementById("activity-log-list");
  if (!list) return;
  const log = JSON.parse(lsGet("activity-log") || "[]");
  const draw = (items) => {
    list.innerHTML = items.slice().reverse().map(item => `
      <div class="job-card">
        <div class="job-info">
          <div class="job-addr">${item.message}</div>
          <div class="job-meta">${item.actor} · ${item.time}</div>
        </div>
      </div>
    `).join("") || `<div class="job-card"><div class="job-info"><div class="job-addr">${T("noActivity")}</div></div></div>`;
  };
  draw(log); // 우선 로컬 기록으로 즉시 표시

  if (sb){
    sb.from("activity_log").select("*").order("created_at", { ascending: true })
      .then(({ data, error }) => {
        if (error){ console.warn("activity_log server fetch failed (showing local only):", error.message); return; }
        if (!data) return;
        const merged = data.map(row => ({
          message: row.message,
          actor: row.actor_name,
          time: new Date(row.created_at).toLocaleString("ko-KR")
        }));
        lsSet("activity-log", JSON.stringify(merged));
        draw(merged); // 다른 기기에서 남긴 기록까지 포함해서 다시 표시
      });
  }
}

// ===== 통합 캘린더 =====
// 일정 한 건 = { type, audience, label, date:"2026-08-18", time:"14:00" }
//   type: shift(크루 근무) / business(사업·미팅) / personal(개인)
//   audience(공개 범위): owner(작은사장님만) / manager(매니저까지) / crew(크루 전체)
const demoAdminEvents = [];
function loadAdminEvents(){
  const saved = lsGet("admin-events");
  if (saved) return JSON.parse(saved);
  lsSet("admin-events", JSON.stringify(demoAdminEvents));
  return demoAdminEvents.slice();
}
function saveAdminEvents(list){ lsSet("admin-events", JSON.stringify(list)); }
function eventDay(e){ return parseInt((e.date || "").split("-")[2], 10); }
const AUDIENCE_RANK = { owner: 3, manager: 2, crew: 1 };


// 지금 로그인한 관리자 직급이 볼 수 있는 일정만
function visibleAdminEvents(){
  const myRank = currentAdminRole === "owner" ? 3 : (currentAdminRole === "manager" ? 2 : 1);
  return loadAdminEvents().filter(e => AUDIENCE_RANK[e.audience || "owner"] <= myRank);
}
// 크루 화면에서 볼 수 있는 일정 (공개 범위 = 크루 전체)
function crewVisibleEvents(){
  return loadAdminEvents().filter(e => (e.audience || "owner") === "crew");
}

// 캘린더는 날짜를 탭해야 그날 일정 리스트가 열림
let selectedAdminDay = null;
function selectAdminCalendarDay(day){
  selectedAdminDay = (selectedAdminDay === day) ? null : day;
  renderAdminCalendarGrid();
  renderAdminCalendar(document.querySelector("#calendar-filter-row .admin-tab.active")?.dataset.filter || "all");
}
function renderAdminCalendar(filter){
  const list = document.getElementById("admin-calendar-list");
  if (!list) return;

  if (selectedAdminDay === null){
    list.innerHTML = "";
    return;
  }
  const d = selectedAdminDay;
  let events = visibleAdminEvents().filter(e => e.date && e.date.startsWith(`${calYear}-${pad(calMonth + 1)}`) && eventDay(e) === d);
  if (filter && filter !== "all") events = events.filter(e => e.type === filter);
  events.sort((a, b) => (a.time || "").localeCompare(b.time || ""));
  const note = loadNotes()[d];
  const dowName = T("dow")[new Date(calYear, calMonth, d).getDay()];

  let html = `<div class="day-detail">
    <div class="day-detail-head"><b>${langIsKo ? `${calMonth + 1}월 ${d}일 ${dowName}요일` : `${dowName}, ${T("monthNames")[calMonth]} ${d}`}</b><span>${fmtT("countEvents", { n: events.length })}</span></div>`;
  if (note){
    html += `<div class="day-note ${note.issue ? "issue" : ""}">
      <div class="day-note-k">${note.issue ? T("crewIssue") : T("crewMemo")}</div>
      <div>${escapeHtml(note.text)}</div>
    </div>`;
  }
  html += events.map((e, i) => `
    <div class="ev-row">
      <i class="d-${e.type}"></i>
      <div class="ev-body">
        <div class="ev-title">${escapeHtml(e.label)}</div>
        <div class="ev-meta">${e.time || T("allDay")} · ${evTypeLabel(e.type)} · ${audLabel(e.audience)}</div>
      </div>
      ${currentAdminRole !== "supervisor" ? `<button class="ev-del" onclick="deleteEvent('${e.date}','${escapeHtml(e.label).replace(/'/g, "\\'")}')"></button>` : ""}
    </div>`).join("");
  if (!events.length && !note) html += `<div class="chat-empty" style="margin:14px 0;">${T("noEventsDay")}</div>`;
  const wd = loadClockRecords().filter(r => { const x = new Date(r.at); return x.getFullYear() === calYear && x.getMonth() === calMonth && x.getDate() === d && r.type === "in" && canSeeSite(r.site); });
  if (wd.length) html = html.replace('</div>', `</div><div class="ev-meta" style="margin-bottom:6px;">${fmtT("workedDayFmt", { n: wd.length, names: wd.map(r => escapeHtml(r.crew)).join(", ") })}</div>`);
  html += `</div>`;
  list.innerHTML = html;
}
function filterAdminCalendar(type, btn){
  btn.parentElement.querySelectorAll(".admin-tab").forEach(t => t.classList.remove("active"));
  btn.classList.add("active");
  renderAdminCalendar(type);
}
function escapeHtml(str){
  return String(str).replace(/[&<>"]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[c]));
}

// 일정 추가 시트
function pickChip(btn){
  btn.parentElement.querySelectorAll(".settings-chip").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
}
function chipValue(rowId){ return document.querySelector("#" + rowId + " .settings-chip.active")?.dataset.v; }
function openNoticeSheet(){
  if (!requireManagerUp(T("actNotice"))) return;
  const n = loadNotice();
  document.getElementById("notice-input").value = n ? n.text : "";
  document.getElementById("notice-sheet-overlay").classList.add("active");
}
function closeNoticeSheet(){ document.getElementById("notice-sheet-overlay").classList.remove("active"); }
function closeNoticeSheetIfBg(e){ if (e.target.id === "notice-sheet-overlay") closeNoticeSheet(); }
function saveNoticeSheet(){
  const text = document.getElementById("notice-input").value.trim();
  saveNotice(text ? { text, by: currentRoleLabel(), at: new Date().toISOString() } : null);
  logActivity(text ? `Notice posted: ${text.slice(0, 40)}` : "Notice removed");
  closeNoticeSheet(); toast(text ? T("noticePosted") : T("noticeRemoved"));
}
function openEventSheet(){
  if (!requireManagerUp(T("actAddEvent"))) return;
  const dateInput = document.getElementById("ev-date");
  if (dateInput) dateInput.value = selectedAdminDay ? `${calYear}-${pad(calMonth + 1)}-${pad(selectedAdminDay)}` : formatDate(new Date());
  document.getElementById("ev-title").value = "";
  document.getElementById("ev-time").value = "";
  document.getElementById("event-overlay").classList.add("active");
}
function closeEventSheet(){ document.getElementById("event-overlay").classList.remove("active"); }
function closeEventSheetIfBg(e){ if (e.target.id === "event-overlay") closeEventSheet(); }
function saveEvent(){
  const label = document.getElementById("ev-title").value.trim();
  const date = document.getElementById("ev-date").value;
  const time = document.getElementById("ev-time").value;
  if (!label || !date){ alert(T("titleDateRequired")); return; }
  const type = chipValue("ev-type-row") || "business";
  let audience = chipValue("ev-aud-row") || "owner";
  // 매니저는 '작은사장님만' 범위로는 못 만듦 (자기도 못 보게 되니까)
  if (currentAdminRole === "manager" && audience === "owner") audience = "manager";
  const list = loadAdminEvents();
  list.push({ type, audience, label, date, time });
  saveAdminEvents(list);
  logActivity(`Event added: ${label} (${date} · ${audience})`);
  closeEventSheet();
  selectedAdminDay = eventDay({ date });
  renderAdminCalendarGrid();
  renderAdminCalendar("all");
}
function deleteEvent(date, label){
  appConfirm(fmtT("deleteEventQ", { label }), () => deleteEventDo(date, label), T("deleteLabel"), "danger");
}
function deleteEventDo(date, label){
  const list = loadAdminEvents().filter(e => !(e.date === date && e.label === label));
  saveAdminEvents(list);
  renderAdminCalendarGrid();
  renderAdminCalendar(document.querySelector("#calendar-filter-row .admin-tab.active")?.dataset.filter || "all");
}
// (이전 버전 호환용 — 이제 공개 범위는 일정마다 따로 정함)
function togglePersonalShare(checked){ lsSet("share-personal-calendar", checked ? "1" : "0"); }
function addPersonalEvent(){ openEventSheet(); }


// ===== 연차 뱃지 (캐릭터 시스템 제거 후에도 유지) =====
// 연차 뱃지: 레벨과 별개로 입사일 기준
function seniorityBadge(startDateStr){
  if (!startDateStr) return null;
  const years = (Date.now() - new Date(startDateStr).getTime()) / (365.25 * 86400000);
  if (years >= 5) return { label: langIsKo ? "5년차 베테랑" : "5-yr veteran", short: "5Y" };
  if (years >= 3) return { label: langIsKo ? "3년차 베테랑" : "3-yr veteran", short: "3Y" };
  if (years >= 1) return { label: Math.floor(years) + (langIsKo ? "년차" : " yr"), short: Math.floor(years) + "Y" };
  const months = Math.max(1, Math.floor(years * 12));
  return { label: months + (langIsKo ? "개월차" : " mo"), short: months + "M" };
}
function myStartDate(){ const me = crewList.find(c => c.name === MY_NAME); return me && me.startDate ? me.startDate : (lsGet("my-start") || null); }

// 근태 신청 시트 (오버타임 / 휴가 / 병가 / 대체근무)
let reqType = "overtime";
function openRequestSheet(type){
  closeMenu();
  reqType = type || "overtime";
  document.querySelectorAll("#req-type-row .settings-chip").forEach(b => b.classList.toggle("active", b.dataset.v === reqType));
  document.getElementById("req-date").value = formatDate(new Date());
  document.getElementById("req-hours").value = "1";
  document.getElementById("req-who").value = "";
  document.getElementById("req-note").value = "";
  syncReqFields();
  document.getElementById("request-overlay").classList.add("active");
}
function pickReqType(btn){ reqType = btn.dataset.v; pickChip(btn); syncReqFields(); }
function syncReqFields(){
  document.getElementById("req-hours-row").style.display = reqType === "overtime" ? "" : "none";
  document.getElementById("req-who-row").style.display = reqType === "cover" ? "" : "none";
}
function closeRequestSheet(){ document.getElementById("request-overlay").classList.remove("active"); }
function closeRequestSheetIfBg(e){ if (e.target.id === "request-overlay") closeRequestSheet(); }
function sendRequest(){
  const date = document.getElementById("req-date").value, note = document.getElementById("req-note").value.trim();
  if (!date){ alert(T("reqDate")); return; }
  if (reqType === "overtime"){ const hours = document.getElementById("req-hours").value; saveRequest("overtime", { date, hours, note }); }
  else if (reqType === "cover"){ const colleague = document.getElementById("req-who").value.trim(); if (!colleague){ alert(T("reqWho")); return; } saveRequest("substitute", { date, colleague, note }); }
  else saveRequest("leave", { type: reqType === "sick" ? "sick" : "leave", date, note });
  closeRequestSheet(); toast(T("reqSent"));
}
// (이전 버전 호환)
function submitOvertime(){ openRequestSheet("overtime"); }
function submitLeave(){ openRequestSheet("leave"); }
function submitSubstitute(){ openRequestSheet("cover"); }

function saveRequest(type, data){
  const log = JSON.parse(lsGet("requests") || "[]");
  const entry = { type, data, site: MY_SITE, crew: MY_NAME, time: new Date().toISOString(), status: "대기" };
  log.push(entry);
  lsSet("requests", JSON.stringify(log));
  renderAdminApprovals();

  if (sb){
    sb.from("requests").insert({
      crew_name: currentRoleLabel(),
      type,
      data,
      status: "대기"
    }).select().single().then(({ data: row, error }) => {
      if (error){ console.warn("requests server save failed (kept locally):", error.message); return; }
      // 방금 로컬에 넣은 항목에 서버 id를 매칭해서 붙여둠 (나중에 승인/거절 시 서버 업데이트용)
      const cur = JSON.parse(lsGet("requests") || "[]");
      const target = cur.find(r => !r.sbId && r.type === entry.type && r.time === entry.time);
      if (target && row){
        target.sbId = row.id;
        lsSet("requests", JSON.stringify(cur));
      }
    });
  }
}

function renderAdminApprovals(){
  const list = document.getElementById("admin-approvals");
  if (!list) return;
  const draw = (allLog) => {
        // 담당 사이트 요청만 (사이트 정보 없는 예전 요청은 전체 관리자만)
    const log = allLog.map((it, idx) => ({ it, idx })).filter(x => x.it.site ? canSeeSite(x.it.site) : allowedSites() === null).map(x => x.it);
    if (log.length === 0){
      list.innerHTML = `<div class="job-card"><div class="job-info"><div class="job-addr">${T("noPendingReq")}</div></div></div>`;
      return;
    }
    list.innerHTML = log.slice().reverse().map((item, i) => {
      const idx = allLog.indexOf(item);
      const statusClass = item.status === "승인" ? "status-done" : "status-wait";
      const actions = item.status === "대기"
        ? `<button class="login-btn" style="padding:4px 10px; font-size:11px;" onclick="decideRequest(${idx}, '승인')">${T("approveBtn")}</button>
           <button class="login-btn" style="padding:4px 10px; font-size:11px;" onclick="decideRequest(${idx}, '거절')">${T("rejectBtn")}</button>`
        : "";
      const byline = item.decidedBy ? `<div class="job-meta" style="margin-top:2px;">${fmtT("decidedByFmt", { name: item.decidedBy })}</div>` : "";
      return `
      <div class="job-card">
        <div class="job-info">
          <div class="job-addr">${reqTypeLabel(item.type) || item.type}</div>
          <div class="job-meta">${item.crew ? item.crew + " · " + (item.site || "") + " · " : ""}${Object.values(item.data || {}).filter(Boolean).map(trWord).join(" · ")}</div>
          ${byline}
        </div>
        <div style="display:flex; flex-direction:column; align-items:flex-end; gap:6px;">
          <div class="job-status ${statusClass}">${item.status}</div>
          <div style="display:flex; gap:4px;">${actions}</div>
        </div>
      </div>
    `;
    }).join("");
  };

  const log = JSON.parse(lsGet("requests") || "[]");
  draw(log);

  if (sb){
    sb.from("requests").select("*").order("created_at", { ascending: true })
      .then(({ data, error }) => {
        if (error){ console.warn("requests server fetch failed (showing local only):", error.message); return; }
        if (!data) return;
        const merged = data.map(row => ({
          sbId: row.id,
          type: row.type,
          data: row.data,
          time: row.created_at,
          status: row.status,
          decidedBy: row.decided_by
        }));
        lsSet("requests", JSON.stringify(merged));
        draw(merged);
      });
  }
}

function decideRequest(index, decision){
  if (!requireManagerUp(T("actDecideReq"))) return;
  appConfirm(fmtT("decideReqQ", { d: stLabel(decision) }), () => decideRequestDo(index, decision), stLabel(decision), decision === "거절" ? "danger" : "");
}
function decideRequestDo(index, decision){
  const log = JSON.parse(lsGet("requests") || "[]");
  if (!log[index]) return;
  log[index].status = decision;
  log[index].decidedBy = currentRoleLabel();
  lsSet("requests", JSON.stringify(log));
  logActivity(`Request ${decision === "승인" ? "approved" : "rejected"}: ${log[index].type}`);
  renderAdminApprovals();
  renderAdminDashboard();

  if (sb && log[index].sbId){
    sb.from("requests").update({ status: decision, decided_by: currentRoleLabel() })
      .eq("id", log[index].sbId)
      .then(({ error }) => { if (error) console.warn("requests server update failed (applied locally):", error.message); });
  }
}

function openMap(address){
  const url = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(address);
  window.open(url, "_blank");
}

// toggleLang() kept as an alias for backward compatibility with any old callers.
function toggleLang(){
  langIsKo = !langIsKo;
  applyLang();
}

// 메모 저장 형식: { "18": { text:"...", issue:true } }  (예전 문자열 형식도 자동 변환)
function notesKey(){ return "calendar-notes-" + calYear + "-" + pad(calMonth + 1); }
function loadNotes(){
  const raw = JSON.parse(lsGet(notesKey()) || "{}");
  Object.keys(raw).forEach(k => { if (typeof raw[k] === "string") raw[k] = { text: raw[k], issue: false }; });
  return raw;
}
function saveNotes(n){ lsSet(notesKey(), JSON.stringify(n)); }

// 이번 달 근무시간 = 출퇴근 기록에서 계산 (오버타임은 승인된 요청 기준)
function monthHours(){ const n = new Date(); return hoursFor(MY_NAME, n.getFullYear(), n.getMonth()).hours; }
function approvedOvertimeDays(year, month){
  const log = JSON.parse(lsGet("requests") || "[]");
  const days = new Set();
  log.filter(r => r.type === "overtime" && r.status === "승인" && r.crew === MY_NAME && r.data && r.data.date).forEach(r => { const d = new Date(r.data.date); if (d.getFullYear() === year && d.getMonth() === month) days.add(d.getDate()); });
  return days;
}
let selectedCrewDay = null;
let calYear = new Date().getFullYear(), calMonth = new Date().getMonth();
function shiftCalMonth(delta){ calMonth += delta; if (calMonth < 0){ calMonth = 11; calYear--; } if (calMonth > 11){ calMonth = 0; calYear++; } selectedCrewDay = null; renderCalendar(); }
function renderCalendar(){
  const grid = document.getElementById("calendar-grid");
  if (!grid) return;
  grid.innerHTML = "";
  const dows = T("dow");
  dows.forEach(d => { const el = document.createElement("div"); el.className = "cal-dow"; el.textContent = d; grid.appendChild(el); });
  const title = document.getElementById("cal-month-title");
  if (title) title.textContent = langIsKo ? `${calYear}년 ${calMonth + 1}월` : `${T("monthNames")[calMonth]} ${calYear}`;

  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const startOffset = new Date(calYear, calMonth, 1).getDay();
  const info = hoursFor(MY_NAME, calYear, calMonth);
  const otDays = approvedOvertimeDays(calYear, calMonth);
  const notes = loadNotes();
  const crewEvents = crewVisibleEvents();
  const now = new Date();
  const todayNum = (now.getFullYear() === calYear && now.getMonth() === calMonth) ? now.getDate() : null;

  for (let i = 0; i < startOffset; i++) grid.appendChild(document.createElement("div"));
  for (let d = 1; d <= daysInMonth; d++){
    const el = document.createElement("div");
    el.className = "cal-day";
    el.textContent = d;
    if (otDays.has(d)) el.classList.add("overtime");
    else if (info.days[d]) el.classList.add("worked");
    else el.classList.add("off");
    if (d === todayNum) el.classList.add("today");
    if (d === selectedCrewDay) el.classList.add("selected");
    if (notes[d] && notes[d].issue) el.classList.add("has-issue");
    else if (notes[d]) el.classList.add("has-note");
    if (crewEvents.some(e => e.date && e.date.startsWith(`${calYear}-${pad(calMonth + 1)}`) && eventDay(e) === d && e.type !== "shift")){
      const dots = document.createElement("span"); dots.className = "cal-dots";
      const i = document.createElement("i"); i.className = "d-business"; dots.appendChild(i); el.appendChild(dots);
    }
    el.onclick = () => selectCrewDay(d);
    grid.appendChild(el);
  }
  const prevM = calMonth === 0 ? 11 : calMonth - 1, prevY = calMonth === 0 ? calYear - 1 : calYear;
  const prev = hoursFor(MY_NAME, prevY, prevM);
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set("cal-stat-hours", info.hours);
  set("cal-stat-hours-prev", prev.hours + "h");
  set("cal-stat-worked", Object.keys(info.days).length + T("days"));
  set("cal-stat-overtime", otDays.size + T("days"));
  set("hours-label", T("monthHours")); set("k-last", T("lastMonth")); set("k-days", T("workDays")); set("k-ot", T("otDays"));
  set("lg-work", T("legendWork")); set("lg-ot", T("legendOT")); set("lg-note", T("legendNote")); set("lg-issue", T("legendIssue")); set("cal-hint-text", T("calHint"));
  const mh = document.getElementById("month-hours-line"); if (mh && now.getMonth() === calMonth && now.getFullYear() === calYear) mh.textContent = info.hours + "h · " + Object.keys(info.days).length + T("days");
  renderCrewDayDetail();
}

function selectCrewDay(d){
  selectedCrewDay = (selectedCrewDay === d) ? null : d;
  renderCalendar();
}

function renderCrewDayDetail(){
  const box = document.getElementById("cal-day-detail");
  if (!box) return;
  const d = selectedCrewDay;
  if (!d){ box.innerHTML = ""; return; }
  const notes = loadNotes();
  const note = notes[d];
  const info = hoursFor(MY_NAME, calYear, calMonth);
  const h = info.days[d] || 0;
  const ot = approvedOvertimeDays(calYear, calMonth).has(d);
  const dowName = T("dow")[new Date(calYear, calMonth, d).getDay()];
  const dateLabel = langIsKo ? `${calMonth + 1}월 ${d}일 ${dowName}요일` : `${dowName}, ${T("monthNames")[calMonth]} ${d}`;
  const monthKey = `${calYear}-${pad(calMonth + 1)}`;
  const events = crewVisibleEvents().filter(e => e.date && e.date.startsWith(monthKey) && eventDay(e) === d);
  const recs = loadClockRecords().filter(r => r.crew === MY_NAME && new Date(r.at).getFullYear() === calYear && new Date(r.at).getMonth() === calMonth && new Date(r.at).getDate() === d);

  let html = `<div class="day-detail">
    <div class="day-detail-head"><b>${dateLabel}</b>
      <span>${h ? T("work") + " " + (Math.round(h * 10) / 10) + "h" + (ot ? " · " + T("legendOT") : "") : T("noWork")}</span></div>`;
  if (recs.length){
    const site = recs[0].site || MY_SITE;
    const times = recs.map(r => (r.type === "in" ? (langIsKo ? "출근 " : "In ") : (langIsKo ? "퇴근 " : "Out ")) + new Date(r.at).toTimeString().slice(0, 5)).join("  ");
    html += `<div class="ev-row"><i class="d-shift"></i><div class="ev-body"><div class="ev-title">${escapeHtml(site)}</div><div class="ev-meta">${times}</div></div></div>`;
  }
  html += events.map(e => `<div class="ev-row"><i class="d-${e.type}"></i><div class="ev-body"><div class="ev-title">${escapeHtml(e.label)}</div><div class="ev-meta">${e.time || ""} · ${T("companyNotice")}</div></div></div>`).join("");
  if (note){
    html += `<div class="day-note ${note.issue ? "issue" : ""}" onclick="openNoteSheet(${d})">
      <div class="day-note-k">${note.issue ? T("issue") : T("memo")} <small>${T("sharedNote")}</small></div>
      <div>${escapeHtml(note.text)}</div>
    </div>`;
  }
  html += `<button class="action-btn" style="margin:10px 0 0;" onclick="openNoteSheet(${d})">${note ? T("editMemo") : T("addMemo")}</button>
  </div>`;
  box.innerHTML = html;
}

// 메모 시트
let noteSheetDay = null;
function openNoteSheet(day){
  noteSheetDay = day;
  const notes = loadNotes();
  const n = notes[day];
  document.getElementById("note-sheet-title").textContent = langIsKo ? `${calMonth + 1}월 ${day}일 메모` : `Note · ${T("monthNames")[calMonth]} ${day}`;
  document.getElementById("note-text").value = n ? n.text : "";
  document.getElementById("note-issue").checked = !!(n && n.issue);
  document.getElementById("note-delete-btn").style.display = n ? "flex" : "none";
  document.getElementById("note-overlay").classList.add("active");
}
function closeNoteSheet(){ document.getElementById("note-overlay").classList.remove("active"); }
function closeNoteSheetIfBg(e){ if (e.target.id === "note-overlay") closeNoteSheet(); }
function saveNote(){
  const text = document.getElementById("note-text").value.trim();
  const issue = document.getElementById("note-issue").checked;
  const notes = loadNotes();
  if (!text){ delete notes[noteSheetDay]; }
  else {
    notes[noteSheetDay] = { text, issue };
    if (issue) notifyAdmin(`[Issue] ${MY_NAME} (${calYear}-${pad(calMonth + 1)}-${pad(noteSheetDay)}): ${text}`);
  }
  saveNotes(notes);
  closeNoteSheet();
  renderCalendar();
}
function deleteNote(){
  const notes = loadNotes();
  delete notes[noteSheetDay];
  saveNotes(notes);
  closeNoteSheet();
  renderCalendar();
}
// (이전 버전 호환)
function openDayNote(day){ openNoteSheet(day); }

if ("serviceWorker" in navigator){
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}

renderCalendar();
renderAdminApprovals();
renderWeekRow();
renderJoinApprovals();

const __today = new Date();
const __dateEl = document.getElementById("today-date");
if (__dateEl) __dateEl.textContent = fullDate(__today);

// 저장된 언어 설정 복원 (새로고침해도 유지)
(function restoreLang(){
  const saved = lsGet("app-lang") || "en";
  setLang(saved);
})();


// 로그인 유지: 이전에 로그인한 상태였으면 역할선택 화면을 건너뛰고 바로 이동
(function restoreSession(){
  if (lsGet("admin-session-active") === "1"){
    goTo("admin");
  } else if (lsGet("session-active") === "1" && MY_NAME){
    goTo("home");
  }
})();

// PIN 변경 (설정 화면에서 프롬프트로 빠르게 변경)

// 로그아웃 (크루/관리자 세션 모두 해제)
function logout(){
  appConfirm(T("logoutQ"), doLogout, T("logout"));
}
function doLogout(){
  document.querySelectorAll(".overlay.active").forEach(o => o.classList.remove("active"));
  if (clockedIn){
    clockedIn = false;
    const btn = document.getElementById("clock-btn");
    const status = document.getElementById("clock-status");
    if (btn) btn.textContent = T("clockIn");
    if (status) status.textContent = T("beforeWork");
  }
  lsSet("session-active", "0");
  lsSet("admin-session-active", "0");
  goTo("role");
}

// 프로필 수정 화면
function loadProfileForm(){
  const name = document.getElementById("pf-name");
  const address = document.getElementById("pf-address");
  const phone = document.getElementById("pf-phone");
  if (name) name.value = lsGet("profile-name") || MY_NAME || "";
  if (address) address.value = lsGet("profile-address") || "";
  if (phone) phone.value = lsGet("profile-phone") || "";
  ["pf-pin-current", "pf-pin-new", "pf-pin-confirm"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
}

function saveProfile(){
  const name = document.getElementById("pf-name").value.trim();
  const address = document.getElementById("pf-address").value.trim();
  const phone = document.getElementById("pf-phone").value.trim();
  if (name && name !== MY_NAME){ MY_NAME = name; lsSet("my-name", name); }
  upsertCrew({ name: MY_NAME, address, phone });
  lsSet("profile-name", name);
  lsSet("profile-address", address);
  lsSet("profile-phone", phone);

  const nameEls = document.querySelectorAll(".profile-name, .pixel-name");
  nameEls.forEach(el => { if (name) el.textContent = name; });

  alert(T("profileSaved"));
  goTo("menu");
}

let currentTimezone = "Australia/Brisbane";
function setTimezone(tz, btn){
  currentTimezone = tz;
  btn.parentElement.querySelectorAll(".settings-chip").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  updateTzPreview();
}
function updateTzPreview(){
  const el = document.getElementById("tz-preview");
  if (!el) return;
  try {
    el.textContent = new Intl.DateTimeFormat("ko-KR", {
      timeZone: currentTimezone, hour: "2-digit", minute: "2-digit", hour12: false
    }).format(new Date());
  } catch (e){ el.textContent = "-"; }
}
setInterval(updateTzPreview, 1000);
updateTzPreview();

// 오프라인 대비: 온라인 상태 확인 및 큐 자동 전송
function updateOfflineNote(){
  const note = document.getElementById("offline-note");
  if (!note) return;
  note.style.display = navigator.onLine ? "none" : "block";
}
window.addEventListener("online", () => { updateOfflineNote(); flushPendingSync(); });
window.addEventListener("offline", updateOfflineNote);
updateOfflineNote();

// 문자로 앱 초대링크 보내기 (1시간 만료) → 크루이 링크 눌러 Join 화면에서 직접 가입 → 관리자가 가입대기 리스트에서 승인
function openInvite(){
  document.getElementById("invite-result").textContent = "";
  document.getElementById("invite-phone").value = "";
  document.getElementById("invite-overlay").classList.add("active");
}
function sendInvite(){
  if (!requireOwner(T("actInvite"))) return;
  const phone = document.getElementById("invite-phone").value.trim();
  if (!phone){ alert(T("phoneRequired")); return; }
  const code = Math.random().toString(36).substring(2, 8).toUpperCase();
  const expiresAt = Date.now() + 60 * 60 * 1000; // 1시간 후 만료
  const inviteUrl = `https://cleanmateaus.app/join?ref=${code}`; // 앱의 Join 가입화면으로 바로 연결
  const invites = JSON.parse(lsGet("invites") || "[]");
  invites.push({ phone, code, expiresAt });
  lsSet("invites", JSON.stringify(invites));
  // 실제 서버 연동 시 여기서 SMS 발송 API 호출
  logActivity(`Invite SMS sent to ${phone}`);
  document.getElementById("invite-result").innerHTML =
    fmtT("inviteSentMsg", { phone, url: inviteUrl });
}
function closeInvite(){ document.getElementById("invite-overlay").classList.remove("active"); }
function closeInviteIfBg(e){ if (e.target.id === "invite-overlay") closeInvite(); }

function renderChat(){
  const thread = document.getElementById("chat-thread");
  if (!thread) return;
  const log = JSON.parse(lsGet("chat-log") || "[]");
  thread.innerHTML = log.map(m => `
    <div class="chat-bubble ${m.from === 'me' ? 'chat-me' : 'chat-admin'}">
      <div class="chat-bubble-text">${m.text}</div>
      <div class="chat-bubble-time">${m.time}</div>
    </div>
  `).join("") || `<div class="chat-empty">${T("chatEmpty")}</div>`;
  thread.scrollTop = thread.scrollHeight;
}

function sendChatMessage(){
  const input = document.getElementById("chat-input");
  const text = input.value.trim();
  if (!text) return;
  const log = JSON.parse(lsGet("chat-log") || "[]");
  const now = new Date();
  const timeStr = pad(now.getHours()) + ":" + pad(now.getMinutes());
  log.push({ from: "me", text, time: timeStr });
  lsSet("chat-log", JSON.stringify(log));
  input.value = "";
  renderChat();
  notifyAdmin(`[Chat] ${MY_NAME}: ${text}`);

}


function registerSite(){ openSiteSheet(null); }
let siteSheetEditing = null;
function openSiteSheet(name){
  if (!requireManagerUp(T("actSiteEdit"))) return;
  const st = name ? loadSites().find(x => x.name === name) : null;
  siteSheetEditing = name || null;
  document.getElementById("site-name").value = st ? st.name : "";
  document.getElementById("site-address").value = st ? (st.address || "") : "";
  document.getElementById("site-lat").value = st && st.lat ? st.lat : "";
  document.getElementById("site-lng").value = st && st.lng ? st.lng : "";
  document.getElementById("site-note").value = st ? (st.note || "") : "";
  document.querySelectorAll("#site-type-row .settings-chip").forEach(b => b.classList.toggle("active", b.dataset.v === ((st && st.type) || "commercial")));
  document.getElementById("site-overlay").classList.add("active");
}
function closeSiteSheet(){ document.getElementById("site-overlay").classList.remove("active"); }
function closeSiteSheetIfBg(e){ if (e.target.id === "site-overlay") closeSiteSheet(); }
function useHereForSite(){
  if (!("geolocation" in navigator)){ toast(T("noGeoToast")); return; }
  toast(T("gettingLoc"));
  navigator.geolocation.getCurrentPosition(pos => {
    document.getElementById("site-lat").value = pos.coords.latitude.toFixed(6);
    document.getElementById("site-lng").value = pos.coords.longitude.toFixed(6);
    toast(T("locSet"));
  }, () => toast(T("locFail")), { enableHighAccuracy: true, timeout: 10000 });
}
function saveSiteSheet(){
  const name = document.getElementById("site-name").value.trim();
  if (!name){ alert(T("siteNameRequired")); return; }
  const lat = parseFloat(document.getElementById("site-lat").value), lng = parseFloat(document.getElementById("site-lng").value);
  const site = { name, address: document.getElementById("site-address").value.trim(), type: chipValue("site-type-row") || "commercial",
    lat: isNaN(lat) ? null : lat, lng: isNaN(lng) ? null : lng, note: document.getElementById("site-note").value.trim() };
  if (siteSheetEditing && siteSheetEditing !== name){ saveSites(loadSites().filter(x => x.name !== siteSheetEditing)); }
  upsertSite(site);
  logActivity(`Site ${siteSheetEditing ? "updated" : "added"}: ${name}`);
  closeSiteSheet(); renderSiteList(); toast(fmtT("savedName", { name }));
}
function deleteSite(name){
  appConfirm(fmtT("deleteSiteQ", { name }), () => {
    saveSites(loadSites().filter(x => x.name !== name));
    crewList.forEach(c => { if (c.site === name) c.site = ""; }); saveCrew();
    if (sb) sb.from("sites").delete().eq("name", name).then(() => {});
    renderSiteList(); toast(T("deletedToast"));
  }, T("deleteLabel"), "danger");
}
function renderSiteList(){
  const box = document.getElementById("site-list");
  if (!box) return;
  const sites = loadSites().filter(x => canSeeSite(x.name));
  box.innerHTML = sites.length ? sites.map(st => {
    const n = crewList.filter(c => c.site === st.name).length;
    return `<div class="job-card">
      <div class="job-info">
        <div class="job-addr" onclick="openSiteSheet('${escapeHtml(st.name)}')" style="cursor:pointer;">${escapeHtml(st.name)} <span style="font-size:11px; color:var(--text-muted); font-weight:500;">${T("editSuffix")}</span></div>
        <div class="job-meta">${escapeHtml(st.address || T("noAddress2"))} · ${st.type === "house" ? T("typeHouse") : T("typeCommercial")} · ${fmtT("crewCountFmt", { n })}</div>
        <div class="job-meta">${st.lat ? T("gpsSet") : T("gpsMissing")}${st.note ? " · " + escapeHtml(st.note) : ""}</div>
      </div>
      <button class="ev-del" onclick="deleteSite('${escapeHtml(st.name)}')"></button>
    </div>`;
  }).join("") : `<div class="chat-empty" style="margin:24px 0;">${T("noSitesMsg")}</div>`;
}



// ===================================================================
// 엑셀 내보내기 (관리자용)
// 화면에 보이는 자료를 엑셀 파일(.xlsx)로 저장합니다.
// SheetJS 라이브러리가 로드돼 있으면 진짜 엑셀 파일로, 안 되어 있으면 CSV로 저장합니다.
// (CSV도 엑셀에서 바로 열려요. 한글이 깨지지 않도록 BOM을 붙입니다.)
// ===================================================================

function todayStamp(){
  const d = new Date();
  return d.getFullYear() + pad(d.getMonth()+1) + pad(d.getDate());
}

// 브라우저에서 파일 다운로드를 실행 (실패하면 false 반환)
function triggerDownload(blob, filename){
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
    return true;
  } catch(e){
    console.warn("File download failed:", e);
    return false;
  }
}

// CSV 앞에 BOM(U+FEFF)을 붙여야 엑셀에서 한글이 깨지지 않습니다
function blobWithBom(text){
  return new Blob([String.fromCharCode(0xFEFF) + text], { type: "text/csv;charset=utf-8;" });
}

// rows: [[헤더...],[값...],...] 형태의 2차원 배열
function rowsToCsv(rows){
  const esc = (v) => {
    const s = (v === null || v === undefined) ? "" : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return rows.map(r => r.map(esc).join(",")).join("\r\n");
}

// sheets: [{ name: "시트이름", rows: [[...],[...]] }, ...]
function saveAsExcel(sheets, baseName){
  const filename = `${baseName}_${todayStamp()}`;

  // 1순위: 진짜 엑셀(.xlsx) 파일로 저장
  if (typeof XLSX !== "undefined" && XLSX.utils){
    try {
      const wb = XLSX.utils.book_new();
      sheets.forEach(s => {
        const ws = XLSX.utils.aoa_to_sheet(s.rows);
        // 열 너비를 내용 길이에 맞춰 대략 조정 (읽기 편하게)
        const colWidths = (s.rows[0] || []).map((_, ci) => {
          const maxLen = s.rows.reduce((m, r) => {
            const cell = r[ci] === undefined || r[ci] === null ? "" : String(r[ci]);
            return Math.max(m, cell.length);
          }, 8);
          return { wch: Math.min(maxLen + 4, 45) };
        });
        ws["!cols"] = colWidths;
        XLSX.utils.book_append_sheet(wb, ws, s.name.substring(0, 31));
      });
      XLSX.writeFile(wb, filename + ".xlsx");
      logActivity(`Excel export: ${baseName}`);
      return;
    } catch(e){
      console.warn("Excel save failed, falling back to CSV:", e);
    }
  }

  // 2순위: CSV로 저장 (엑셀에서 바로 열림, 한글 깨짐 방지 BOM 포함)
  const csvParts = sheets.map(s =>
    (sheets.length > 1 ? `[${s.name}]\r\n` : "") + rowsToCsv(s.rows)
  ).join("\r\n\r\n");
  const ok = triggerDownload(blobWithBom(csvParts), filename + ".csv");

  if (ok){
    logActivity(`CSV export: ${baseName}`);
  } else {
    alert(T("exportBlocked"));
  }
}

// ---- 각 자료별 내보내기 ----

function exportCrewList(){
  const rows = [langIsKo ? ["이름", "근무지", "현재상태", "출근시각", "입사일", "Induction 만료일", "만료까지(일)", "상태"] : ["Name", "Site", "Status", "Clock-in", "Start date", "Induction expiry", "Days left", "Induction"]];
  visibleCrew().forEach(c => {
    const st = inductionStatusFor(c.startDate);
    const levelLabel = st
      ? ({ ok: T("indOk"), warning: T("ind30"), urgent: T("ind7"), expired: T("expiredLabel") }[st.level] || "-")
      : "-";
    rows.push([
      c.name,
      c.site,
      c.status === "working" ? T("workingStatus") : T("offToday"),
      c.clockIn || "-",
      c.startDate || "-",
      st ? st.expiryText : "-",
      st ? st.days : "-",
      levelLabel
    ]);
  });
  saveAsExcel([{ name: langIsKo ? "크루현황" : "Crew", rows }], langIsKo ? "크루현황" : "Crew");
}

function exportRequests(){
    const log = JSON.parse(lsGet("requests") || "[]");
  const rows = [langIsKo ? ["종류", "신청내용", "상태", "처리자", "신청일시"] : ["Type", "Details", "Status", "Decided by", "Requested at"]];
  log.forEach(item => {
    rows.push([
      reqTypeLabel(item.type) || item.type,
      typeof item.data === "object" ? JSON.stringify(item.data) : (item.data || ""),
      item.status || "",
      item.decidedBy || "",
      item.time ? new Date(item.time).toLocaleString("ko-KR") : ""
    ]);
  });
  saveAsExcel([{ name: langIsKo ? "근태요청" : "Requests", rows }], langIsKo ? "근태요청" : "Requests");
}

function exportJoinApplicants(){
  const applicants = JSON.parse(lsGet("join-applicants") || "[]");
  const rows = [langIsKo ? ["이름", "연락처", "성별", "생년월일", "거주지", "비상연락처", "근무시작 희망일", "상태", "처리자"] : ["Name", "Phone", "Gender", "DOB", "Address", "Emergency contact", "Preferred start", "Status", "Decided by"]];
  applicants.forEach(a => {
    rows.push([
      a.name || "", a.phone || "", a.gender || "", a.birth || "",
      a.address || "", a.guardian || "", a.startDate || "",
      a.status || "", a.decidedBy || ""
    ]);
  });
  saveAsExcel([{ name: langIsKo ? "가입신청" : "Joins", rows }], langIsKo ? "가입신청" : "Joins");
}

function exportActivityLog(){
  const log = JSON.parse(lsGet("activity-log") || "[]");
  const rows = [langIsKo ? ["일시", "처리자", "내용"] : ["Time", "By", "Action"]];
  log.forEach(item => rows.push([item.time || "", item.actor || "", item.message || ""]));
  saveAsExcel([{ name: langIsKo ? "활동로그" : "ActivityLog", rows }], langIsKo ? "활동로그" : "ActivityLog");
}

function exportChecklists(){
  const rows = [langIsKo ? ["근무지", "요일", "체크리스트 항목"] : ["Site", "Day", "Checklist item"]];
  CHECKLIST_SITES_().forEach(site => {
    CHECKLIST_DAYS.forEach(day => {
      const items = getChecklistItems(site, day);
      items.forEach(item => rows.push([site, dayFull(day), item]));
    });
  });
  if (rows.length === 1) rows.push([langIsKo ? "(등록된 체크리스트가 없습니다)" : "(no checklists registered)", "", ""]);
  saveAsExcel([{ name: langIsKo ? "체크리스트" : "Checklists", rows }], langIsKo ? "체크리스트" : "Checklists");
}

// 전체 자료를 시트별로 나눠서 엑셀 파일 하나로 저장
function exportAllData(){
  if (!requireManagerUp(T("actExportAll"))) return;

  const sheets = [];

  // 1. 크루 현황
  const crewRows = [langIsKo ? ["이름", "근무지", "현재상태", "출근시각", "입사일", "Induction 만료일", "만료까지(일)", "상태"] : ["Name", "Site", "Status", "Clock-in", "Start date", "Induction expiry", "Days left", "Induction"]];
  visibleCrew().forEach(c => {
    const st = inductionStatusFor(c.startDate);
    const levelLabel = st ? ({ ok: T("indOk"), warning: T("ind30"), urgent: T("ind7"), expired: T("expiredLabel") }[st.level] || "-") : "-";
    crewRows.push([c.name, c.site, c.status === "working" ? T("workingStatus") : T("offToday"), c.clockIn || "-",
                   c.startDate || "-", st ? st.expiryText : "-", st ? st.days : "-", levelLabel]);
  });
  sheets.push({ name: langIsKo ? "크루현황" : "Crew", rows: crewRows });

  // 2. 근태 요청
    const reqRows = [langIsKo ? ["종류", "신청내용", "상태", "처리자", "신청일시"] : ["Type", "Details", "Status", "Decided by", "Requested at"]];
  JSON.parse(lsGet("requests") || "[]").forEach(item => {
    reqRows.push([reqTypeLabel(item.type) || item.type,
                  typeof item.data === "object" ? JSON.stringify(item.data) : (item.data || ""),
                  item.status || "", item.decidedBy || "",
                  item.time ? new Date(item.time).toLocaleString("ko-KR") : ""]);
  });
  sheets.push({ name: langIsKo ? "근태요청" : "Requests", rows: reqRows });

  // 3. 가입 신청
  const joinRows = [langIsKo ? ["이름", "연락처", "성별", "생년월일", "거주지", "비상연락처", "근무시작 희망일", "상태", "처리자"] : ["Name", "Phone", "Gender", "DOB", "Address", "Emergency contact", "Preferred start", "Status", "Decided by"]];
  JSON.parse(lsGet("join-applicants") || "[]").forEach(a => {
    joinRows.push([a.name || "", a.phone || "", a.gender || "", a.birth || "", a.address || "",
                   a.guardian || "", a.startDate || "", a.status || "", a.decidedBy || ""]);
  });
  sheets.push({ name: langIsKo ? "가입신청" : "Joins", rows: joinRows });

  // 4. 체크리스트
  const clRows = [langIsKo ? ["근무지", "요일", "체크리스트 항목"] : ["Site", "Day", "Checklist item"]];
  CHECKLIST_SITES_().forEach(site => {
    CHECKLIST_DAYS.forEach(day => {
      getChecklistItems(site, day).forEach(item => clRows.push([site, dayFull(day), item]));
    });
  });
  sheets.push({ name: langIsKo ? "체크리스트" : "Checklists", rows: clRows });

  // 5. 활동 로그
  const logRows = [langIsKo ? ["일시", "처리자", "내용"] : ["Time", "By", "Action"]];
  JSON.parse(lsGet("activity-log") || "[]").forEach(item => {
    logRows.push([item.time || "", item.actor || "", item.message || ""]);
  });
  sheets.push({ name: langIsKo ? "활동로그" : "ActivityLog", rows: logRows });

  saveAsExcel(sheets, langIsKo ? "CleanMate_전체자료" : "CleanMate_AllData");
}
