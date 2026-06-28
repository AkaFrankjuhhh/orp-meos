(function () {
  var root = document.documentElement;
  var bootTimer = window.setTimeout(function () {
    showBootError("Portaal laden duurt te lang. Vernieuw de pagina; blijft dit gebeuren, sluit de browser volledig en open het portaal opnieuw.");
  }, 12000);

  function updateBootErrorMessage(message) {
    if (!message) return;
    var messageElement = document.querySelector(".orp-boot-error-message");
    if (messageElement) messageElement.textContent = message;
  }

  function releaseBoot() {
    window.clearTimeout(bootTimer);
    if (root.classList.contains("orp-app-load-error")) return;
    root.classList.remove("orp-app-booting");
    root.classList.add("orp-app-ready");
  }

  function showBootError(message) {
    window.clearTimeout(bootTimer);
    if (root.classList.contains("orp-app-ready")) return;
    updateBootErrorMessage(message);
    root.classList.remove("orp-app-booting");
    root.classList.add("orp-app-load-error");
  }

  function scheduleBootRelease(delay) {
    window.setTimeout(releaseBoot, delay);
  }

  window.__orpBootReady = releaseBoot;
  window.__orpBootFail = showBootError;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      scheduleBootRelease(150);
    }, { once: true });
  } else {
    scheduleBootRelease(150);
  }

  window.addEventListener("load", function () {
    scheduleBootRelease(80);
  }, { once: true });

  window.addEventListener("error", function (event) {
    var target = event.target;
    if (!target || !target.tagName) return;
    var tag = target.tagName.toUpperCase();
    var rel = String(target.rel || "").toLowerCase();
    if ((tag === "LINK" && rel.indexOf("stylesheet") !== -1) || tag === "SCRIPT") {
      showBootError("Een stijlbestand of script kon niet laden. Vernieuw de pagina; blijft dit gebeuren, controleer netwerk/cache.");
    }
  }, true);

  document.addEventListener("click", function (event) {
    var button = event.target.closest("[data-boot-reload]");
    if (button) window.location.reload();
  });
})();
