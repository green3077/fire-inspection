// 구글 드라이브 자동 저장 - 외부(GitHub Pages) 접속 시 업로드/생성되는 파일을 사용자 본인 구글 드라이브에 백업.
// GIS(Google Identity Services) 토큰 클라이언트 사용, 서버 없이 브라우저에서 직접 Drive REST API 호출.
// drive.file 스코프(이 앱이 만든 파일에만 접근) + userinfo.email(로그인 이메일 표시용)만 요청.
(function (global) {
  "use strict";

  const CLIENT_ID = "241380622667-7ivkno58obn28fafd7g69al8798e9cgc.apps.googleusercontent.com";
  const SCOPES = "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email";
  const EVER_SIGNED_IN_KEY = "fireinspect_drive_ever_signed_in";
  const ROOT_FOLDER_NAME = "조은소방_자동저장";

  let tokenClient = null;
  let accessToken = null;
  let tokenExpiry = 0;
  let cachedEmail = null;
  const folderCache = new Map();

  function loadGisScript() {
    return new Promise((resolve, reject) => {
      if (global.google && global.google.accounts && global.google.accounts.oauth2) return resolve();
      const existing = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
      if (existing) {
        existing.addEventListener("load", () => resolve());
        existing.addEventListener("error", () => reject(new Error("gis_script_load_failed")));
        return;
      }
      const s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("gis_script_load_failed"));
      document.head.appendChild(s);
    });
  }

  async function ensureTokenClient() {
    await loadGisScript();
    if (!tokenClient) {
      tokenClient = global.google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: () => {},
      });
    }
    return tokenClient;
  }

  function requestToken(prompt) {
    return new Promise((resolve, reject) => {
      ensureTokenClient()
        .then((client) => {
          client.callback = (resp) => {
            if (resp.error) return reject(new Error(resp.error));
            accessToken = resp.access_token;
            tokenExpiry = Date.now() + (Number(resp.expires_in || 3600) - 60) * 1000;
            localStorage.setItem(EVER_SIGNED_IN_KEY, "1");
            resolve(accessToken);
          };
          client.requestAccessToken({ prompt });
        })
        .catch(reject);
    });
  }

  async function signIn() {
    const token = await requestToken("consent");
    cachedEmail = await fetchEmail(token);
    return { token, email: cachedEmail };
  }

  async function trySilentSignIn() {
    if (!localStorage.getItem(EVER_SIGNED_IN_KEY)) return null;
    try {
      const token = await requestToken("");
      cachedEmail = await fetchEmail(token);
      return { token, email: cachedEmail };
    } catch (err) {
      return null;
    }
  }

  async function getToken() {
    if (accessToken && Date.now() < tokenExpiry) return accessToken;
    return requestToken("");
  }

  async function fetchEmail(token) {
    try {
      const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data.email || null;
    } catch (err) {
      return null;
    }
  }

  function isConnected() {
    return !!localStorage.getItem(EVER_SIGNED_IN_KEY);
  }

  function getEmail() {
    return cachedEmail;
  }

  function signOut() {
    localStorage.removeItem(EVER_SIGNED_IN_KEY);
    accessToken = null;
    tokenExpiry = 0;
    cachedEmail = null;
    folderCache.clear();
  }

  function escapeForQuery(name) {
    return String(name).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  }

  function sanitizeName(name) {
    return String(name || "제목없음").replace(/[\\/:*?"<>|]/g, "_").trim() || "제목없음";
  }

  async function findFolder(name, parentId) {
    const token = await getToken();
    const parent = parentId || "root";
    const q = `name='${escapeForQuery(name)}' and '${parent}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error("drive_query_failed_" + res.status);
    const data = await res.json();
    return (data.files && data.files[0] && data.files[0].id) || null;
  }

  async function createFolder(name, parentId) {
    const token = await getToken();
    const body = { name, mimeType: "application/vnd.google-apps.folder" };
    if (parentId) body.parents = [parentId];
    const res = await fetch("https://www.googleapis.com/drive/v3/files", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error("drive_folder_create_failed_" + res.status);
    const data = await res.json();
    return data.id;
  }

  async function findOrCreateFolder(name, parentId) {
    const found = await findFolder(name, parentId);
    if (found) return found;
    return createFolder(name, parentId);
  }

  async function resolveFolderPath(parts) {
    const key = parts.join("/");
    if (folderCache.has(key)) return folderCache.get(key);
    let parentId = null;
    let cumKey = "";
    for (const part of parts) {
      cumKey = cumKey ? `${cumKey}/${part}` : part;
      if (folderCache.has(cumKey)) {
        parentId = folderCache.get(cumKey);
        continue;
      }
      const id = await findOrCreateFolder(part, parentId);
      folderCache.set(cumKey, id);
      parentId = id;
    }
    return parentId;
  }

  async function findFileByName(name, parentId) {
    const token = await getToken();
    const q = `name='${escapeForQuery(name)}' and '${parentId}' in parents and trashed=false`;
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error("drive_query_failed_" + res.status);
    const data = await res.json();
    return (data.files && data.files[0] && data.files[0].id) || null;
  }

  async function uploadFile(name, blob, parentId) {
    const token = await getToken();
    const existingId = await findFileByName(name, parentId);
    const metadata = existingId ? { name } : { name, parents: [parentId] };
    const form = new FormData();
    form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
    form.append("file", blob);
    const url = existingId
      ? `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=multipart`
      : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;
    const res = await fetch(url, {
      method: existingId ? "PATCH" : "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    if (!res.ok) throw new Error("drive_upload_failed_" + res.status);
    return res.json();
  }

  // 항상 non-throwing: 연결 안 돼 있거나 실패해도 앱의 로컬 저장/기존 흐름을 절대 막지 않는다.
  async function uploadToSite(siteName, category, filename, blob) {
    if (!isConnected() || !blob) return null;
    try {
      const folderId = await resolveFolderPath([ROOT_FOLDER_NAME, sanitizeName(siteName || "미지정 현장"), category]);
      return await uploadFile(sanitizeName(filename), blob, folderId);
    } catch (err) {
      console.warn("[DriveBackup] upload failed:", err);
      return null;
    }
  }

  global.DriveBackup = {
    signIn,
    signOut,
    trySilentSignIn,
    isConnected,
    getEmail,
    uploadToSite,
  };
})(window);
