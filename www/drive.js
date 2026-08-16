// 구글 드라이브 자동 저장 - 업로드/생성되는 파일을 사장님의 구글 드라이브 한 곳으로 자동 백업.
// 방문자 개인 로그인 없이, 전용 Cloudflare Worker(fire-inspection-drive-proxy)가 사장님 계정의
// refresh token으로 Drive API를 대신 호출한다. 이 파일은 그 Worker에 파일을 POST하기만 하면 된다.
(function (global) {
  "use strict";

  const PROXY_URL = "https://fire-inspection-drive-proxy.cigar-log-gemini-proxy.workers.dev";
  const APP_SECRET = "jeeun-fire-9417";
  const ENABLED_KEY = "fireinspect_drive_backup_enabled";

  function isEnabled() {
    const v = localStorage.getItem(ENABLED_KEY);
    return v === null ? true : v === "1";
  }

  function setEnabled(v) {
    localStorage.setItem(ENABLED_KEY, v ? "1" : "0");
  }

  function sanitizeName(name) {
    return String(name || "제목없음").replace(/[\\/:*?"<>|]/g, "_").trim() || "제목없음";
  }

  // 항상 non-throwing: 꺼져 있거나 네트워크 실패해도 앱의 로컬 저장/기존 흐름을 절대 막지 않는다.
  async function uploadToSite(siteName, category, filename, blob) {
    if (!blob || !isEnabled()) return null;
    try {
      const form = new FormData();
      form.append("siteName", sanitizeName(siteName || "미지정 현장"));
      form.append("category", category);
      form.append("filename", sanitizeName(filename));
      form.append("file", blob);
      const res = await fetch(PROXY_URL, {
        method: "POST",
        headers: { "x-app-secret": APP_SECRET },
        body: form,
      });
      if (!res.ok) throw new Error("drive_proxy_failed_" + res.status);
      return await res.json();
    } catch (err) {
      console.warn("[DriveBackup] upload failed:", err);
      return null;
    }
  }

  global.DriveBackup = {
    isEnabled,
    setEnabled,
    uploadToSite,
  };
})(window);
