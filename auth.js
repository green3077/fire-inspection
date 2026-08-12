// 외부 접속(공인 도메인, 예: GitHub Pages) 시 아이디/비밀번호 로그인을 요구한다.
// 사무실 LAN(휴대폰 등, serve.py를 192.168.x.x 등으로 접속)이나 로컬 개발(localhost)은
// 이미 신뢰된 접근으로 보고 게이트를 걸지 않는다.
(function (global) {
  "use strict";

  const DEFAULT_USERNAME = "5275";
  const DEFAULT_PASSWORD = "5275";
  const KEY_USERNAME = "fireinspect_auth_username";
  const KEY_PASSWORD = "fireinspect_auth_password";
  const KEY_LOGGED_IN = "fireinspect_logged_in";

  function isPrivateOrLocalHost(hostname) {
    if (!hostname || hostname === "localhost" || hostname === "127.0.0.1") return true;
    if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
    if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
    return false;
  }

  function isGateRequired() {
    return !isPrivateOrLocalHost(global.location.hostname);
  }

  function getUsername() {
    return localStorage.getItem(KEY_USERNAME) || DEFAULT_USERNAME;
  }

  function getPassword() {
    return localStorage.getItem(KEY_PASSWORD) || DEFAULT_PASSWORD;
  }

  function isLoggedIn() {
    return !isGateRequired() || localStorage.getItem(KEY_LOGGED_IN) === "1";
  }

  function tryLogin(username, password) {
    if (String(username || "") === getUsername() && String(password || "") === getPassword()) {
      localStorage.setItem(KEY_LOGGED_IN, "1");
      return true;
    }
    return false;
  }

  function logout() {
    localStorage.removeItem(KEY_LOGGED_IN);
  }

  function changeCredentials(newUsername, newPassword) {
    const username = String(newUsername || "").trim() || getUsername();
    const password = String(newPassword || "").trim() || getPassword();
    localStorage.setItem(KEY_USERNAME, username);
    localStorage.setItem(KEY_PASSWORD, password);
  }

  global.Auth = {
    isGateRequired,
    isLoggedIn,
    tryLogin,
    logout,
    getUsername,
    changeCredentials,
  };
})(window);
