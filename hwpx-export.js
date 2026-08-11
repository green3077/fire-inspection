// 이행완료보고서 HWPX(신 한글) 파일 생성 - 실제 별지 제11호서식 샘플 파일(templates/completion-report-template.hwpx)을
// 템플릿으로 불러와 DOM으로 파싱한 뒤, 라벨 셀 옆의 값 칸을 찾아 채우고 지적내역서 표는 실제 항목 수만큼 행을 복제한다.
// 사진은 hp:pic(그림) 개체로 BinData에 임베드한다 - 이 프로젝트에 실제 사진이 포함된 hwpx 예제가 없어 한글 프로그램으로
// 직접 열어 검증하지 못했으므로, 문제가 있으면 PDF/인쇄 경로를 대신 사용할 것.
const HwpxExport = (() => {
  const HP = "http://www.hancom.co.kr/hwpml/2011/paragraph";
  const HC = "http://www.hancom.co.kr/hwpml/2011/core";
  const OPF = "http://www.idpf.org/2007/opf/";
  const TEMPLATE_URL = "templates/completion-report-template.hwpx";

  function el(doc, name, attrs) {
    const e = doc.createElementNS(HP, name);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  function hcEl(doc, name, attrs) {
    const e = doc.createElementNS(HC, name);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  function getTexts(doc) {
    return Array.from(doc.getElementsByTagNameNS(HP, "t"));
  }

  // 라벨 셀(hp:tc) 텍스트가 정확히 일치하는 셀을 찾아, 같은 행(hp:tr) 안의 다음 hp:tc(값 칸)를 반환.
  // "소재지"처럼 문서에 같은 라벨이 여러 번 나오는 경우를 위해 occurrence(0-base)로 몇 번째 라벨인지 지정.
  function findValueCellByLabel(doc, labelText, occurrence) {
    const tcs = Array.from(doc.getElementsByTagNameNS(HP, "tc"));
    let count = 0;
    for (const tc of tcs) {
      const text = Array.from(tc.getElementsByTagNameNS(HP, "t")).map((t) => t.textContent).join("").trim();
      if (text === labelText) {
        if (count === (occurrence || 0)) {
          let sib = tc.nextElementSibling;
          while (sib && sib.localName !== "tc") sib = sib.nextElementSibling;
          return sib;
        }
        count++;
      }
    }
    return null;
  }

  // 값 칸(hp:tc)에 텍스트 채우기 - 기존 run+t가 있으면 재사용, 없으면(완전히 빈 칸) 첫 문단에 새 run 추가.
  function setCellText(tc, text, fallbackCharPrIDRef) {
    if (!tc) return false;
    const runs = Array.from(tc.getElementsByTagNameNS(HP, "run"));
    const runWithT = runs.find((r) => r.getElementsByTagNameNS(HP, "t").length > 0);
    if (runWithT) {
      runWithT.getElementsByTagNameNS(HP, "t")[0].textContent = text;
      return true;
    }
    const ps = tc.getElementsByTagNameNS(HP, "p");
    if (ps.length === 0) return false;
    const doc = tc.ownerDocument;
    const p = ps[0];
    const run = el(doc, "hp:run", { charPrIDRef: fallbackCharPrIDRef || "45" });
    const t = el(doc, "hp:t", {});
    t.textContent = text;
    run.appendChild(t);
    p.appendChild(run);
    return true;
  }

  // 텍스트 노드(hp:t)의 내용이 조건에 맞는 것을 찾아 콜백으로 치환 - occurrence번째(0-base) 일치 항목만 처리.
  function replaceNthMatchingText(doc, predicate, occurrence, replacer) {
    const ts = getTexts(doc);
    let count = 0;
    for (const t of ts) {
      if (predicate(t.textContent)) {
        if (count === occurrence) {
          t.textContent = replacer(t.textContent);
          return true;
        }
        count++;
      }
    }
    return false;
  }

  // "성명:" / "전화번호:" / "소재지"처럼 라벨만 있는 run 바로 뒤에 값 run을 복제해서 삽입 (occurrence번째 일치).
  function insertValueAfterLabelRun(doc, labelText, value, occurrence) {
    const ts = getTexts(doc);
    let count = 0;
    for (const t of ts) {
      if (t.textContent.trim() === labelText) {
        if (count === (occurrence || 0)) {
          const run = t.parentNode;
          const newRun = run.cloneNode(true);
          newRun.getElementsByTagNameNS(HP, "t")[0].textContent = "   " + value;
          run.parentNode.insertBefore(newRun, run.nextSibling);
          return true;
        }
        count++;
      }
    }
    return false;
  }

  function fillCoverPage(doc, data) {
    setCellText(findValueCellByLabel(doc, "대상물 명칭(상호)", 0), data.siteName);
    setCellText(findValueCellByLabel(doc, "대상물 구분(용도)", 0), data.siteType || "");
    setCellText(findValueCellByLabel(doc, "업체명(상호)", 0), data.company.name || "");
    setCellText(findValueCellByLabel(doc, "사업자번호", 0), data.company.bizRegNo || "");
    // "소재지"는 라벨 셀 하나가 행 전체(colSpan=4)를 차지하는 구조라 별도 값 칸이 없음 - 라벨 뒤에 이어서 삽입.
    insertValueAfterLabelRun(doc, "소재지", data.siteAddr, 0);
    insertValueAfterLabelRun(doc, "소재지", data.company.address || "", 1);

    // 관계인 / 대표이사 - "(성명:               전화번호:           )" 형태의 한 run 안에 값 삽입 (등장 순서: 관계인 -> 대표이사)
    // 치환 후에도 문자열이 여전히 패턴에 매칭되므로(괄호로 시작, 성명:/전화번호: 포함) occurrence를 0, 1로 명시해야 관계인/대표이사 줄이 서로 안 뒤섞인다.
    const combinedPattern = (s) => s.includes("성명:") && s.includes("전화번호:") && s.trim().startsWith("(");
    replaceNthMatchingText(doc, combinedPattern, 0, () => `(성명: ${data.contactName || "-"}    전화번호: ${data.contactPhone || "-"})`);
    replaceNthMatchingText(doc, combinedPattern, 1, () => `(성명: ${data.company.ceo || "-"}    전화번호: ${data.company.phone || "-"})`);

    // 소방안전관리자 성명/전화번호 - 라벨 run 뒤에 값 run 삽입
    insertValueAfterLabelRun(doc, "성명:", data.managerName || "-");
    insertValueAfterLabelRun(doc, "전화번호:", data.managerPhone || "-");

    // 이행조치 일자 - 첫 번째 ". . . ~ . . ." 자리만 실제 날짜로 교체
    replaceNthMatchingText(doc, (s) => /^[.\s∼~]+$/.test(s) && s.includes("."), 0, () => data.dateRange || "");

    // 년/월/일 서명일자 줄 - 공백이 긴 "...년...월...일" 형태의 유일한 줄
    replaceNthMatchingText(
      doc,
      (s) => s.includes("년") && s.includes("월") && s.includes("일") && /\s{5,}/.test(s),
      0,
      () => {
        const now = new Date();
        return `                                                        ${now.getFullYear()}년    ${now.getMonth() + 1}월    ${now.getDate()}일`;
      }
    );

    // 관계인: (서명란) - "관계인:" 뒤에 공백으로 채워진 유일한 줄
    replaceNthMatchingText(doc, (s) => s.includes("관계인:") && s.trim().length > "관계인:".length, 0, (orig) =>
      orig.replace("관계인:", `관계인: ${data.contactName || ""}`)
    );

    // 지적내역서 (대상물: ... ) 제목
    replaceNthMatchingText(doc, (s) => s.includes("지적내역서") && s.includes("대상물:"), 0, (orig) =>
      orig.replace(/대상물:\s*$/, `대상물: ${data.siteName}`)
    );
  }

  // 문단(hp:p)의 텍스트를 clear하고 새 텍스트로 교체 (하나의 run만 남김) - 여러 줄이 필요하면 caller가 문단을 복제해서 사용.
  function setParagraphText(p, text, charPrIDRef) {
    const doc = p.ownerDocument;
    Array.from(p.getElementsByTagNameNS(HP, "run")).forEach((r) => r.remove());
    Array.from(p.getElementsByTagNameNS(HP, "linesegarray")).forEach((r) => r.remove());
    const run = el(doc, "hp:run", { charPrIDRef: charPrIDRef || "47" });
    const t = el(doc, "hp:t", {});
    t.textContent = text;
    run.appendChild(t);
    p.appendChild(run);
  }

  function clearCellAndSetLines(tc, lines, charPrIDRef) {
    const doc = tc.ownerDocument;
    const subList = tc.getElementsByTagNameNS(HP, "subList")[0];
    const paras = Array.from(subList.getElementsByTagNameNS(HP, "p"));
    const templatePara = paras[0];
    paras.forEach((p) => p.remove());
    lines.forEach((line, i) => {
      const p = templatePara.cloneNode(true);
      setParagraphText(p, line, charPrIDRef);
      subList.appendChild(p);
    });
  }

  function buildPicElement(doc, binaryId, hwpWidth, hwpHeight) {
    const pic = el(doc, "hp:pic", {
      id: String(1000000000 + Math.floor(Math.random() * 900000000)),
      zOrder: "0",
      numberingType: "PICTURE",
      textWrap: "SQUARE",
      textFlow: "BOTH_SIDES",
      lock: "0",
      dropcapstyle: "None",
      href: "",
      groupLevel: "0"
    });
    pic.appendChild(el(doc, "hp:offset", { x: "0", y: "0" }));
    pic.appendChild(el(doc, "hp:orgSz", { width: String(hwpWidth), height: String(hwpHeight) }));
    pic.appendChild(el(doc, "hp:curSz", { width: String(hwpWidth), height: String(hwpHeight) }));
    pic.appendChild(el(doc, "hp:flip", { horizontal: "0", vertical: "0" }));
    pic.appendChild(
      el(doc, "hp:rotationInfo", { angle: "0", centerX: String(Math.round(hwpWidth / 2)), centerY: String(Math.round(hwpHeight / 2)), rotateimage: "1" })
    );
    const ri = el(doc, "hp:renderingInfo", {});
    ri.appendChild(hcEl(doc, "hc:transMatrix", { e1: "1", e2: "0", e3: "0", e4: "0", e5: "1", e6: "0" }));
    ri.appendChild(hcEl(doc, "hc:scaMatrix", { e1: "1", e2: "0", e3: "0", e4: "0", e5: "1", e6: "0" }));
    ri.appendChild(hcEl(doc, "hc:rotMatrix", { e1: "1", e2: "0", e3: "0", e4: "0", e5: "1", e6: "0" }));
    pic.appendChild(ri);
    const imgRect = el(doc, "hp:imgRect", {});
    imgRect.appendChild(hcEl(doc, "hc:pt0", { x: "0", y: "0" }));
    imgRect.appendChild(hcEl(doc, "hc:pt1", { x: String(hwpWidth), y: "0" }));
    imgRect.appendChild(hcEl(doc, "hc:pt2", { x: String(hwpWidth), y: String(hwpHeight) }));
    imgRect.appendChild(hcEl(doc, "hc:pt3", { x: "0", y: String(hwpHeight) }));
    pic.appendChild(imgRect);
    pic.appendChild(el(doc, "hp:imgClip", { left: "0", right: String(hwpWidth), top: "0", bottom: String(hwpHeight) }));
    pic.appendChild(el(doc, "hp:inMargin", { left: "0", right: "0", top: "0", bottom: "0" }));
    pic.appendChild(el(doc, "hp:imgDim", { dimwidth: String(hwpWidth), dimheight: String(hwpHeight) }));
    pic.appendChild(el(doc, "hp:img", { bright: "0", contrast: "0", effect: "REAL_PIC", alpha: "0", binaryItemIDRef: binaryId }));
    return pic;
  }

  async function getImagePixelSize(blob) {
    const bitmap = await createImageBitmap(blob);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  }

  // 셀 안의 "사진" 안내 문단을 지우고 그림 개체를 넣은 새 문단으로 교체. 이미지가 없으면 "사진 없음" 텍스트만 남김.
  async function setCellPhoto(tc, blob, cellWidthHwp, cellHeightHwp, imageState) {
    const doc = tc.ownerDocument;
    const subList = tc.getElementsByTagNameNS(HP, "subList")[0];
    const paras = Array.from(subList.getElementsByTagNameNS(HP, "p"));
    const templatePara = paras[0];
    paras.forEach((p) => p.remove());

    if (!blob) {
      const p = templatePara.cloneNode(true);
      setParagraphText(p, "사진 없음", "47");
      subList.appendChild(p);
      return;
    }

    const { width, height } = await getImagePixelSize(blob);
    const maxW = cellWidthHwp - 200;
    const maxH = cellHeightHwp - 200;
    const scale = Math.min(maxW / width, maxH / height);
    const hwpWidth = Math.max(1000, Math.round(width * scale));
    const hwpHeight = Math.max(1000, Math.round(height * scale));

    const ext = blob.type === "image/png" ? "png" : "jpg";
    const mediaType = blob.type === "image/png" ? "image/png" : "image/jpeg";
    const imageIndex = ++imageState.count;
    const binaryId = `image${imageIndex}`;
    const buf = await blob.arrayBuffer();
    imageState.zip.file(`BinData/${binaryId}.${ext}`, buf);
    imageState.manifestItems.push({ id: binaryId, href: `BinData/${binaryId}.${ext}`, mediaType });

    const p = templatePara.cloneNode(true);
    Array.from(p.getElementsByTagNameNS(HP, "run")).forEach((r) => r.remove());
    Array.from(p.getElementsByTagNameNS(HP, "linesegarray")).forEach((r) => r.remove());
    const run = el(doc, "hp:run", { charPrIDRef: "47" });
    run.appendChild(buildPicElement(doc, binaryId, hwpWidth, hwpHeight));
    p.appendChild(run);
    subList.appendChild(p);
  }

  async function fillDeficiencyTable(doc, tbl, items, photoMap, imageState) {
    const trs = Array.from(tbl.getElementsByTagNameNS(HP, "tr"));
    // tr[0]=제목, tr[1]=이행결과/안내문구, tr[2]=이행전/이행후 라벨, tr[3..]=예시 데이터 4행
    const templateRow = trs[3].cloneNode(true);
    for (let i = 3; i < trs.length; i++) trs[i].remove();

    const rowWidthHwp = 20308; // 템플릿 사진 칸 폭 (샘플 파일 기준)
    const rowHeightHwp = 15293;

    for (let i = 0; i < items.length; i++) {
      const def = items[i];
      const row = templateRow.cloneNode(true);
      const tcs = Array.from(row.getElementsByTagNameNS(HP, "tc"));
      const [contentTc, beforeTc, afterTc] = tcs;

      tcs.forEach((tc) => {
        const addr = tc.getElementsByTagNameNS(HP, "cellAddr")[0];
        if (addr) addr.setAttribute("rowAddr", String(3 + i));
      });

      const lines = [[def.floor, def.location].filter(Boolean).join(" ") || `${i + 1}번 항목`];
      if (def.code) lines.push(`점검번호: ${def.code}`);
      lines.push(def.description || "");
      clearCellAndSetLines(contentTc, lines, "47");

      const beforeId = (def.beforePhotoIds || [])[0];
      const afterId = (def.afterPhotoIds || [])[0];
      await setCellPhoto(beforeTc, beforeId ? photoMap.get(beforeId) : null, rowWidthHwp, rowHeightHwp, imageState);
      await setCellPhoto(afterTc, afterId ? photoMap.get(afterId) : null, rowWidthHwp, rowHeightHwp, imageState);

      tbl.appendChild(row);
    }
    tbl.setAttribute("rowCnt", String(3 + items.length));
  }

  function addManifestItems(hpfDoc, items) {
    const manifest = hpfDoc.getElementsByTagNameNS(OPF, "manifest")[0];
    for (const item of items) {
      const el2 = hpfDoc.createElementNS(OPF, "opf:item");
      el2.setAttribute("id", item.id);
      el2.setAttribute("href", item.href);
      el2.setAttribute("media-type", item.mediaType);
      manifest.appendChild(el2);
    }
  }

  // resolved: 완료된 지적사항 배열 (def.beforePhotoIds/afterPhotoIds/floor/location/code/description)
  // photoMap: Map(photoId -> Blob)
  async function generateCompletionReportHwpx({ site, company, resolved, photoMap, dateRange, contactName, contactPhone, managerName, managerPhone, siteName, siteType, siteAddr }) {
    const res = await fetch(TEMPLATE_URL);
    if (!res.ok) throw new Error("template_fetch_failed_" + res.status);
    const buf = await res.arrayBuffer();
    const zip = await JSZip.loadAsync(buf);

    const sectionXmlText = await zip.file("Contents/section0.xml").async("text");
    const hpfXmlText = await zip.file("Contents/content.hpf").async("text");

    const parser = new DOMParser();
    const sectionDoc = parser.parseFromString(sectionXmlText, "application/xml");
    const hpfDoc = parser.parseFromString(hpfXmlText, "application/xml");

    if (sectionDoc.getElementsByTagName("parsererror").length > 0) {
      throw new Error("hwpx_template_parse_error");
    }

    fillCoverPage(sectionDoc, { site, company, dateRange, contactName, contactPhone, managerName, managerPhone, siteName, siteType, siteAddr });

    const tbls = Array.from(sectionDoc.getElementsByTagNameNS(HP, "tbl"));
    const deficiencyTbl = tbls[tbls.length - 1];
    const imageState = { zip, count: 0, manifestItems: [] };
    await fillDeficiencyTable(sectionDoc, deficiencyTbl, resolved, photoMap, imageState);

    if (imageState.manifestItems.length > 0) {
      addManifestItems(hpfDoc, imageState.manifestItems);
    }

    const serializer = new XMLSerializer();
    const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>';
    zip.file("Contents/section0.xml", XML_DECL + serializer.serializeToString(sectionDoc.documentElement));
    zip.file("Contents/content.hpf", XML_DECL + serializer.serializeToString(hpfDoc.documentElement));

    return zip.generateAsync({ type: "blob", mimeType: "application/hwp+zip" });
  }

  return { generateCompletionReportHwpx };
})();
