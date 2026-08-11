// 건축물대장 자동 조회 (주소 -> 법정동코드 변환 후 국토교통부 건축물대장정보 서비스 조회)
// 필요한 API 키 2개 (모두 무료, 본인 명의 발급 필요):
//  1) 행정안전부 도로명주소 API (juso.go.kr) - 주소 -> 법정동코드/지번 변환용
//  2) 공공데이터포털(data.go.kr) 건축물대장정보 서비스(국토교통부) - 실제 대장 조회용
const BldReg = (() => {
  const KEY = "fireInspectionApiKeys";

  function getKeys() {
    try {
      return JSON.parse(localStorage.getItem(KEY)) || {};
    } catch (e) {
      return {};
    }
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

  async function getBuildingRegister(juso, dataGoKrKey) {
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
      numOfRows: "5",
      pageNo: "1"
    });
    const res = await fetch(`https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo?serviceKey=${dataGoKrKey}&${params.toString()}`);
    if (!res.ok) throw new Error("bldreg_http_" + res.status);
    const data = await res.json();
    const header = data.response && data.response.header;
    if (!header || header.resultCode !== "00") {
      throw new Error("bldreg_error: " + (header ? `${header.resultCode} ${header.resultMsg}` : "unknown"));
    }
    const items = data.response.body && data.response.body.items;
    if (!items || items === "") return null;
    let item = items.item;
    if (Array.isArray(item)) item = item[0];
    return item || null;
  }

  // 반환: { juso, item } / item이 null이면 대장을 찾지 못함
  async function lookup(address) {
    const keys = getKeys();
    if (!keys.jusoKey || !keys.dataGoKrKey) {
      const err = new Error("missing_keys");
      err.code = "missing_keys";
      throw err;
    }
    const juso = await lookupAddress(address, keys.jusoKey);
    const item = await getBuildingRegister(juso, keys.dataGoKrKey);
    return { juso, item };
  }

  return { getKeys, saveKeys, lookup };
})();
