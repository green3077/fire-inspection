// 소방점검 관리 앱 메인 로직
(() => {
  let editingSiteId = null;
  let currentSiteId = null;      // 현장 상세 화면에서 보고 있는 현장
  let currentInspection = null;  // 체크리스트/보고서/지적사항 화면에서 다루는 점검(메모리 상 사본)
  let activeObjectUrls = [];

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function todayISO() {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${m}-${day}`;
  }

  function revokeObjectUrls() {
    activeObjectUrls.forEach((u) => URL.revokeObjectURL(u));
    activeObjectUrls = [];
  }

  function showScreen(id) {
    $$(".screen").forEach((s) => s.classList.remove("active"));
    $("#" + id).classList.add("active");
    $$(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === id));
    $(".tab-bar").classList.toggle("hidden", id === "screen-home");
    const isSiteForm = id === "screen-site-form";
    $("#btnHeaderBack").classList.toggle("header-btn-off", !isSiteForm);
    $("#btnHeaderSave").classList.toggle("header-btn-off", !isSiteForm);
  }

  // ---------- 홈 ----------
  $("#appHeaderTitle").addEventListener("click", () => showScreen("screen-home"));
  $("#btnHeaderBack").addEventListener("click", () => $("#btnCancelSiteForm").click());
  $("#btnHeaderSave").addEventListener("click", () => $("#btnSaveSite").click());
  $("#btnHomeAddSite").addEventListener("click", () => $("#btnAddSite").click());
  $("#btnHomeViewSites").addEventListener("click", () => { renderSites(); showScreen("screen-sites"); });

  // ---------- 탭 ----------
  $$(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      if (tab === "screen-sites") renderSites();
      if (tab === "screen-route") renderRoute();
      if (tab === "screen-deficiency-hub") renderDeficiencyHub();
      if (tab === "screen-settings") renderSettings();
      showScreen(tab);
    });
  });

  // ================= 현장 =================
  async function renderSites() {
    const [sites, inspections] = await Promise.all([FireDB.getAllSites(), FireDB.getAllInspections()]);
    sites.sort((a, b) => a.name.localeCompare(b.name, "ko"));

    const lastBySite = new Map();
    inspections.forEach((insp) => {
      const d = insp.completedDate || insp.scheduledDate || "";
      const cur = lastBySite.get(insp.siteId);
      const curD = cur ? (cur.completedDate || cur.scheduledDate || "") : "";
      if (!cur || d > curD) lastBySite.set(insp.siteId, insp);
    });

    const list = $("#sitesList");
    if (sites.length === 0) {
      list.innerHTML = `<div class="empty-state">등록된 현장이 없습니다.<br>현장을 추가해 점검을 시작하세요.</div>`;
      return;
    }
    list.innerHTML = sites.map((s) => {
      const last = lastBySite.get(s.id);
      return `
        <div class="list-card" data-id="${s.id}">
          <div class="list-card-title">${escapeHtml(s.name)}</div>
          <div class="list-card-sub">${last ? `마지막 점검일: ${escapeHtml(last.completedDate || last.scheduledDate)} · 점검자: ${escapeHtml(last.inspector || "-")}` : "점검 이력 없음"}</div>
          <div class="list-card-sub site-card-phone-row">
            <span>${s.contactPhone ? "📞 " + escapeHtml(s.contactPhone) : "연락처 미입력"}</span>
            ${s.contactPhone ? `<a class="btn-call" href="tel:${escapeHtml(s.contactPhone)}">전화걸기</a>` : ""}
          </div>
        </div>
      `;
    }).join("");
    $$("#sitesList .list-card").forEach((el) => {
      el.addEventListener("click", () => openSiteChecklist(el.dataset.id));
      const callBtn = el.querySelector(".btn-call");
      if (callBtn) callBtn.addEventListener("click", (e) => e.stopPropagation());
    });
  }

  async function getOrCreateActiveInspection(siteId) {
    const inspections = await FireDB.getInspectionsBySite(siteId);
    const inProgress = inspections.filter((i) => i.status !== "completed");
    inProgress.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    if (inProgress.length > 0) return inProgress[0];
    const insp = {
      siteId,
      type: "작동기능점검",
      scheduledDate: todayISO(),
      inspector: "",
      status: "scheduled",
      completedDate: null,
      overallNote: "",
      checklist: buildChecklistItems(),
      createdAt: new Date().toISOString()
    };
    return FireDB.addInspection(insp);
  }

  async function openSiteChecklist(siteId) {
    currentSiteId = siteId;
    const insp = await getOrCreateActiveInspection(siteId);
    await openInspection(insp.id);
  }

  const SITE_FORM_FIELDS = [
    "siteName", "siteAddress", "siteContactName", "siteContactPhone",
    "siteBuildingType", "siteArea", "siteFloorInfo", "siteApprovalDate", "siteStructure",
    "siteFireManagerName", "siteFireManagerPhone", "siteFireManagerAppointDate", "siteFireManagerEduDate",
    "siteEngineerName", "siteEngineerPhone", "siteNotes",
    "siteReceiverLocation", "siteReceiverAccess", "sitePumpRoomLocation", "sitePumpRoomAccess", "siteEquipmentMemo"
  ];

  function openBlankSiteForm() {
    editingSiteId = null;
    $("#siteFormTitle").textContent = "현장 추가";
    SITE_FORM_FIELDS.forEach((id) => { $("#" + id).value = ""; });
    $("#bldRegResult").classList.add("hidden");
    $("#importSummary").classList.add("hidden");
    lastAutoBldRegAddress = "";
    showScreen("screen-site-form");
  }

  $("#btnAddSite").addEventListener("click", () => showScreen("screen-site-entry-choice"));
  $("#btnCancelEntryChoice").addEventListener("click", () => { renderSites(); showScreen("screen-sites"); });
  $("#btnEntryManual").addEventListener("click", openBlankSiteForm);
  $("#btnEntryImport").addEventListener("click", () => $("#clientImportInput").click());

  $("#clientImportInput").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    toast("자료를 분석하고 있습니다. 잠시만 기다려주세요...");
    try {
      const result = await ClientImport.parseClientFile(file);
      if (result.unsupported) {
        toast("지원하지 않는 파일 형식입니다 (.xlsx, .docx, .pdf, .hwp, 사진).", "error");
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
    }
  });

  $("#btnCancelSiteForm").addEventListener("click", () => {
    if (editingSiteId) openSiteDetail(editingSiteId); else { renderSites(); showScreen("screen-sites"); }
  });

  $("#btnSaveSite").addEventListener("click", async () => {
    const name = $("#siteName").value.trim();
    if (!name) { toast("현장명을 입력해주세요.", "error"); return; }
    const data = {
      name,
      address: $("#siteAddress").value.trim(),
      contactName: $("#siteContactName").value.trim(),
      contactPhone: $("#siteContactPhone").value.trim(),
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
      await FireDB.updateSite(editingSiteId, data);
      openSiteDetail(editingSiteId);
    } else {
      data.createdAt = new Date().toISOString();
      const site = await FireDB.addSite(data);
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
      const { item } = await BldReg.lookup(address);
      if (!item) {
        resultBox.innerHTML = `<div class="bldreg-error">해당 주소의 건축물대장을 찾지 못했습니다. 주소를 정확히 입력했는지 확인하거나 직접 입력해주세요.</div>`;
        return;
      }
      const rawApprovalDate = item.useAprDay || "";
      const fetched = {
        buildingType: item.mainPurpsCdNm || "",
        area: item.totArea || "",
        floorInfo: [item.grndFlrCnt ? `지상 ${item.grndFlrCnt}층` : "", item.ugrndFlrCnt ? `지하 ${item.ugrndFlrCnt}층` : ""].filter(Boolean).join(" / "),
        approvalDate: /^\d{8}$/.test(rawApprovalDate) ? `${rawApprovalDate.slice(0, 4)}-${rawApprovalDate.slice(4, 6)}-${rawApprovalDate.slice(6, 8)}` : rawApprovalDate,
        structure: item.strctCdNm || ""
      };
      // 건축물대장이 실제로 값을 준 항목만 덮어쓴다 - 특정 항목을 비워서 응답하면(예: 연면적 "-")
      // 자료 불러오기로 이미 채워둔 값을 빈 값으로 지워버리지 않도록 보존한다.
      if (fetched.buildingType) $("#siteBuildingType").value = fetched.buildingType;
      if (fetched.area) $("#siteArea").value = fetched.area;
      if (fetched.floorInfo) $("#siteFloorInfo").value = fetched.floorInfo;
      if (fetched.approvalDate) $("#siteApprovalDate").value = fetched.approvalDate;
      if (fetched.structure) $("#siteStructure").value = fetched.structure;
      resultBox.innerHTML = `
        <div class="report-meta-row"><span class="label">대장구분</span><span>${escapeHtml(item.regstrKindCdNm || "-")}</span></div>
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

  $("#btnLookupBldReg").addEventListener("click", () => {
    lastAutoBldRegAddress = $("#siteAddress").value.trim();
    lookupBldRegForCurrentAddress();
  });

  $("#siteAddress").addEventListener("blur", () => {
    const address = $("#siteAddress").value.trim();
    if (address && address !== lastAutoBldRegAddress) {
      lastAutoBldRegAddress = address;
      lookupBldRegForCurrentAddress();
    }
  });

  async function openSiteDetail(id) {
    currentSiteId = id;
    const site = await FireDB.getSite(id);
    if (!site) { renderSites(); showScreen("screen-sites"); return; }
    $("#siteDetailInfo").innerHTML = `
      <h2>${escapeHtml(site.name)}</h2>
      <div class="report-meta-row"><span class="label">주소</span><span>${escapeHtml(site.address || "-")}</span></div>
      <div class="report-meta-row"><span class="label">담당자</span><span>${escapeHtml(site.contactName || "-")}</span></div>
      <div class="report-meta-row"><span class="label">연락처</span><span>${escapeHtml(site.contactPhone || "-")}</span></div>
      <div class="report-meta-row"><span class="label">건물 용도</span><span>${escapeHtml(site.buildingType || "-")}</span></div>
      <div class="report-meta-row"><span class="label">연면적</span><span>${escapeHtml(site.area ? site.area + " ㎡" : "-")}</span></div>
      ${site.floorInfo ? `<div class="report-meta-row"><span class="label">층수</span><span>${escapeHtml(site.floorInfo)}</span></div>` : ""}
      ${site.structure ? `<div class="report-meta-row"><span class="label">구조</span><span>${escapeHtml(site.structure)}</span></div>` : ""}
      ${site.approvalDate ? `<div class="report-meta-row"><span class="label">사용승인일</span><span>${escapeHtml(site.approvalDate)}</span></div>` : ""}
      ${site.fireManagerName ? `<div class="report-meta-row"><span class="label">소방안전관리자</span><span>${escapeHtml(site.fireManagerName)}${site.fireManagerPhone ? " · " + escapeHtml(site.fireManagerPhone) : ""}</span></div>` : ""}
      ${site.fireManagerAppointDate ? `<div class="report-meta-row"><span class="label">선임일자</span><span>${escapeHtml(site.fireManagerAppointDate)}</span></div>` : ""}
      ${site.fireManagerEduDate ? `<div class="report-meta-row"><span class="label">교육일자</span><span>${escapeHtml(site.fireManagerEduDate)}</span></div>` : ""}
      ${site.engineerName ? `<div class="report-meta-row"><span class="label">담당기사</span><span>${escapeHtml(site.engineerName)}${site.engineerPhone ? " · " + escapeHtml(site.engineerPhone) : ""}</span></div>` : ""}
      ${site.receiverLocation ? `<div class="report-meta-row"><span class="label">수신기 위치</span><span>${escapeHtml(site.receiverLocation)}</span></div>` : ""}
      ${site.receiverAccess ? `<div class="report-meta-row"><span class="label">수신기 접근방법</span><span>${escapeHtml(site.receiverAccess)}</span></div>` : ""}
      ${site.pumpRoomLocation ? `<div class="report-meta-row"><span class="label">펌프실 위치</span><span>${escapeHtml(site.pumpRoomLocation)}</span></div>` : ""}
      ${site.pumpRoomAccess ? `<div class="report-meta-row"><span class="label">펌프실 접근방법</span><span>${escapeHtml(site.pumpRoomAccess)}</span></div>` : ""}
      ${site.equipmentMemo ? `<div class="report-meta-row"><span class="label">메모</span><span>${escapeHtml(site.equipmentMemo)}</span></div>` : ""}
      ${site.notes ? `<div class="report-meta-row"><span class="label">비고</span><span>${escapeHtml(site.notes)}</span></div>` : ""}
    `;
    const inspections = await FireDB.getInspectionsBySite(id);
    inspections.sort((a, b) => (b.scheduledDate || "").localeCompare(a.scheduledDate || ""));
    const listEl = $("#siteInspectionsList");
    if (inspections.length === 0) {
      listEl.innerHTML = `<div class="empty-state">점검 이력이 없습니다.</div>`;
    } else {
      listEl.innerHTML = inspections.map((i) => inspectionCardHtml(i, site)).join("");
      bindInspectionCardClicks(listEl);
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
    $("#siteBuildingType").value = site.buildingType || "";
    $("#siteArea").value = site.area || "";
    $("#siteFloorInfo").value = site.floorInfo || "";
    $("#siteApprovalDate").value = site.approvalDate || "";
    $("#siteStructure").value = site.structure || "";
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
    showScreen("screen-site-form");
  });

  $("#btnDeleteSite").addEventListener("click", async () => {
    const ok = await confirmDialog("이 현장과 관련 점검 기록을 모두 삭제할까요?");
    if (!ok) return;
    await FireDB.deleteSite(currentSiteId);
    renderSites();
    showScreen("screen-sites");
  });

  $("#btnScheduleFromSite").addEventListener("click", async () => {
    await openSiteChecklist(currentSiteId);
  });

  // ================= 점검 목록 =================
  function computeStatus(insp) {
    if (insp.status === "completed") return "completed";
    if (insp.scheduledDate && insp.scheduledDate < todayISO()) return "overdue";
    return "scheduled";
  }

  const STATUS_LABEL = { scheduled: "예정", overdue: "기한초과", completed: "완료" };

  function inspectionCardHtml(insp, site) {
    const st = computeStatus(insp);
    return `
      <div class="list-card" data-id="${insp.id}">
        <div class="list-card-title">
          <span>${escapeHtml(site ? site.name : "")}</span>
          <span class="badge badge-${st}">${STATUS_LABEL[st]}</span>
        </div>
        <div class="list-card-sub">${escapeHtml(insp.type)} · ${escapeHtml(insp.scheduledDate || "")}</div>
        <div class="list-card-sub">${escapeHtml(insp.inspector ? "점검자: " + insp.inspector : "")}</div>
      </div>
    `;
  }

  function bindInspectionCardClicks(container) {
    Array.from(container.querySelectorAll(".list-card")).forEach((el) => {
      el.addEventListener("click", () => openInspection(el.dataset.id));
    });
  }

  // ================= 체크리스트 =================
  async function openInspection(id) {
    const insp = await FireDB.getInspection(id);
    if (!insp) { renderSites(); showScreen("screen-sites"); return; }
    if (insp.status === "completed") {
      openReport(id);
      return;
    }
    currentInspection = insp;
    const site = await FireDB.getSite(insp.siteId);
    $("#checklistHeader").innerHTML = `
      <h2>${escapeHtml(site ? site.name : "")}</h2>
      <div class="report-meta-row"><span class="label">주소</span><span>${escapeHtml(site ? site.address || "-" : "-")}</span></div>
      <div class="field-row">
        <div class="field">
          <span>점검 종류</span>
          <select class="insp-field" data-field="type">
            <option value="작동기능점검" ${insp.type === "작동기능점검" ? "selected" : ""}>작동기능점검</option>
            <option value="종합정밀점검" ${insp.type === "종합정밀점검" ? "selected" : ""}>종합정밀점검</option>
          </select>
        </div>
        <div class="field"><span>점검일</span><input type="date" class="insp-field" data-field="scheduledDate" value="${escapeHtml(insp.scheduledDate || "")}"></div>
      </div>
      <div class="field"><span>점검자</span><input type="text" class="insp-field" data-field="inspector" placeholder="예: 홍길동" value="${escapeHtml(insp.inspector || "")}"></div>
    `;
    $$("#checklistHeader .insp-field").forEach((el) => {
      el.addEventListener("change", async () => {
        currentInspection[el.dataset.field] = el.value;
        await persistCurrentInspection();
      });
    });
    $("#inspOverallNote").value = insp.overallNote || "";
    await renderChecklistBody();
    showScreen("screen-checklist");
  }

  async function renderChecklistBody() {
    revokeObjectUrls();
    const insp = currentInspection;
    const groups = {};
    insp.checklist.forEach((item) => {
      (groups[item.category] = groups[item.category] || []).push(item);
    });

    const photos = await FireDB.getPhotosByInspection(insp.id);
    const photoMap = new Map(photos.map((p) => [p.id, p]));

    let html = "";
    for (const category of Object.keys(groups)) {
      html += `<div class="checklist-group-title">${escapeHtml(category)}</div>`;
      for (const item of groups[category]) {
        const thumbs = item.photoIds.map((pid) => {
          const p = photoMap.get(pid);
          if (!p) return "";
          const url = URL.createObjectURL(p.blob);
          activeObjectUrls.push(url);
          return `<div class="photo-thumb-wrap">
            <img class="photo-thumb" src="${url}">
            <button class="photo-thumb-remove" data-item="${item.id}" data-photo="${pid}">×</button>
          </div>`;
        }).join("");
        html += `
          <div class="checklist-item" data-item="${item.id}">
            <div class="checklist-item-name">${escapeHtml(item.name)}</div>
            <div class="result-options">
              ${RESULT_OPTIONS.map((opt) => `<button class="result-btn ${item.result === opt ? "sel-" + opt : ""}" data-item="${item.id}" data-result="${opt}">${opt}</button>`).join("")}
            </div>
            <textarea class="item-note" data-item="${item.id}" rows="1" placeholder="비고 입력">${escapeHtml(item.note || "")}</textarea>
            <div class="photo-thumbs">
              ${thumbs}
              <label class="btn-add-photo-label">＋
                <input type="file" accept="image/*" capture="environment" class="photo-file-input" data-item="${item.id}">
              </label>
            </div>
          </div>
        `;
      }
    }
    $("#checklistBody").innerHTML = html;

    $$("#checklistBody .result-btn").forEach((btn) => {
      btn.addEventListener("click", () => setItemResult(btn.dataset.item, btn.dataset.result));
    });
    $$("#checklistBody .item-note").forEach((ta) => {
      ta.addEventListener("change", () => setItemNote(ta.dataset.item, ta.value));
    });
    $$("#checklistBody .photo-file-input").forEach((input) => {
      input.addEventListener("change", (e) => onChecklistPhotoSelected(input.dataset.item, e.target.files[0]));
    });
    $$("#checklistBody .photo-thumb-remove").forEach((btn) => {
      btn.addEventListener("click", () => removeItemPhoto(btn.dataset.item, btn.dataset.photo));
    });
  }

  function findItem(itemId) {
    return currentInspection.checklist.find((i) => i.id === itemId);
  }

  async function persistCurrentInspection() {
    await FireDB.updateInspection(currentInspection.id, {
      type: currentInspection.type,
      scheduledDate: currentInspection.scheduledDate,
      inspector: currentInspection.inspector,
      checklist: currentInspection.checklist,
      overallNote: currentInspection.overallNote
    });
  }

  async function setItemResult(itemId, result) {
    const item = findItem(itemId);
    item.result = item.result === result ? "" : result;
    await persistCurrentInspection();
    await renderChecklistBody();
  }

  async function setItemNote(itemId, note) {
    const item = findItem(itemId);
    item.note = note;
    await persistCurrentInspection();
  }

  async function onChecklistPhotoSelected(itemId, file) {
    if (!file) return;
    const item = findItem(itemId);
    const photo = await FireDB.addPhoto({
      inspectionId: currentInspection.id,
      itemId: item.id,
      blob: file,
      createdAt: new Date().toISOString()
    });
    item.photoIds.push(photo.id);
    await persistCurrentInspection();
    await renderChecklistBody();
  }

  async function removeItemPhoto(itemId, photoId) {
    const item = findItem(itemId);
    item.photoIds = item.photoIds.filter((id) => id !== photoId);
    await FireDB.deletePhoto(photoId);
    await persistCurrentInspection();
    await renderChecklistBody();
  }

  $("#btnSaveChecklistDraft").addEventListener("click", async () => {
    currentInspection.overallNote = $("#inspOverallNote").value;
    await persistCurrentInspection();
    if (currentSiteId) openSiteDetail(currentSiteId);
    else { renderSites(); showScreen("screen-sites"); }
  });

  $("#btnBackFromChecklist").addEventListener("click", async () => {
    currentInspection.overallNote = $("#inspOverallNote").value;
    await persistCurrentInspection();
    if (currentSiteId) openSiteDetail(currentSiteId);
    else { renderSites(); showScreen("screen-sites"); }
  });

  $("#btnViewSiteInfo").addEventListener("click", async () => {
    currentInspection.overallNote = $("#inspOverallNote").value;
    await persistCurrentInspection();
    await openSiteDetail(currentInspection.siteId);
  });

  $("#btnCompleteInspection").addEventListener("click", async () => {
    currentInspection.overallNote = $("#inspOverallNote").value;
    const missing = currentInspection.checklist.filter((i) => !i.result).length;
    if (missing > 0) {
      const ok = await confirmDialog(`${missing}개 항목이 미입력 상태입니다. 그래도 점검을 완료 처리할까요?`);
      if (!ok) return;
    }
    await FireDB.updateInspection(currentInspection.id, {
      checklist: currentInspection.checklist,
      overallNote: currentInspection.overallNote,
      status: "completed",
      completedDate: todayISO()
    });
    openReport(currentInspection.id);
  });

  // ================= 보고서 =================
  async function openReport(id) {
    revokeObjectUrls();
    const insp = await FireDB.getInspection(id);
    const site = await FireDB.getSite(insp.siteId);
    const photos = await FireDB.getPhotosByInspection(id);
    const photoMap = new Map(photos.map((p) => [p.id, p]));
    currentInspection = insp;

    const groups = {};
    insp.checklist.forEach((item) => { (groups[item.category] = groups[item.category] || []).push(item); });

    let groupsHtml = "";
    for (const category of Object.keys(groups)) {
      groupsHtml += `<div class="report-group"><h3>${escapeHtml(category)}</h3>`;
      for (const item of groups[category]) {
        const photosHtml = item.photoIds.map((pid) => {
          const p = photoMap.get(pid);
          if (!p) return "";
          const url = URL.createObjectURL(p.blob);
          activeObjectUrls.push(url);
          return `<img src="${url}">`;
        }).join("");
        groupsHtml += `
          <div class="report-item">
            <div class="report-item-top">
              <span>${escapeHtml(item.name)}</span>
              <span class="badge badge-${item.result === "불량" ? "overdue" : item.result === "양호" ? "completed" : "scheduled"}">${escapeHtml(item.result || "미입력")}</span>
            </div>
            ${item.note ? `<div class="report-item-note">${escapeHtml(item.note)}</div>` : ""}
            ${photosHtml ? `<div class="report-item-photos">${photosHtml}</div>` : ""}
          </div>
        `;
      }
      groupsHtml += `</div>`;
    }

    $("#reportContent").innerHTML = `
      <div class="report-header">
        <h2>소방시설 자체점검 결과 보고서</h2>
        <div class="sub">${escapeHtml(insp.type)}</div>
      </div>
      <div class="report-meta">
        <div class="report-meta-row"><span class="label">현장명</span><span>${escapeHtml(site ? site.name : "-")}</span></div>
        <div class="report-meta-row"><span class="label">주소</span><span>${escapeHtml(site ? site.address || "-" : "-")}</span></div>
        <div class="report-meta-row"><span class="label">건물 용도</span><span>${escapeHtml(site ? site.buildingType || "-" : "-")}</span></div>
        <div class="report-meta-row"><span class="label">점검일</span><span>${escapeHtml(insp.completedDate || insp.scheduledDate || "-")}</span></div>
        <div class="report-meta-row"><span class="label">점검자</span><span>${escapeHtml(insp.inspector || "-")}</span></div>
      </div>
      ${groupsHtml}
      ${insp.overallNote ? `<h3 style="font-size:14px;color:var(--accent-light);margin:0 0 8px;">종합 소견</h3><div class="report-overall">${escapeHtml(insp.overallNote)}</div>` : ""}
    `;
    showScreen("screen-report");
  }

  $("#btnBackFromReport").addEventListener("click", () => {
    if (currentSiteId) openSiteDetail(currentSiteId);
    else { renderSites(); showScreen("screen-sites"); }
  });

  $("#btnPrintReport").addEventListener("click", () => window.print());

  $("#btnShareReport").addEventListener("click", async () => {
    const insp = currentInspection;
    const site = await FireDB.getSite(insp.siteId);
    const text = `[소방시설 자체점검 결과 보고서]\n현장: ${site ? site.name : ""}\n종류: ${insp.type}\n점검일: ${insp.completedDate || insp.scheduledDate}\n점검자: ${insp.inspector || "-"}`;
    if (navigator.share) {
      try { await navigator.share({ title: "소방점검 보고서", text }); } catch (e) { /* 사용자 취소 */ }
    } else if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      toast("보고서 요약이 클립보드에 복사되었습니다. '인쇄 / PDF 저장' 버튼으로 상세 보고서를 저장할 수 있습니다.");
    }
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
      resolvedDate: null,
      createdAt: new Date().toISOString()
    };
  }

  // ---------- 지적사항 허브 (현장별) ----------
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
          <span>이행완료${def.resolvedDate ? " (" + escapeHtml(def.resolvedDate) + ")" : ""}</span>
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
    def.resolvedDate = checked ? todayISO() : null;
    await FireDB.updateDeficiency(def.id, { resolved: def.resolved, resolvedDate: def.resolvedDate });
    await renderDeficiencies();
  }

  async function onDeficiencyPhotoSelected(defId, role, files) {
    if (!files || files.length === 0) return;
    const def = findDeficiency(defId);
    const targetArr = role === "before" ? def.beforePhotoIds : def.afterPhotoIds;
    for (const file of files) {
      const photo = await FireDB.addPhoto({
        siteId: currentDeficiencySiteId,
        itemId: def.id,
        role,
        blob: file,
        createdAt: new Date().toISOString()
      });
      targetArr.push(photo.id);
    }
    await FireDB.updateDeficiency(def.id, { beforePhotoIds: def.beforePhotoIds, afterPhotoIds: def.afterPhotoIds });
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

  $("#btnGoToDeficiencies").addEventListener("click", async () => {
    currentInspection.overallNote = $("#inspOverallNote").value;
    await persistCurrentInspection();
    await openSiteDeficiencies(currentInspection.siteId);
  });

  $("#btnGoToDeficienciesFromReport").addEventListener("click", async () => {
    await openSiteDeficiencies(currentInspection.siteId);
  });

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
    const ext = file.name.split(".").pop().toLowerCase();
    try {
      let rows = null;
      let lowConfidence = false;
      let typeLabel = "";
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
        toast("지원하지 않는 파일 형식입니다 (.xlsx, .docx, .pdf만 가능).", "error");
        return;
      }
      if (!rows || rows.length === 0) {
        toast(`${typeLabel}에서 지적사항 표를 인식하지 못했습니다. 다른 파일을 이용하거나 직접 입력해주세요.`, "error");
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

  async function openCompletionReport() {
    revokeObjectUrls();
    const site = await FireDB.getSite(currentDeficiencySiteId);
    const resolved = currentDeficiencies.filter((d) => d.resolved);
    const dates = resolved.map((d) => d.resolvedDate).filter(Boolean).sort();
    const dateRange = dates.length ? (dates[0] === dates[dates.length - 1] ? dates[0] : `${dates[0]} ~ ${dates[dates.length - 1]}`) : "-";

    const photos = await FireDB.getPhotosBySite(currentDeficiencySiteId);
    const photoMap = new Map(photos.map((p) => [p.id, p]));

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

    const rowsHtml = resolved.map((def) => `
      <tr>
        <td class="completion-loc">
          <strong>${escapeHtml([def.floor, def.location].filter(Boolean).join(" "))}</strong>
          ${def.code ? `<div class="report-item-note">점검번호: ${escapeHtml(def.code)}</div>` : ""}
          <div class="report-item-note">${escapeHtml(def.description)}</div>
        </td>
        <td class="completion-photo-cell">${photoCellHtml(def, "before")}</td>
        <td class="completion-photo-cell">${photoCellHtml(def, "after")}</td>
      </tr>
    `).join("");

    $("#completionReportContent").innerHTML = `
      <div class="report-header">
        <h2>소방시설등의 자체점검 결과 이행완료 보고서</h2>
        <div class="sub">${escapeHtml(site ? site.name : "")}</div>
      </div>
      <div class="report-meta">
        <div class="report-meta-row"><span class="label">대상물 명칭</span><span>${escapeHtml(site ? site.name : "-")}</span></div>
        <div class="report-meta-row"><span class="label">대상물 구분</span><span>${escapeHtml(site ? site.buildingType || "-" : "-")}</span></div>
        <div class="report-meta-row"><span class="label">소재지</span><span>${escapeHtml(site ? site.address || "-" : "-")}</span></div>
        <div class="report-meta-row"><span class="label">관계인</span><span>${escapeHtml(site ? site.contactName || "-" : "-")} ${site && site.contactPhone ? "(" + escapeHtml(site.contactPhone) + ")" : ""}</span></div>
        <div class="report-meta-row"><span class="label">이행조치 일자</span><span>${escapeHtml(dateRange)}</span></div>
      </div>
      <table class="completion-table">
        <thead>
          <tr><th class="completion-loc">위치 / 지적내용</th><th>이행 전</th><th>이행 후</th></tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    `;
    showScreen("screen-completion-report");
  }

  $("#btnBackFromCompletionReport").addEventListener("click", async () => {
    await renderDeficiencies();
    showScreen("screen-deficiencies");
  });

  $("#btnPrintCompletionReport").addEventListener("click", () => window.print());

  $("#btnShareCompletionReport").addEventListener("click", async () => {
    const site = await FireDB.getSite(currentDeficiencySiteId);
    const text = `[소방시설등의 자체점검 결과 이행완료 보고서]\n현장: ${site ? site.name : ""}`;
    if (navigator.share) {
      try { await navigator.share({ title: "이행완료 보고서", text }); } catch (e) { /* 사용자 취소 */ }
    } else if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      toast("보고서 요약이 클립보드에 복사되었습니다. '인쇄 / PDF 저장' 버튼으로 상세 보고서를 저장할 수 있습니다.");
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
  }

  $("#btnSaveApiKeys").addEventListener("click", () => {
    BldReg.saveKeys({
      jusoKey: $("#jusoApiKey").value.trim(),
      dataGoKrKey: $("#dataGoKrApiKey").value.trim()
    });
    toast("API 키가 저장되었습니다.");
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

  // ================= 초기화 =================
  $("#categoryList").innerHTML = ChecklistTemplate.map((g) => `<option value="${escapeHtml(g.category)}">`).join("");
  renderSites();
  showScreen("screen-home");
})();
