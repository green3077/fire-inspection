// 건축물대장 자동 조회 (주소 -> 법정동코드 변환 후 국토교통부 건축물대장정보 서비스 조회)
// 필요한 API 키 2개 (모두 무료, 본인 명의 발급 필요):
//  1) 행정안전부 도로명주소 API (juso.go.kr) - 주소 -> 법정동코드/지번 변환용
//  2) 공공데이터포털(data.go.kr) 건축물대장정보 서비스(국토교통부) - 실제 대장 조회용
const BldReg = (() => {
  const KEY = "fireInspectionApiKeys";
  // 외부(GitHub Pages) 접속 시 매번 재입력하지 않도록 기본값으로 내장 - 공개 저장소이므로 키가 노출됨을 인지하고 사용자가 직접 요청함.
  // juso.go.kr 키는 2026-08-11 발급된 임시(테스트) 키(devU01...) 형식이라 며칠 내 만료될 수 있음 - 정식 승인키로 교체 시 아래 값도 갱신 필요.
  const DEFAULT_KEYS = {
    jusoKey: "devU01TX0FVVEgyMDI2MDgxMTEwMjU1NzExOTk2MTE=",
    dataGoKrKey: "CxvoWctkbRsFSxR8Z%2Bpx876r5%2B07L4UY5%2F2VNLFt%2B01QBQwSjGcVqWe1onEs7H06tFLMp3tgh06U%2BZT0hFhNtw%3D%3D"
  };

  function getKeys() {
    let stored;
    try {
      stored = JSON.parse(localStorage.getItem(KEY)) || {};
    } catch (e) {
      stored = {};
    }
    return {
      jusoKey: stored.jusoKey || DEFAULT_KEYS.jusoKey,
      dataGoKrKey: stored.dataGoKrKey || DEFAULT_KEYS.dataGoKrKey
    };
  }

  function saveKeys(keys) {
    localStorage.setItem(KEY, JSON.stringify(keys));
  }

  async function lookupAddress(address, jusoKey) {
    const params = new URLSearchParams({
      confmKey: jusoKey,
      currentPage: "1",
      countPerPage: "1",
      keyword: address,
      resultType: "json"
    });
    const res = await fetch(`https://business.juso.go.kr/addrlink/addrLinkApi.do?${params.toString()}`);
    if (!res.ok) throw new Error("juso_http_" + res.status);
    const data = await res.json();
    const common = data.results && data.results.common;
    if (!common || common.errorCode !== "0") {
      throw new Error("juso_error: " + (common ? `${common.errorCode} ${common.errorMessage}` : "unknown"));
    }
    const juso = data.results.juso && data.results.juso[0];
    if (!juso) throw new Error("juso_not_found");
    return juso;
  }

  // 표제부(getBrTitleInfo)/총괄표제부(getBrRecapTitleInfo)는 요청 파라미터가 동일하므로 공통 처리.
  // 항상 원본 배열 그대로 반환 - 첫 항목만 필요한 호출부는 [0]을, 대지 내 모든 동이 필요한 호출부(층수/구조 집계)는 전체를 사용.
  async function queryBldRegOpList(operation, juso, dataGoKrKey, numOfRows) {
    const admCd = juso.admCd;
    const sigunguCd = admCd.slice(0, 5);
    const bjdongCd = admCd.slice(5, 10);
    const platGbCd = juso.mtYn === "1" ? "1" : "0";
    const bun = (juso.lnbrMnnm || "0").padStart(4, "0");
    const ji = (juso.lnbrSlno || "0").padStart(4, "0");
    // serviceKey는 data.go.kr에서 이미 URL-인코딩된 값으로 발급되므로 URLSearchParams로 다시 인코딩하면 깨진다 (재인코딩 방지 위해 별도로 붙임).
    const params = new URLSearchParams({
      sigunguCd, bjdongCd, platGbCd, bun, ji,
      _type: "json",
      numOfRows: String(numOfRows),
      pageNo: "1"
    });
    const res = await fetch(`https://apis.data.go.kr/1613000/BldRgstHubService/${operation}?serviceKey=${dataGoKrKey}&${params.toString()}`);
    if (!res.ok) throw new Error("bldreg_http_" + res.status);
    const data = await res.json();
    const header = data.response && data.response.header;
    if (!header || header.resultCode !== "00") {
      throw new Error("bldreg_error: " + (header ? `${header.resultCode} ${header.resultMsg}` : "unknown"));
    }
    const items = data.response.body && data.response.body.items;
    if (!items || items === "") return [];
    let item = items.item;
    if (!Array.isArray(item)) item = item ? [item] : [];
    return item;
  }

  async function queryBldRegOp(operation, juso, dataGoKrKey) {
    const list = await queryBldRegOpList(operation, juso, dataGoKrKey, 5);
    return list[0] || null;
  }

  // 총괄표제부: 여러 동으로 이루어진 집합건축물(아파트 단지 등)에만 존재 - 없는 게 정상인 경우가 많음.
  async function getRecapTitleInfo(juso, dataGoKrKey) {
    return queryBldRegOp("getBrRecapTitleInfo", juso, dataGoKrKey);
  }

  // 표제부: 총괄표제부가 없는 일반건축물(단독주택, 상가 등) 및 집합건축물의 개별 동 정보 - 사실상 "일반건축물 정보"에 해당.
  async function getBuildingRegister(juso, dataGoKrKey) {
    return queryBldRegOp("getBrTitleInfo", juso, dataGoKrKey);
  }

  // 대지 내 모든 동의 표제부 목록 - 총괄표제부에는 없는 층수/구조를 동별로 집계하기 위함 (동이 많은 대단지 대비 넉넉히 100건).
  async function getBuildingRegisterList(juso, dataGoKrKey) {
    return queryBldRegOpList("getBrTitleInfo", juso, dataGoKrKey, 100);
  }

  // 여러 동의 표제부에서 층수(최고~최저)와 구조(중복 제거) 집계 - 총괄표제부는 대지 전체 집계값만 갖고
  // 동별 층수/구조는 갖지 않으므로, 그 값이 필요할 때만 이 집계를 사용한다.
  function summarizeFloorsAndStructure(items) {
    let grndMin = null, grndMax = null, ugrndMin = null, ugrndMax = null;
    const structures = [];
    for (const it of items) {
      const g = parseInt(it.grndFlrCnt, 10);
      if (!isNaN(g)) {
        grndMin = grndMin === null ? g : Math.min(grndMin, g);
        grndMax = grndMax === null ? g : Math.max(grndMax, g);
      }
      const u = parseInt(it.ugrndFlrCnt, 10);
      if (!isNaN(u)) {
        ugrndMin = ugrndMin === null ? u : Math.min(ugrndMin, u);
        ugrndMax = ugrndMax === null ? u : Math.max(ugrndMax, u);
      }
      const s = (it.strctCdNm || "").trim();
      if (s && !structures.includes(s)) structures.push(s);
    }
    return { grndMin, grndMax, ugrndMin, ugrndMax, structures };
  }

  // 반환: { juso, item, source, floorSummary } / item이 null이면 대장을 찾지 못함. source: "recap"(총괄표제부) | "title"(표제부/일반건축물)
  // floorSummary: item 자체에 층수/구조 정보가 없을 때(주로 총괄표제부인 경우)만 대지 내 모든 동의 표제부를 조회해 채운 값. 없으면 null.
  async function lookup(address) {
    const keys = getKeys();
    if (!keys.jusoKey || !keys.dataGoKrKey) {
      const err = new Error("missing_keys");
      err.code = "missing_keys";
      throw err;
    }
    const juso = await lookupAddress(address, keys.jusoKey);
    let item = null;
    let source = null;
    try {
      item = await getRecapTitleInfo(juso, keys.dataGoKrKey);
      if (item) source = "recap";
    } catch (e) {
      // 총괄표제부가 없는 건물(대부분의 일반건축물)은 이 API가 정상적으로 에러 응답을 주므로 무시하고 표제부로 폴백.
    }
    if (!item) {
      item = await getBuildingRegister(juso, keys.dataGoKrKey);
      if (item) source = "title";
    }
    let floorSummary = null;
    if (item && (!(item.grndFlrCnt || item.ugrndFlrCnt) || !item.strctCdNm)) {
      try {
        const titleItems = await getBuildingRegisterList(juso, keys.dataGoKrKey);
        floorSummary = summarizeFloorsAndStructure(titleItems);
      } catch (e) {
        // 동별 표제부 목록 조회가 실패해도 이미 얻은 item(연면적 등)은 그대로 유지 - 층수/구조만 비어있게 된다.
      }
    }
    return { juso, item, source, floorSummary };
  }

  return { getKeys, saveKeys, lookup };
})();
