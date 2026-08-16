// 커스텀 토스트 / 확인 모달 (native alert/confirm 대체)
function toast(message, type) {
  const container = document.getElementById("toastContainer");
  const el = document.createElement("div");
  el.className = "toast" + (type === "error" ? " toast-error" : "");
  el.textContent = message;
  container.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 300);
  }, 2800);
}

function confirmDialog(message) {
  const modal = document.getElementById("confirmModal");
  const msgEl = document.getElementById("confirmMessage");
  const okBtn = document.getElementById("confirmOkBtn");
  const cancelBtn = document.getElementById("confirmCancelBtn");
  msgEl.textContent = message;
  modal.classList.remove("hidden");
  return new Promise((resolve) => {
    function cleanup(result) {
      modal.classList.add("hidden");
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      resolve(result);
    }
    function onOk() { cleanup(true); }
    function onCancel() { cleanup(false); }
    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
  });
}

// "pdf" | "hwpx" | null(취소) 반환
function pickShareFormat() {
  const modal = document.getElementById("shareFormatModal");
  const pdfBtn = document.getElementById("shareFormatPdfBtn");
  const hwpxBtn = document.getElementById("shareFormatHwpxBtn");
  const cancelBtn = document.getElementById("shareFormatCancelBtn");
  modal.classList.remove("hidden");
  return new Promise((resolve) => {
    function cleanup(result) {
      modal.classList.add("hidden");
      pdfBtn.removeEventListener("click", onPdf);
      hwpxBtn.removeEventListener("click", onHwpx);
      cancelBtn.removeEventListener("click", onCancel);
      resolve(result);
    }
    function onPdf() { cleanup("pdf"); }
    function onHwpx() { cleanup("hwpx"); }
    function onCancel() { cleanup(null); }
    pdfBtn.addEventListener("click", onPdf);
    hwpxBtn.addEventListener("click", onHwpx);
    cancelBtn.addEventListener("click", onCancel);
  });
}
