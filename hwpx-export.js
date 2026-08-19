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
  //
  // hwpWidth/hwpHeight: 화면/표 칸에 실제로 그려질 "표시 크기"(hp:orgSz/curSz/sz, HWPUNIT 단위).
  // pixelWidth/pixelHeight: 실제로 저장한 이미지 파일 자체의 픽셀 크기. 이 둘은 서로 다른 단위/의미인데,
  // hc:img의 imgRect/hp:imgClip/hp:imgDim은 "이미지 파일 안에서 어느 픽셀 범위를 보여줄지"를 픽셀
  // 좌표로 나타내는 필드라서 반드시 pixelWidth/pixelHeight를 써야 한다 - 예전 버전은 여기에도 표시
  // 크기(hwpWidth/hwpHeight, 보통 수만 단위)를 그대로 넣는 실수가 있었다. 그러면 뷰어가 "이 이미지는
  // 원래 20000x15000픽셀짜리"라고 잘못 믿고, 실제로는 훨씬 작은 이미지(예: 200x150픽셀)를 그 큰 좌표계의
  // 극히 일부(왼쪽 위 모서리)로 해석해 심하게 확대/뭉개진 상태로 보여주는 원인이 된다 - 사용자가 겪은
  // "사진이 확대되어 표시됨" 문제의 실제 원인.
  function buildPicElement(doc, binaryId, hwpWidth, hwpHeight, pixelWidth, pixelHeight) {
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
    // 아래 세 요소는 표시 크기(hwpWidth/hwpHeight)가 아니라 실제 이미지 파일의 픽셀 크기를 써야 한다 -
    // 위 함수 주석 참고.
    const imgRect = el(doc, "hp:imgRect", {});
    imgRect.appendChild(hcEl(doc, "hc:pt0", { x: "0", y: "0" }));
    imgRect.appendChild(hcEl(doc, "hc:pt1", { x: String(pixelWidth), y: "0" }));
    imgRect.appendChild(hcEl(doc, "hc:pt2", { x: String(pixelWidth), y: String(pixelHeight) }));
    imgRect.appendChild(hcEl(doc, "hc:pt3", { x: "0", y: String(pixelHeight) }));
    pic.appendChild(imgRect);
    pic.appendChild(el(doc, "hp:imgClip", { left: "0", right: String(pixelWidth), top: "0", bottom: String(pixelHeight) }));
    pic.appendChild(el(doc, "hp:inMargin", { left: "0", right: "0", top: "0", bottom: "0" }));
    pic.appendChild(el(doc, "hp:imgDim", { dimwidth: String(pixelWidth), dimheight: String(pixelHeight) }));
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
  //
  // 예전에는 셀 비율에 맞춰 가운데를 기준으로 잘라내(crop) 표 칸을 꽉 채웠으나, 사용자가 "원본 사진의
  // 비율을 절대적으로 유지하고 표에서 잘리지 않게 해달라"고 명시적으로 요청 - 원본을 자르지 않고 그대로
  // 다시 인코딩만 한다. 셀 안에서의 크기 조정(축소, 비율 유지, 안 잘리게)은 setCellPhoto가 담당한다.
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
      const ctx = canvas.getContext("2d");
      // 항상 흰 배경을 먼저 채운다 - 원본이 PNG(스크린샷 등)면 캔버스가 알파 채널을 가진 채
      // 그려지는데, 실제 PC 한글(Hwp.exe)에서 이렇게 나온 RGBA PNG를 hp:pic으로 삽입하면 깨진
      // 그림 아이콘만 뜨고 사진이 아예 안 보이는 문제가 있었다(휴대폰/모바일 뷰어는 같은 파일을
      // 문제없이 보여줘서 오래 못 찾았다 - 실제 Hwp.exe로 직접 열어 재현/확인함). 아래에서 항상
      // JPEG로만 내보내면(알파 채널 자체가 없는 포맷) 이 문제가 사라진다 - 사진에는 어차피 투명도가
      // 필요 없으므로 원본이 PNG였어도 흰 배경으로 깔고 JPEG로 인코딩해도 시각적으로 차이가 없다.
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      const outBlob = await new Promise((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("canvas_encode_failed"))), "image/jpeg", 0.92);
      });
      return { blob: outBlob, width, height };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // 셀 안의 "사진" 안내 문단을 지우고 그림 개체를 넣은 새 문단으로 교체. 이미지가 없으면 "사진 없음" 텍스트만 남김.
  async function setCellPhoto(tc, blob, cellWidthHwp, imageState) {
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

    // SVG(벡터 아이콘/그림)는 실제 현장 사진이 아니다 - <img>로 디코딩 자체는 되는 경우가 많아서
    // (그래서 너비/높이 측정에는 성공) 아래 크기 계산 로직만으로는 걸러지지 않고, 원본이 아주 작은
    // 아이콘 그림을 표 칸 크기까지 억지로 확대해 이상하게 보이는 원인이 된다(실제 사용자가 겪은
    // 문제) - 업로드 시점(app.js)에서도 막지만, 과거에 이미 잘못 저장/백업된 사진을 위한 안전망.
    if (blob.type === "image/svg+xml") {
      const p = templatePara.cloneNode(true);
      setParagraphText(p, "사진을 표시할 수 없습니다 (지원하지 않는 이미지 형식)", "47");
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

    // 원본 비율(width/height)을 그대로 유지한 채 "폭"에 맞춰서만 채운다(자르지 않음) - 표의 칸 폭은
    // 전체 열에 고정된 값이라 반드시 지켜야 하지만, 칸 높이는 한글이 실제 내용(그림 크기)에 맞춰
    // 행을 자동으로 늘려주는 값이다(appendValueLineInLabelCell의 cellSz 관련 주석 참고). 예전에는
    // 폭/높이 둘 다 원래 칸 크기(가로가 긴 landscape 형태, 20308x15293) 안에 들어가도록 축소했는데,
    // 세로로 찍은(portrait) 현장 사진은 그러면 높이가 먼저 꽉 차서 폭이 칸의 절반 정도로만 줄어들어
    // "사진이 작게(칸 절반만 차지) 나온다"는 문제가 있었다 - 높이는 어차피 행이 알아서 늘어나므로,
    // 항상 폭 기준으로만 맞추면 세로 사진도 칸 폭을 꽉 채우고(행만 자동으로 길어짐) 잘리지도 않는다.
    const maxW = cellWidthHwp - 200;
    const scale = maxW / width;
    const hwpWidth = Math.max(1000, Math.round(width * scale));
    const hwpHeight = Math.max(1000, Math.round(height * scale));

    // normalizeImagePhoto가 이제 항상 JPEG로 인코딩하므로(PC 한글의 RGBA PNG 렌더링 실패 회피) 고정값.
    const ext = "jpg";
    const mediaType = "image/jpeg";
    const imageIndex = ++imageState.count;
    const binaryId = `image${imageIndex}`;
    const buf = await normalizedBlob.arrayBuffer();
    imageState.zip.file(`BinData/${binaryId}.${ext}`, buf);
    imageState.manifestItems.push({ id: binaryId, href: `BinData/${binaryId}.${ext}`, mediaType });

    const p = templatePara.cloneNode(true);
    Array.from(p.getElementsByTagNameNS(HP, "run")).forEach((r) => r.remove());
    Array.from(p.getElementsByTagNameNS(HP, "linesegarray")).forEach((r) => r.remove());
    const run = el(doc, "hp:run", { charPrIDRef: "47" });
    run.appendChild(buildPicElement(doc, binaryId, hwpWidth, hwpHeight, width, height));
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

    const rowWidthHwp = 20308; // 템플릿 사진 칸 폭 (샘플 파일 기준) - 높이는 한글이 내용에 맞춰 자동으로 늘리므로 필요 없음

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

      // photoMap은 app.js에서 FireDB.getPhotosBySite() 결과(+구글 드라이브에서 보충한 것)를 id 기준으로
      // 매핑한 것 - 값은 Blob이 아니라 { id, siteId, itemId, role, blob, ... } 사진 레코드 전체이므로
      // .blob으로 꺼내 써야 한다. beforePhotoIds/afterPhotoIds는 촬영/업로드한 순서대로 뒤에 추가되므로
      // (onDeficiencyPhotoSelected가 항상 push) 배열의 마지막 항목이 가장 최근에 올린 사진이다 - 한
      // 칸에는 한 장만 넣을 수 있어 그 중 하나를 골라야 하는데, 가장 최근 것을 우선한다. 배열 앞쪽부터
      // 찾으면(구글 드라이브 보충 이후로는 대부분의 id가 뭔가는 찾아지므로) 오래된 사진이 최신 사진을
      // 밀어내고 채워지는 문제가 있었다(실제 사용자가 겪은 문제: "내가 올린 사진이 아니라 이상한
      // 사진으로 채워짐") - 뒤에서부터 찾아 항상 가장 최근 것이 이기도록 한다.
      const beforePhoto = (def.beforePhotoIds || []).map((id) => photoMap.get(id)).filter(Boolean).pop() || null;
      const afterPhoto = (def.afterPhotoIds || []).map((id) => photoMap.get(id)).filter(Boolean).pop() || null;
      await setCellPhoto(beforeTc, beforePhoto ? beforePhoto.blob : null, rowWidthHwp, imageState);
      await setCellPhoto(afterTc, afterPhoto ? afterPhoto.blob : null, rowWidthHwp, imageState);

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
