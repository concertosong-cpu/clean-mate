/* =====================================================================
   Supreme Solutions Management — site script
   - Language toggle (EN default, 한국어). English text lives in index.html;
     Korean text lives in the KO dictionary below, keyed by data-i18n.
   - Quote form: posts to FORM_ENDPOINT when set (e.g. a Formspree URL),
     otherwise opens the visitor's mail app with the message prefilled.
   - Mobile menu, FAQ, scroll reveal, toast. No browser popups.
   ===================================================================== */
(function () {
  "use strict";

  // ---------- Settings (edit here) ----------
  var CONFIG = {
    email: "info@supremesolution.com.au",
    formEndpoint: "",          // e.g. "https://formspree.io/f/xxxxxxxx". Empty = mail app fallback
    crewAppUrl: ""             // CleanMate crew app URL. Empty = "Crew login" link hidden
  };

  // ---------- Korean dictionary ----------
  var KO = {
    "skip": "본문으로 건너뛰기",
    "nav.services": "서비스", "nav.industries": "업종", "nav.why": "선택 이유", "nav.process": "진행 절차", "nav.faq": "자주 묻는 질문", "nav.contact": "문의",
    "cta.quote": "무료 견적 받기", "cta.quoteShort": "무료 견적", "cta.call": "전화",

    "hero.eyebrow": "상업·사무실 청소 · 브리즈번",
    "hero.title": "매 근무마다 깨끗하게.<br>기록으로 증명합니다.",
    "hero.lead": "Supreme Solutions Management는 브리즈번의 사무실·매장·의료시설·산업시설을 보험 가입과 경찰 신원조회를 마친 크루가 청소합니다. 모든 방문은 현장에서 출근 기록을 남기고 체크리스트대로 작업한 뒤 감독자가 확인합니다. 청소가 됐는지 고객이 확인할 필요가 없습니다.",
    "hero.p1": "무료 현장 견적", "hero.p2": "매일 · 주 1회 · 격주 · 월 1회 선택", "hero.p3": "한국어·영어 모두 가능",

    "report.tag": "근무 리포트 · 예시", "report.status": "현장 근무 중", "report.site": "사무실 · 3층 · 매일 야간 청소",
    "report.in": "출근", "report.out": "퇴근",
    "report.i1": "전체 바닥 진공·물걸레", "report.i2": "화장실 살균, 소모품 보충", "report.i3": "탕비실 심층 청소, 싱크대·가전",
    "report.i4": "책상·모니터·손이 닿는 곳", "report.i5": "쓰레기통 비우기, 봉투 교체",
    "report.i6": "메모: 3층 탕비실 수도꼭지 누수 — 사진과 함께 보고",
    "report.signed": "감독자 확인 완료",
    "badge.title": "모든 근무에 체크리스트", "badge.sub": "시간이 기록되고, 빠뜨리는 일이 없습니다.",

    "strip.1t": "보험 가입 · 경찰 신원조회", "strip.1s": "유니폼을 입은 검증된 크루",
    "strip.2t": "매번 같은 담당자", "strip.2s": "정기 계약은 같은 팀이 맡습니다",
    "strip.3t": "현장 출근 기록", "strip.3s": "위치와 시간으로 근무를 확인합니다",
    "strip.4t": "친환경 세제", "strip.4s": "상업용 장비, 환경에 안전한 제품",

    "services.eyebrow": "서비스", "services.title": "이런 청소를 합니다",
    "services.sub": "정기 계약도, 1회성 작업도 가능합니다. 현장을 알려주시면 직접 둘러보며 작업 범위를 함께 정합니다.",
    "svc.1t": "상업·사무실 청소", "svc.1d": "바닥 진공·물걸레, 책상과 손 닿는 곳 닦기, 탕비실 심층 청소, 화장실 살균과 소모품 보충, 쓰레기 처리. 매일·주 1회·격주·월 1회 중 선택하십시오.",
    "svc.2t": "바닥 관리", "svc.2d": "넓은 바닥을 위한 기계 스크러빙, 광택, 왁스 제거·코팅. 창고·매장·로비용 상업 장비를 씁니다.",
    "svc.3t": "카펫·유리창 청소", "svc.3d": "사무실과 공용 공간 카펫 습식 청소. 정기 청소에 실내 유리를 포함하거나, 별도 창문 청소로 진행합니다.",
    "svc.4t": "준공 청소", "svc.4d": "공사·리노베이션 후 먼지, 잔해, 자국을 제거해 인도나 입주가 가능한 상태로 만듭니다.",
    "svc.5t": "본드·퇴거 청소", "svc.5d": "임대 종료 시 중개인의 점검 항목에 맞춰 위에서 아래까지 전체를 청소합니다.",
    "svc.6t": "특수 작업", "svc.6d": "고압 세척, 잔디 깎기, 해충 방제를 청소와 함께 처리합니다. 한 곳에 연락하면 현장 전체가 해결됩니다.",

    "ind.eyebrow": "업종", "ind.title": "이런 곳을 청소합니다", "ind.sub": "업종마다 기준이 다릅니다. 현장 체크리스트는 그 기준에 맞춰 만듭니다.",
    "ind.1t": "사무실", "ind.1d": "업무 시간 이후에 청소해 아침에 바로 일할 수 있게 합니다.",
    "ind.2t": "의료 시설", "ind.2d": "클리닉과 진료실을 멸균 수준으로 살균합니다.",
    "ind.3t": "매장", "ind.3d": "매장 바닥, 피팅룸, 창고를 영업시간 외에 청소합니다.",
    "ind.4t": "숙박·외식", "ind.4d": "호텔, 레스토랑, 행사장을 서비스 사이에 정리합니다.",
    "ind.5t": "산업 시설", "ind.5d": "창고와 제조 현장을 안전 규정에 맞춰 청소합니다.",
    "ind.6t": "위생 특수", "ind.6d": "실험실과 식품 가공시설의 엄격한 위생 기준을 따릅니다.",
    "ind.7t": "학교", "ind.7d": "수업 시간을 피해 교실과 학습 공간을 안전하게 청소합니다.",
    "ind.8t": "다른 곳인가요?", "ind.8d": "현장을 설명해 주시면 가능 여부를 바로 알려드립니다.", "ind.8l": "문의하기 →",

    "why.eyebrow": "선택 이유", "why.title": "청소하러 왔는지 고객이 확인해야 한다면 잘못된 겁니다.",
    "why.sub": "청소 불만의 대부분은 실력 문제가 아닙니다. 빠진 날, 잊힌 작업, 그리고 그걸 알 방법이 없다는 것입니다. 저희는 그 불안을 없애는 데 운영의 초점을 맞췄습니다.",
    "why.1t": "현장별·요일별 체크리스트", "why.1d": "계약한 작업 범위가 방문마다 체크리스트가 됩니다. 크루는 항목을 하나씩 처리하므로, 바닥에 시간이 더 걸렸다고 화요일 탕비실 청소가 빠지지 않습니다.",
    "why.2t": "위치와 시간으로 확인되는 근무", "why.2d": "크루는 현장에서 출퇴근을 기록합니다. '사람이 왔었다'는 말 대신 방문마다 시간 기록을 받으실 수 있습니다.",
    "why.3t": "문제는 당일 밤에 보고", "why.3d": "새는 수도꼭지, 고장 난 조명, 전문 처리가 필요한 오염. 감독자가 사진과 함께 기록하고, 다음 청구서가 아니라 다음 날 아침 전에 알려드립니다.",
    "why.4t": "안정적인 전담 크루", "why.4d": "정기 현장은 같은 크루가 계속 맡습니다. 모두 현장 교육을 받고, 보험에 가입돼 있으며, 경찰 신원조회를 마치고 유니폼을 입습니다.",
    "why.5t": "투명한 가격", "why.5d": "정기 계약은 현장 확인 후 고정 금액으로 정합니다. 청구서에 예상 밖의 추가 비용이 붙지 않습니다.",

    "proc.eyebrow": "진행 절차", "proc.title": "문의부터 첫 청소까지",
    "proc.1t": "문의", "proc.1d": "양식을 보내거나 전화하십시오. 현장 종류, 넓이, 청소 주기만 알려주시면 1분이면 충분합니다.",
    "proc.2t": "현장 견적", "proc.2d": "직접 방문해 함께 둘러보고 작업 범위를 정합니다. 견적은 무료이며 서면으로 드립니다.",
    "proc.3t": "검토 · 확정", "proc.3d": "필요하면 계획을 조정하고 시작일을 확정합니다. 크루 현장 교육과 체크리스트 작성이 이어집니다.",
    "proc.4t": "청소 · 보고 · 점검", "proc.4d": "모든 방문이 기록됩니다. 정기적으로 현장을 함께 점검하고 필요에 따라 범위를 조정합니다.",

    "price.eyebrow": "가격", "price.title": "견적은 이렇게 정해집니다",
    "price.sub": "같은 넓이의 사무실이라도 필요한 작업은 크게 다르기 때문에 정찰 가격을 올리지 않습니다. 현장 확인 때 보는 네 가지입니다.",
    "price.1t": "면적과 바닥재", "price.1d": "바닥 면적, 바닥 종류, 화장실과 탕비실 수.",
    "price.2t": "청소 주기", "price.2d": "매일·주 1회·격주·월 1회. 자주 할수록 1회당 비용은 낮아집니다.",
    "price.3t": "작업 시간대", "price.3d": "영업시간 이후나 야간 근무는 고객의 영업시간에 맞춰 잡습니다.",
    "price.4t": "추가 작업", "price.4d": "주기적 바닥 관리, 카펫, 유리창, 고압 세척. 따로 책정해 실제로 한 만큼만 냅니다.",

    "faq.eyebrow": "자주 묻는 질문", "faq.title": "자주 받는 질문",
    "faq.1q": "영업시간 외에도 청소가 가능합니까?", "faq.1a": "가능합니다. 상업 청소 대부분이 영업시간 이후나 야간에 진행됩니다. 시간대를 함께 정하고, 현장 규정에 따라 열쇠를 받거나 안내를 받아 들어갑니다.",
    "faq.2q": "서비스 지역은 어디입니까?", "faq.2a": "브리즈번과 인근 지역입니다. 더 멀다면 주소를 보내 주십시오. 가능 여부를 확인해 드립니다.",
    "faq.3q": "장비와 세제를 직접 가져옵니까?", "faq.3a": "네. 상업용 장비와 환경에 안전한 제품을 가져갑니다. 의료·식품 시설처럼 특정 세제가 필요한 현장은 그 기준에 맞춥니다.",
    "faq.4q": "청소가 실제로 됐는지 어떻게 압니까?", "faq.4a": "모든 방문에 현장 출퇴근 기록과 완료된 체크리스트가 남고 감독자가 확인합니다. 근무 기록은 언제든 요청하실 수 있습니다.",
    "faq.5q": "최소 계약 기간이 있습니까?", "faq.5a": "정기 계약은 월 단위로 견적합니다. 준공 청소, 본드 청소, 고압 세척 같은 1회성 작업은 건별로 견적합니다.",
    "faq.6q": "한국어로 상담할 수 있습니까?", "faq.6a": "네. 대면, 전화, 서면 모두 한국어와 영어로 가능합니다.",

    "contact.eyebrow": "문의", "contact.title": "무료 현장 견적 받기",
    "contact.sub": "현장을 알려주십시오. 영업일 기준 하루 안에 답하고, 편한 시간에 방문 일정을 잡습니다.",
    "contact.office": "사무실", "contact.mobile": "휴대전화", "contact.email": "이메일", "contact.area": "브리즈번 전역 서비스",
    "form.name": "이름", "form.biz": "업체 / 현장 이름", "form.phone": "전화번호", "form.email": "이메일",
    "form.type": "현장 종류", "form.t1": "사무실", "form.t2": "매장", "form.t3": "의료 시설", "form.t4": "숙박·외식", "form.t5": "산업 시설 / 창고", "form.t6": "학교", "form.t7": "준공 / 본드 청소", "form.t8": "기타",
    "form.freq": "청소 주기", "form.f1": "매일", "form.f2": "주 1회", "form.f3": "격주", "form.f4": "월 1회", "form.f5": "1회성",
    "form.msg": "주소, 넓이, 그 밖에 알려주실 내용", "form.send": "무료 견적 요청", "form.note": "광고 없음, 의무 없음. 영업일 기준 하루 안에 답합니다.",

    "footer.tag": "믿을 수 있는 품질. 브리즈번 상업·사무실 청소 전문.",
    "footer.services": "서비스", "footer.contact": "연락처", "footer.rights": "All rights reserved.", "footer.crew": "크루 로그인",

    "toast.required": "이름과 전화번호를 입력해 주십시오.",
    "toast.sending": "보내는 중입니다…",
    "toast.sent": "접수됐습니다. 영업일 기준 하루 안에 연락드리겠습니다.",
    "toast.mail": "메일 앱이 열립니다. 보내기만 누르시면 됩니다.",
    "toast.fail": "전송에 실패했습니다. 전화나 이메일로 연락해 주십시오.",
    "mail.subject": "청소 견적 요청"
  };

  var EN_EXTRA = {
    "toast.required": "Please enter your name and phone number.",
    "toast.sending": "Sending…",
    "toast.sent": "Received. We will be in touch within one business day.",
    "toast.mail": "Your mail app will open. Just press send.",
    "toast.fail": "Could not send. Please call or email us instead.",
    "mail.subject": "Cleaning quote request"
  };

  // ---------- i18n ----------
  var EN = {};
  var nodes = document.querySelectorAll("[data-i18n]");
  for (var i = 0; i < nodes.length; i++) {
    var k = nodes[i].getAttribute("data-i18n");
    if (!(k in EN)) EN[k] = nodes[i].innerHTML;
  }
  var lang = "en";

  function t(key) {
    var d = lang === "ko" ? KO : EN_EXTRA;
    return d[key] || EN[key] || key;
  }

  function applyLang(next) {
    lang = next === "ko" ? "ko" : "en";
    document.documentElement.setAttribute("lang", lang);
    for (var j = 0; j < nodes.length; j++) {
      var key = nodes[j].getAttribute("data-i18n");
      var val = lang === "ko" ? KO[key] : EN[key];
      if (val != null) nodes[j].innerHTML = val;
    }
    var toggle = document.getElementById("lang-toggle");
    toggle.textContent = lang === "ko" ? "English" : "한국어";
    toggle.setAttribute("aria-label", lang === "ko" ? "Switch to English" : "한국어로 보기");
    document.title = lang === "ko"
      ? "Supreme Solutions Management — 브리즈번 상업·사무실 청소"
      : "Supreme Solutions Management — Commercial Cleaning Brisbane";
    try { localStorage.setItem("ssm-lang", lang); } catch (e) {}
  }

  var initial = "en";
  try {
    var q = new URLSearchParams(location.search).get("lang");
    initial = q || localStorage.getItem("ssm-lang") || "en";
  } catch (e) {}
  if (initial === "ko") applyLang("ko");

  document.getElementById("lang-toggle").addEventListener("click", function () {
    applyLang(lang === "ko" ? "en" : "ko");
  });

  // ---------- Mobile menu ----------
  var burger = document.getElementById("burger");
  var nav = document.getElementById("nav");
  burger.addEventListener("click", function () {
    var open = nav.classList.toggle("open");
    burger.setAttribute("aria-expanded", open ? "true" : "false");
  });
  nav.addEventListener("click", function (e) {
    if (e.target.tagName === "A") { nav.classList.remove("open"); burger.setAttribute("aria-expanded", "false"); }
  });

  // ---------- Reveal on scroll ----------
  var reveals = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); } });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add("in"); });
  }

  // ---------- Toast ----------
  var toastEl = document.getElementById("toast");
  var toastTimer;
  function toast(msg, ms) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("show"); }, ms || 3200);
  }

  // ---------- Quote form ----------
  var form = document.getElementById("quote-form");
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var f = form.elements;
    var name = f.name.value.trim(), phone = f.phone.value.trim();
    f.name.classList.toggle("invalid", !name);
    f.phone.classList.toggle("invalid", !phone);
    if (!name || !phone) { toast(t("toast.required")); (name ? f.phone : f.name).focus(); return; }

    var typeSel = f.type, freqSel = f.frequency;
    var data = {
      name: name,
      business: f.business.value.trim(),
      phone: phone,
      email: f.email.value.trim(),
      type: typeSel.options[typeSel.selectedIndex].text,
      frequency: freqSel.options[freqSel.selectedIndex].text,
      message: f.message.value.trim(),
      language: lang
    };
    var body = [
      "Name: " + data.name,
      "Business / site: " + data.business,
      "Phone: " + data.phone,
      "Email: " + data.email,
      "Type of site: " + data.type,
      "Frequency: " + data.frequency,
      "",
      data.message
    ].join("\n");

    if (CONFIG.formEndpoint) {
      var btn = form.querySelector("button[type=submit]");
      btn.disabled = true; toast(t("toast.sending"), 8000);
      fetch(CONFIG.formEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify(data)
      }).then(function (r) {
        if (!r.ok) throw new Error("bad status");
        form.reset(); toast(t("toast.sent"), 5000);
      }).catch(function () {
        toast(t("toast.fail"), 5000);
      }).then(function () { btn.disabled = false; });
      return;
    }

    var subject = t("mail.subject") + " — " + (data.business || data.name);
    window.location.href = "mailto:" + CONFIG.email +
      "?subject=" + encodeURIComponent(subject) +
      "&body=" + encodeURIComponent(body);
    toast(t("toast.mail"), 4500);
  });

  // ---------- Misc ----------
  document.getElementById("year").textContent = String(new Date().getFullYear());
  var crew = document.querySelector(".crew-link");
  if (CONFIG.crewAppUrl) crew.href = CONFIG.crewAppUrl; else crew.hidden = true;
})();
