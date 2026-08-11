// 거래처(현장) 등록 정보 자동 인식 - 엑셀 / 워드 / PDF / 한글(HWP) / 사진(OCR)에서
// 거래처명, 주소, 담당자, 소방안전관리자, 담당기사 정보를 추출 시도.
// 표/문서 형식이 제각각이라 100% 정확하지 않을 수 있음 - 항상 사용자가 확인/수정하는 것을 전제로 함(직접입력 폼에 채워서 보여줌).
const ClientImport = (() => {

  // 필드별 라벨 후보(구체적인 것부터). 같은 줄/칸에서 라벨 매칭 시 문자열 길이가 긴 것부터 우선 시도.
  const FIELD_LABELS = [
    { field: "fireManagerAppointDate", labels: ["소방안전관리자 선임일자", "소방안전관리자선임일자", "선임일자", "선임년월일", "선임일"] },
    { field: "fireManagerEduDate", labels: ["소방안전관리자 실무교육일자", "실무교육일자", "교육일자", "이수일자", "교육일"] },
    { field: "fireManagerPhone", labels: ["소방안전관리자 연락처", "소방안전관리자 전화번호", "소방안전관리자 휴대폰", "안전관리자 연락처"] },
    { field: "fireManagerName", labels: ["소방안전관리자 성명", "소방안전관리자명", "소방안전관리자", "안전관리자 성명", "안전관리자명", "안전관리자"] },
    { field: "engineerPhone", labels: ["담당기사 연락처", "관리기사 연락처", "담당기사 전화번호"] },
    { field: "engineerName", labels: ["담당기사 성명", "담당기사명", "담당기사", "관리기사 성명", "관리기사"] },
    { field: "contactPhone", labels: ["담당자 연락처", "담당자 전화번호", "담당자 휴대폰", "관계인 연락처", "연락처", "휴대전화", "휴대폰", "전화번호", "전화"] },
    { field: "contactName", labels: ["담당자 성명", "담당자명", "담당자", "관계인 성명", "관계인"] },
    { field: "address", labels: ["도로명주소", "소재지 주소", "소재지", "주소"] },
    { field: "name", labels: ["거래처명", "현장명", "업체명", "상호명", "대상물명", "건물명", "명칭(상호)", "상호", "명칭"] }
  ];

  const SORTED_LABELS = FIELD_LABELS
    .flatMap(({ field, labels }) => labels.map((label) => ({ field, label })))
    .sort((a, b) => b.label.length - a.label.length);

  // 라벨과 값이 표에서 여러 칸/줄로 떨어져 나오는 정부 서식 PDF 특성상 건너뛰어야 할 잡음.
  const SKIP_TOKENS = ["대상물", "구분", "용도", "성명", "전화번호", "점검자", "점검기간", "특정소방", "점검인력", "점검참여일", "점검일수", "송달", "동의", "관계인", "전자우편", "시설"];
  // 값이 여러 칸에 걸쳐 이어지는 경우(도로명 + 번지 + 동, 회사명 + 지점명 등)를 허용할 필드와 이어붙일 때 쓸 구분자.
  const MULTI_CELL_FIELDS = ["address", "name"];
  const MULTI_CELL_JOIN = { address: " ", name: "" };
  // "2.건축물 정보"가 아닌 표지의 "대상물 구분(용도)" 칸에서 건물 용도를 찾을 때 기준으로 삼는
  // 건축법 시행령상 표준 용도 분류 키워드(문서마다 표현이 조금씩 달라도 이 단어들은 대체로 그대로 나옴).
  const BUILDING_TYPE_CATEGORIES = ["근린생활시설", "공동주택", "단독주택", "업무시설", "숙박시설", "판매시설", "의료시설", "교육연구시설", "노유자시설", "수련시설", "운동시설", "위락시설", "창고시설", "위험물저장", "자동차관련시설", "동식물관련시설", "자원순환", "교정및군사시설", "방송통신시설", "발전시설", "묘지관련시설", "관광휴게시설", "장례시설", "야영장시설", "문화및집회시설", "종교시설", "공장", "지하가"];
  // 한 칸/줄에 역할명이 2개 이상 섞여있는 경우(예: "소방시설관리업자ㆍ소방안전관리자ㆍ관계인 : 도득현" 서명란) -
  // 실제로는 한 사람이 여러 역할을 겸하는 경우가 많으므로, 이름을 찾으면 해당되는 모든 역할 필드에 채운다.
  const ROLE_TO_FIELD = { "소방안전관리자": "fireManagerName", "관계인": "contactName", "담당기사": "engineerName" };
  const ROLE_MARKERS = Object.keys(ROLE_TO_FIELD).concat(["소방시설관리업자"]);
  const NAME_FIELDS = ["fireManagerName", "engineerName", "contactName"];

  const PHONE_RE = /01[016789]-?\d{3,4}-?\d{4}|0\d{1,2}-?\d{3,4}-?\d{4}/;

  // 소방시설 자체점검 실시결과 보고서(1.소방안전정보) 특유의 "성명 ○○○, 전화번호 010-...." 인라인 패턴.
  // 이 서식엔 이 패턴이 보통 2번 나옴: 관계인(대표자/소유자/관리자/점유자 체크박스와 같이 나옴) 1번,
  // 소방안전관리자(체크박스 없이 성명/전화번호/교육이수일만 나옴) 1번 - 전자는 대표자/소유자/점유자 표기로 구분.
  const NAME_PHONE_RE = /성명\s*[:：]?\s*([가-힣][가-힣\s]{0,8}[가-힣])\s*[:,：]*\s*전화번호\s*[:：]?\s*(01[016789]-?\d{2,4}-?\d{4})/;
  const RELATED_PERSON_MARKERS = ["대표자", "소유자", "점유자"];
  // 같은 줄에 같이 나오는 경우가 많은 "최근 교육이수일" (소방안전관리자 항목에만 해당).
  const EDU_DATE_RE = /최근\s*교육이수일\s*[:：]?\s*(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/;
  // "2.건축물 정보" 섹션(사용승인일/연면적/층수) - 건축물대장 조회가 실패하거나 아직 조회 전일 때의 대체 출처.
  // 건축물대장 조회가 성공하면 항상 그 값으로 덮어써지므로(최종 기준), 여기서는 보조적으로만 채운다.
  const REPORT_APPROVAL_DATE_RE = /사용승인일\s*(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/;
  const REPORT_AREA_RE = /연\s*면\s*적\s*([\d,]+\.?\d*)\s*㎡/;
  const REPORT_FLOOR_RE = /층수\s*(?:지상\s*(\d+)\s*층)?\s*\/?\s*(?:지하\s*(\d+)\s*층)?/;

  function normalizeDate(v) {
    if (!v) return v;
    const m = v.match(/(\d{4})\s*[.\-\/년]\s*(\d{1,2})\s*[.\-\/월]\s*(\d{1,2})/);
    if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    return v;
  }

  function cleanValue(v) {
    return v.replace(/^[\s:：\-,·]+/, "").replace(/[\s,·]+$/, "").trim().slice(0, 80);
  }

  function normTight(s) {
    return (s || "").replace(/[\s()]/g, "");
  }

  function isSkippableCell(text) {
    const norm = normTight(text);
    if (!norm) return true;
    if (/^[\[\]√○●×\-~,.:：·]+$/.test(norm)) return true;
    return SKIP_TOKENS.some((t) => norm.includes(t));
  }

  function isBoundary(text) {
    return text.trim().startsWith("[") || text.includes("[");
  }

  function roleMarkersIn(text) {
    const norm = normTight(text);
    return ROLE_MARKERS.filter((m) => norm.includes(m));
  }

  function looksLikeAnotherLabel(text) {
    const norm = normTight(text);
    return SORTED_LABELS.some(({ label }) => {
      const ln = normTight(label);
      return ln.length >= 2 && norm.includes(ln);
    });
  }

  // 값 후보 앞부분에서 한글 이름처럼 보이는 부분만 뽑아낸다 - "(서명 또는 인)" 같은 꼬리표가 붙어있어도
  // 이름 자체는 정상 추출하되, 체크박스/자격목록처럼 애초에 이름이 아닌 값은 걸러낸다.
  function extractPersonName(v) {
    const compact = v.replace(/\s/g, "");
    const m = compact.match(/^[가-힣]{2,6}/);
    return m ? m[0] : null;
  }

  // 표(rows)에서 라벨 칸을 찾고, 뒤따르는 칸들 중 첫 실질 내용 칸을 값으로 채택.
  // 정부 서식 PDF는 라벨과 값이 같은 줄/칸이 아니라 표 구조상 여러 칸 떨어져 나오는 경우가 많아
  // 단순 "같은 줄" 매칭 대신 칸 단위로 순서대로 훑으며 체크박스/구획 경계를 건너뛴다.
  function findValueCellAfter(flat, i) {
    for (let j = i + 1; j < Math.min(i + 8, flat.length); j++) {
      if (isBoundary(flat[j].text)) break;
      if (isSkippableCell(flat[j].text)) continue;
      if (looksLikeAnotherLabel(flat[j].text)) break;
      return j;
    }
    return -1;
  }

  function extractFieldsFromCells(rows, result) {
    if (!rows) return;
    const flat = [];
    rows.forEach((row, rowIdx) => {
      (row || []).forEach((c) => {
        const text = c == null ? "" : String(c).trim();
        if (text) flat.push({ text, rowIdx });
      });
    });
    for (let i = 0; i < flat.length; i++) {
      const norm = normTight(flat[i].text);
      if (!norm) continue;

      const roles = roleMarkersIn(flat[i].text);
      if (roles.length >= 2) {
        const anchorIdx = findValueCellAfter(flat, i);
        if (anchorIdx !== -1) {
          const nm = extractPersonName(flat[anchorIdx].text.trim());
          if (nm) roles.forEach((r) => { const f = ROLE_TO_FIELD[r]; if (f && !result[f]) result[f] = nm; });
        }
        continue;
      }

      for (const { field, label } of SORTED_LABELS) {
        if (result[field]) continue;
        const labelNorm = normTight(label);
        if (!norm.includes(labelNorm)) continue;
        const anchorIdx = findValueCellAfter(flat, i);
        if (anchorIdx === -1) continue;
        let value = flat[anchorIdx].text.trim();
        if (MULTI_CELL_FIELDS.includes(field)) {
          const anchorRow = flat[anchorIdx].rowIdx;
          const joinSep = MULTI_CELL_JOIN[field] != null ? MULTI_CELL_JOIN[field] : " ";
          const parts = [value];
          let k = anchorIdx + 1;
          while (k < flat.length && flat[k].rowIdx === anchorRow && parts.join(joinSep).length < 60) {
            if (isBoundary(flat[k].text) || looksLikeAnotherLabel(flat[k].text)) break;
            const n2 = normTight(flat[k].text);
            if (n2 && SKIP_TOKENS.some((t) => n2.includes(t))) break;
            parts.push(flat[k].text.trim());
            k++;
          }
          value = parts.join(joinSep).replace(/\s+([),.])/g, "$1").replace(/\(\s+/g, "(").trim();
        }
        value = cleanValue(value);
        if (NAME_FIELDS.includes(field)) {
          const nm = extractPersonName(value);
          if (!nm) continue;
          value = nm;
        }
        if (value) result[field] = value;
      }
    }
  }

  // 표가 아닌 줄글(워드 문단, HWP 미리보기 텍스트)에서 "라벨: 값" 형태를 같은 줄 안에서 인식.
  function extractFieldsFromLine(line, result) {
    if (!line || !line.trim()) return;

    const roles = roleMarkersIn(line);
    if (roles.length >= 2) {
      // "관계인 도득현 (서명 또는 인)"처럼 역할명 여러 개 + 이름이 한 줄에 같이 나오는 서명란
      const rolePattern = roles.map((r) => r.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
      const afterRoles = cleanValue(line.replace(new RegExp(rolePattern, "g"), " "));
      const nm = extractPersonName(afterRoles);
      if (nm) roles.forEach((r) => { const f = ROLE_TO_FIELD[r]; if (f && !result[f]) result[f] = nm; });
      return;
    }

    const matches = [];
    for (const { field, label } of SORTED_LABELS) {
      const idx = line.indexOf(label);
      if (idx === -1) continue;
      matches.push({ field, label, idx, end: idx + label.length });
    }
    if (matches.length === 0) return;
    matches.sort((a, b) => a.idx - b.idx);
    const filtered = [];
    for (const m of matches) {
      const overlap = filtered.find((f) => m.idx >= f.idx && m.idx < f.end);
      if (!overlap) filtered.push(m);
    }
    for (let i = 0; i < filtered.length; i++) {
      const m = filtered[i];
      const next = filtered[i + 1];
      let value = cleanValue(line.slice(m.end, next ? next.idx : line.length));
      if (NAME_FIELDS.includes(m.field)) {
        const nm = extractPersonName(value);
        if (!nm) continue;
        value = nm;
      }
      if (value && !result[m.field]) result[m.field] = value;
    }
  }

  // "성명:X,전화번호:Y" 인라인 패턴을 줄 단위로 찾아 관계인/소방안전관리자를 구분해 채운다.
  // 뒤에 나오는 약한 신호(체크박스 서명란 등)보다 신뢰도가 높으므로 항상 먼저 실행해 우선순위를 갖는다.
  function extractNamePhonePairs(lines, result) {
    lines.forEach((line) => {
      const m = line.match(NAME_PHONE_RE);
      if (!m) return;
      const name = m[1].replace(/\s/g, "");
      const phone = m[2];
      const isRelatedPerson = RELATED_PERSON_MARKERS.some((k) => line.includes(k));
      if (isRelatedPerson) {
        if (!result.contactName) result.contactName = name;
        if (!result.contactPhone) result.contactPhone = phone;
      } else {
        if (!result.fireManagerName) result.fireManagerName = name;
        if (!result.fireManagerPhone) result.fireManagerPhone = phone;
        const eduMatch = line.match(EDU_DATE_RE);
        if (eduMatch && !result.fireManagerEduDate) {
          result.fireManagerEduDate = `${eduMatch[1]}-${eduMatch[2].padStart(2, "0")}-${eduMatch[3].padStart(2, "0")}`;
        }
      }
    });
  }

  // "◦설치장소:동명(본관) [√ 지상]/[ ]지하( 1 )층 실명(복도)" 형태의 위치 표기를 "본관 지상 1층 복도"로 요약.
  // 전각(全角) 숫자(０-９)를 일반 숫자로 변환 - PDF 추출 시 가끔 전각으로 나옴.
  function normalizeDigits(v) {
    return (v || "").replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFF10 + 0x30));
  }

  function parseLocationFragment(joined) {
    const dong = (joined.match(/동명\s*\(([^)]*)\)/) || [])[1];
    // 체크(√) 표기가 "[√ 지상]"(괄호 안)과 "[ ]√지하"(괄호 뒤) 두 형식 모두 나오므로 괄호 위치에 상관없이 인식.
    const isGround = /√[^가-힣]{0,4}지상/.test(joined);
    const isBasement = /√[^가-힣]{0,4}지하/.test(joined);
    const floorSide = isGround ? "지상" : (isBasement ? "지하" : null);
    const floorNum = normalizeDigits((joined.match(/\(\s*([^)]*?)\s*\)\s*층/) || [])[1]);
    const room = (joined.match(/실명\s*\(([^)]*)\)/) || [])[1];
    const parts = [];
    if (dong && dong.trim()) parts.push(dong.trim());
    if (floorSide && floorNum && floorNum.trim()) parts.push(`${floorSide} ${floorNum.trim()}층`);
    if (room && room.trim()) parts.push(room.trim());
    return parts.join(" ").trim();
  }

  // 점검표의 "주된수원" 설치장소 -> 펌프실 위치, "경보설비" 안의 (채워진) 수신기 위치 -> 수신기 위치로 가져온다.
  // 실시결과보고서의 상세 점검표에서만 나오는 항목이라 rows(표) 데이터가 있을 때만 시도한다.
  function extractEquipmentLocations(joinedRows, result) {
    if (!joinedRows || joinedRows.length === 0) return;

    const pumpIdx = joinedRows.findIndex((j) => j.includes("주된") && j.includes("수원"));
    if (pumpIdx !== -1) {
      for (let i = pumpIdx; i < Math.min(pumpIdx + 6, joinedRows.length); i++) {
        if (joinedRows[i].includes("설치장소")) {
          const loc = parseLocationFragment(joinedRows[i]);
          if (loc && !result.pumpRoomLocation) result.pumpRoomLocation = loc;
          break;
        }
      }
    }

    // "경보설비"라는 단어 자체는 점검표 다른 항목(예: 비상경보설비 체크박스)에도 등장하므로,
    // 반드시 "3-5.경보설비"처럼 번호가 붙은 실제 섹션 제목 행에서만 시작한다.
    const alarmIdx = joinedRows.findIndex((j) => /^\d+-\d+\.\s*경보설비/.test(j.trim()));
    if (alarmIdx !== -1) {
      const alarmEnd = Math.min(alarmIdx + 150, joinedRows.length);
      for (let i = alarmIdx; i < alarmEnd; i++) {
        if (joinedRows[i].includes("수신기") && joinedRows[i].includes("위치")) {
          const loc = parseLocationFragment(joinedRows[i]);
          if (loc) { result.receiverLocation = loc; break; }
        }
      }
    }
  }

  // "2.건축물 정보" 섹션에서 사용승인일/연면적/층수를 가져온다 - 건축물대장 조회가 실패했거나
  // 아직 조회하지 않은 상태에서도 값이 비어있지 않도록 하는 보조 출처(조회가 성공하면 그 값으로 항상 덮어써짐).
  function extractBuildingInfoFromReport(joinedRows, result) {
    const fullText = joinedRows.join("\n");
    const approvalMatch = fullText.match(REPORT_APPROVAL_DATE_RE);
    if (approvalMatch && !result.approvalDate) {
      result.approvalDate = `${approvalMatch[1]}-${approvalMatch[2].padStart(2, "0")}-${approvalMatch[3].padStart(2, "0")}`;
    }
    const areaMatch = fullText.match(REPORT_AREA_RE);
    if (areaMatch && !result.area) {
      result.area = normalizeDigits(areaMatch[1]).replace(/,/g, "");
    }
    const floorMatch = fullText.match(REPORT_FLOOR_RE);
    if (floorMatch && (floorMatch[1] || floorMatch[2]) && !result.floorInfo) {
      result.floorInfo = [
        floorMatch[1] ? `지상 ${normalizeDigits(floorMatch[1])}층` : "",
        floorMatch[2] ? `지하 ${normalizeDigits(floorMatch[2])}층` : ""
      ].filter(Boolean).join(" / ");
    }
  }

  // 표지의 "대상물 구분(용도)" 칸에서 건물 용도를 가져온다 - 건축물대장 조회가 실패했거나
  // 아직 조회 전일 때의 대체 출처(연면적/사용승인일/층수와 같은 성격, 조회 성공 시 항상 그 값으로 덮어써짐).
  // 문서 앞부분(표지)에서만 의미가 있으므로 뒤쪽 점검표에서 같은 단어가 또 나와도 잘못 걸리지 않도록 처음 10줄만 본다.
  function extractBuildingTypeFromReport(rows, result) {
    if (!rows || result.buildingType) return;
    const searchEnd = Math.min(10, rows.length);
    for (let i = 0; i < searchEnd; i++) {
      for (const cell of (rows[i] || [])) {
        const text = (cell == null ? "" : String(cell));
        const cat = BUILDING_TYPE_CATEGORIES.find((c) => text.includes(c));
        if (cat) {
          const value = text.replace(/^[,\s]+/, "").replace(/\($/, "").trim();
          if (value) { result.buildingType = value.slice(0, 40); return; }
        }
      }
    }
  }

  function extractFields(text, rows) {
    const result = {};

    // 신뢰도가 가장 높은 "성명:X,전화번호:Y" 인라인 패턴을 먼저 시도해 우선순위를 갖게 한다.
    const lines = [];
    if (rows) rows.forEach((row) => lines.push((row || []).join("")));
    if (text) text.split(/\r?\n/).forEach((l) => { if (l.trim()) lines.push(l.trim()); });
    extractNamePhonePairs(lines, result);

    // 표 구조 데이터는 칸 단위 탐색이 더 정확하므로 다음으로 시도.
    extractFieldsFromCells(rows, result);
    if (rows) {
      extractBuildingTypeFromReport(rows, result);
      const joinedRows = rows.map((row) => (row || []).join(""));
      extractEquipmentLocations(joinedRows, result);
      extractBuildingInfoFromReport(joinedRows, result);
    }

    // 줄글(워드 문단 등)은 같은 줄 "라벨: 값" 패턴으로 보완.
    if (text) {
      text.split(/\r?\n/).forEach((l) => { if (l.trim()) extractFieldsFromLine(l.trim(), result); });
    }

    ["contactPhone", "fireManagerPhone", "engineerPhone"].forEach((f) => {
      if (result[f]) {
        const m = result[f].match(PHONE_RE);
        if (m) result[f] = m[0];
        else delete result[f];
      }
    });
    ["fireManagerAppointDate", "fireManagerEduDate"].forEach((f) => {
      if (result[f]) result[f] = normalizeDate(result[f]);
    });
    return result;
  }

  // ---------- 파일 형식별 텍스트/표 추출 ----------

  async function excelToRows(file) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array", cellDates: true });
    const rows = [];
    wb.SheetNames.forEach((name) => {
      rows.push(...XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "" }));
    });
    return rows;
  }

  async function wordToTextAndRows(file) {
    const zip = await JSZip.loadAsync(file);
    const docXmlFile = zip.file("word/document.xml");
    if (!docXmlFile) return { text: "", rows: [] };
    const xmlText = await docXmlFile.async("text");
    const xmlDoc = new DOMParser().parseFromString(xmlText, "application/xml");
    const paras = Array.from(xmlDoc.getElementsByTagName("w:p"));
    const text = paras
      .map((p) => Array.from(p.getElementsByTagName("w:t")).map((t) => t.textContent).join(""))
      .join("\n");
    const rows = [];
    Array.from(xmlDoc.getElementsByTagName("w:tbl")).forEach((tbl) => {
      Array.from(tbl.getElementsByTagName("w:tr")).forEach((tr) => {
        rows.push(Array.from(tr.getElementsByTagName("w:tc")).map((tc) =>
          Array.from(tc.getElementsByTagName("w:t")).map((t) => t.textContent).join("")));
      });
    });
    return { text, rows };
  }

  async function pdfToRows(file) {
    // FireImport.extractPdfRows와 동일한 좌표 기반 줄 구성 로직 재사용
    return FireImport.extractPdfRows(file);
  }

  async function hwpToText(file) {
    // 정식 HWP 파서가 아닌 최선 노력(best-effort) 추출: HWP(비HWPX)는 OLE 복합문서 포맷이며
    // "PrvText"(미리보기 텍스트) 스트림은 압축 없이 UTF-16LE로 저장되어 있어 이를 직접 읽어봄.
    // 실패 시 빈 문자열 반환 -> 호출측에서 "인식 실패"로 처리하고 직접입력 안내.
    try {
      if (!window.XLSX || !XLSX.CFB) return "";
      const buf = await file.arrayBuffer();
      const cfb = XLSX.CFB.read(new Uint8Array(buf), { type: "array" });
      let entryIdx = -1;
      for (let i = 0; i < cfb.FullPaths.length; i++) {
        if (/(^|\/)PrvText$/.test(cfb.FullPaths[i])) { entryIdx = i; break; }
      }
      if (entryIdx === -1) return "";
      const entry = cfb.FileIndex[entryIdx];
      const raw = entry.content;
      if (!raw || !raw.length) return "";
      const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
      let str = "";
      for (let i = 0; i + 1 < bytes.length; i += 2) {
        str += String.fromCharCode(bytes[i] | (bytes[i + 1] << 8));
      }
      // PrvText는 문단/런마다 "<...>"로 감싸져 있어 한 줄에 라벨+값이 여러 개 붙어 나옴 -> "<"/">"를 줄바꿈으로 풀어서
      // "명칭(상호) 미소빌딩"처럼 한 항목이 한 줄이 되게 만들면 줄 단위 라벨:값 인식이 훨씬 정확해짐.
      return str.split(/[<>]/).map((s) => s.trim()).filter(Boolean).join("\n");
    } catch (e) {
      return "";
    }
  }

  let tesseractLoadPromise = null;
  function loadTesseract() {
    if (window.Tesseract) return Promise.resolve();
    if (tesseractLoadPromise) return tesseractLoadPromise;
    tesseractLoadPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("tesseract_load_failed"));
      document.head.appendChild(s);
    });
    return tesseractLoadPromise;
  }

  async function imageToText(file) {
    // 사진 속 글자 인식(OCR) - 최초 사용 시 라이브러리/언어 데이터를 인터넷에서 내려받아 다소 시간이 걸릴 수 있음.
    await loadTesseract();
    if (!window.Tesseract) return "";
    const { data } = await Tesseract.recognize(file, "kor+eng");
    return (data && data.text) || "";
  }

  // ---------- 통합 진입점 ----------
  async function parseClientFile(file) {
    const ext = file.name.split(".").pop().toLowerCase();
    let text = "", rows = null, lowConfidence = false, typeLabel = "";

    if (ext === "xlsx" || ext === "xls") {
      typeLabel = "엑셀";
      rows = await excelToRows(file);
    } else if (ext === "docx") {
      typeLabel = "워드 문서";
      const r = await wordToTextAndRows(file);
      text = r.text; rows = r.rows;
    } else if (ext === "pdf") {
      typeLabel = "PDF";
      const r = await pdfToRows(file);
      rows = r.rows;
      lowConfidence = r.lowConfidence;
    } else if (ext === "hwp") {
      typeLabel = "한글(HWP)";
      lowConfidence = true;
      text = await hwpToText(file);
      if (!text) return { fields: {}, typeLabel, lowConfidence: true, failed: true };
    } else if (["jpg", "jpeg", "png", "webp", "bmp"].includes(ext)) {
      typeLabel = "사진(OCR)";
      lowConfidence = true;
      text = await imageToText(file);
      if (!text || !text.trim()) return { fields: {}, typeLabel, lowConfidence: true, failed: true };
    } else {
      return { fields: {}, typeLabel: "", lowConfidence: false, unsupported: true };
    }

    const fields = extractFields(text, rows);
    const failed = Object.keys(fields).length === 0;
    return { fields, typeLabel, lowConfidence, failed };
  }

  return { parseClientFile, extractFields };
})();
