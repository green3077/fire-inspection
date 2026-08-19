// 업로드 파일(PDF/엑셀/워드/한글/HWPX/사진)을 Gemini AI로 분석해 폼 입력칸에 자동으로 채워주는 모듈.
// 실제 Gemini API 키는 이 기기/앱에 전혀 없음 - [[project_cigar_log]]가 이미 사용 중인 공유 Cloudflare Worker
// 프록시(cigar-log-gemini-proxy)를 그대로 호출한다. 별도 키 입력/비밀번호 없이 항상 동작한다.
// 호출이 실패하면 호출부(app.js)가 기존 정규식 기반 파서로 자동 폴백한다.
const AiFill = (() => {
  const ENABLED_STORAGE = "fireInspectionAiEnabled";
  const PROXY_BASE = "https://cigar-log-gemini-proxy.cigar-log-gemini-proxy.workers.dev";
  const GEMINI_MODELS = ["gemini-3.6-flash", "gemini-2.5-flash", "gemini-2.0-flash"];
  const geminiUrl = (model) => `${PROXY_BASE}/v1beta/models/${model}:generateContent`;
  const IMAGE_MEDIA_TYPES = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", bmp: "image/bmp", gif: "image/gif" };

  function isEnabled() {
    const v = localStorage.getItem(ENABLED_STORAGE);
    return v === null ? true : v === "1";
  }
  function setEnabled(on) {
    localStorage.setItem(ENABLED_STORAGE, on ? "1" : "0");
  }

  async function fileToBase64(file) {
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  function decodeXmlEntities(s) {
    return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  }

  // HWPX(신 한글 포맷, zip+XML)에서 본문 텍스트 추출 - Contents/section*.xml의 <hp:t> 런을 모두 이어붙임.
  async function hwpxToText(file) {
    const zip = await JSZip.loadAsync(file);
    const sectionNames = Object.keys(zip.files).filter((n) => /^Contents\/section\d+\.xml$/.test(n)).sort();
    const texts = [];
    for (const name of sectionNames) {
      const xml = await zip.file(name).async("text");
      const re = /<hp:t(?:\s[^>]*)?(?:\/>|>([\s\S]*?)<\/hp:t>)/g;
      let m;
      while ((m = re.exec(xml))) {
        if (m[1]) texts.push(decodeXmlEntities(m[1]));
      }
    }
    return texts.join("\n");
  }

  async function excelToText(file) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array", cellDates: true });
    return wb.SheetNames.map((name) => {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "" });
      return `[시트: ${name}]\n` + JSON.stringify(rows);
    }).join("\n\n");
  }

  async function wordToText(file) {
    const zip = await JSZip.loadAsync(file);
    const docXmlFile = zip.file("word/document.xml");
    if (!docXmlFile) return "";
    const xmlText = await docXmlFile.async("text");
    const xmlDoc = new DOMParser().parseFromString(xmlText, "application/xml");
    return Array.from(xmlDoc.getElementsByTagName("w:t")).map((t) => t.textContent).join(" ");
  }

  // 이 파일 형식을 이 함수가 다룰 수 있는지 (구 HWP 바이너리는 다루지 않음 - 호출부가 기존 폴백 경로로 넘어감).
  function isSupportedExt(ext) {
    return ["pdf", "xlsx", "xls", "docx", "hwpx"].includes(ext) || !!IMAGE_MEDIA_TYPES[ext];
  }

  // xlsx/docx/hwpx는 AI 호출 전에 미리 텍스트로 뽑아둔다 - 표/PDF/사진과 달리 이 텍스트는
  // detectSprinklerFromText로 AI 응답을 보완하는 데도 재사용된다.
  async function extractDocText(file, ext) {
    if (ext === "xlsx" || ext === "xls") return excelToText(file);
    if (ext === "docx") return wordToText(file);
    if (ext === "hwpx") return hwpxToText(file);
    return null;
  }

  async function buildParts(file, ext, instruction, docText) {
    if (ext === "pdf") {
      const data = await fileToBase64(file);
      return [{ inline_data: { mime_type: "application/pdf", data } }, { text: instruction }];
    }
    if (IMAGE_MEDIA_TYPES[ext]) {
      const data = await fileToBase64(file);
      return [{ inline_data: { mime_type: IMAGE_MEDIA_TYPES[ext], data } }, { text: instruction }];
    }
    if (!docText || !docText.trim()) return null;
    return [{ text: `${instruction}\n\n--- 문서 내용 ---\n${docText.slice(0, 60000)}` }];
  }

  // 소방시설 세부현황표 같은 문서는 "설비의 종류" 체크박스가 같은 페이지에 여러 번(가압송수장치별로)
  // 반복돼 표 구조가 사라진 평문 텍스트만 보고 훑는 AI가 스프링클러 체크 여부를 놓치는 경우가 있다.
  // "]" 바로 뒤(공백 허용)에 "스프링클러설비"가 붙어 있는 자리만 체크박스로 인정해 "간이스프링클러설비",
  // "화재조기진압용스프링클러설비", "포워터스프링클러설비" 같은 다른 설비명과는 구분한다.
  function detectSprinklerFromText(text) {
    const re = /\[([^\]]{0,4})\]\s*스프링클러설비/g;
    let m, foundAny = false, foundChecked = false;
    while ((m = re.exec(text))) {
      foundAny = true;
      if (/[√✓]/.test(m[1])) foundChecked = true;
    }
    if (!foundAny) return "";
    return foundChecked ? "예" : "아니오";
  }

  // 우리 쪽 JSON 스키마(소문자 type)를 Gemini의 responseSchema 형식(대문자 Type)으로 변환.
  function toGeminiSchema(schema) {
    if (schema.type === "object") {
      return {
        type: "OBJECT",
        properties: Object.fromEntries(Object.entries(schema.properties).map(([k, v]) => [k, toGeminiSchema(v)])),
        required: schema.required
      };
    }
    if (schema.type === "array") {
      return { type: "ARRAY", items: toGeminiSchema(schema.items) };
    }
    return { type: schema.type.toUpperCase(), description: schema.description };
  }

  function friendlyError(body) {
    try {
      const j = JSON.parse(body);
      return j?.error?.message || body.slice(0, 240);
    } catch {
      return body.slice(0, 240);
    }
  }

  function extractJson(text) {
    try {
      return JSON.parse(text);
    } catch {
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      if (start === -1 || end === -1) throw new Error("gemini_no_json");
      return JSON.parse(text.slice(start, end + 1));
    }
  }

  async function callGemini({ system, parts, schema, maxTokens }) {
    const body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: toGeminiSchema(schema),
        temperature: 0.1,
        maxOutputTokens: maxTokens,
        // gemini-3.6-flash는 기본적으로 "생각" 단계를 거쳐 30초 이상 걸릴 수 있다 - 낮은 예산으로
        // 제한해서 예전 2.0/2.5-flash 수준의 응답 속도(1~3초)를 유지한다(0은 이 모델에서 400 에러).
        thinkingConfig: { thinkingBudget: 512 }
      }
    };
    let last = null;
    for (const model of GEMINI_MODELS) {
      const res = await fetch(geminiUrl(model), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      last = { res, model };
      if (![400, 404].includes(res.status)) break;
    }
    const { res, model } = last;
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`gemini_api_${res.status}_${model}: ${friendlyError(errText)}`);
    }
    const data = await res.json();
    const candidate = data?.candidates?.[0];
    if (!candidate) {
      const blockReason = data?.promptFeedback?.blockReason;
      throw new Error(blockReason ? `gemini_blocked_${blockReason}` : "gemini_no_candidate");
    }
    const text = (candidate.content?.parts || []).map((p) => p.text || "").join("");
    if (!text) throw new Error("gemini_no_text");
    return extractJson(text);
  }

  const CLIENT_FIELD_DESCRIPTIONS = {
    name: "거래처명(현장명, 건물명, 상호)",
    address: "소재지 주소 (도로명주소 우선)",
    contactName: "담당자/관계인 성명",
    contactPhone: "담당자/관계인 전화번호, 000-0000-0000 형식",
    fireManagerName: "소방안전관리자 성명",
    fireManagerPhone: "소방안전관리자 전화번호, 000-0000-0000 형식",
    fireManagerAppointDate: "소방안전관리자 선임일자, YYYY-MM-DD 형식",
    fireManagerEduDate: "소방안전관리자 실무교육(최근 교육이수)일자, YYYY-MM-DD 형식",
    engineerName: "담당기사 성명",
    engineerPhone: "담당기사 전화번호, 000-0000-0000 형식",
    receiverLocation: "수신기(자동화재탐지설비) 설치 위치",
    pumpRoomLocation: "펌프실(주된 수원) 설치 위치",
    area: "연면적 (숫자만, 단위 ㎡ 제외)",
    approvalDate: "건축물 사용승인일, YYYY-MM-DD 형식",
    floorInfo: "층수 정보, 예: 지상 5층 / 지하 1층",
    buildingType: "건물 용도/구분",
    sprinklerInstalled: "소화설비 점검표에서 스프링클러설비가 설치되어 있고 점검(대상)으로 체크되어 있으면 \"예\", 스프링클러설비가 없거나 미설치/해당없음으로 표시되어 있으면 \"아니오\", 문서에서 판단할 수 없으면 빈 문자열"
  };

  const CLIENT_SCHEMA = {
    type: "object",
    properties: Object.fromEntries(Object.entries(CLIENT_FIELD_DESCRIPTIONS).map(([k, desc]) => [k, { type: "string", description: desc }])),
    required: Object.keys(CLIENT_FIELD_DESCRIPTIONS)
  };

  const CLIENT_SYSTEM = "당신은 대한민국 소방점검 업체가 사용하는 업무용 앱의 문서 인식 도우미입니다. 업로드된 문서(소방시설 자체점검 결과보고서, 명함, 안내문 등)에서 요청된 항목을 정확히 추출하세요. 문서에 명시적으로 없는 정보는 절대 추측하지 말고 반드시 빈 문자열(\"\")로 남기세요. 전화번호와 날짜는 지정된 형식으로 정규화하세요. 같은 사람이 여러 역할(예: 관계인이자 소방안전관리자)을 겸하는 경우 해당하는 모든 필드에 채워주세요. 반드시 JSON으로만 응답하세요.";

  async function analyzeClientFile(file) {
    const ext = file.name.split(".").pop().toLowerCase();
    if (!isSupportedExt(ext)) return { unsupported: true };
    const instruction = "이 문서에서 거래처(현장) 등록에 필요한 정보를 추출해줘.";
    const docText = await extractDocText(file, ext);
    const parts = await buildParts(file, ext, instruction, docText);
    if (!parts) return { failed: true, typeLabel: extTypeLabel(ext) };
    const fields = await callGemini({ system: CLIENT_SYSTEM, parts, schema: CLIENT_SCHEMA, maxTokens: 4096 });
    // AI가 스프링클러 여부를 "예"/"아니오"로 못 정했으면(체크박스 표 구조가 깨져 못 읽은 경우 등)
    // 같은 텍스트에서 체크박스를 직접 찾아 보완한다.
    if (fields.sprinklerInstalled !== "예" && fields.sprinklerInstalled !== "아니오" && docText) {
      const detected = detectSprinklerFromText(docText);
      if (detected) fields.sprinklerInstalled = detected;
    }
    const filledCount = Object.values(fields).filter((v) => v && String(v).trim()).length;
    return { fields, typeLabel: extTypeLabel(ext) + " (AI 분석)", lowConfidence: false, failed: filledCount === 0 };
  }

  const DEFICIENCY_SCHEMA = {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            category: { type: "string", description: "설비 구분 (예: 소화설비, 경보설비, 피난구조설비 등)" },
            floor: { type: "string", description: "층" },
            location: { type: "string", description: "설치 장소" },
            code: { type: "string", description: "점검번호" },
            description: { type: "string", description: "불량내용(지적사항)" }
          },
          required: ["category", "floor", "location", "code", "description"]
        }
      }
    },
    required: ["items"]
  };

  const DEFICIENCY_SYSTEM = "당신은 대한민국 소방점검 업체가 사용하는 업무용 앱의 문서 인식 도우미입니다. 업로드된 소방시설 지적사항(불량내역) 문서에서 각 지적 항목을 표로 추출하세요. 설비 구분, 층, 설치장소, 점검번호, 불량내용을 항목별로 정리하고, 하나의 지적사항이 여러 줄/셀에 걸쳐 나뉘어 있으면 하나의 항목으로 합치세요. 표 헤더나 안내문구는 항목으로 만들지 마세요. 지적사항이 없으면 빈 배열을 반환하세요. 반드시 JSON으로만 응답하세요.";

  async function analyzeDeficiencyFile(file) {
    const ext = file.name.split(".").pop().toLowerCase();
    if (!isSupportedExt(ext)) return { unsupported: true };
    const instruction = "이 문서에서 소방시설 지적사항(불량내역) 목록을 추출해줘.";
    const parts = await buildParts(file, ext, instruction);
    if (!parts) return { rows: null, typeLabel: extTypeLabel(ext) };
    const result = await callGemini({ system: DEFICIENCY_SYSTEM, parts, schema: DEFICIENCY_SCHEMA, maxTokens: 8000 });
    return { rows: result.items && result.items.length ? result.items : null, typeLabel: extTypeLabel(ext) + " (AI 분석)" };
  }

  function extTypeLabel(ext) {
    if (ext === "pdf") return "PDF";
    if (ext === "xlsx" || ext === "xls") return "엑셀";
    if (ext === "docx") return "워드 문서";
    if (ext === "hwpx") return "한글(HWPX)";
    if (ext === "hwp") return "한글(HWP)";
    if (IMAGE_MEDIA_TYPES[ext]) return "사진";
    return "파일";
  }

  return { isEnabled, setEnabled, isSupportedExt, analyzeClientFile, analyzeDeficiencyFile, hwpxToText };
})();
