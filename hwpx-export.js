// 이행완료보고서 HWPX(신 한글) 파일 생성 - 실제 별지 제11호서식 샘플 파일(templates/completion-report-template.hwpx)을
// 템플릿으로 불러와 DOM으로 파싱한 뒤, 라벨 셀 옆의 값 칸을 찾아 채우고 지적내역서 표는 실제 항목 수만큼 행을 복제한다.
// 사진은 hp:pic(그림) 개체로 BinData에 임베드한다 - hp:pic의 정확한 구조는 실제 한글 프로그램의 COM
// 자동화(HWPFrame.HwpObject)로 그림 삽입한 문서를 직접 저장해 나온 XML을 그대로 참고해 맞췄다
// (2026-08-12; 스펙만 보고 손으로 만들었던 이전 버전은 hc:img를 hp:img로 잘못 쓰고 hp:sz/hp:pos/hp:outMargin
// 등 필수 요소가 빠져 있어서 실제 한글에서 파일 자체를 열지 못하는 문제가 있었다).
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

  // "대상물 명칭(상호)"/"업체명(상호)" 등은 실제 템플릿에 값 전용 칸이 따로 없다 - 라벨 칸(hp:tc) 자체가
  // 그 행의 나머지 폭을 차지하는 구조라, "관계인"/"소방안전관리자" 칸이 이미 쓰고 있는 것과 같은 방식으로
  // 라벨 문단 밑에 값 문단을 새로 이어붙인다(옆 칸이 아니라 라벨 밑에 값이 오도록).
  function appendValueLineInLabelCell(doc, labelText, value, occurrence) {
    const tcs = Array.from(doc.getElementsByTagNameNS(HP, "tc"));
    let count = 0;
    for (const tc of tcs) {
      const ps = tc.getElementsByTagNameNS(HP, "p");
      // 셀 전체가 아니라 첫 문단(라벨 줄)만 비교한다 - 같은 라벨이 여러 번 나오는 "소재지" 같은 경우,
      // 앞서 occurrence 0을 처리하며 값 줄을 이어붙이고 나면 셀 전체 텍스트는 더 이상 라벨과 같지 않아서
      // 이후 occurrence를 셀 전체 텍스트로 찾으면 순서가 어긋난다.
      const firstPText = ps.length ? Array.from(ps[0].getElementsByTagNameNS(HP, "t")).map((t) => t.textContent).join("").trim() : "";
      if (firstPText === labelText) {
        if (count === (occurrence || 0)) {
          const labelP = ps[0];
          const newP = labelP.cloneNode(true);
          const t = newP.getElementsByTagNameNS(HP, "t")[0];
          if (t) t.textContent = value;
          const lineseg = newP.getElementsByTagNameNS(HP, "lineseg")[0];
          if (lineseg) lineseg.setAttribute("vertpos", String(1600 * ps.length));
          tc.getElementsByTagNameNS(HP, "subList")[0].appendChild(newP);
          // cellSz의 height는 한글이 실제 내용에 맞춰 다시 계산하는 값이라 손대지 않는다 - 예전에 여기서
          // 미리 높이를 부풀렸더니(+3009) 실제 한글에서 줄 밑에 불필요한 빈 여백이 남는 문제가 있었다.
          return true;
        }
        count++;
      }
    }
    return false;
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
    appendValueLineInLabelCell(doc, "대상물 명칭(상호)", data.siteName, 0);
    appendValueLineInLabelCell(doc, "대상물 구분(용도)", data.siteType || "", 0);
    appendValueLineInLabelCell(doc, "업체명(상호)", data.company.name || "", 0);
    appendValueLineInLabelCell(doc, "사업자번호", data.company.bizRegNo || "", 0);
    // "소재지"도 라벨 셀 하나가 행 전체(colSpan=4)를 차지하는 구조라 별도 값 칸이 없음 - 위 필드들과 마찬가지로
    // 옆이 아니라 라벨 밑에 새 줄로 값이 오도록 한다.
    appendValueLineInLabelCell(doc, "소재지", data.siteAddr, 0);
    appendValueLineInLabelCell(doc, "소재지", data.company.address || "", 1);

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

    // 년/월/일 서명일자(제출 날짜) 줄은 실제 제출 시점에 손으로 적도록 공란으로 남겨둔다(자동 채움 없음).

    // 관계인: (서명란) - "관계인:" 뒤에 공백으로 채워진 유일한 줄
    replaceNthMatchingText(doc, (s) => s.includes("관계인:") && s.trim().length > "관계인:".length, 0, (orig) =>
      orig.replace("관계인:", `관계인: ${data.contactName || ""}`)
    );

    // 지적내역서 (대상물: ... ) 제목
    replaceNthMatchingText(doc, (s) => s.includes("지적내역서") && s.includes("대상물:"), 0, (orig) =>
      orig.replace(/대상물:\s*$/, `대상물: ${data.siteName}`)
    );

    // "○○ 소방본부장ㆍ소방서장 귀하" - 실제 관할소방서 이름을 알면 그것으로 교체 ("귀하"는 별도 run이라 손대지 않음).
    if (data.fireStation) {
      replaceNthMatchingText(doc, (s) => s.includes("소방본부장"), 0, () => `   ${data.fireStation}장 `);
    }
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

  // hp:pic(그림 개체) 요소 - HWPFrame.HwpObject COM 자동화로 실제 한글이 그림을 삽입한 문서를 저장해
  // 얻은 진짜 예제 XML을 그대로 본떠 만들었다(요소 순서/네임스페이스가 실제와 정확히 일치해야 한글이 연다).
  function buildPicElement(doc, binaryId, hwpWidth, hwpHeight) {
    const picId = String(1000000000 + Math.floor(Math.random() * 900000000));
    const pic = el(doc, "hp:pic", {
      id: picId,
      zOrder: "0",
      numberingType: "PICTURE",
      textWrap: "TOP_AND_BOTTOM",
      textFlow: "BOTH_SIDES",
      lock: "0",
      dropcapstyle: "None",
      href: "",
      groupLevel: "0",
      instid: String(1000000000 + Math.floor(Math.random() * 900000000)),
      reverse: "0"
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
    // 실제 예제에서 그림 데이터 참조는 hp:img가 아니라 hc:img(core 네임스페이스)이다.
    pic.appendChild(hcEl(doc, "hc:img", { binaryItemIDRef: binaryId, bright: "0", contrast: "0", effect: "REAL_PIC", alpha: "0" }));
    const imgRect = el(doc, "hp:imgRect", {});
    imgRect.appendChild(hcEl(doc, "hc:pt0", { x: "0", y: "0" }));
    imgRect.appendChild(hcEl(doc, "hc:pt1", { x: String(hwpWidth), y: "0" }));
    imgRect.appendChild(hcEl(doc, "hc:pt2", { x: String(hwpWidth), y: String(hwpHeight) }));
    imgRect.appendChild(hcEl(doc, "hc:pt3", { x: "0", y: String(hwpHeight) }));
    pic.appendChild(imgRect);
    pic.appendChild(el(doc, "hp:imgClip", { left: "0", right: String(hwpWidth), top: "0", bottom: String(hwpHeight) }));
    pic.appendChild(el(doc, "hp:inMargin", { left: "0", right: "0", top: "0", bottom: "0" }));
    pic.appendChild(el(doc, "hp:imgDim", { dimwidth: String(hwpWidth), dimheight: String(hwpHeight) }));
    pic.appendChild(el(doc, "hp:effects", {}));
    pic.appendChild(el(doc, "hp:sz", { width: String(hwpWidth), widthRelTo: "ABSOLUTE", height: String(hwpHeight), heightRelTo: "ABSOLUTE", protect: "0" }));
    // treatAsChar="1": 텍스트 흐름에 얹혀 셀 안에 들어가는 인라인 그림(표 밖으로 떠다니지 않음) - 실제 예제와 동일.
    pic.appendChild(el(doc, "hp:pos", {
      treatAsChar: "1", affectLSpacing: "0", flowWithText: "1", allowOverlap: "0", holdAnchorAndSO: "0",
      vertRelTo: "PARA", horzRelTo: "COLUMN", vertAlign: "TOP", horzAlign: "LEFT", vertOffset: "0", horzOffset: "0"
    }));
    pic.appendChild(el(doc, "hp:outMargin", { left: "0", right: "0", top: "0", bottom: "0" }));
    return pic;
  }

  // 사진 파일을 캔버스에 다시 그려 픽셀 데이터를 얻는다. 카메라 사진은 원본 바이트가 항상 "가로"로
  // 저장되고 EXIF Orientation 태그로 실제 회전을 표시하는 경우가 많은데, 브라우저의 <img>는 이를 반영해
  // 정방향으로 그려주는 반면 한글(HWPX)은 이 태그를 무시하고 원본 바이트를 그대로 표시해 일부 사진이
  // 90도 돌아간 채 들어가는 원인이 된다. 화면에 보이는 그대로(회전 반영 완료) 새로 인코딩해 내보내면
  // 뷰어가 EXIF를 읽든 안 읽든 항상 올바른 방향으로 보인다.
  async function normalizeImagePhoto(blob) {
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("image_decode_failed"));
        image.src = url;
      });
      const width = img.naturalWidth;
      const height = img.naturalHeight;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0);
      const outType = blob.type === "image/png" ? "image/png" : "image/jpeg";
      const outBlob = await new Promise((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("canvas_encode_failed"))), outType, 0.92);
      });
      return { blob: outBlob, width, height };
    } finally {
      URL.revokeObjectURL(url);
    }
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

    let width, height, normalizedBlob;
    try {
      ({ blob: normalizedBlob, width, height } = await normalizeImagePhoto(blob));
    } catch (err) {
      // HEIC(아이폰 기본 사진 형식) 등 브라우저가 디코딩하지 못하는 이미지가 섞여 있으면 크기를 잴 수 없다 -
      // 이 사진 한 장만 건너뛰고 나머지 보고서는 정상 생성한다.
      const p = templatePara.cloneNode(true);
      setParagraphText(p, "사진을 표시할 수 없습니다 (지원하지 않는 이미지 형식)", "47");
      subList.appendChild(p);
      return;
    }

    const maxW = cellWidthHwp - 200;
    const maxH = cellHeightHwp - 200;
    const scale = Math.min(maxW / width, maxH / height);
    const hwpWidth = Math.max(1000, Math.round(width * scale));
    const hwpHeight = Math.max(1000, Math.round(height * scale));

    const ext = normalizedBlob.type === "image/png" ? "png" : "jpg";
    const mediaType = normalizedBlob.type === "image/png" ? "image/png" : "image/jpeg";
    const imageIndex = ++imageState.count;
    const binaryId = `image${imageIndex}`;
    const buf = await normalizedBlob.arrayBuffer();
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

  function addManifestItems(hpfDoc, items) {
    const manifest = hpfDoc.getElementsByTagNameNS(OPF, "manifest")[0];
    for (const item of items) {
      const el2 = hpfDoc.createElementNS(OPF, "opf:item");
      el2.setAttribute("id", item.id);
      el2.setAttribute("href", item.href);
      el2.setAttribute("media-type", item.mediaType);
      el2.setAttribute("isEmbeded", "1");
      manifest.appendChild(el2);
    }
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
      lines.push(def.description || "");
      clearCellAndSetLines(contentTc, lines, "47");

      // photoMap은 app.js에서 FireDB.getPhotosBySite() 결과를 id 기준으로 매핑한 것 - 값은 Blob이 아니라
      // { id, siteId, itemId, role, blob, ... } 사진 레코드 전체이므로 .blob으로 꺼내 써야 한다.
      const beforeId = (def.beforePhotoIds || [])[0];
      const afterId = (def.afterPhotoIds || [])[0];
      const beforePhoto = beforeId ? photoMap.get(beforeId) : null;
      const afterPhoto = afterId ? photoMap.get(afterId) : null;
      await setCellPhoto(beforeTc, beforePhoto ? beforePhoto.blob : null, rowWidthHwp, rowHeightHwp, imageState);
      await setCellPhoto(afterTc, afterPhoto ? afterPhoto.blob : null, rowWidthHwp, rowHeightHwp, imageState);

      tbl.appendChild(row);
    }
    tbl.setAttribute("rowCnt", String(3 + items.length));
  }

  // resolved: 완료된 지적사항 배열 (def.beforePhotoIds/afterPhotoIds/floor/location/code/description)
  // photoMap: Map(photoId -> 사진 레코드, app.js의 FireDB.getPhotosBySite() 결과)
  async function generateCompletionReportHwpx({ site, company, resolved, photoMap, dateRange, contactName, contactPhone, managerName, managerPhone, siteName, siteType, siteAddr, fireStation }) {
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

    fillCoverPage(sectionDoc, { site, company, dateRange, contactName, contactPhone, managerName, managerPhone, siteName, siteType, siteAddr, fireStation });

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
