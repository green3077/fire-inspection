// 소방점검 관리 앱 메인 로직
(() => {
  let editingSiteId = null;
  let currentSiteId = null;      // 현장 상세 화면에서 보고 있는 현장
  let currentConstructionSiteId = null;  // 공사팀에서 보고 있는 업체(=현장)
  let activeObjectUrls = [];
  let pendingAttachments = [];   // 신규 현장 등록 시 아직 저장 전인 첨부파일 (저장 시점에 실제 siteId로 옮겨 담음)
  let sitesSortMode = "name";    // "name"(가나다순) | "region"(지역별) - 거래처 목록 정렬 방식
  let sitesSelectedRegion = null; // 지역별 모드에서 드릴다운한 지역 (구/도 이름), null이면 지역 버튼 목록 표시 중
  let comprehensiveTarget = null; // 현장 등록/수정 폼의 "종합점검대상/해당없음" 토글 상태: true | false | null(미정)
  // 종합점검/작동점검월을 예외적으로 직접 지정한 값 - null이면 자동계산(comprehensiveTarget+사용승인일) 사용,
  // 숫자(1~12)면 저장 시 site.comprehensiveMonthOverride/operationalMonthOverride로 저장되어 항상 우선한다.
  let comprehensiveMonthValue = null;
  let operationalMonthValue = null;
  let scheduleCalDate = new Date();   // 스케줄 관리 달력이 보여주는 월
  let scheduleSelectedDate = "";      // 스케줄 관리에서 선택된 날짜 (YYYY-MM-DD)
  let scheduleCompanySearchTerm = ""; // 스케줄 관리 업체 선택 목록 검색어
  let scheduleStagedIds = new Set();  // 업체 선택 화면에서 "확인"을 누르기 전까지 임시로 체크된 업체 (저장 전)

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function isNativeApp() {
    return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  }
  // 이 프로젝트는 번들러를 쓰지 않아 @capacitor/core 전체가 아니라 가벼운 native-bridge.js만 로드된다
  // (window.Capacitor.registerPlugin은 없다) - 대신 native-bridge.js가 실제로 제공하는 저수준
  // nativePromise(pluginName, methodName, options)로 아무 네이티브 플러그인이나 직접 호출한다.
  function callNativePlugin(pluginName, method, options) {
    return window.Capacitor.nativePromise(pluginName, method, options);
  }
  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result; // "data:<mime>;base64,XXXX"
        const idx = result.indexOf(",");
        resolve(idx >= 0 ? result.slice(idx + 1) : result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
  // 네이티브 앱(APK) 안의 WebView는 Web Share API(navigator.share)를 지원하지 않는 경우가 많아
  // "공유" 버튼을 눌러도 아무 앱 선택 화면 없이 조용히 실패하거나 다운로드로만 대체됐다 - 안드로이드의
  // 진짜 공유 시트(어느 앱으로 보낼지 아이콘이 뜨는 화면)를 확실히 띄우려면 @capacitor/filesystem으로
  // 파일을 앱 캐시에 저장한 뒤 그 파일의 uri를 넘겨야 한다.
  // 처음엔 @capacitor/share의 share()를 썼는데, 그 플러그인은 MIME 타입을 파일 확장자로 추측한다
  // (MimeTypeMap.getMimeTypeFromExtension) - 안드로이드는 .hwpx 같은 비표준 확장자를 몰라서 항상
  // "*/*"로 넘어가고, 카카오톡 등 일부 앱은 그렇게 애매한 타입으로 온 첨부를 사용자가 골라도 조용히
  // 전송하지 않는다(실제 사용자가 겪은 문제: "카카오톡으로 전송이 안됨"). 그래서 확장자 추측에 기대지
  // 않고 우리가 이미 알고 있는 정확한 MIME 타입을 직접 넘기는 자체 FileSaver.shareFiles를 쓴다.
  async function nativeShareFiles(blobsWithNames, title) {
    const uris = [];
    for (const { blob, name } of blobsWithNames) {
      const base64 = await blobToBase64(blob);
      const result = await callNativePlugin("Filesystem", "writeFile", {
        path: name,
        data: base64,
        directory: "CACHE",
        recursive: true,
      });
      uris.push(result.uri);
    }
    const mimeType = (blobsWithNames[0] && blobsWithNames[0].blob.type) || "*/*";
    await callNativePlugin("FileSaver", "shareFiles", {
      uris,
      mimeType,
      title,
      dialogTitle: "공유할 앱을 선택하세요",
    });
  }
  // "다운로드한 파일이 어디에 저장되는지 모르겠다"는 요청으로 추가 - 공유 화면과 달리 이건 다른 앱으로
  // 넘기지 않고, 안드로이드 표준 "다운로드" 폴더(파일 관리자 앱에서 바로 보이는 곳)에 직접 저장하고
  // 그 위치를 그대로 돌려준다. 네이티브 FileSaver 플러그인(이 프로젝트가 직접 만든 것, android/app/src/
  // main/java/.../FileSaver.java) 사용.
  async function nativeSaveToDownloads(blob, filename, mimeType) {
    const base64 = await blobToBase64(blob);
    // { location, uri, mimeType } - uri는 저장 직후 "어떤 프로그램으로 열지" 선택 화면을 띄우는 데 쓴다.
    return callNativePlugin("FileSaver", "saveToDownloads", {
      filename,
      data: base64,
      mimeType,
    });
  }
  // 저장된 파일이 실제로 정상 파일인지, 한글 등 원하는 프로그램에서 잘 열리는지 그 자리에서 바로
  // 확인할 수 있도록 안드로이드의 "다음으로 열기" 앱 선택 화면을 띄운다. 열 수 있는 앱이 없어도
  // (예: 한글 앱 미설치) 조용히 무시한다 - 파일은 이미 다운로드 폴더에 저장되어 있으므로 실패로 볼 일은 아니다.
  async function nativeOfferToOpen(uri, mimeType) {
    try {
      await callNativePlugin("FileSaver", "openFile", { uri, mimeType });
    } catch (e) {
      // 열 앱이 없는 경우 등 - 파일 저장 자체는 이미 성공했으므로 조용히 넘어간다.
    }
  }

  // 업로드/생성되는 파일을 구글 드라이브(사장님 계정, 중앙 백업 프록시)에 저장 - 꺼져 있으면
  // 아무 일도 하지 않고, 실패해도 절대 호출부의 저장/UI 흐름을 막지 않는 fire-and-forget 함수.
  function backupToDrive(siteId, category, filename, blob) {
    if (!blob) return;
    (siteId ? FireDB.getSite(siteId) : Promise.resolve(null))
      .then((site) => DriveBackup.uploadToSite(site ? site.name : null, category, filename, blob))
      .catch(() => {});
  }

  function todayISO() {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${m}-${day}`;
  }

  // "01031308364" 처럼 하이픈 없이 저장된 옛날 데이터도 화면에는 "010-3130-8364"처럼 보이도록 표시용으로 포맷.
  // 이미 하이픈이 있거나 형식을 알 수 없는 값은 원본 그대로 둔다(잘못 자르지 않기 위해).
  function formatPhone(raw) {
    const digits = (raw || "").replace(/[^0-9]/g, "");
    if (!digits) return raw || "";
    if (digits.length === 11) return digits.replace(/(\d{3})(\d{4})(\d{4})/, "$1-$2-$3");
    if (digits.length === 10) {
      return digits.startsWith("02")
        ? digits.replace(/(\d{2})(\d{4})(\d{4})/, "$1-$2-$3")
        : digits.replace(/(\d{3})(\d{3})(\d{4})/, "$1-$2-$3");
    }
    if (digits.length === 9 && digits.startsWith("02")) return digits.replace(/(\d{2})(\d{3})(\d{4})/, "$1-$2-$3");
    return raw || "";
  }

  function revokeObjectUrls() {
    activeObjectUrls.forEach((u) => URL.revokeObjectURL(u));
    activeObjectUrls = [];
  }

  // ---------- 거래처 지역 분류 (가나다순/지역별 정렬용) ----------
  // 대구는 구/군 단위까지, 그 외 지역은 도/광역시 단위까지만 분류한다(사용자 요청).
  // "달서구"는 "서구"를 부분 문자열로 포함하므로 반드시 먼저 검사해야 오분류를 피할 수 있다.
  const DAEGU_DISTRICTS = ["달서구", "달성군", "군위군", "수성구", "동구", "서구", "남구", "북구", "중구"];
  const PROVINCE_PATTERNS = [
    [/^대구/, "대구"],
    [/^서울/, "서울"],
    [/^부산/, "부산"],
    [/^인천/, "인천"],
    [/^광주/, "광주"],
    [/^대전/, "대전"],
    [/^울산/, "울산"],
    [/^세종/, "세종"],
    [/^경기/, "경기"],
    [/^강원/, "강원"],
    [/^충청북|^충북/, "충북"],
    [/^충청남|^충남/, "충남"],
    [/^전라북|^전북/, "전북"],
    [/^전라남|^전남/, "전남"],
    [/^경상북|^경북/, "경북"],
    [/^경상남|^경남/, "경남"],
    [/^제주/, "제주"]
  ];
  function classifyRegion(address) {
    const addr = (address || "").trim();
    if (!addr) return "지역 미상";
    for (const [re, label] of PROVINCE_PATTERNS) {
      if (!re.test(addr)) continue;
      if (label === "대구") {
        const gu = DAEGU_DISTRICTS.find((g) => addr.includes(g));
        return gu || "대구 기타";
      }
      return label;
    }
    return "지역 미상";
  }
  // 요약줄의 "N개 지역" 개수용 - 버튼 그리드는 대구를 구/군까지 쪼개서 보여주지만,
  // 이 개수는 광역시/도 단위로만 세어 대구의 여러 구가 지역 개수를 부풀리지 않게 한다.
  function classifyBroadRegion(address) {
    const addr = (address || "").trim();
    if (!addr) return "지역 미상";
    for (const [re, label] of PROVINCE_PATTERNS) {
      if (re.test(addr)) return label;
    }
    return "지역 미상";
  }

  // 이행완료 보고서의 "○○ 소방본부장ㆍ소방서장 귀하"를 실제 관할소방서 이름으로 채우기 위한 최선 추정.
  // 정확한 관할 구역은 소방서마다 다르고 공식 API가 없어 완전히 보장할 수 없으므로, 확실히 아는 대구 구/군과
  // 창원(마산/창원/진해로 나뉨) 특례만 정확히 매핑하고, 나머지는 "OO시/군소방서" 일반 규칙으로 추정한다.
  // 현장 등록 화면의 "관할소방서" 칸은 직접 입력할 수 없는 읽기 전용 칸이라, 이 추정값이 곧 저장되는 값이다.
  const DAEGU_FIRE_STATION = {
    "중구": "중부소방서", "동구": "동부소방서", "서구": "서부소방서", "남구": "남부소방서",
    "북구": "북부소방서", "수성구": "수성소방서", "달서구": "달서소방서", "달성군": "달성소방서"
  };
  const CHANGWON_FIRE_STATION = {
    "마산합포구": "마산소방서", "마산회원구": "마산소방서",
    "성산구": "창원소방서", "의창구": "창원소방서",
    "진해구": "진해소방서"
  };
  function guessFireStation(address) {
    const addr = (address || "").trim();
    if (!addr) return "";
    if (/^대구/.test(addr)) {
      const gu = DAEGU_DISTRICTS.find((g) => addr.includes(g));
      return (gu && DAEGU_FIRE_STATION[gu]) || "";
    }
    if (addr.includes("창원시")) {
      const gu = Object.keys(CHANGWON_FIRE_STATION).find((g) => addr.includes(g));
      if (gu) return CHANGWON_FIRE_STATION[gu];
    }
    const tokens = addr.split(/\s+/);
    for (let i = 1; i < tokens.length; i++) {
      const t = tokens[i].replace(/[^가-힣]/g, "");
      if (/^[가-힣]{2,}(시|군)$/.test(t) && !/(특별시|광역시|특별자치시|특별자치도)$/.test(t)) {
        // 실제 소방서 명칭은 "OO시소방서"가 아니라 "시/군" 접미사를 뗀 "OO소방서" 형태이므로
        // (예: "경산시" -> "경산소방서", "경산시소방서" 아님) 여기서 접미사를 제거한다.
        return `${t.replace(/(시|군)$/, "")}소방서`;
      }
    }
    return "";
  }

  // 사용승인일 문자열에서 월(1~12)만 최대한 관대하게 뽑아낸다 - "YYYY-MM-DD", "YYYYMMDD", "YYYY.M.D",
  // "2013년 7월" 처럼 자유 입력/자동 인식 결과가 저마다 형식이 다를 수 있어서.
  function extractApprovalMonth(approvalDate) {
    const s = (approvalDate || "").trim();
    if (!s) return null;
    const m = s.match(/^\d{4}[.\-/](\d{1,2})[.\-/]\d{1,2}/) || s.match(/^\d{4}(\d{2})\d{2}$/) || s.match(/(\d{1,2})\s*월/);
    if (!m) return null;
    const month = parseInt(m[1], 10);
    return month >= 1 && month <= 12 ? month : null;
  }

  // 종합점검/작동점검 대상월 계산 - site.comprehensiveTarget이 true(스프링클러 등 설치, 종합점검 대상)면
  // 종합점검은 사용승인월, 작동점검은 그 6개월 뒤. false(해당없음)면 종합점검 없이 작동점검만 사용승인월.
  // comprehensiveTarget이 아직 정해지지 않았거나(null) 사용승인일을 알 수 없으면 자동계산은 못하지만,
  // site.comprehensiveMonthOverride/operationalMonthOverride(현장 정보 수정 화면에서 예외적으로 직접
  // 지정한 월)가 있으면 그 값이 항상 자동계산 결과보다 우선한다.
  function computeInspectionMonths(site) {
    const approvalMonth = extractApprovalMonth(site.approvalDate);
    let comprehensiveMonth = null;
    let operationalMonth = null;
    if (approvalMonth !== null && typeof site.comprehensiveTarget === "boolean") {
      if (site.comprehensiveTarget) {
        comprehensiveMonth = approvalMonth;
        operationalMonth = ((approvalMonth - 1 + 6) % 12) + 1;
      } else {
        operationalMonth = approvalMonth;
      }
    }
    if (typeof site.comprehensiveMonthOverride === "number") comprehensiveMonth = site.comprehensiveMonthOverride;
    if (typeof site.operationalMonthOverride === "number") operationalMonth = site.operationalMonthOverride;
    if (comprehensiveMonth === null && operationalMonth === null) return null;
    return { comprehensiveMonth, operationalMonth };
  }

  function inspectionScheduleBadgeHtml(site) {
    const sched = computeInspectionMonths(site);
    if (!sched) return "";
    const comp = sched.comprehensiveMonth ? `종합 ${sched.comprehensiveMonth}월` : "종합 해당없음";
    return `<span class="inspection-schedule-badge">${comp} · 작동 ${sched.operationalMonth}월</span>`;
  }

  function showScreen(id) {
    $$(".screen").forEach((s) => s.classList.remove("active"));
    $("#" + id).classList.add("active");
    $$(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === id));
  }

  // 헤더의 "← 뒤로" 버튼은 화면마다 원래 있던 개별 뒤로가기 버튼을 그대로 대신 눌러준다 -
  // (그 버튼들이 이미 각 화면에 맞는 재조회/상태 정리를 다 하고 있으므로 로직을 중복시키지 않는다)
  // 매핑에 없는 화면(홈, 거래처보기/일정관리/설정/지적사항 허브 같은 최상위 탭 화면)은 홈으로 이동한다.
  const BACK_DELEGATE = {
    "screen-construction-team": "btnBackFromConstructionTeam",
    "screen-construction-company": "btnBackFromConstructionCompany",
    "screen-construction-estimates": "btnBackFromConstructionEstimates",
    "screen-construction-history": "btnBackFromConstructionHistory",
    "screen-inspection-team": "btnBackFromInspectionTeam",
    "screen-site-entry-choice": "btnCancelEntryChoice",
    "screen-site-form": "btnCancelSiteForm",
    "screen-site-detail": "btnBackToSites",
    "screen-photo-gallery": "btnBackFromGallery",
    "screen-deficiencies": "btnBackFromDeficiencies",
    "screen-completion-report": "btnBackFromCompletionReport"
  };

  // ---------- 홈 ----------
  const WEEKDAY_LABEL = ["일", "월", "화", "수", "목", "금", "토"];

  async function renderHomeTodo() {
    const today = todayISO();
    const now = new Date();
    $("#homeTodoDate").textContent = `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일 (${WEEKDAY_LABEL[now.getDay()]})`;

    const [inspections, sites] = await Promise.all([FireDB.getAllInspections(), FireDB.getAllSites()]);
    const siteMap = new Map(sites.map((s) => [s.id, s]));
    const lastBySite = computeLastInspectionBySite(inspections);
    const pending = inspections.filter((i) => i.status !== "completed" && i.scheduledDate && i.scheduledDate <= today);
    pending.sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate));

    const list = $("#homeTodoList");
    if (pending.length === 0) {
      list.innerHTML = `<div class="home-todo-empty">오늘 예정된 할일이 없습니다.</div>`;
      return;
    }
    list.innerHTML = pending.map((insp) => {
      const site = siteMap.get(insp.siteId);
      const isOverdue = insp.scheduledDate < today;
      const last = site ? lastBySite.get(site.id) : null;
      const lastDate = last ? (last.completedDate || last.scheduledDate) : "";
      return `
        <div class="home-todo-item ${isOverdue ? "is-overdue" : ""}" data-site-id="${insp.siteId}">
          <span class="home-todo-item-icon">${isOverdue ? "⚠️" : "🔔"}</span>
          <div class="home-todo-item-body">
            <div class="home-todo-item-title">${escapeHtml(site ? site.name : "알 수 없는 현장")}</div>
            <div class="home-todo-item-sub">${escapeHtml(insp.type || "점검")} · ${isOverdue ? `기한초과 (${escapeHtml(insp.scheduledDate)})` : "오늘 예정"}</div>
            <div class="home-todo-item-sub">마지막 점검일: ${lastDate ? escapeHtml(lastDate) : "이력 없음"}</div>
            ${site && site.equipmentMemo ? `<div class="home-todo-item-memo">📝 ${escapeHtml(site.equipmentMemo)}</div>` : ""}
          </div>
        </div>
      `;
    }).join("");
    $$("#homeTodoList .home-todo-item").forEach((el) => {
      el.addEventListener("click", () => openSiteDetail(el.dataset.siteId));
    });
  }

  async function goHome() {
    showScreen("screen-home");
    try {
      await renderHomeTodo();
    } catch (err) {
      toast((err && err.message) || "오늘의 할일을 불러오지 못했습니다.", "error");
    }
  }

  $("#appHeaderTitle").addEventListener("click", goHome);
  $("#btnHeaderHome").addEventListener("click", goHome);
  $("#btnHeaderBack").addEventListener("click", () => {
    const current = $(".screen.active");
    const delegateId = current && BACK_DELEGATE[current.id];
    if (delegateId) $("#" + delegateId).click();
    else goHome();
  });

  // ---------- 안드로이드 하드웨어 뒤로가기 버튼 ----------
  // @capacitor/app 플러그인이 없으면 웹뷰 기본 동작(뒤로 갈 브라우저 히스토리가 없으면 그냥 앱 종료)이
  // 그대로 발동해 어느 화면에서 눌러도 앱이 꺼져버렸다(실제 사용자가 겪은 문제) - 이 리스너가 화면
  // 전환/모달 닫기로 대신 처리하고("← 뒤로" 헤더 버튼과 완전히 같은 경로, BACK_DELEGATE 재사용),
  // 정말 홈 화면일 때만 실제 종료로 넘긴다.
  if (isNativeApp() && window.Capacitor.addListener) {
    window.Capacitor.addListener("App", "backButton", () => {
      const openModal = $$(".modal-overlay:not(.hidden), .photo-viewer-overlay:not(.hidden)")[0];
      if (openModal) {
        const closeBtn = openModal.querySelector("#confirmCancelBtn, #shareFormatCancelBtn, #btnClosePhotoViewer");
        if (closeBtn) { closeBtn.click(); return; }
      }
      const current = $(".screen.active");
      if (current && current.id === "screen-home") {
        callNativePlugin("App", "exitApp", {});
        return;
      }
      $("#btnHeaderBack").click();
    });
  }
  $("#btnHomeAddSite").addEventListener("click", () => $("#btnAddSite").click());
  $("#btnHomeViewSites").addEventListener("click", () => { renderSites(); showScreen("screen-sites"); });
  $("#btnHomeConstructionTeam").addEventListener("click", () => { renderConstructionTeam(); showScreen("screen-construction-team"); });
  $("#btnHomeInspectionTeam").addEventListener("click", () => showScreen("screen-inspection-team"));
  $("#btnHomeScheduleManage").addEventListener("click", async () => {
    scheduleCalDate = new Date();
    await selectScheduleDate(todayISO());
    showScreen("screen-schedule-manage");
  });
  $("#btnBackFromScheduleManage").addEventListener("click", goHome);
  $("#btnBackFromConstructionTeam").addEventListener("click", goHome);
  $("#btnBackFromInspectionTeam").addEventListener("click", goHome);

  // ---------- 공사팀 (업체 = 거래처 재사용, 견적서/공사내역은 업체별 하위 메뉴) ----------
  async function renderConstructionTeam() {
    const sites = await FireDB.getAllSites();
    sites.sort((a, b) => a.name.localeCompare(b.name, "ko"));
    const list = $("#constructionTeamList");
    if (sites.length === 0) {
      list.innerHTML = `<div class="empty-state">등록된 업체가 없습니다.</div>`;
      return;
    }
    list.innerHTML = sites.map((s) => `
      <div class="list-card" data-id="${s.id}">
        <div class="list-card-title">${escapeHtml(s.name)}</div>
        <div class="list-card-sub">${s.address ? "📍 " + escapeHtml(s.address) : "주소 미입력"}</div>
      </div>
    `).join("");
    Array.from(list.querySelectorAll(".list-card")).forEach((el) => {
      el.addEventListener("click", () => openConstructionCompany(el.dataset.id));
    });
  }

  async function openConstructionCompany(id) {
    currentConstructionSiteId = id;
    const site = await FireDB.getSite(id);
    if (!site) { renderConstructionTeam(); showScreen("screen-construction-team"); return; }
    $("#constructionCompanyName").textContent = site.name;
    $("#constructionCompanyAddress").textContent = site.address || "";
    showScreen("screen-construction-company");
  }

  $("#btnBackFromConstructionCompany").addEventListener("click", () => { renderConstructionTeam(); showScreen("screen-construction-team"); });

  $("#btnConstructionEstimates").addEventListener("click", async () => {
    const site = await FireDB.getSite(currentConstructionSiteId);
    $("#constructionEstimatesCompanyName").textContent = site ? site.name : "";
    showScreen("screen-construction-estimates");
  });
  $("#btnBackFromConstructionEstimates").addEventListener("click", () => showScreen("screen-construction-company"));

  $("#btnConstructionHistory").addEventListener("click", async () => {
    const site = await FireDB.getSite(currentConstructionSiteId);
    $("#constructionHistoryCompanyName").textContent = site ? site.name : "";
    showScreen("screen-construction-history");
  });
  $("#btnBackFromConstructionHistory").addEventListener("click", () => showScreen("screen-construction-company"));

  // ---------- 탭 ----------
  // 자료를 불러오다 실패/시간초과되면(예: 불안정한 네트워크) 화면은 바뀌었는데 내용은 계속
  // 비어있는 채로 남아 "눌러도 반응 없음"처럼 보일 수 있다 - 실패를 토스트로 반드시 보여준다.
  function reportLoadFailure(err) {
    toast((err && err.message) || "자료를 불러오지 못했습니다. 네트워크를 확인해주세요.", "error");
  }
  $$(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      if (tab === "screen-deficiency-hub") renderDeficiencyHub().catch(reportLoadFailure);
      if (tab === "screen-reports-hub") renderReportsHub().catch(reportLoadFailure);
      if (tab === "screen-sites") renderSites().catch(reportLoadFailure);
      if (tab === "screen-route") renderRoute().catch(reportLoadFailure);
      if (tab === "screen-settings") renderSettings().catch(reportLoadFailure);
      showScreen(tab);
    });
  });

  // ================= 현장 =================
  function siteCardHtml(s, lastBySite) {
    const last = lastBySite.get(s.id);
    return `
      <div class="list-card" data-id="${s.id}">
        <div class="list-card-title"><span>${escapeHtml(s.name)}</span>${inspectionScheduleBadgeHtml(s)}</div>
        <div class="list-card-sub">${s.address ? "📍 " + escapeHtml(s.address) : "주소 미입력"}${s.contactName ? " · 담당자: " + escapeHtml(s.contactName) : ""}</div>
        <div class="list-card-sub">${last ? `마지막 점검일: ${escapeHtml(last.completedDate || last.scheduledDate)} · 점검자: ${escapeHtml(last.inspector || "-")}` : "점검 이력 없음"}</div>
        <div class="list-card-sub site-card-phone-row">
          <span>${s.contactPhone ? "📞 " + escapeHtml(formatPhone(s.contactPhone)) : "연락처 미입력"}</span>
          ${s.contactPhone ? `<a class="btn-call" href="tel:${escapeHtml(s.contactPhone)}">전화걸기</a>` : ""}
        </div>
      </div>
    `;
  }
  function bindSiteCardClicks(container) {
    Array.from(container.querySelectorAll(".list-card")).forEach((el) => {
      el.addEventListener("click", () => openSiteDetail(el.dataset.id));
      const callBtn = el.querySelector(".btn-call");
      if (callBtn) callBtn.addEventListener("click", (e) => e.stopPropagation());
    });
  }
  function renderSiteCardsInto(list, sitesArr, lastBySite, emptyMessage) {
    if (sitesArr.length === 0) {
      list.innerHTML = `<div class="empty-state">${emptyMessage}</div>`;
      return;
    }
    list.innerHTML = sitesArr.map((s) => siteCardHtml(s, lastBySite)).join("");
    bindSiteCardClicks(list);
  }

  function renderSitesByRegion(sites, lastBySite) {
    const list = $("#sitesList");

    if (sitesSelectedRegion) {
      const filtered = sites.filter((s) => classifyRegion(s.address) === sitesSelectedRegion);
      const backBtnHtml = `<button class="btn btn-secondary region-back-row" id="btnBackToRegionList">← 지역 목록으로 (${escapeHtml(sitesSelectedRegion)})</button>`;
      if (filtered.length === 0) {
        list.innerHTML = `${backBtnHtml}<div class="empty-state">이 지역에 등록된 현장이 없습니다.</div>`;
      } else {
        list.innerHTML = backBtnHtml + filtered.map((s) => siteCardHtml(s, lastBySite)).join("");
        bindSiteCardClicks(list);
      }
      $("#btnBackToRegionList").addEventListener("click", () => { sitesSelectedRegion = null; renderSites(); });
      return;
    }

    // 지역 버튼 목록: 대구는 구/군 단위로, 그 외는 도/광역시 단위로, 실제로 거래처가 있는 지역만 표시.
    const counts = new Map();
    sites.forEach((s) => {
      const region = classifyRegion(s.address);
      counts.set(region, (counts.get(region) || 0) + 1);
    });
    const daeguOrder = DAEGU_DISTRICTS.filter((g) => counts.has(g));
    const otherOrder = PROVINCE_PATTERNS.map(([, label]) => label).filter((l) => l !== "대구" && counts.has(l));
    const orderedRegions = [...daeguOrder, ...otherOrder];
    if (counts.has("대구 기타")) orderedRegions.push("대구 기타");
    if (counts.has("지역 미상")) orderedRegions.push("지역 미상");

    list.innerHTML = `<div class="region-grid">${orderedRegions.map((r) => `
      <button class="region-btn" data-region="${escapeHtml(r)}">
        <span class="region-btn-name">${escapeHtml(r)}</span>
        <span class="region-btn-count">${counts.get(r)}개</span>
      </button>
    `).join("")}</div>`;
    Array.from(list.querySelectorAll(".region-btn")).forEach((btn) => {
      btn.addEventListener("click", () => { sitesSelectedRegion = btn.dataset.region; renderSites(); });
    });
  }

  // "마지막 점검일"은 실제로 완료된 점검만 대상으로 한다 - 아직 완료되지 않은 예정 건은 날짜가 더 미래라도 "마지막"이 아니다.
  function computeLastInspectionBySite(inspections) {
    const lastBySite = new Map();
    inspections.forEach((insp) => {
      if (insp.status !== "completed") return;
      const d = insp.completedDate || insp.scheduledDate || "";
      const cur = lastBySite.get(insp.siteId);
      const curD = cur ? (cur.completedDate || cur.scheduledDate || "") : "";
      if (!cur || d > curD) lastBySite.set(insp.siteId, insp);
    });
    return lastBySite;
  }

  async function renderSites() {
    const [sites, inspections] = await Promise.all([FireDB.getAllSites(), FireDB.getAllInspections()]);
    sites.sort((a, b) => a.name.localeCompare(b.name, "ko"));

    const lastBySite = computeLastInspectionBySite(inspections);

    const list = $("#sitesList");
    const summary = $("#sitesSummary");
    if (sites.length === 0) {
      summary.textContent = "";
      list.innerHTML = `<div class="empty-state">등록된 현장이 없습니다.<br>현장을 추가해 점검을 시작하세요.</div>`;
      return;
    }

    if (sitesSortMode === "region") {
      if (sitesSelectedRegion) {
        const inRegion = sites.filter((s) => classifyRegion(s.address) === sitesSelectedRegion).length;
        summary.innerHTML = `<strong>${sitesSelectedRegion}</strong> ${inRegion}개 · 전체 ${sites.length}개`;
      } else {
        const regionCount = new Set(sites.map((s) => classifyBroadRegion(s.address))).size;
        summary.innerHTML = `전체 <strong>${sites.length}개</strong> 거래처 · ${regionCount}개 지역`;
      }
      renderSitesByRegion(sites, lastBySite);
      return;
    }
    summary.innerHTML = `전체 <strong>${sites.length}개</strong> 거래처`;
    renderSiteCardsInto(list, sites, lastBySite, "등록된 현장이 없습니다.");
  }

  $("#btnSortByName").addEventListener("click", () => {
    sitesSortMode = "name";
    sitesSelectedRegion = null;
    $("#btnSortByName").classList.add("active");
    $("#btnSortByRegion").classList.remove("active");
    renderSites();
  });
  $("#btnSortByRegion").addEventListener("click", () => {
    sitesSortMode = "region";
    $("#btnSortByRegion").classList.add("active");
    $("#btnSortByName").classList.remove("active");
    renderSites();
  });

  // 방문 예약/이력(일정관리, 오늘의 할일, 마지막 점검일) 트리거 - 예전엔 체크리스트를 여는 것 자체가 트리거였으나
  // 체크리스트가 사진 갤러리로 대체되면서, 이제 "현장점검 사진" 갤러리를 여는 것이 같은 역할을 한다.
  async function getOrCreateActiveInspection(siteId) {
    const inspections = await FireDB.getInspectionsBySite(siteId);
    const inProgress = inspections.filter((i) => i.status !== "completed");
    inProgress.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    if (inProgress.length > 0) return inProgress[0];
    const insp = {
      siteId,
      type: "작동점검",
      scheduledDate: todayISO(),
      inspector: "",
      status: "scheduled",
      completedDate: null,
      createdAt: new Date().toISOString()
    };
    return FireDB.addInspection(insp);
  }

  const SITE_FORM_FIELDS = [
    "siteName", "siteAddress", "siteContactName", "siteContactPhone", "siteFireStation", "siteStation119",
    "siteBuildingType", "siteArea", "siteFloorInfo", "siteApprovalDate", "siteStructure",
    "siteFireManagerName", "siteFireManagerPhone", "siteFireManagerAppointDate", "siteFireManagerEduDate",
    "siteEngineerName", "siteEngineerPhone", "siteNotes",
    "siteReceiverLocation", "siteReceiverAccess", "sitePumpRoomLocation", "sitePumpRoomAccess", "siteEquipmentMemo"
  ];

  // "종합점검대상"/"종합점검 해당없음" 토글 - 이미 선택된 버튼을 다시 누르면 미정(null) 상태로 되돌아간다.
  function renderComprehensiveToggle(value) {
    comprehensiveTarget = value;
    $("#btnCompTargetYes").classList.toggle("active", value === true);
    $("#btnCompTargetNo").classList.toggle("active", value === false);
    renderMonthPickerButtons();
  }
  $("#btnCompTargetYes").addEventListener("click", () => renderComprehensiveToggle(comprehensiveTarget === true ? null : true));
  $("#btnCompTargetNo").addEventListener("click", () => renderComprehensiveToggle(comprehensiveTarget === false ? null : false));

  // 종합점검/작동점검 버튼에 현재 값(직접 지정한 값이 있으면 그 값, 없으면 자동계산 결과)을 표시.
  function renderMonthPickerButtons() {
    const sched = computeInspectionMonths({
      comprehensiveTarget,
      approvalDate: $("#siteApprovalDate").value,
      comprehensiveMonthOverride: comprehensiveMonthValue,
      operationalMonthOverride: operationalMonthValue
    });
    const comp = sched && sched.comprehensiveMonth;
    $("#btnPickComprehensiveMonth").textContent = comp ? `${comp}월` : (comprehensiveTarget === false ? "해당없음" : "미정");
    const oper = sched && sched.operationalMonth;
    $("#btnPickOperationalMonth").textContent = oper ? `${oper}월` : "미정";
  }
  $("#siteApprovalDate").addEventListener("input", renderMonthPickerButtons);

  // 월 그리드에서 고른 뒤에도 확인 다이얼로그를 한 번 더 거쳐야 실제로 반영된다 - 그리드 자체에서
  // 취소하거나 확인 다이얼로그에서 취소하면 기존 표시값 그대로 유지, 마지막에 "저장" 버튼을 눌러야
  // site.comprehensiveMonthOverride/operationalMonthOverride로 실제 저장된다(btnSaveSite 참고).
  $("#btnPickComprehensiveMonth").addEventListener("click", async () => {
    const month = await pickMonth("종합점검 월 선택");
    if (month === null) return;
    if (!(await confirmDialog(`종합점검을 ${month}월로 변경하시겠습니까?`))) return;
    comprehensiveMonthValue = month;
    renderMonthPickerButtons();
  });
  $("#btnPickOperationalMonth").addEventListener("click", async () => {
    const month = await pickMonth("작동점검 월 선택");
    if (month === null) return;
    if (!(await confirmDialog(`작동점검을 ${month}월로 변경하시겠습니까?`))) return;
    operationalMonthValue = month;
    renderMonthPickerButtons();
  });

  function openBlankSiteForm() {
    editingSiteId = null;
    pendingAttachments = [];
    $("#siteFormTitle").textContent = "현장 추가";
    SITE_FORM_FIELDS.forEach((id) => { $("#" + id).value = ""; });
    comprehensiveMonthValue = null;
    operationalMonthValue = null;
    renderComprehensiveToggle(null);
    $("#bldRegResult").classList.add("hidden");
    $("#importSummary").classList.add("hidden");
    lastAutoBldRegAddress = "";
    renderSiteAttachments();
    showScreen("screen-site-form");
  }

  function formatFileSize(bytes) {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  }

  function attachmentRowHtml(id, filename, size, url) {
    return `
      <div class="list-card attachment-row">
        <div class="list-card-title">
          <a href="${url}" download="${escapeHtml(filename)}">${escapeHtml(filename)}</a>
        </div>
        <div class="list-card-sub">${formatFileSize(size)}</div>
        <button class="btn btn-danger btn-delete-attachment" data-att="${id}" type="button">삭제</button>
      </div>
    `;
  }

  async function renderSiteAttachments() {
    revokeObjectUrls();
    const list = $("#siteAttachmentsList");

    // 신규 현장(아직 저장 전)은 메모리 상의 pendingAttachments를 보여주고, 저장 시점에 실제 DB로 옮겨 담는다.
    if (!editingSiteId) {
      if (pendingAttachments.length === 0) {
        list.innerHTML = `<div class="empty-state">첨부된 자료가 없습니다.</div>`;
        return;
      }
      list.innerHTML = pendingAttachments.map((att) => {
        const url = URL.createObjectURL(att.blob);
        activeObjectUrls.push(url);
        return attachmentRowHtml(att.tempId, att.filename, att.size, url);
      }).join("");
      list.querySelectorAll(".btn-delete-attachment").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const ok = await confirmDialog("이 자료를 삭제할까요?");
          if (!ok) return;
          pendingAttachments = pendingAttachments.filter((a) => a.tempId !== btn.dataset.att);
          renderSiteAttachments();
        });
      });
      return;
    }

    const attachments = await FireDB.getAttachmentsBySite(editingSiteId);
    if (attachments.length === 0) {
      list.innerHTML = `<div class="empty-state">첨부된 자료가 없습니다.</div>`;
      return;
    }
    list.innerHTML = attachments.map((att) => {
      const url = URL.createObjectURL(att.blob);
      activeObjectUrls.push(url);
      return attachmentRowHtml(att.id, att.filename, att.size, url);
    }).join("");
    list.querySelectorAll(".btn-delete-attachment").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const ok = await confirmDialog("이 자료를 삭제할까요?");
        if (!ok) return;
        await FireDB.deleteAttachment(btn.dataset.att);
        renderSiteAttachments();
      });
    });
  }

  $("#btnUploadAttachment").addEventListener("click", () => {
    $("#attachmentInput").click();
  });

  $("#attachmentInput").addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (files.length === 0) return;
    if (editingSiteId) {
      for (const file of files) {
        await FireDB.addAttachment({
          siteId: editingSiteId,
          filename: file.name,
          size: file.size,
          blob: file,
          createdAt: new Date().toISOString()
        });
        backupToDrive(editingSiteId, "첨부파일", file.name, file);
      }
    } else {
      for (const file of files) {
        pendingAttachments.push({ tempId: FireDB.genId(), filename: file.name, size: file.size, blob: file });
      }
    }
    await renderSiteAttachments();
    toast(`${files.length}개 자료를 첨부했습니다.`);
  });

  $("#btnAddSite").addEventListener("click", () => showScreen("screen-site-entry-choice"));
  $("#btnCancelEntryChoice").addEventListener("click", () => { renderSites(); showScreen("screen-sites"); });
  $("#btnEntryManual").addEventListener("click", openBlankSiteForm);
  $("#btnEntryImport").addEventListener("click", () => $("#clientImportInput").click());

  $("#clientImportInput").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    ImportLoading.show(AiFill.isEnabled() ? "AI가 자료를 분석하고 있습니다." : "자료를 분석하고 있습니다.");
    ImportLoading.startSimulated();
    try {
      let result = null;
      if (AiFill.isEnabled()) {
        try {
          const aiResult = await AiFill.analyzeClientFile(file);
          if (!aiResult.unsupported) result = aiResult;
        } catch (aiErr) {
          result = null; // AI 분석 실패 시 기존 방식으로 폴백
        }
      }
      if (!result) {
        result = await ClientImport.parseClientFile(file, (percent) =>
          ImportLoading.setProgress(percent, "사진에서 글자를 인식하고 있습니다.")
        );
      }
      {
        const guessName = (result.fields && result.fields.name) || file.name.replace(/\.[^.]+$/, "");
        DriveBackup.uploadToSite(guessName, "거래처_등록자료", file.name, file).catch(() => {});
      }
      if (result.unsupported) {
        toast(`지원하지 않는 파일 형식입니다 (.xlsx, .docx, .pdf, .hwp, .hwpx, 사진).`, "error");
        return;
      }
      openBlankSiteForm();
      if (result.failed) {
        $("#importSummary").classList.remove("hidden");
        $("#importSummary").textContent = `${result.typeLabel}에서 자동으로 인식된 항목이 없습니다. 아래 내용을 직접 입력해주세요.`;
        toast(`${result.typeLabel}에서 인식된 정보가 없습니다. 직접 입력해주세요.`, "error");
        return;
      }
      const map = {
        name: "siteName", address: "siteAddress",
        contactName: "siteContactName", contactPhone: "siteContactPhone",
        fireManagerName: "siteFireManagerName", fireManagerPhone: "siteFireManagerPhone",
        fireManagerAppointDate: "siteFireManagerAppointDate", fireManagerEduDate: "siteFireManagerEduDate",
        engineerName: "siteEngineerName", engineerPhone: "siteEngineerPhone",
        receiverLocation: "siteReceiverLocation", pumpRoomLocation: "sitePumpRoomLocation",
        area: "siteArea", approvalDate: "siteApprovalDate", floorInfo: "siteFloorInfo",
        buildingType: "siteBuildingType"
      };
      let filledCount = 0;
      Object.entries(map).forEach(([field, id]) => {
        if (result.fields[field]) { $("#" + id).value = result.fields[field]; filledCount++; }
      });
      // 스프링클러설비 체크 여부(AI 분석 전용 - 정규식 폴백 경로에는 이 필드가 없음)로 종합점검대상 토글을 미리 맞춰준다.
      // 사용자가 내용을 확인하고 필요하면 직접 다시 눌러 바꿀 수 있다.
      if (result.fields.sprinklerInstalled === "예") renderComprehensiveToggle(true);
      else if (result.fields.sprinklerInstalled === "아니오") renderComprehensiveToggle(false);
      $("#importSummary").classList.remove("hidden");
      $("#importSummary").textContent = `${result.typeLabel}에서 ${filledCount}개 항목을 자동으로 채웠습니다.${result.lowConfidence ? " 인식 품질이 낮을 수 있으니 내용을 꼭 확인해주세요." : " 내용을 확인 후 저장해주세요."}`;
      toast(`${result.typeLabel}에서 ${filledCount}개 항목을 채웠습니다. 내용을 확인해주세요.`);
      if (result.fields.address) {
        lastAutoBldRegAddress = result.fields.address;
        lookupBldRegForCurrentAddress();
      }
    } catch (err) {
      toast("파일을 분석하는 중 오류가 발생했습니다. 직접 입력해주세요.", "error");
      openBlankSiteForm();
    } finally {
      ImportLoading.hide();
    }
  });

  $("#btnCancelSiteForm").addEventListener("click", () => {
    if (editingSiteId) openSiteDetail(editingSiteId); else { renderSites(); showScreen("screen-sites"); }
  });

  // 주소가 같은 현장은 새로 만들지 않고 기존 현장에 합친다 - 공백 차이 정도만 무시하는 단순 정규화 비교.
  function normalizeAddress(addr) {
    return (addr || "").replace(/\s+/g, "").trim();
  }

  const SITE_FIELD_LABELS = {
    name: "현장명", address: "주소", contactName: "담당자명", contactPhone: "담당자 연락처",
    fireStation: "관할소방서", station119: "관할119안전센터",
    buildingType: "건물 용도", area: "연면적", floorInfo: "층수", approvalDate: "사용승인일", structure: "구조",
    fireManagerName: "소방안전관리자 성명", fireManagerPhone: "소방안전관리자 연락처",
    fireManagerAppointDate: "선임일자", fireManagerEduDate: "교육일자",
    engineerName: "담당기사 성명", engineerPhone: "담당기사 연락처",
    receiverLocation: "수신기 위치", receiverAccess: "수신기 접근방법",
    pumpRoomLocation: "펌프실 위치", pumpRoomAccess: "펌프실 접근방법",
    equipmentMemo: "메모", notes: "비고",
    comprehensiveTarget: "종합점검대상 여부",
    comprehensiveMonthOverride: "종합점검월(직접지정)", operationalMonthOverride: "작동점검월(직접지정)"
  };

  const NUMBER_FIELDS = new Set(["comprehensiveMonthOverride", "operationalMonthOverride"]);

  // 새로 입력/인식된 값 중 실제로 뭔가 채워진 것만 기존 현장 위에 덮어쓴다 - 새 값이 비어 있으면
  // (예: 이번엔 그 항목이 인식/입력되지 않음) 기존에 저장돼 있던 값을 그대로 유지한다.
  function mergeSiteData(oldSite, newData) {
    const merged = { ...oldSite };
    for (const key of Object.keys(newData)) {
      const nv = newData[key];
      if (key === "comprehensiveTarget") {
        if (typeof nv === "boolean") merged[key] = nv;
        continue;
      }
      if (NUMBER_FIELDS.has(key)) {
        if (typeof nv === "number") merged[key] = nv;
        continue;
      }
      if (nv !== undefined && nv !== null && String(nv).trim() !== "") merged[key] = nv;
    }
    return merged;
  }

  function diffSiteFields(oldSite, newSite) {
    const changes = [];
    for (const key of Object.keys(SITE_FIELD_LABELS)) {
      const isBool = key === "comprehensiveTarget";
      const isNum = NUMBER_FIELDS.has(key);
      const ov = isBool ? (typeof oldSite[key] === "boolean" ? String(oldSite[key]) : "")
        : isNum ? (typeof oldSite[key] === "number" ? String(oldSite[key]) : "")
        : String(oldSite[key] || "").trim();
      const nv = isBool ? (typeof newSite[key] === "boolean" ? String(newSite[key]) : "")
        : isNum ? (typeof newSite[key] === "number" ? String(newSite[key]) : "")
        : String(newSite[key] || "").trim();
      // 주소는 공백 차이만 있으면(중복 판정에 쓰는 정규화와 동일 기준) 실질적으로 안 바뀐 것으로 본다.
      const same = key === "address" ? normalizeAddress(ov) === normalizeAddress(nv) : ov === nv;
      if (nv && !same) changes.push({ field: key, label: SITE_FIELD_LABELS[key], oldValue: ov, newValue: nv });
    }
    return changes;
  }

  async function saveSiteAttachments(siteId, siteName) {
    for (const att of pendingAttachments) {
      await FireDB.addAttachment({
        siteId,
        filename: att.filename,
        size: att.size,
        blob: att.blob,
        createdAt: new Date().toISOString()
      });
      DriveBackup.uploadToSite(siteName, "첨부파일", att.filename, att.blob).catch(() => {});
    }
    pendingAttachments = [];
  }

  $("#btnSaveSite").addEventListener("click", async () => {
    const name = $("#siteName").value.trim();
    if (!name) { toast("현장명을 입력해주세요.", "error"); return; }
    const data = {
      name,
      address: $("#siteAddress").value.trim(),
      contactName: $("#siteContactName").value.trim(),
      contactPhone: $("#siteContactPhone").value.trim(),
      fireStation: $("#siteFireStation").value.trim(),
      station119: $("#siteStation119").value.trim(),
      comprehensiveTarget,
      comprehensiveMonthOverride: comprehensiveMonthValue,
      operationalMonthOverride: operationalMonthValue,
      buildingType: $("#siteBuildingType").value.trim(),
      area: $("#siteArea").value.trim(),
      floorInfo: $("#siteFloorInfo").value.trim(),
      approvalDate: $("#siteApprovalDate").value.trim(),
      structure: $("#siteStructure").value.trim(),
      fireManagerName: $("#siteFireManagerName").value.trim(),
      fireManagerPhone: $("#siteFireManagerPhone").value.trim(),
      fireManagerAppointDate: $("#siteFireManagerAppointDate").value.trim(),
      fireManagerEduDate: $("#siteFireManagerEduDate").value.trim(),
      engineerName: $("#siteEngineerName").value.trim(),
      engineerPhone: $("#siteEngineerPhone").value.trim(),
      receiverLocation: $("#siteReceiverLocation").value.trim(),
      receiverAccess: $("#siteReceiverAccess").value.trim(),
      pumpRoomLocation: $("#sitePumpRoomLocation").value.trim(),
      pumpRoomAccess: $("#sitePumpRoomAccess").value.trim(),
      equipmentMemo: $("#siteEquipmentMemo").value.trim(),
      notes: $("#siteNotes").value.trim()
    };
    if (editingSiteId) {
      const before = await FireDB.getSite(editingSiteId);
      const changes = diffSiteFields(before, data);
      if (changes.length > 0) data.changeHistory = [...(before.changeHistory || []), { date: new Date().toISOString(), changes }];
      await FireDB.updateSite(editingSiteId, data);
      openSiteDetail(editingSiteId);
      return;
    }
    const normAddr = normalizeAddress(data.address);
    const existing = normAddr ? (await FireDB.getAllSites()).find((s) => normalizeAddress(s.address) === normAddr) : null;
    if (existing) {
      const merged = mergeSiteData(existing, data);
      const changes = diffSiteFields(existing, merged);
      if (changes.length > 0) merged.changeHistory = [...(existing.changeHistory || []), { date: new Date().toISOString(), changes }];
      await FireDB.updateSite(existing.id, merged);
      await saveSiteAttachments(existing.id, merged.name);
      renderSites();
      showScreen("screen-sites");
      openSiteDetail(existing.id);
      toast("주소가 같은 기존 현장을 찾아 정보를 갱신했습니다.", "success");
    } else {
      data.createdAt = new Date().toISOString();
      const site = await FireDB.addSite(data);
      await saveSiteAttachments(site.id, site.name);
      renderSites();
      showScreen("screen-sites");
      openSiteDetail(site.id);
    }
  });

  let lastAutoBldRegAddress = "";

  async function lookupBldRegForCurrentAddress() {
    const address = $("#siteAddress").value.trim();
    const resultBox = $("#bldRegResult");
    if (!address) { toast("주소를 먼저 입력해주세요.", "error"); return; }
    const keys = BldReg.getKeys();
    if (!keys.jusoKey || !keys.dataGoKrKey) {
      resultBox.classList.remove("hidden");
      resultBox.innerHTML = `<div class="bldreg-error">건축물대장 조회를 사용하려면 '설정' 탭에서 API 키를 먼저 저장해주세요 (도로명주소 API 키, 공공데이터포털 건축물대장 인증키).</div>`;
      return;
    }
    resultBox.classList.remove("hidden");
    resultBox.innerHTML = `<div class="report-meta-row"><span class="label">상태</span><span>건축물대장 조회 중...</span></div>`;
    try {
      const { item, source, floorSummary } = await BldReg.lookup(address);
      if (!item) {
        resultBox.innerHTML = `<div class="bldreg-error">해당 주소의 건축물대장을 찾지 못했습니다. 주소를 정확히 입력했는지 확인하거나 직접 입력해주세요.</div>`;
        return;
      }
      const rawApprovalDate = item.useAprDay || "";
      // 총괄표제부는 대지 전체 집계값(연면적 등)만 갖고 동별 층수/구조는 없다 - 이 경우
      // floorSummary(대지 내 모든 동의 표제부에서 집계)로 층수는 최고~최저 범위, 구조는 중복 제거한 목록으로 채운다.
      let floorInfo = [item.grndFlrCnt ? `지상 ${item.grndFlrCnt}층` : "", item.ugrndFlrCnt ? `지하 ${item.ugrndFlrCnt}층` : ""].filter(Boolean).join(" / ");
      if (!floorInfo && floorSummary) {
        const rangeText = (min, max, label) => (min == null ? "" : min === max ? `${label} ${max}층` : `${label} ${min}~${max}층`);
        floorInfo = [rangeText(floorSummary.grndMin, floorSummary.grndMax, "지상"), rangeText(floorSummary.ugrndMin, floorSummary.ugrndMax, "지하")].filter(Boolean).join(" / ");
      }
      let structure = item.strctCdNm || "";
      if (!structure && floorSummary && floorSummary.structures.length) {
        structure = floorSummary.structures.join(", ");
      }
      const fetched = {
        buildingType: item.mainPurpsCdNm || "",
        area: item.totArea || "",
        floorInfo,
        approvalDate: /^\d{8}$/.test(rawApprovalDate) ? `${rawApprovalDate.slice(0, 4)}-${rawApprovalDate.slice(4, 6)}-${rawApprovalDate.slice(6, 8)}` : rawApprovalDate,
        structure
      };
      // 건축물대장이 실제로 값을 준 항목만 덮어쓴다 - 특정 항목을 비워서 응답하면(예: 연면적 "-")
      // 자료 불러오기로 이미 채워둔 값을 빈 값으로 지워버리지 않도록 보존한다.
      if (fetched.buildingType) $("#siteBuildingType").value = fetched.buildingType;
      if (fetched.area) $("#siteArea").value = fetched.area;
      if (fetched.floorInfo) $("#siteFloorInfo").value = fetched.floorInfo;
      if (fetched.approvalDate) $("#siteApprovalDate").value = fetched.approvalDate;
      if (fetched.structure) $("#siteStructure").value = fetched.structure;
      const registerLabel = item.regstrKindCdNm || (source === "recap" ? "총괄표제부" : "표제부");
      resultBox.innerHTML = `
        <div class="report-meta-row"><span class="label">대장구분</span><span>${escapeHtml(registerLabel)}</span></div>
        <div class="report-meta-row"><span class="label">건물명</span><span>${escapeHtml(item.bldNm || "-")}</span></div>
        <div class="report-meta-row"><span class="label">주용도</span><span>${escapeHtml(fetched.buildingType || "-")}</span></div>
        <div class="report-meta-row"><span class="label">연면적</span><span>${escapeHtml(fetched.area ? fetched.area + " ㎡" : "-")}</span></div>
        <div class="report-meta-row"><span class="label">층수</span><span>${escapeHtml(fetched.floorInfo || "-")}</span></div>
        <div class="report-meta-row"><span class="label">구조</span><span>${escapeHtml(fetched.structure || "-")}</span></div>
        <div class="report-meta-row"><span class="label">사용승인일</span><span>${escapeHtml(fetched.approvalDate || "-")}</span></div>
        <div class="hint-text">건축물대장 정보로 자동으로 채웠습니다. 내용이 다르면 직접 수정해주세요.</div>
      `;
      toast("건축물대장 정보를 자동으로 불러왔습니다.");
    } catch (err) {
      let msg = "건축물대장 조회 중 오류가 발생했습니다.";
      if (String(err.message).startsWith("juso_")) msg = "주소 검색(도로명주소 API) 조회에 실패했습니다. 주소나 API 키를 확인해주세요.";
      else if (String(err.message).startsWith("bldreg_")) msg = "건축물대장 조회(공공데이터포털)에 실패했습니다. API 키 또는 서비스 활용신청 상태를 확인해주세요.";
      else if (err.name === "TypeError") msg = "네트워크 요청이 브라우저 보안 정책(CORS)에 막혔을 수 있습니다. 정부24에서 직접 열람해주세요.";
      resultBox.innerHTML = `<div class="bldreg-error">${escapeHtml(msg)}</div><button class="btn btn-secondary bldreg-actions" id="btnOpenGov24" type="button">정부24에서 건축물대장 열람 열기</button>`;
      $("#btnOpenGov24").addEventListener("click", () => window.open("https://www.gov.kr/mw/AA020InfoCappView.do?HighCtgCD=A01015&CappBizCD=13100000015", "_blank"));
    }
  }

  // 관할소방서 칸은 이제 직접 입력하지 않고(readonly) 주소만으로 항상 자동 표시한다 - 이행완료보고서 생성 시
  // 쓰이는 값(site.fireStation)과 완전히 같은 guessFireStation() 결과이므로 보고서 쪽 로직은 그대로 유지된다.
  function autoSuggestFireStation(address) {
    $("#siteFireStation").value = guessFireStation(address) || "";
  }

  $("#siteAddress").addEventListener("input", () => {
    autoSuggestFireStation($("#siteAddress").value.trim());
  });

  $("#btnLookupBldReg").addEventListener("click", () => {
    lastAutoBldRegAddress = $("#siteAddress").value.trim();
    lookupBldRegForCurrentAddress();
    autoSuggestFireStation(lastAutoBldRegAddress);
  });

  $("#siteAddress").addEventListener("blur", () => {
    const address = $("#siteAddress").value.trim();
    if (address && address !== lastAutoBldRegAddress) {
      lastAutoBldRegAddress = address;
      lookupBldRegForCurrentAddress();
    }
    autoSuggestFireStation(address);
  });

  async function openSiteDetail(id) {
    currentSiteId = id;
    const site = await FireDB.getSite(id);
    if (!site) { renderSites(); showScreen("screen-sites"); return; }
    $("#siteDetailInfo").innerHTML = `
      <h2 class="site-form-title-row"><span>${escapeHtml(site.name)}</span>${inspectionScheduleBadgeHtml(site)}</h2>
      <div class="report-meta-row"><span class="label">주소</span><span>${escapeHtml(site.address || "-")}</span></div>
      <div class="report-meta-row"><span class="label">관할소방서</span><span>${escapeHtml(site.fireStation || "-")}</span></div>
      <div class="report-meta-row"><span class="label">관할119안전센터</span><span>${escapeHtml(site.station119 || "-")}</span></div>
      <div class="report-meta-row"><span class="label">담당자</span><span>${escapeHtml(site.contactName || "-")}</span></div>
      <div class="report-meta-row"><span class="label">연락처</span><span>${escapeHtml(site.contactPhone ? formatPhone(site.contactPhone) : "-")}</span></div>
      <div class="report-meta-row"><span class="label">건물 용도</span><span>${escapeHtml(site.buildingType || "-")}</span></div>
      <div class="report-meta-row"><span class="label">연면적</span><span>${escapeHtml(site.area ? site.area + " ㎡" : "-")}</span></div>
      ${site.floorInfo ? `<div class="report-meta-row"><span class="label">층수</span><span>${escapeHtml(site.floorInfo)}</span></div>` : ""}
      ${site.structure ? `<div class="report-meta-row"><span class="label">구조</span><span>${escapeHtml(site.structure)}</span></div>` : ""}
      ${site.approvalDate ? `<div class="report-meta-row"><span class="label">사용승인일</span><span>${escapeHtml(site.approvalDate)}</span></div>` : ""}
      ${site.fireManagerName ? `<div class="report-meta-row"><span class="label">소방안전관리자</span><span>${escapeHtml(site.fireManagerName)}${site.fireManagerPhone ? " · " + escapeHtml(formatPhone(site.fireManagerPhone)) : ""}</span></div>` : ""}
      ${site.fireManagerAppointDate ? `<div class="report-meta-row"><span class="label">선임일자</span><span>${escapeHtml(site.fireManagerAppointDate)}</span></div>` : ""}
      ${site.fireManagerEduDate ? `<div class="report-meta-row"><span class="label">교육일자</span><span>${escapeHtml(site.fireManagerEduDate)}</span></div>` : ""}
      ${site.engineerName ? `<div class="report-meta-row"><span class="label">담당기사</span><span>${escapeHtml(site.engineerName)}${site.engineerPhone ? " · " + escapeHtml(formatPhone(site.engineerPhone)) : ""}</span></div>` : ""}
      ${site.receiverLocation ? `<div class="report-meta-row"><span class="label">수신기 위치</span><span>${escapeHtml(site.receiverLocation)}</span></div>` : ""}
      ${site.receiverAccess ? `<div class="report-meta-row"><span class="label">수신기 접근방법</span><span>${escapeHtml(site.receiverAccess)}</span></div>` : ""}
      ${site.pumpRoomLocation ? `<div class="report-meta-row"><span class="label">펌프실 위치</span><span>${escapeHtml(site.pumpRoomLocation)}</span></div>` : ""}
      ${site.pumpRoomAccess ? `<div class="report-meta-row"><span class="label">펌프실 접근방법</span><span>${escapeHtml(site.pumpRoomAccess)}</span></div>` : ""}
      ${site.equipmentMemo ? `<div class="report-meta-row"><span class="label">메모</span><span>${escapeHtml(site.equipmentMemo)}</span></div>` : ""}
      ${site.notes ? `<div class="report-meta-row"><span class="label">비고</span><span>${escapeHtml(site.notes)}</span></div>` : ""}
    `;
    const history = site.changeHistory || [];
    $("#siteChangeHistorySection").classList.toggle("hidden", history.length === 0 || !isChangeHistoryVisible());
    $("#siteChangeHistoryList").innerHTML = history.slice().reverse().map((h) => `
      <div class="change-history-entry">
        <div class="change-history-date">${escapeHtml((h.date || "").slice(0, 10))}</div>
        <div class="change-history-summary">${h.changes.map((c) => `${escapeHtml(c.label)}: ${escapeHtml(c.oldValue || "(없음)")} → ${escapeHtml(c.newValue)}`).join(", ")}</div>
      </div>
    `).join("");

    const inspections = await FireDB.getInspectionsBySite(id);
    inspections.sort((a, b) => (b.scheduledDate || "").localeCompare(a.scheduledDate || ""));
    const listEl = $("#siteInspectionsList");
    if (inspections.length === 0) {
      listEl.innerHTML = `<div class="empty-state">점검 이력이 없습니다.</div>`;
    } else {
      listEl.innerHTML = inspections.map((i) => inspectionCardHtml(i, site)).join("");
    }
    showScreen("screen-site-detail");
  }

  $("#btnBackToSites").addEventListener("click", () => { renderSites(); showScreen("screen-sites"); });

  $("#btnEditSite").addEventListener("click", async () => {
    const site = await FireDB.getSite(currentSiteId);
    editingSiteId = currentSiteId;
    $("#siteFormTitle").textContent = "현장 정보 수정";
    $("#siteName").value = site.name || "";
    $("#siteAddress").value = site.address || "";
    $("#siteContactName").value = site.contactName || "";
    $("#siteContactPhone").value = site.contactPhone || "";
    autoSuggestFireStation(site.address || "");
    $("#siteStation119").value = site.station119 || "";
    $("#siteBuildingType").value = site.buildingType || "";
    $("#siteArea").value = site.area || "";
    $("#siteFloorInfo").value = site.floorInfo || "";
    $("#siteApprovalDate").value = site.approvalDate || "";
    $("#siteStructure").value = site.structure || "";
    // renderComprehensiveToggle이 renderMonthPickerButtons도 함께 호출하므로, 그 안에서 읽는
    // siteApprovalDate 값이 이미 채워진 뒤(위 줄들 이후)에 불러야 한다.
    comprehensiveMonthValue = typeof site.comprehensiveMonthOverride === "number" ? site.comprehensiveMonthOverride : null;
    operationalMonthValue = typeof site.operationalMonthOverride === "number" ? site.operationalMonthOverride : null;
    renderComprehensiveToggle(typeof site.comprehensiveTarget === "boolean" ? site.comprehensiveTarget : null);
    $("#siteFireManagerName").value = site.fireManagerName || "";
    $("#siteFireManagerPhone").value = site.fireManagerPhone || "";
    $("#siteFireManagerAppointDate").value = site.fireManagerAppointDate || "";
    $("#siteFireManagerEduDate").value = site.fireManagerEduDate || "";
    $("#siteEngineerName").value = site.engineerName || "";
    $("#siteEngineerPhone").value = site.engineerPhone || "";
    $("#siteReceiverLocation").value = site.receiverLocation || "";
    $("#siteReceiverAccess").value = site.receiverAccess || "";
    $("#sitePumpRoomLocation").value = site.pumpRoomLocation || "";
    $("#sitePumpRoomAccess").value = site.pumpRoomAccess || "";
    $("#siteEquipmentMemo").value = site.equipmentMemo || "";
    $("#siteNotes").value = site.notes || "";
    $("#bldRegResult").classList.add("hidden");
    $("#importSummary").classList.add("hidden");
    lastAutoBldRegAddress = site.address || "";
    renderSiteAttachments();
    showScreen("screen-site-form");
  });

  $("#btnDeleteSite").addEventListener("click", async () => {
    const ok = await confirmDialog("이 현장과 관련 점검 기록을 모두 삭제할까요?");
    if (!ok) return;
    await FireDB.deleteSite(currentSiteId);
    renderSites();
    showScreen("screen-sites");
  });

  $("#btnOpenSiteGallery").addEventListener("click", () => openPhotoGallery(currentSiteId, "site"));
  $("#btnOpenDeficiencyGallery").addEventListener("click", () => openPhotoGallery(currentSiteId, "deficiency"));

  // ================= 점검 목록 (일정관리 표시용 방문 이력 - 조회 전용) =================
  function computeStatus(insp) {
    if (insp.status === "completed") return "completed";
    if (insp.scheduledDate && insp.scheduledDate < todayISO()) return "overdue";
    return "scheduled";
  }

  const STATUS_LABEL = { scheduled: "예정", overdue: "기한초과", completed: "완료" };

  function inspectionCardHtml(insp, site) {
    const st = computeStatus(insp);
    return `
      <div class="list-card list-card-static">
        <div class="list-card-title">
          <span>${escapeHtml(site ? site.name : "")}</span>
          <span class="badge badge-${st}">${STATUS_LABEL[st]}</span>
        </div>
        <div class="list-card-sub">${escapeHtml(insp.type)} · ${escapeHtml(insp.scheduledDate || "")}</div>
        <div class="list-card-sub">${escapeHtml(insp.inspector ? "점검자: " + insp.inspector : "")}</div>
      </div>
    `;
  }

  // ================= 사진 갤러리 (현장점검 사진 / 지적사항 사진 공용) =================
  // 현장점검 사진: siteId로만 귀속되는 photos 레코드(itemId를 이 상수로 표시) - 지적사항과 마찬가지로 점검 기록과 무관.
  // 지적사항 사진: 기존 지적사항 이행전/이행후 개별 업로드(itemId=지적사항 id)를 한곳에 모아 보여주기만 하는 조회 전용 화면.
  const SITE_GALLERY_ITEM_ID = "site-gallery";
  let galleryMode = null;              // "site" | "deficiency"
  let galleryActiveInspectionId = null; // "site" 모드에서 방문 완료 처리 대상 점검 id
  let galleryPhotos = [];              // [{id, blob, createdAt, ...}]
  let gallerySelected = new Set();
  let galleryViewerIndex = -1;

  async function openPhotoGallery(siteId, mode) {
    currentSiteId = siteId;
    galleryMode = mode;
    galleryActiveInspectionId = null;
    gallerySelected = new Set();
    if (mode === "site") {
      const insp = await getOrCreateActiveInspection(siteId);
      galleryActiveInspectionId = insp.id;
    }
    const site = await FireDB.getSite(siteId);
    $("#galleryTitle").textContent = `${site ? site.name : ""} · ${mode === "site" ? "현장점검 사진" : "지적사항 사진"}`;
    $("#galleryHint").textContent = mode === "site"
      ? "현장 사진을 여러 장 올릴 수 있습니다. 사진을 누르면 원본이 크게 보이고, 선택해서 외부로 공유할 수 있습니다."
      : "지적사항에 등록된 이행전/이행후 사진을 한곳에 모아 봅니다. 선택해서 외부로 공유할 수 있습니다.";
    $("#btnGalleryUpload").classList.toggle("hidden", mode !== "site");
    $("#btnCompleteSiteVisit").classList.toggle("hidden", mode !== "site");
    await loadGalleryPhotos();
    showScreen("screen-photo-gallery");
  }

  async function loadGalleryPhotos() {
    const all = await FireDB.getPhotosBySite(currentSiteId);
    galleryPhotos = all
      .filter((p) => (galleryMode === "site") === (p.itemId === SITE_GALLERY_ITEM_ID))
      .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
    gallerySelected = new Set(Array.from(gallerySelected).filter((id) => galleryPhotos.some((p) => p.id === id)));
    renderGalleryGrid();
  }

  function renderGalleryGrid() {
    revokeObjectUrls();
    const grid = $("#galleryGrid");
    if (galleryPhotos.length === 0) {
      grid.innerHTML = `<div class="empty-state">등록된 사진이 없습니다.</div>`;
    } else {
      grid.innerHTML = galleryPhotos.map((p) => {
        const url = URL.createObjectURL(p.blob);
        activeObjectUrls.push(url);
        const selected = gallerySelected.has(p.id);
        return `
          <div class="gallery-thumb-wrap ${selected ? "selected" : ""}" data-id="${p.id}">
            <img class="gallery-thumb" src="${url}">
            <span class="gallery-thumb-check" data-id="${p.id}">${selected ? "✓" : ""}</span>
          </div>
        `;
      }).join("");
    }
    $$("#galleryGrid .gallery-thumb").forEach((img) => {
      img.addEventListener("click", () => openPhotoViewer(img.closest(".gallery-thumb-wrap").dataset.id));
    });
    $$("#galleryGrid .gallery-thumb-check").forEach((chk) => {
      chk.addEventListener("click", (e) => { e.stopPropagation(); toggleGallerySelect(chk.dataset.id); });
    });
    updateGalleryToolbar();
  }

  function toggleGallerySelect(id) {
    if (gallerySelected.has(id)) gallerySelected.delete(id); else gallerySelected.add(id);
    renderGalleryGrid();
  }

  function updateGalleryToolbar() {
    const allSelected = galleryPhotos.length > 0 && gallerySelected.size === galleryPhotos.length;
    $("#btnGallerySelectAll").textContent = allSelected ? "선택 해제" : "전체 선택";
    $("#btnGallerySelectAll").disabled = galleryPhotos.length === 0;
    $("#btnGalleryShare").disabled = gallerySelected.size === 0;
    $("#btnGalleryShare").textContent = gallerySelected.size > 0 ? `선택한 사진 공유 (${gallerySelected.size})` : "선택한 사진 공유";
  }

  $("#btnGallerySelectAll").addEventListener("click", () => {
    gallerySelected = gallerySelected.size === galleryPhotos.length ? new Set() : new Set(galleryPhotos.map((p) => p.id));
    renderGalleryGrid();
  });

  $("#btnGalleryUpload").addEventListener("click", () => $("#galleryUploadInput").click());

  $("#galleryUploadInput").addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (files.length === 0) return;
    for (const file of files) {
      const photo = await FireDB.addPhoto({
        siteId: currentSiteId,
        itemId: SITE_GALLERY_ITEM_ID,
        blob: file,
        createdAt: new Date().toISOString()
      });
      backupToDrive(currentSiteId, "현장점검_사진", `${photo.id}.jpg`, file);
    }
    await loadGalleryPhotos();
    toast(`${files.length}장의 사진을 추가했습니다.`, "success");
  });

  function galleryPhotoFilename(p, idx) {
    const ext = p.blob.type && p.blob.type.includes("png") ? "png" : "jpg";
    return `사진${idx + 1}_${(p.createdAt || "").slice(0, 10)}.${ext}`;
  }

  async function shareOrDownloadFiles(files, title) {
    if (isNativeApp()) {
      try {
        await nativeShareFiles(files.map((f) => ({ blob: f, name: f.name })), title);
        return;
      } catch (e) {
        if (e && e.message && /cancel/i.test(e.message)) return; // 사용자가 공유 화면에서 취소함
        toast("공유 화면을 여는 데 실패했습니다: " + (e && e.message ? e.message : "알 수 없는 오류"), "error");
        return;
      }
    }
    if (navigator.canShare && navigator.canShare({ files })) {
      try {
        await navigator.share({ files, title });
        return;
      } catch (e) {
        if (e.name === "AbortError") return;
      }
    }
    for (const file of files) {
      const url = URL.createObjectURL(file);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
    toast(`${files.length}장의 사진이 다운로드되었습니다. 원하는 방법으로 공유해주세요.`, "success");
  }

  $("#btnGalleryShare").addEventListener("click", async () => {
    const selectedPhotos = galleryPhotos.filter((p) => gallerySelected.has(p.id));
    if (selectedPhotos.length === 0) return;
    const files = selectedPhotos.map((p, i) => new File([p.blob], galleryPhotoFilename(p, i), { type: p.blob.type || "image/jpeg" }));
    await shareOrDownloadFiles(files, galleryMode === "site" ? "현장점검 사진" : "지적사항 사진");
  });

  function openPhotoViewer(photoId) {
    galleryViewerIndex = galleryPhotos.findIndex((p) => p.id === photoId);
    if (galleryViewerIndex === -1) return;
    renderPhotoViewer();
    $("#photoViewerModal").classList.remove("hidden");
  }

  function renderPhotoViewer() {
    const p = galleryPhotos[galleryViewerIndex];
    if (!p) { closePhotoViewer(); return; }
    const url = URL.createObjectURL(p.blob);
    activeObjectUrls.push(url);
    $("#photoViewerImg").src = url;
    $("#btnPhotoViewerPrev").disabled = galleryViewerIndex <= 0;
    $("#btnPhotoViewerNext").disabled = galleryViewerIndex >= galleryPhotos.length - 1;
    $("#btnDeleteViewerPhoto").classList.toggle("hidden", galleryMode !== "site");
  }

  function closePhotoViewer() {
    $("#photoViewerModal").classList.add("hidden");
    galleryViewerIndex = -1;
  }

  $("#btnClosePhotoViewer").addEventListener("click", closePhotoViewer);
  $("#photoViewerModal").addEventListener("click", (e) => {
    if (e.target.id === "photoViewerModal") closePhotoViewer();
  });
  $("#btnPhotoViewerPrev").addEventListener("click", () => {
    if (galleryViewerIndex > 0) { galleryViewerIndex--; renderPhotoViewer(); }
  });
  $("#btnPhotoViewerNext").addEventListener("click", () => {
    if (galleryViewerIndex < galleryPhotos.length - 1) { galleryViewerIndex++; renderPhotoViewer(); }
  });
  $("#btnDeleteViewerPhoto").addEventListener("click", async () => {
    const p = galleryPhotos[galleryViewerIndex];
    if (!p) return;
    const ok = await confirmDialog("이 사진을 삭제할까요?");
    if (!ok) return;
    await FireDB.deletePhoto(p.id);
    gallerySelected.delete(p.id);
    closePhotoViewer();
    await loadGalleryPhotos();
  });

  $("#btnCompleteSiteVisit").addEventListener("click", async () => {
    const ok = await confirmDialog("오늘 방문을 완료 처리할까요? (마지막 점검일이 갱신됩니다)");
    if (!ok || !galleryActiveInspectionId) return;
    await FireDB.updateInspection(galleryActiveInspectionId, { status: "completed", completedDate: todayISO() });
    toast("방문이 완료 처리되었습니다.", "success");
  });

  $("#btnBackFromGallery").addEventListener("click", () => {
    closePhotoViewer();
    if (currentSiteId) openSiteDetail(currentSiteId);
    else { renderSites(); showScreen("screen-sites"); }
  });

  // ================= 지적사항 / 이행완료 (점검 기록과 완전히 분리, 현장에만 귀속) =================
  let currentDeficiencySiteId = null;
  let currentDeficiencies = [];

  function findDeficiency(defId) {
    return currentDeficiencies.find((d) => d.id === defId);
  }

  function newDeficiency(fields) {
    return {
      id: FireDB.genId(),
      siteId: fields.siteId || currentDeficiencySiteId,
      category: fields.category || "",
      floor: fields.floor || "",
      location: fields.location || "",
      code: fields.code || "",
      description: fields.description || "",
      beforePhotoIds: [],
      afterPhotoIds: [],
      resolved: false,
      createdAt: new Date().toISOString()
    };
  }

  // ---------- 지적사항 허브 (현장별) ----------
  // ================= 보고서 모아보기 =================
  // 이행완료보고서는 로컬에 따로 저장되지 않고 생성될 때마다 구글 드라이브(현장별 "이행완료보고서"
  // 폴더)로 백업되므로, 그 드라이브가 그대로 "지금까지 만든 보고서" 목록의 원본이다 - 프록시의
  // list-reports가 모든 현장 폴더를 돌며 모아준다.
  async function renderReportsHub() {
    const list = $("#reportsHubList");
    list.innerHTML = `<div class="empty-state">불러오는 중...</div>`;
    let files;
    try {
      files = await DriveBackup.listReports();
    } catch (err) {
      list.innerHTML = `<div class="empty-state">보고서 목록을 불러오지 못했습니다.<br>네트워크를 확인해주세요.</div>`;
      return;
    }
    if (files.length === 0) {
      list.innerHTML = `<div class="empty-state">아직 생성된 이행완료보고서가 없습니다.</div>`;
      return;
    }
    list.innerHTML = files.map((f) => `
      <div class="report-row" data-id="${f.id}" data-name="${escapeHtml(f.name)}">
        <span class="report-row-site">${escapeHtml(f.siteName)}</span>
        <span class="report-row-file">${escapeHtml(f.name)}</span>
      </div>
    `).join("");
    $$("#reportsHubList .report-row").forEach((el) => {
      el.addEventListener("click", async () => {
        if (el.classList.contains("report-row-loading")) return;
        el.classList.add("report-row-loading");
        try {
          const blob = await DriveBackup.downloadFile(el.dataset.id);
          const name = el.dataset.name;
          const mimeType = name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "application/hwp+zip";
          await shareOrDownloadFile(blob, name, mimeType);
        } catch (err) {
          toast("파일을 여는 데 실패했습니다: " + (err && err.message ? err.message : "알 수 없는 오류"), "error");
        } finally {
          el.classList.remove("report-row-loading");
        }
      });
    });
  }

  async function renderDeficiencyHub() {
    const [sites, defs] = await Promise.all([FireDB.getAllSites(), FireDB.getAllDeficiencies()]);
    sites.sort((a, b) => a.name.localeCompare(b.name, "ko"));
    const countsBySite = new Map();
    defs.forEach((d) => {
      const c = countsBySite.get(d.siteId) || { open: 0, resolved: 0 };
      d.resolved ? c.resolved++ : c.open++;
      countsBySite.set(d.siteId, c);
    });
    const list = $("#deficiencyHubList");
    if (sites.length === 0) {
      list.innerHTML = `<div class="empty-state">등록된 현장이 없습니다.</div>`;
      return;
    }
    list.innerHTML = sites.map((s) => {
      const c = countsBySite.get(s.id) || { open: 0, resolved: 0 };
      const badges = [
        c.open > 0 ? `<span class="badge badge-open">미해결 ${c.open}</span>` : "",
        c.resolved > 0 ? `<span class="badge badge-resolved">해결 ${c.resolved}</span>` : "",
        (c.open === 0 && c.resolved === 0) ? `<span class="badge badge-scheduled">지적사항 없음</span>` : ""
      ].join(" ");
      return `
        <div class="list-card" data-site="${s.id}">
          <div class="list-card-title"><span>${escapeHtml(s.name)}</span><span>${badges}</span></div>
          <div class="list-card-sub">${escapeHtml(s.address || "")}</div>
        </div>
      `;
    }).join("");
    $$("#deficiencyHubList .list-card").forEach((el) => {
      el.addEventListener("click", () => openSiteDeficiencies(el.dataset.site));
    });
  }

  async function openSiteDeficiencies(siteId) {
    currentDeficiencySiteId = siteId;
    currentDeficiencies = await FireDB.getDeficienciesBySite(siteId);
    currentDeficiencies.sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
    await renderDeficiencies();
    showScreen("screen-deficiencies");
  }

  // ---------- 지적사항 목록/편집 (현장 단위) ----------
  async function renderDeficiencies() {
    revokeObjectUrls();
    const site = await FireDB.getSite(currentDeficiencySiteId);
    const open = currentDeficiencies.filter((d) => !d.resolved).length;
    const resolved = currentDeficiencies.filter((d) => d.resolved).length;
    $("#deficiencyHeader").innerHTML = `
      <h2>${escapeHtml(site ? site.name : "")} · 지적사항 관리</h2>
      <div class="report-meta-row"><span class="label">주소</span><span>${escapeHtml(site && site.address ? site.address : "-")}</span></div>
      <div class="report-meta-row"><span class="label">미해결 / 해결</span><span>${open}건 / ${resolved}건</span></div>
    `;

    const photos = await FireDB.getPhotosBySite(currentDeficiencySiteId);
    const photoMap = new Map(photos.map((p) => [p.id, p]));

    const list = $("#deficienciesList");
    if (currentDeficiencies.length === 0) {
      list.innerHTML = `<div class="empty-state">등록된 지적사항이 없습니다.<br>직접 추가하거나 자료를 올려보세요.</div>`;
      return;
    }

    function photoColHtml(def, role) {
      const ids = role === "before" ? def.beforePhotoIds : def.afterPhotoIds;
      const thumbs = ids.map((pid) => {
        const p = photoMap.get(pid);
        if (!p) return "";
        const url = URL.createObjectURL(p.blob);
        activeObjectUrls.push(url);
        return `<div class="photo-thumb-wrap">
          <img class="photo-thumb" src="${url}">
          <button class="photo-thumb-remove" data-def="${def.id}" data-role="${role}" data-photo="${pid}">×</button>
        </div>`;
      }).join("");
      return `
        <div class="deficiency-photo-col">
          <span class="col-label">${role === "before" ? "이행 전" : "이행 후"}</span>
          <div class="photo-thumbs">
            ${thumbs}
            <label class="btn-add-photo-label">＋
              <input type="file" accept="image/*" multiple class="deficiency-photo-input" data-def="${def.id}" data-role="${role}">
            </label>
          </div>
        </div>
      `;
    }

    list.innerHTML = currentDeficiencies.map((def, idx) => `
      <div class="deficiency-card" data-def="${def.id}">
        <div class="deficiency-card-number">${idx + 1}번 지적항목</div>
        <div class="field-row">
          <div class="field"><span>설비</span><input type="text" class="def-field" data-def="${def.id}" data-field="category" list="categoryList" value="${escapeHtml(def.category)}"></div>
          <div class="field"><span>층</span><input type="text" class="def-field" data-def="${def.id}" data-field="floor" value="${escapeHtml(def.floor)}"></div>
        </div>
        <div class="field-row">
          <div class="field"><span>설치장소</span><input type="text" class="def-field" data-def="${def.id}" data-field="location" value="${escapeHtml(def.location)}"></div>
          <div class="field"><span>점검번호</span><input type="text" class="def-field" data-def="${def.id}" data-field="code" value="${escapeHtml(def.code)}"></div>
        </div>
        <div class="field"><span>${idx + 1}번 지적항목 내용</span><textarea class="def-field" data-def="${def.id}" data-field="description" rows="2">${escapeHtml(def.description)}</textarea></div>
        <div class="deficiency-photo-cols">
          ${photoColHtml(def, "before")}
          ${photoColHtml(def, "after")}
        </div>
        <div class="deficiency-resolved-row">
          <input type="checkbox" class="def-resolved" data-def="${def.id}" ${def.resolved ? "checked" : ""}>
          <span>이행완료</span>
        </div>
        <div class="deficiency-card-actions">
          <button class="btn btn-danger btn-delete-def" data-def="${def.id}">삭제</button>
        </div>
      </div>
    `).join("");

    $$("#deficienciesList .def-field").forEach((el) => {
      el.addEventListener("change", () => setDeficiencyField(el.dataset.def, el.dataset.field, el.value));
    });
    $$("#deficienciesList .def-resolved").forEach((el) => {
      el.addEventListener("change", () => setDeficiencyResolved(el.dataset.def, el.checked));
    });
    $$("#deficienciesList .deficiency-photo-input").forEach((input) => {
      input.addEventListener("change", (e) => onDeficiencyPhotoSelected(input.dataset.def, input.dataset.role, e.target.files));
    });
    $$("#deficienciesList .photo-thumb-remove").forEach((btn) => {
      btn.addEventListener("click", () => removeDeficiencyPhoto(btn.dataset.def, btn.dataset.role, btn.dataset.photo));
    });
    $$("#deficienciesList .btn-delete-def").forEach((btn) => {
      btn.addEventListener("click", () => deleteDeficiency(btn.dataset.def));
    });
  }

  async function setDeficiencyField(defId, field, value) {
    const def = findDeficiency(defId);
    def[field] = value;
    await FireDB.updateDeficiency(def.id, { [field]: value });
  }

  async function setDeficiencyResolved(defId, checked) {
    const def = findDeficiency(defId);
    def.resolved = checked;
    await FireDB.updateDeficiency(def.id, { resolved: def.resolved });
    await renderDeficiencies();
  }

  async function onDeficiencyPhotoSelected(defId, role, files) {
    if (!files || files.length === 0) return;
    const def = findDeficiency(defId);
    const targetArr = role === "before" ? def.beforePhotoIds : def.afterPhotoIds;
    for (const file of files) {
      // 파일 선택창의 accept="image/*"는 SVG(아이콘/그림 파일)도 걸러내지 못한다 - 벡터 이미지는
      // 절대 실제 현장 사진이 아니므로, 여기서 거르지 않으면 보고서에 그대로(비정상적으로 확대되어)
      // 들어가버린다(실제 사용자가 겪은 문제).
      if (file.type === "image/svg+xml") {
        toast("아이콘/그림 파일(SVG)은 사진으로 등록할 수 없습니다. 실제 사진 파일을 선택해주세요.", "error");
        continue;
      }
      const photo = await FireDB.addPhoto({
        siteId: currentDeficiencySiteId,
        itemId: def.id,
        role,
        blob: file,
        createdAt: new Date().toISOString()
      });
      targetArr.push(photo.id);
      backupToDrive(currentDeficiencySiteId, "지적사항_사진", `${role === "before" ? "이행전" : "이행후"}_${photo.id}.jpg`, file);
    }
    const changes = { beforePhotoIds: def.beforePhotoIds, afterPhotoIds: def.afterPhotoIds };
    // 이행후 사진이 곧 수리 완료의 증거이므로, 한 장이라도 올라오면 이행완료를 자동으로 체크해준다.
    if (role === "after" && !def.resolved) {
      def.resolved = true;
      changes.resolved = true;
    }
    await FireDB.updateDeficiency(def.id, changes);
    await renderDeficiencies();
  }

  async function removeDeficiencyPhoto(defId, role, photoId) {
    const def = findDeficiency(defId);
    const key = role === "before" ? "beforePhotoIds" : "afterPhotoIds";
    def[key] = def[key].filter((id) => id !== photoId);
    await FireDB.deletePhoto(photoId);
    await FireDB.updateDeficiency(def.id, { [key]: def[key] });
    await renderDeficiencies();
  }

  async function deleteDeficiency(defId) {
    const ok = await confirmDialog("이 지적사항을 삭제할까요?");
    if (!ok) return;
    await FireDB.deleteDeficiency(defId);
    currentDeficiencies = currentDeficiencies.filter((d) => d.id !== defId);
    await renderDeficiencies();
  }

  $("#btnBackFromDeficiencies").addEventListener("click", async () => {
    await renderDeficiencyHub();
    showScreen("screen-deficiency-hub");
  });

  $("#btnAddDeficiency").addEventListener("click", async () => {
    const newDef = newDeficiency({});
    await FireDB.addDeficiency(newDef);
    currentDeficiencies.push(newDef);
    await renderDeficiencies();
    const card = document.querySelector(`.deficiency-card[data-def="${newDef.id}"]`);
    if (card) {
      card.scrollIntoView({ behavior: "smooth", block: "start" });
      const firstField = card.querySelector(".def-field");
      if (firstField) firstField.focus();
    }
  });

  $("#btnImportData").addEventListener("click", () => $("#dataImportInput").click());

  $("#dataImportInput").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    backupToDrive(currentDeficiencySiteId, "지적사항_자료", file.name, file);
    const ext = file.name.split(".").pop().toLowerCase();
    ImportLoading.show(AiFill.isEnabled() ? "AI가 자료를 분석하고 있습니다." : "자료를 분석하고 있습니다.");
    ImportLoading.startSimulated();
    try {
      let rows = null;
      let lowConfidence = false;
      let typeLabel = "";
      if (AiFill.isEnabled() && AiFill.isSupportedExt(ext)) {
        try {
          const aiResult = await AiFill.analyzeDeficiencyFile(file);
          rows = aiResult.rows;
          typeLabel = aiResult.typeLabel;
        } catch (aiErr) {
          rows = null; // AI 분석 실패 시 기존 방식으로 폴백
        }
      }
      if (!rows) {
        if (ext === "xlsx" || ext === "xls") {
          rows = await FireImport.parseExcelFile(file);
          typeLabel = "엑셀";
        } else if (ext === "docx") {
          rows = await FireImport.parseWordFile(file);
          typeLabel = "워드 문서";
        } else if (ext === "pdf") {
          const result = await FireImport.parsePdfFile(file);
          rows = result.rows;
          lowConfidence = result.lowConfidence;
          typeLabel = "PDF";
        } else {
          toast(`지원하지 않는 파일 형식입니다 (.xlsx, .docx, .pdf${AiFill.isEnabled() ? ", .hwpx, 사진" : ""}만 가능).`, "error");
          return;
        }
      }
      if (!rows || rows.length === 0) {
        toast(`${typeLabel || "파일"}에서 지적사항 표를 인식하지 못했습니다. 다른 파일을 이용하거나 직접 입력해주세요.`, "error");
        return;
      }
      for (const r of rows) {
        const def = newDeficiency(r);
        await FireDB.addDeficiency(def);
        currentDeficiencies.push(def);
      }
      await renderDeficiencies();
      toast(`${typeLabel}에서 ${rows.length}개 지적사항을 가져왔습니다.${lowConfidence ? " (인식 품질이 낮을 수 있어 내용을 확인해주세요.)" : ""}`);
    } catch (err) {
      toast("파일을 읽는 중 오류가 발생했습니다.", "error");
    } finally {
      ImportLoading.hide();
    }
  });

  // ---------- 이행완료 보고서 ----------
  $("#btnGenerateCompletionReport").addEventListener("click", async () => {
    const resolved = currentDeficiencies.filter((d) => d.resolved);
    if (resolved.length === 0) {
      toast("이행완료로 표시된 지적사항이 없습니다. 목록에서 이행완료 여부를 먼저 체크해주세요.", "error");
      return;
    }
    await openCompletionReport();
  });

  let lastCompletionReportData = null;

  async function openCompletionReport() {
    revokeObjectUrls();
    const site = await FireDB.getSite(currentDeficiencySiteId);
    const company = getCompanyProfile();
    const resolved = currentDeficiencies.filter((d) => d.resolved);
    // 이행조치 일자는 더 이상 자동 기록하지 않고, 실제 제출 시점에 손으로 적도록 항상 공란으로 둔다.
    const dateRange = ". . . ~ . . .";

    const photos = await FireDB.getPhotosBySite(currentDeficiencySiteId);
    const photoMap = new Map(photos.map((p) => [p.id, p]));

    // 사진은 기기별 IndexedDB에만 저장된다 - 휴대폰으로 찍어 올린 사진은 PC 등 다른 기기의
    // 로컬 저장소엔 원본이 없어 여기서 빠질 수 있다(실제 사용자가 겪은 문제: "PC에서 이행완료보고서
    // 만들면 텍스트는 나오는데 사진은 안 나옴"). 이미 구글 드라이브에 자동 백업된 사본이 있으면
    // 그걸로 채운다 - 파일명 규칙은 backupToDrive가 지적사항 사진을 올릴 때 쓰는 것과 동일
    // (이행전_<id>.jpg / 이행후_<id>.jpg). 둘 다에 없으면 기존과 동일하게 "사진 없음"으로 표시된다.
    if (site && site.name) {
      const missing = [];
      resolved.forEach((def) => {
        (def.beforePhotoIds || []).forEach((id) => { if (!photoMap.has(id)) missing.push({ id, prefix: "이행전" }); });
        (def.afterPhotoIds || []).forEach((id) => { if (!photoMap.has(id)) missing.push({ id, prefix: "이행후" }); });
      });
      await Promise.all(missing.map(async ({ id, prefix }) => {
        const blob = await DriveBackup.fetchFile(site.name, "지적사항_사진", `${prefix}_${id}.jpg`);
        if (blob) photoMap.set(id, { id, blob });
      }));
    }

    function photoCellHtml(def, role) {
      const ids = role === "before" ? def.beforePhotoIds : def.afterPhotoIds;
      if (ids.length === 0) return `<div class="no-photo">사진 없음</div>`;
      return ids.map((pid) => {
        const p = photoMap.get(pid);
        if (!p) return "";
        const url = URL.createObjectURL(p.blob);
        activeObjectUrls.push(url);
        return `<img src="${url}">`;
      }).join("");
    }

    const siteName = site ? site.name || "-" : "-";
    const siteType = site ? site.buildingType || "-" : "-";
    const siteAddr = site ? site.address || "-" : "-";
    const contactName = site ? site.contactName || "" : "";
    const contactPhone = site ? site.contactPhone || "" : "";
    const managerName = site ? site.fireManagerName || "" : "";
    const managerPhone = site ? site.fireManagerPhone || "" : "";
    const fireStation = site ? (site.fireStation || guessFireStation(site.address)) : "";
    const fireStationLine = fireStation ? `${escapeHtml(fireStation)}장 귀하` : "○○ 소방본부장ㆍ소방서장 귀하";

    // 지적내역서는 사진 있는 항목이 페이지를 길게 늘어뜨리므로, 한 페이지에 4건씩만 담고
    // 나머지는 다음 페이지로 넘긴다 (화면 네비게이션과 인쇄/PDF 양쪽 다 이 단위로 쪽이 나뉜다).
    const DETAIL_ITEMS_PER_PAGE = 4;
    const detailChunks = [];
    for (let i = 0; i < resolved.length; i += DETAIL_ITEMS_PER_PAGE) {
      detailChunks.push(resolved.slice(i, i + DETAIL_ITEMS_PER_PAGE));
    }
    if (detailChunks.length === 0) detailChunks.push([]);

    const detailPagesHtml = detailChunks.map((items, idx) => {
      const rowsHtml = items.map((def) => `
        <tr>
          <td class="did-content">
            <strong>${escapeHtml([def.floor, def.location].filter(Boolean).join(" "))}</strong>
            <div class="report-item-note">${escapeHtml(def.description)}</div>
          </td>
          <td class="did-photo completion-photo-cell" data-photo-label="이행 전">${photoCellHtml(def, "before")}</td>
          <td class="did-photo completion-photo-cell" data-photo-label="이행 후">${photoCellHtml(def, "after")}</td>
        </tr>
      `).join("");
      const pageLabel = detailChunks.length > 1 ? ` (${idx + 1}/${detailChunks.length}쪽)` : "";
      return `
        <div class="report-page">
          <div class="official-form-title">지적내역서 (대상물: ${escapeHtml(siteName)})${pageLabel}</div>
          <table class="completion-table">
            <colgroup>
              <col class="did-content">
              <col class="did-photo">
              <col class="did-photo">
            </colgroup>
            <thead>
              <tr>
                <th colspan="3">이행완료 보고서 증빙자료</th>
              </tr>
              <tr>
                <th class="did-content did-result-label" rowspan="2">이행결과</th>
                <th class="did-photo official-table-note" colspan="2">1. 이행 조치 건별 전ㆍ후 사진<br>2. 공사계약서 등 증빙서류 첨부(별첨)</th>
              </tr>
              <tr>
                <th class="did-photo">이행 전</th>
                <th class="did-photo">이행 후</th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
      `;
    }).join("");

    $("#completionReportContent").innerHTML = `
      <div class="official-form">
      <div class="report-page">
        <div class="official-form-topnote">■ 소방시설 설치 및 관리에 관한 법률 시행규칙 [별지 제11호서식]</div>
        <div class="official-form-title">소방시설등의 자체점검 결과 이행완료 보고서</div>

        <table class="official-table">
          <tr>
            <td class="section-label" rowspan="3">특정소방<br>대상물</td>
            <td class="field-label">대상물 명칭(상호)</td>
            <td>${escapeHtml(siteName)}</td>
            <td class="field-label">대상물 구분(용도)</td>
            <td>${escapeHtml(siteType)}</td>
          </tr>
          <tr>
            <td class="field-label">관계인</td>
            <td>성명: ${escapeHtml(contactName || "-")}<br>전화번호: <span class="nowrap">${escapeHtml(contactPhone ? formatPhone(contactPhone) : "-")}</span></td>
            <td class="field-label">소방안전관리자</td>
            <td>성명: ${escapeHtml(managerName || "-")}<br>전화번호: <span class="nowrap">${escapeHtml(managerPhone ? formatPhone(managerPhone) : "-")}</span></td>
          </tr>
          <tr>
            <td class="field-label">소재지</td>
            <td colspan="3">${escapeHtml(siteAddr)}</td>
          </tr>
        </table>

        <table class="official-table">
          <tr>
            <td class="section-label" rowspan="3">소방공사<br>업체</td>
            <td class="field-label">업체명(상호)</td>
            <td>${escapeHtml(company.name || "-")}</td>
            <td class="field-label">사업자번호</td>
            <td>${escapeHtml(company.bizRegNo || "-")}</td>
          </tr>
          <tr>
            <td class="field-label">대표이사</td>
            <td colspan="3">성명: ${escapeHtml(company.ceo || "-")} 　전화번호: <span class="nowrap">${escapeHtml(company.phone ? formatPhone(company.phone) : "-")}</span></td>
          </tr>
          <tr>
            <td class="field-label">소재지</td>
            <td colspan="3">${escapeHtml(company.address || "-")}</td>
          </tr>
        </table>

        <table class="official-table official-table-spaced">
          <tr>
            <td class="section-label">이행완료<br>사항</td>
            <td class="field-label">이행조치 내용</td>
            <td>※ 지 적 내 역 참 조 ※</td>
            <td class="field-label">이행조치 일자</td>
            <td>${escapeHtml(dateRange)}</td>
          </tr>
        </table>

        <p class="official-form-legal">
          「소방시설 설치 및 안전관리에 관한 법률」 제23조제4항 및 같은 법 시행규칙 제23조제6항에 따라 위와 같이 소방시설등의 수리ㆍ교체ㆍ정비에 대한 이행완료 보고서를 제출합니다.
        </p>

        <div class="official-form-sign">
          <div>　　년　　월　　일</div>
          <div>관계인: ${escapeHtml(contactName || "")}　　　　　(서명 또는 인)</div>
          <div>${fireStationLine}</div>
        </div>

        <table class="official-table official-table-spaced">
          <tr>
            <td class="field-label">첨부서류</td>
            <td>1. 이행계획 건별 이행 전ㆍ후 사진 증명자료 1부<br>2. 소방시설공사 계약서(이행조치 내용과 관련됩니다) 1부</td>
          </tr>
          <tr>
            <td colspan="2" class="official-table-bar">유의 사항</td>
          </tr>
          <tr>
            <td class="field-label">「소방시설 설치 및 관리에 관한 법률」 제61조제1항 제8호 및 제9호</td>
            <td>1. 특정소방대상물의 관계인이 법 제22조에 따른 소방시설등의 자체점검 결과에 따른 수리ㆍ조치ㆍ정비사항 발생 시 이행계획서를 첨부하지 않거나 거짓으로 제출한 경우 300만원 이하의 과태료를 부과합니다.<br>2. 특정소방대상물의 관계인이 소방시설등의 수리ㆍ조치ㆍ정비 이행계획을 별도의 연기신청 없이 기간 내에 완료하지 않은 경우 300만원 이하의 과태료를 부과합니다.</td>
          </tr>
        </table>

        <div class="official-form-footer">210mm×297mm[백상지(80g/㎡) 또는 중질지(80g/㎡)]</div>
      </div>
      ${detailPagesHtml}
      </div>
    `;
    lastCompletionReportData = { site, company, resolved, photoMap, dateRange, contactName, contactPhone, managerName, managerPhone, siteName, siteType, siteAddr, fireStation };
    completionReportPages = Array.from($("#completionReportContent").querySelectorAll(".report-page"));
    showCompletionReportPage(0);
    showScreen("screen-completion-report");
  }

  let completionReportPages = [];
  let completionReportPageIndex = 0;

  function showCompletionReportPage(idx) {
    if (!completionReportPages.length) return;
    completionReportPageIndex = Math.max(0, Math.min(idx, completionReportPages.length - 1));
    completionReportPages.forEach((el, i) => el.classList.toggle("active", i === completionReportPageIndex));
    const total = completionReportPages.length;
    $("#completionPageIndicator").textContent = `${completionReportPageIndex + 1} / ${total}`;
    $("#btnCompletionPrevPage").disabled = completionReportPageIndex === 0;
    $("#btnCompletionNextPage").disabled = completionReportPageIndex === total - 1;
    $("#completionReportPager").classList.toggle("hidden", total <= 1);
  }

  $("#btnCompletionPrevPage").addEventListener("click", () => showCompletionReportPage(completionReportPageIndex - 1));
  $("#btnCompletionNextPage").addEventListener("click", () => showCompletionReportPage(completionReportPageIndex + 1));

  $("#btnDownloadCompletionHwpx").addEventListener("click", async () => {
    if (!lastCompletionReportData) return;
    const btn = $("#btnDownloadCompletionHwpx");
    const originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = "생성 중...";
    try {
      const blob = await HwpxExport.generateCompletionReportHwpx(lastCompletionReportData);
      backupToDrive(
        lastCompletionReportData.site ? lastCompletionReportData.site.id : null,
        "이행완료보고서",
        `이행완료보고서_${lastCompletionReportData.siteName}_${todayISO()}.hwpx`,
        blob
      );
      // 앱(APK) 안의 WebView는 <a download>로 조용히 다운로드하는 게 안 보이거나 그냥 안 될 때가
      // 많다(사용자가 실제로 겪은 문제) - 네이티브에서는 안드로이드 표준 "다운로드" 폴더에 직접 저장하고
      // (FileSaver 네이티브 플러그인) 실제 저장된 위치를 그대로 알려준다.
      const filename = `이행완료보고서_${lastCompletionReportData.siteName}.hwpx`;
      if (isNativeApp()) {
        btn.textContent = "저장 중...";
        const saved = await nativeSaveToDownloads(blob, filename, "application/hwp+zip");
        toast(`저장되었습니다: ${saved.location}`, "success");
        await nativeOfferToOpen(saved.uri, saved.mimeType);
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        toast("HWPX 파일이 생성되었습니다. 한글 프로그램에서 정상적으로 열리는지 꼭 확인해주세요.", "success");
      }
    } catch (err) {
      toast("HWPX 파일 생성에 실패했습니다: " + err.message, "error");
    } finally {
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  });

  $("#btnBackFromCompletionReport").addEventListener("click", async () => {
    await renderDeficiencies();
    showScreen("screen-deficiencies");
  });

  // 안드로이드 WebView는 window.print()를 기본적으로 지원하지 않는다(PrintManager 네이티브
  // 연동이 따로 있어야 하는데, 이 프로젝트엔 없다) - 그냥 조용히 아무 반응도 없다(사용자가 실제로
  // 겪은 문제). 네이티브 앱에서는 대신 이미 있는 PDF 생성 경로(공유 버튼과 동일)로 PDF 파일을
  // 만들어 다운로드 폴더에 저장하고 바로 열도록 한다. 웹(데스크톱 브라우저)에서는 실제 인쇄도
  // 가능한 window.print()가 더 유용하므로 그대로 둔다.
  // 네이티브 앱에서는 실제 "인쇄"가 아니라 PDF 저장만 일어나므로 버튼 문구를 그에 맞게 바꾼다.
  if (isNativeApp()) $("#btnPrintCompletionReport").textContent = "PDF 저장";
  $("#btnPrintCompletionReport").addEventListener("click", async () => {
    if (!isNativeApp()) {
      window.print();
      return;
    }
    const btn = $("#btnPrintCompletionReport");
    const originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = "PDF 생성 중...";
    try {
      const blob = await generateCompletionReportPdfBlob();
      const filename = `이행완료보고서_${lastCompletionReportData.siteName}.pdf`;
      btn.textContent = "저장 중...";
      const saved = await nativeSaveToDownloads(blob, filename, "application/pdf");
      toast(`저장되었습니다: ${saved.location}`, "success");
      await nativeOfferToOpen(saved.uri, saved.mimeType);
    } catch (err) {
      toast("PDF 생성에 실패했습니다: " + err.message, "error");
    } finally {
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  });

  async function generateCompletionReportPdfBlob() {
    const el = $("#completionReportContent");
    // 화면에서는 한 번에 한 페이지만 보이지만(.report-page.active), PDF에는 전체 페이지가
    // 다 들어가야 하므로 캡처 직전에만 전부 보이게 전환한다 - html2canvas는 @media print를
    // 반영하지 않으므로 인쇄용 CSS만으로는 부족하다.
    el.classList.add("pdf-export-all-pages");
    try {
      return await html2pdf()
        .set({
          margin: 8,
          filename: "report.pdf",
          image: { type: "jpeg", quality: 0.95 },
          html2canvas: { scale: 2, useCORS: true },
          jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
          pagebreak: { mode: ["css", "legacy"] }
        })
        .from(el)
        .outputPdf("blob");
    } finally {
      el.classList.remove("pdf-export-all-pages");
    }
  }

  // 파일 공유를 지원하는 브라우저(모바일 대부분)면 공유 시트를 띄우고, 아니면 파일을 바로 다운로드한다.
  async function shareOrDownloadFile(blob, filename, mimeType) {
    if (isNativeApp()) {
      try {
        await nativeShareFiles([{ blob, name: filename }], "이행완료 보고서");
        return;
      } catch (e) {
        if (e && e.message && /cancel/i.test(e.message)) return; // 사용자가 공유 화면에서 취소함
        toast("공유 화면을 여는 데 실패했습니다: " + (e && e.message ? e.message : "알 수 없는 오류"), "error");
        return;
      }
    }
    const file = new File([blob], filename, { type: mimeType });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: "이행완료 보고서" });
        return;
      } catch (e) {
        if (e.name === "AbortError") return; // 사용자가 공유를 취소함
        // 그 외 오류(공유 대상 없음 등)면 아래에서 다운로드로 대체 처리
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast(`${filename} 파일이 다운로드되었습니다. 원하는 방법으로 공유해주세요.`, "success");
  }

  $("#btnShareCompletionReport").addEventListener("click", async () => {
    if (!lastCompletionReportData) return;
    const format = await pickShareFormat();
    if (!format) return;
    const btn = $("#btnShareCompletionReport");
    const originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = "생성 중...";
    try {
      const filenameBase = `이행완료보고서_${lastCompletionReportData.siteName}`;
      const siteId = lastCompletionReportData.site ? lastCompletionReportData.site.id : null;
      if (format === "hwpx") {
        const blob = await HwpxExport.generateCompletionReportHwpx(lastCompletionReportData);
        backupToDrive(siteId, "이행완료보고서", `${filenameBase}_${todayISO()}.hwpx`, blob);
        btn.textContent = "공유 화면 여는 중...";
        await shareOrDownloadFile(blob, `${filenameBase}.hwpx`, "application/hwp+zip");
      } else {
        const blob = await generateCompletionReportPdfBlob();
        backupToDrive(siteId, "이행완료보고서", `${filenameBase}_${todayISO()}.pdf`, blob);
        btn.textContent = "공유 화면 여는 중...";
        await shareOrDownloadFile(blob, `${filenameBase}.pdf`, "application/pdf");
      }
    } catch (err) {
      toast("파일 생성에 실패했습니다: " + err.message, "error");
    } finally {
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  });

  function escapeHtml(str) {
    return String(str ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  // ================= 동선 =================
  const COMPANY_KEY = "fireInspectionCompanyProfile";
  const DEFAULT_COMPANY = { name: "조은소방", address: "대구시 수성구 중동 551-49", phone: "", ceo: "", bizRegNo: "", licenseNo: "" };

  function getCompanyProfile() {
    try {
      const raw = localStorage.getItem(COMPANY_KEY);
      if (!raw) return { ...DEFAULT_COMPANY };
      const parsed = JSON.parse(raw);
      return {
        name: parsed.name || DEFAULT_COMPANY.name,
        address: parsed.address || DEFAULT_COMPANY.address,
        phone: parsed.phone || "",
        ceo: parsed.ceo || "",
        bizRegNo: parsed.bizRegNo || "",
        licenseNo: parsed.licenseNo || ""
      };
    } catch (e) {
      return { ...DEFAULT_COMPANY };
    }
  }

  function saveCompanyProfile(profile) {
    localStorage.setItem(COMPANY_KEY, JSON.stringify(profile));
  }

  let routeSelectedDate = "";

  async function renderRoute() {
    if (!routeSelectedDate) routeSelectedDate = todayISO();
    $("#routeDate").value = routeSelectedDate;
    await renderScheduleAgenda();
    await renderRouteList();
  }

  async function renderScheduleAgenda() {
    const [inspections, sites] = await Promise.all([FireDB.getAllInspections(), FireDB.getAllSites()]);
    const siteMap = new Map(sites.map((s) => [s.id, s]));
    const upcoming = inspections.filter((i) => i.status !== "completed" && i.scheduledDate);
    const byDate = new Map();
    upcoming.forEach((i) => {
      if (!byDate.has(i.scheduledDate)) byDate.set(i.scheduledDate, []);
      byDate.get(i.scheduledDate).push(i);
    });
    const dates = Array.from(byDate.keys()).sort();

    const list = $("#scheduleAgenda");
    if (dates.length === 0) {
      list.innerHTML = `<div class="empty-state">예정된 점검이 없습니다.</div>`;
      return;
    }
    const today = todayISO();
    list.innerHTML = dates.map((date) => {
      const items = byDate.get(date);
      const isOverdue = date < today;
      const names = items.map((i) => escapeHtml(siteMap.get(i.siteId) ? siteMap.get(i.siteId).name : "알 수 없는 현장")).join(", ");
      return `
        <div class="list-card" data-date="${date}">
          <div class="list-card-title">
            <span>${escapeHtml(date)}${date === today ? " (오늘)" : ""}</span>
            <span class="badge badge-${isOverdue ? "overdue" : "scheduled"}">${isOverdue ? "기한초과" : "예정"}</span>
          </div>
          <div class="list-card-sub">${names} (${items.length}건)</div>
        </div>
      `;
    }).join("");
    $$("#scheduleAgenda .list-card").forEach((el) => {
      el.addEventListener("click", async () => {
        routeSelectedDate = el.dataset.date;
        $("#routeDate").value = routeSelectedDate;
        await renderRouteList();
        $("#routeDate").scrollIntoView({ behavior: "smooth", block: "center" });
      });
    });
  }

  const CHANGE_HISTORY_VISIBLE_KEY = "fireInspectionShowChangeHistory";
  function isChangeHistoryVisible() {
    const v = localStorage.getItem(CHANGE_HISTORY_VISIBLE_KEY);
    return v === null ? true : v === "1";
  }
  function setChangeHistoryVisible(on) {
    localStorage.setItem(CHANGE_HISTORY_VISIBLE_KEY, on ? "1" : "0");
  }

  async function renderSettings() {
    const profile = getCompanyProfile();
    $("#companyName").value = profile.name;
    $("#companyAddress").value = profile.address;
    $("#companyPhone").value = profile.phone;
    $("#companyCeo").value = profile.ceo;
    $("#companyBizRegNo").value = profile.bizRegNo;
    $("#companyLicenseNo").value = profile.licenseNo;
    const apiKeys = BldReg.getKeys();
    $("#jusoApiKey").value = apiKeys.jusoKey || "";
    $("#dataGoKrApiKey").value = apiKeys.dataGoKrKey || "";
    $("#aiEnabledToggle").checked = AiFill.isEnabled();
    $("#changeHistoryEnabledToggle").checked = isChangeHistoryVisible();
    renderDriveStatus();
    $("#authCurrentUser").textContent = Auth.getDisplayName();
  }

  // ---------- 앱 버전 / 업데이트 확인 ----------
  // 사이드로드 앱(스토어 밖에서 apk로 설치)은 스스로를 조용히 덮어쓸 수 없으므로(설치는 항상 사용자
  // 확인 필요), 새 버전이 있으면 외부 브라우저로 APK 다운로드 URL을 열어 다운로드->설치를 대신 시작해준다.
  // version.js의 APP_VERSION은 마지막으로 웹 파일이 바뀐 실제 날짜/시간(한국시간)이고,
  // APP_VERSION_CODE/NAME은 APK를 새로 빌드해서 배포할 때만 올리는 별개의 버전 번호다.
  const APP_VERSION_CODE = 22;
  const APP_VERSION_NAME = "1.21";
  const UPDATE_MANIFEST_URL = "https://green3077.github.io/fire-inspection/version.json";
  const IS_NATIVE_UPDATE = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  // 이 프로젝트는 번들러(webpack/vite 등)를 쓰지 않는 순수 스크립트 앱이라 @capacitor/core 전체가
  // 로드되지 않고, 네이티브가 자동 주입하는 가벼운 native-bridge.js만 있다 - 거기엔 registerPlugin()이
  // 없다(그건 @capacitor/core 패키지 쪽 API라 window.Capacitor.registerPlugin은 항상 존재하지 않는
  // 함수였다 - 이 한 줄의 예외가 여기부터 파일 끝까지 나머지 스크립트 실행을 통째로 멈춰버려서
  // 업데이트 확인/로그아웃 버튼이 아예 연결 안 되고, 자동 부팅(Auth.onReady)도 못 걸리는 게
  // "홈 화면이 안 뜨고 버튼이 안 눌리는" 문제의 실제 원인이었다). native-bridge.js가 실제로 제공하는
  // 저수준 API인 nativePromise(pluginName, methodName, options)로 직접 호출한다.
  function callUpdateBridge(method, options) {
    return window.Capacitor.nativePromise("UpdateBridge", method, options);
  }
  let pendingApkUrl = null;

  $("#appVersionText").textContent =
    "현재 버전: v" + APP_VERSION_NAME + (typeof APP_VERSION !== "undefined" ? " (빌드: " + APP_VERSION + ")" : "");

  $("#btnCheckUpdate").addEventListener("click", async () => {
    if (pendingApkUrl) {
      if (IS_NATIVE_UPDATE) {
        callUpdateBridge("openExternal", { url: pendingApkUrl }).catch(() => {
          $("#updateStatus").textContent = "업데이트 파일을 여는 데 실패했습니다.";
        });
      } else {
        window.open(pendingApkUrl, "_blank");
      }
      return;
    }
    $("#updateStatus").textContent = "업데이트 확인 중...";
    try {
      const res = await fetch(UPDATE_MANIFEST_URL + "?t=" + Date.now());
      const info = await res.json();
      if (!info || typeof info.versionCode !== "number") {
        $("#updateStatus").textContent = "업데이트 정보를 확인하지 못했습니다.";
        return;
      }
      if (info.versionCode <= APP_VERSION_CODE) {
        $("#updateStatus").textContent = "이미 최신 버전입니다 (v" + APP_VERSION_NAME + ")";
        return;
      }
      pendingApkUrl = info.apkUrl;
      $("#btnCheckUpdate").textContent = "새 버전(" + (info.versionName || info.versionCode) + ") 다운로드하기";
      $("#updateStatus").textContent = "다시 눌러서 다운로드를 시작하세요.";
    } catch (e) {
      $("#updateStatus").textContent = "업데이트 확인에 실패했습니다. 네트워크를 확인해주세요.";
    }
  });

  function renderDriveStatus() {
    $("#driveEnabledToggle").checked = DriveBackup.isEnabled();
  }

  $("#driveEnabledToggle").addEventListener("change", (e) => {
    DriveBackup.setEnabled(e.target.checked);
    toast(e.target.checked ? "자동 저장을 켰습니다." : "자동 저장을 껐습니다.");
  });

  $("#btnSaveApiKeys").addEventListener("click", () => {
    BldReg.saveKeys({
      jusoKey: $("#jusoApiKey").value.trim(),
      dataGoKrKey: $("#dataGoKrApiKey").value.trim()
    });
    toast("API 키가 저장되었습니다.");
  });

  $("#aiEnabledToggle").addEventListener("change", (e) => {
    AiFill.setEnabled(e.target.checked);
    toast(e.target.checked ? "AI 자동 인식을 켰습니다." : "AI 자동 인식을 껐습니다.");
  });

  $("#changeHistoryEnabledToggle").addEventListener("change", (e) => {
    setChangeHistoryVisible(e.target.checked);
    toast(e.target.checked ? "변경이력 보기를 켰습니다." : "변경이력 보기를 껐습니다.");
  });

  // ---------- 자료 백업 / 복구 ----------
  // 거래처/점검/지적사항/스케줄(=Firebase의 공유 텍스트 자료)의 스냅샷을 zip으로 묶어 구글
  // 드라이브에 보관한다. 사진/첨부파일은 업로드 시점에 이미 각자 개별적으로 구글 드라이브에
  // 자동 저장되므로 여기 다시 담지 않는다(용량 낭비 + 중복). 이행완료보고서도 지적사항 데이터가
  // 있으면 언제든 다시 만들 수 있어 별도로 담지 않는다 - "다시 만들 수 없는 원본 텍스트"만 백업한다.
  async function collectBackupData() {
    const [sites, inspections, deficiencies, schedules] = await Promise.all([
      FireDB.getAllSites(),
      FireDB.getAllInspections(),
      FireDB.getAllDeficiencies(),
      FireDB.getAllSchedules(),
    ]);
    return { version: 1, exportedAt: new Date().toISOString(), company: getCompanyProfile(), sites, inspections, deficiencies, schedules };
  }

  function backupFilenameDate() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  }

  $("#btnDataBackup").addEventListener("click", async () => {
    const btn = $("#btnDataBackup");
    const originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = "백업 중...";
    $("#backupStatus").textContent = "";
    try {
      const data = await collectBackupData();
      const zip = new JSZip();
      zip.file("backup.json", JSON.stringify(data, null, 2));
      const blob = await zip.generateAsync({ type: "blob" });
      const filename = `${backupFilenameDate()}.zip`;
      await DriveBackup.uploadBackup(filename, blob);
      $("#backupStatus").textContent = `마지막 백업: ${filename}`;
      toast(`백업 완료: ${filename} (구글 드라이브에 저장됨)`, "success");
    } catch (err) {
      toast("백업에 실패했습니다: " + (err && err.message ? err.message : "알 수 없는 오류"), "error");
    } finally {
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  });

  $("#btnDataRestore").addEventListener("click", async () => {
    const ok = await confirmDialog(
      "가장 최근 백업으로 복구할까요?\n" +
      "현재 거래처·점검·지적사항·스케줄 자료가 백업 시점 내용으로 전부 바뀌며, 이 앱을 쓰는 모든 사람에게 적용됩니다.\n" +
      "되돌릴 수 없습니다."
    );
    if (!ok) return;
    const btn = $("#btnDataRestore");
    const originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = "복구 중...";
    $("#backupStatus").textContent = "";
    try {
      const backups = await DriveBackup.listBackups();
      if (backups.length === 0) {
        toast("구글 드라이브에 백업 파일이 없습니다.", "error");
        return;
      }
      const latest = backups[0];
      btn.textContent = "다운로드 중...";
      const blob = await DriveBackup.downloadFile(latest.id);
      const zip = await JSZip.loadAsync(blob);
      const entry = zip.file("backup.json");
      if (!entry) throw new Error("백업 파일 형식이 올바르지 않습니다.");
      const data = JSON.parse(await entry.async("string"));

      btn.textContent = "복원 중...";
      for (const site of data.sites || []) await FireDB.addSite(site);
      for (const insp of data.inspections || []) await FireDB.addInspection(insp);
      for (const def of data.deficiencies || []) await FireDB.addDeficiency(def);
      for (const sched of data.schedules || []) {
        await FireDB.setScheduleSiteIds(sched.id, sched.siteIds || []);
        await FireDB.setScheduleConfirmed(sched.id, !!sched.confirmed);
      }
      if (data.company) saveCompanyProfile(data.company);

      $("#backupStatus").textContent = `복구 완료: ${latest.name}`;
      toast(`복구 완료 (백업 파일: ${latest.name})`, "success");
      renderSettings();
    } catch (err) {
      toast("복구에 실패했습니다: " + (err && err.message ? err.message : "알 수 없는 오류"), "error");
    } finally {
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  });

  $("#btnAuthLogout").addEventListener("click", () => {
    Auth.logout();
    $("#loginUsername").value = "";
    $("#loginPassword").value = "";
    $("#loginGate").classList.remove("hidden");
    showScreen("screen-home");
    toast("로그아웃되었습니다.");
  });

  async function renderRouteList() {
    const [inspections, sites] = await Promise.all([FireDB.getAllInspections(), FireDB.getAllSites()]);
    const siteMap = new Map(sites.map((s) => [s.id, s]));
    const dayInspections = inspections.filter((i) => i.scheduledDate === routeSelectedDate);
    dayInspections.sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));

    const list = $("#routeList");
    if (dayInspections.length === 0) {
      list.innerHTML = `<div class="empty-state">이 날짜에 예정된 점검이 없습니다.</div>`;
      return;
    }
    list.innerHTML = dayInspections.map((insp) => {
      const site = siteMap.get(insp.siteId);
      const st = computeStatus(insp);
      return `
        <div class="list-card">
          <div class="list-card-title">
            <span>${escapeHtml(site ? site.name : "알 수 없는 현장")}</span>
            <span class="badge badge-${st}">${STATUS_LABEL[st]}</span>
          </div>
          <div class="list-card-sub">${escapeHtml(site && site.address ? site.address : "주소 미입력")}</div>
          <div class="list-card-sub">${escapeHtml(insp.type)}${insp.inspector ? " · 점검자: " + insp.inspector : ""}</div>
        </div>
      `;
    }).join("");
  }

  $("#routeDate").addEventListener("change", async (e) => {
    routeSelectedDate = e.target.value || todayISO();
    await renderRouteList();
  });

  $("#btnSaveCompany").addEventListener("click", () => {
    const name = $("#companyName").value.trim() || DEFAULT_COMPANY.name;
    const address = $("#companyAddress").value.trim() || DEFAULT_COMPANY.address;
    const phone = $("#companyPhone").value.trim();
    const ceo = $("#companyCeo").value.trim();
    const bizRegNo = $("#companyBizRegNo").value.trim();
    const licenseNo = $("#companyLicenseNo").value.trim();
    saveCompanyProfile({ name, address, phone, ceo, bizRegNo, licenseNo });
    toast("업체 정보가 저장되었습니다.");
  });

  $("#btnOpenGoogleRoute").addEventListener("click", async () => {
    const profile = getCompanyProfile();
    const [inspections, sites] = await Promise.all([FireDB.getAllInspections(), FireDB.getAllSites()]);
    const siteMap = new Map(sites.map((s) => [s.id, s]));
    const dayInspections = inspections.filter((i) => i.scheduledDate === routeSelectedDate);
    dayInspections.sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));

    const addresses = [];
    let skipped = 0;
    dayInspections.forEach((insp) => {
      const site = siteMap.get(insp.siteId);
      if (site && site.address) addresses.push(site.address);
      else skipped++;
    });

    if (addresses.length === 0) {
      toast("이 날짜에 주소가 등록된 방문 현장이 없습니다.", "error");
      return;
    }
    if (addresses.length > 9) {
      toast("구글 지도 경로는 최대 9개 경유지까지만 표시됩니다. 앞 9곳만 반영합니다.", "error");
    }
    const stops = addresses.slice(0, 9);
    const destination = stops[stops.length - 1];
    const waypoints = stops.slice(0, -1);

    const params = new URLSearchParams({
      api: "1",
      origin: profile.address,
      destination,
      travelmode: "driving"
    });
    if (waypoints.length) params.set("waypoints", waypoints.join("|"));

    if (skipped > 0) toast(`주소가 없는 현장 ${skipped}곳은 동선에서 제외되었습니다.`);
    window.open(`https://www.google.com/maps/dir/?${params.toString()}`, "_blank");
  });

  // ================= 스케줄 관리 (날짜별 방문 예정/확정 업체) =================
  // 점검 기록(inspections)과는 무관한 가벼운 일정 - 날짜에 업체를 담아두고, 전화로 방문이
  // 확정되면 그 날짜 전체를 "확정"으로 표시한다(업체 개별 확정이 아니라 날짜 단위 확정).
  function scheduleDateStr(year, month, day) {
    return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  async function renderScheduleCalendar() {
    const year = scheduleCalDate.getFullYear();
    const month = scheduleCalDate.getMonth();
    $("#scheduleMonthLabel").textContent = `${year}년 ${month + 1}월`;

    const schedules = await FireDB.getAllSchedules();
    const scheduleMap = new Map(schedules.map((s) => [s.id, s]));

    const startWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = todayISO();

    let cellsHtml = "";
    for (let i = 0; i < startWeekday; i++) {
      cellsHtml += `<div class="schedule-day-cell is-empty"></div>`;
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = scheduleDateStr(year, month, day);
      const sched = scheduleMap.get(dateStr);
      const count = sched ? sched.siteIds.length : 0;
      const classes = ["schedule-day-cell"];
      if (count > 0) classes.push("has-schedule");
      if (sched && sched.confirmed) classes.push("is-confirmed");
      if (dateStr === today) classes.push("is-today");
      if (dateStr === scheduleSelectedDate) classes.push("is-selected");
      cellsHtml += `
        <div class="${classes.join(" ")}" data-date="${dateStr}">
          <span>${day}</span>
          ${count > 0 ? `<span class="schedule-day-count">${count}곳</span>` : ""}
        </div>
      `;
    }
    $("#scheduleCalendarGrid").innerHTML = cellsHtml;
    $$("#scheduleCalendarGrid .schedule-day-cell:not(.is-empty)").forEach((el) => {
      el.addEventListener("click", () => selectScheduleDate(el.dataset.date));
    });
  }

  // 날짜를 선택할 때마다 그 날짜에 이미 저장된 업체 목록으로 "확인 전 임시 선택" 상태를 초기화한다 -
  // 업체 선택 목록에서 체크만 해두고 아직 저장(확인)하지 않은 상태를 달력 이동 시 버리기 위함.
  async function selectScheduleDate(date) {
    scheduleSelectedDate = date;
    const sched = await FireDB.getScheduleByDate(date);
    scheduleStagedIds = new Set(sched ? sched.siteIds : []);
    await refreshScheduleManage();
  }

  async function renderScheduleDayDetail() {
    const date = scheduleSelectedDate;
    const d = new Date(date + "T00:00:00");
    $("#scheduleSelectedDateLabel").textContent = `${date} (${WEEKDAY_LABEL[d.getDay()]}) 방문 예정 업체`;

    const [sched, sites] = await Promise.all([FireDB.getScheduleByDate(date), FireDB.getAllSites()]);
    const siteMap = new Map(sites.map((s) => [s.id, s]));
    const siteIds = sched ? sched.siteIds : [];
    const confirmed = !!(sched && sched.confirmed);

    const list = $("#scheduleDayCompanyList");
    if (siteIds.length === 0) {
      list.innerHTML = `<div class="empty-state">아래 업체 목록에서 선택 후 "확인"을 누르면 여기에 표시됩니다.</div>`;
    } else {
      list.innerHTML = siteIds.map((id) => `
        <div class="schedule-day-company-chip">
          <span>${escapeHtml(siteMap.has(id) ? siteMap.get(id).name : "삭제된 업체")}</span>
          <button type="button" data-remove="${id}">×</button>
        </div>
      `).join("");
      $$("#scheduleDayCompanyList [data-remove]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const id = btn.dataset.remove;
          await FireDB.removeSiteFromSchedule(date, id);
          scheduleStagedIds.delete(id);
          await refreshScheduleManage();
          toast("삭제했습니다.");
        });
      });
    }

    $("#btnScheduleConfirm").classList.toggle("hidden", siteIds.length === 0 || confirmed);
    $("#btnScheduleUnconfirm").classList.toggle("hidden", !confirmed);
  }

  // 업체 선택 목록은 클릭 즉시 저장하지 않고 scheduleStagedIds(임시 체크 상태)만 바꾼다 -
  // 실제로 그 날짜의 예정 업체로 저장되는 시점은 "확인" 버튼을 눌렀을 때뿐이다.
  async function renderScheduleCompanyPickList() {
    const sites = await FireDB.getAllSites();
    const term = scheduleCompanySearchTerm.trim();
    const filtered = (term ? sites.filter((s) => s.name.includes(term)) : sites)
      .sort((a, b) => a.name.localeCompare(b.name, "ko"));

    const list = $("#scheduleCompanyPickList");
    if (filtered.length === 0) {
      list.innerHTML = `<div class="empty-state">${term ? "검색 결과가 없습니다." : "등록된 업체가 없습니다."}</div>`;
      return;
    }
    list.innerHTML = filtered.map((s) => `
      <div class="schedule-company-pick-row ${scheduleStagedIds.has(s.id) ? "is-added" : ""}" data-id="${s.id}">
        ${scheduleStagedIds.has(s.id) ? "☑" : "☐"} ${escapeHtml(s.name)}
      </div>
    `).join("");
    $$("#scheduleCompanyPickList .schedule-company-pick-row").forEach((el) => {
      el.addEventListener("click", () => {
        const id = el.dataset.id;
        if (scheduleStagedIds.has(id)) scheduleStagedIds.delete(id);
        else scheduleStagedIds.add(id);
        renderScheduleCompanyPickList();
      });
    });
  }

  async function refreshScheduleManage() {
    await Promise.all([renderScheduleCalendar(), renderScheduleDayDetail(), renderScheduleCompanyPickList()]);
  }

  $("#btnSchedulePrevMonth").addEventListener("click", async () => {
    scheduleCalDate = new Date(scheduleCalDate.getFullYear(), scheduleCalDate.getMonth() - 1, 1);
    await renderScheduleCalendar();
  });
  $("#btnScheduleNextMonth").addEventListener("click", async () => {
    scheduleCalDate = new Date(scheduleCalDate.getFullYear(), scheduleCalDate.getMonth() + 1, 1);
    await renderScheduleCalendar();
  });
  $("#scheduleCompanySearch").addEventListener("input", (e) => {
    scheduleCompanySearchTerm = e.target.value;
    renderScheduleCompanyPickList();
  });
  $("#btnScheduleAddCompanies").addEventListener("click", async () => {
    await FireDB.setScheduleSiteIds(scheduleSelectedDate, Array.from(scheduleStagedIds));
    await refreshScheduleManage();
    toast("예정으로 등록되었습니다.");
  });
  $("#btnScheduleConfirm").addEventListener("click", async () => {
    await FireDB.setScheduleConfirmed(scheduleSelectedDate, true);
    await refreshScheduleManage();
    toast("일정을 확정했습니다.");
  });
  $("#btnScheduleUnconfirm").addEventListener("click", async () => {
    await FireDB.setScheduleConfirmed(scheduleSelectedDate, false);
    await refreshScheduleManage();
    toast("확정을 취소했습니다.");
  });

  // ================= 초기화 =================
  // 지적사항 "설비" 입력칸의 자동완성 후보 (소방시설 표준 분류) - 체크리스트 기능과는 무관하게 유지.
  const DEFICIENCY_CATEGORY_SUGGESTIONS = ["소화설비", "경보설비", "피난구조설비", "소화용수설비", "소화활동설비", "전기 및 기타"];

  function bootApp() {
    $("#bootLoading").classList.add("hidden");
    showScreen("screen-home");
    $("#categoryList").innerHTML = DEFICIENCY_CATEGORY_SUGGESTIONS.map((c) => `<option value="${escapeHtml(c)}">`).join("");
    $("#appVersionTag").textContent = typeof APP_VERSION !== "undefined" ? "v" + APP_VERSION : "";
    renderSites().catch(reportLoadFailure);
    renderHomeTodo().catch(reportLoadFailure);
  }

  // 이제 모든 자료(거래처·점검기록·지적사항·스케줄)가 로그인한 사람만 읽고 쓸 수 있는 공용
  // 온라인 저장소(Firebase)에 있어서, 예전과 달리 사무실 Wi-Fi/로컬에서도 로그인이 항상 필요하다.
  async function attemptLogin() {
    const username = $("#loginUsername").value.trim();
    const password = $("#loginPassword").value;
    $("#btnLogin").disabled = true;
    const ok = await Auth.tryLogin(username, password);
    $("#btnLogin").disabled = false;
    if (ok) {
      $("#loginError").classList.add("hidden");
      $("#loginGate").classList.add("hidden");
      bootApp();
    } else {
      $("#loginError").classList.remove("hidden");
      $("#loginPassword").value = "";
      $("#loginPassword").focus();
    }
  }
  $("#btnLogin").addEventListener("click", attemptLogin);
  $("#loginUsername").addEventListener("keydown", (e) => { if (e.key === "Enter") attemptLogin(); });
  $("#loginPassword").addEventListener("keydown", (e) => { if (e.key === "Enter") attemptLogin(); });

  // Auth.onReady() 자체가 (알 수 없는 이유로) 끝없이 멈출 가능성까지 대비해, 20초 안에 응답이
  // 없으면 로그인 화면으로 강제 전환한다 - "로딩 중" 표시만 영원히 뜨는 상황을 막기 위함.
  const authReadyWithTimeout = Promise.race([
    Auth.onReady(),
    new Promise((resolve) => setTimeout(() => resolve(false), 20000)),
  ]);
  authReadyWithTimeout.then((loggedIn) => {
    if (loggedIn) {
      bootApp();
    } else {
      $("#bootLoading").classList.add("hidden");
      $("#loginGate").classList.remove("hidden");
      $("#loginUsername").focus();
    }
  }).catch(() => {
    $("#bootLoading").classList.add("hidden");
    $("#loginGate").classList.remove("hidden");
    $("#loginUsername").focus();
  });
})();
