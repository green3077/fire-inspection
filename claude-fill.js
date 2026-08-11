// 업로드 파일(PDF/엑셀/워드/한글/HWPX/사진)을 Claude AI로 분석해 폼 입력칸에 자동으로 채워주는 모듈.
// 사용자 본인의 Anthropic API 키가 설정 탭에 저장되어 있을 때만 동작 (브라우저 로컬 저장, 서버 전송 없음).
// 키가 없거나 API 호출이 실패하면 호출부(app.js)가 기존 정규식 기반 파서로 자동 폴백한다.
const ClaudeFill = (() => {
  const KEY_STORAGE = "fireInspectionClaudeApiKey";
  const MODEL = "claude-opus-5";
  // 영남이공대학교 API Gateway(mindlogic) - Anthropic 네이티브 Messages API 호환 엔드포인트.
  // Anthropic SDK의 base_url을 이 주소로 바꾸는 것과 동일 (SDK가 내부적으로 붙이는 /v1/messages 경로 포함).
  const API_URL = "https://factchat-cloud.mindlogic.ai/v1/gateway/claude/v1/messages";
  const IMAGE_MEDIA_TYPES = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", bmp: "image/bmp", gif: "image/gif" };

  function getApiKey() {
    return (localStorage.getItem(KEY_STORAGE) || "").trim();
  }
  function saveApiKey(key) {
    localStorage.setItem(KEY_STORAGE, (key || "").trim());
  }
  function isConfigured() {
    return !!getApiKey();
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

  async function buildContentBlocks(file, ext, instruction) {
    if (ext === "pdf") {
      const data = await fileToBase64(file);
      return [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data } },
        { type: "text", text: instruction }
      ];
    }
    if (IMAGE_MEDIA_TYPES[ext]) {
      const data = await fileToBase64(file);
      return [
        { type: "image", source: { type: "base64", media_type: IMAGE_MEDIA_TYPES[ext], data } },
        { type: "text", text: instruction }
      ];
    }
    let text = "";
    if (ext === "xlsx" || ext === "xls") text = await excelToText(file);
    else if (ext === "docx") text = await wordToText(file);
    else if (ext === "hwpx") text = await hwpxToText(file);
    if (!text || !text.trim()) return null;
    return [{ type: "text", text: `${instruction}\n\n--- 문서 내용 ---\n${text.slice(0, 60000)}` }];
  }

  async function callClaude({ system, content, schema, maxTokens }) {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error("claude_no_api_key");
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "authorization": "Bearer " + apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        system,
        output_config: { effort: "low", format: { type: "json_schema", schema } },
        messages: [{ role: "user", content }]
      })
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`claude_api_${res.status}: ${errText.slice(0, 300)}`);
    }
    const data = await res.json();
    if (data.stop_reason === "refusal") throw new Error("claude_refusal");
    const textBlock = (data.content || []).find((b) => b.type === "text");
    if (!textBlock) throw new Error("claude_no_text");
    return JSON.parse(textBlock.text);
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
    buildingType: "건물 용도/구분"
  };

  const CLIENT_SCHEMA = {
    type: "object",
    properties: Object.fromEntries(Object.entries(CLIENT_FIELD_DESCRIPTIONS).map(([k, desc]) => [k, { type: "string", description: desc }])),
    required: Object.keys(CLIENT_FIELD_DESCRIPTIONS),
    additionalProperties: false
  };

  const CLIENT_SYSTEM = "당신은 대한민국 소방점검 업체가 사용하는 업무용 앱의 문서 인식 도우미입니다. 업로드된 문서(소방시설 자체점검 결과보고서, 명함, 안내문 등)에서 요청된 항목을 정확히 추출하세요. 문서에 명시적으로 없는 정보는 절대 추측하지 말고 반드시 빈 문자열(\"\")로 남기세요. 전화번호와 날짜는 지정된 형식으로 정규화하세요. 같은 사람이 여러 역할(예: 관계인이자 소방안전관리자)을 겸하는 경우 해당하는 모든 필드에 채워주세요.";

  async function analyzeClientFile(file) {
    const ext = file.name.split(".").pop().toLowerCase();
    if (!isSupportedExt(ext)) return { unsupported: true };
    const instruction = "이 문서에서 거래처(현장) 등록에 필요한 정보를 추출해줘.";
    const content = await buildContentBlocks(file, ext, instruction);
    if (!content) return { failed: true, typeLabel: extTypeLabel(ext) };
    const fields = await callClaude({ system: CLIENT_SYSTEM, content, schema: CLIENT_SCHEMA, maxTokens: 4096 });
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
          required: ["category", "floor", "location", "code", "description"],
          additionalProperties: false
        }
      }
    },
    required: ["items"],
    additionalProperties: false
  };

  const DEFICIENCY_SYSTEM = "당신은 대한민국 소방점검 업체가 사용하는 업무용 앱의 문서 인식 도우미입니다. 업로드된 소방시설 지적사항(불량내역) 문서에서 각 지적 항목을 표로 추출하세요. 설비 구분, 층, 설치장소, 점검번호, 불량내용을 항목별로 정리하고, 하나의 지적사항이 여러 줄/셀에 걸쳐 나뉘어 있으면 하나의 항목으로 합치세요. 표 헤더나 안내문구는 항목으로 만들지 마세요. 지적사항이 없으면 빈 배열을 반환하세요.";

  async function analyzeDeficiencyFile(file) {
    const ext = file.name.split(".").pop().toLowerCase();
    if (!isSupportedExt(ext)) return { unsupported: true };
    const instruction = "이 문서에서 소방시설 지적사항(불량내역) 목록을 추출해줘.";
    const content = await buildContentBlocks(file, ext, instruction);
    if (!content) return { rows: null, typeLabel: extTypeLabel(ext) };
    const result = await callClaude({ system: DEFICIENCY_SYSTEM, content, schema: DEFICIENCY_SCHEMA, maxTokens: 8000 });
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

  return { getApiKey, saveApiKey, isConfigured, isSupportedExt, analyzeClientFile, analyzeDeficiencyFile, hwpxToText };
})();
