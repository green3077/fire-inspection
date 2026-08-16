// 지적사항 표 가져오기 (엑셀 / 워드 / PDF) - "설비/층/설치장소/점검번호/불량내용" 표 구조를 인식
const FireImport = (() => {

  function cellText(v) {
    if (v == null) return "";
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return String(v).trim();
  }

  // 원시 표(행렬 배열)를 지적사항 배열로 변환
  function rowsToDeficiencies(rows) {
    if (!rows || rows.length === 0) return null;

    let headerIdx = -1;
    let colMap = null;
    for (let i = 0; i < rows.length; i++) {
      const row = (rows[i] || []).map(cellText);
      const hasEquip = row.some((c) => c.includes("설비"));
      const hasContent = row.some((c) => c.includes("불량") || c.includes("내용") || c.includes("지적"));
      const hasLoc = row.some((c) => c.includes("설치장소") || c.includes("위치"));
      if (hasEquip && hasContent && hasLoc) {
        headerIdx = i;
        colMap = {};
        row.forEach((c, idx) => {
          if (c.includes("설비")) colMap.category = idx;
          else if (c === "층") colMap.floor = idx;
          else if (c.includes("설치장소") || c.includes("위치")) colMap.location = idx;
          else if (c.includes("점검번호") || c.includes("번호")) colMap.code = idx;
          else if (c.includes("불량") || c.includes("내용") || c.includes("지적")) colMap.description = idx;
        });
        break;
      }
    }
    if (headerIdx === -1) return null;

    const results = [];
    let lastCategory = "";
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i] || [];
      const texts = row.map(cellText);
      if (texts.every((c) => c === "")) continue;
      const firstNonEmpty = texts.find((c) => c !== "") || "";
      if (/^[※*]/.test(firstNonEmpty)) break;

      const get = (key) => (colMap[key] != null ? cellText(row[colMap[key]]) : "");
      let category = get("category");
      if (category) lastCategory = category; else category = lastCategory;
      const floor = get("floor");
      const location = get("location");
      const code = get("code");
      const description = get("description");
      if (!description && !location) continue;
      results.push({ category, floor, location, code, description });
    }
    return results.length ? results : null;
  }

  async function parseExcelFile(file) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array", cellDates: true });
    for (const sheetName of wb.SheetNames) {
      const sheet = wb.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
      const parsed = rowsToDeficiencies(rows);
      if (parsed) return parsed;
    }
    return null;
  }

  async function parseWordFile(file) {
    const zip = await JSZip.loadAsync(file);
    const docXmlFile = zip.file("word/document.xml");
    if (!docXmlFile) return null;
    const xmlText = await docXmlFile.async("text");
    const xmlDoc = new DOMParser().parseFromString(xmlText, "application/xml");
    const tables = Array.from(xmlDoc.getElementsByTagName("w:tbl"));
    if (tables.length === 0) return null;

    for (const tbl of tables) {
      const trs = Array.from(tbl.getElementsByTagName("w:tr"));
      const rows = trs.map((tr) => {
        const tcs = Array.from(tr.getElementsByTagName("w:tc"));
        return tcs.map((tc) => {
          const ts = Array.from(tc.getElementsByTagName("w:t"));
          return ts.map((t) => t.textContent).join("");
        });
      });
      const parsed = rowsToDeficiencies(rows);
      if (parsed) return parsed;
    }
    return null;
  }

  async function extractPdfRows(file) {
    if (window.pdfjsLib) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
    }
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;

    let totalChars = 0;
    let replacementChars = 0;
    const allRows = [];

    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const items = content.items.map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5] }));
      items.forEach((it) => {
        totalChars += it.str.length;
        replacementChars += (it.str.match(/�/g) || []).length;
      });

      const lines = new Map();
      items.forEach((it) => {
        if (!it.str.trim()) return;
        const key = Math.round(it.y / 4) * 4;
        if (!lines.has(key)) lines.set(key, []);
        lines.get(key).push(it);
      });
      const sortedYs = Array.from(lines.keys()).sort((a, b) => b - a);
      sortedYs.forEach((y) => {
        const lineItems = lines.get(y).sort((a, b) => a.x - b.x);
        const cols = [];
        let cur = "";
        let lastEndX = null;
        lineItems.forEach((it) => {
          if (lastEndX !== null && it.x - lastEndX > 12) {
            cols.push(cur);
            cur = "";
          }
          cur += it.str;
          lastEndX = it.x + it.str.length * 3.5;
        });
        if (cur) cols.push(cur);
        allRows.push(cols);
      });
    }

    const lowConfidence = totalChars === 0 || replacementChars / Math.max(totalChars, 1) > 0.05;
    return { rows: allRows, lowConfidence };
  }

  async function parsePdfFile(file) {
    const { rows: allRows, lowConfidence } = await extractPdfRows(file);
    const rows = rowsToDeficiencies(allRows);
    return { rows, lowConfidence };
  }

  return { parseExcelFile, parseWordFile, parsePdfFile, extractPdfRows, rowsToDeficiencies };
})();
