(function () {
  var root = document.documentElement;
  var fatalLoadError = false;
  var bootTimer = window.setTimeout(function () {
    showBootError("Portaal laden duurt te lang. Vernieuw de pagina; blijft dit gebeuren, sluit de browser volledig en open het portaal opnieuw.");
  }, 20000);

  function updateBootErrorMessage(message) {
    if (!message) return;
    var messageElement = document.querySelector(".orp-boot-error-message");
    if (messageElement) messageElement.textContent = message;
  }

  function releaseBoot() {
    window.clearTimeout(bootTimer);
    if (fatalLoadError) return;
    root.classList.remove("orp-app-booting", "orp-app-load-error");
    root.classList.add("orp-app-ready");
  }

  function showBootError(message, options) {
    var fatal = options && options.fatal;
    window.clearTimeout(bootTimer);
    if (root.classList.contains("orp-app-ready") && !fatal) return;
    if (fatal) fatalLoadError = true;
    updateBootErrorMessage(message);
    root.classList.remove("orp-app-booting", "orp-app-ready");
    root.classList.add("orp-app-load-error");
  }

  window.__orpBootReady = releaseBoot;
  window.__orpBootFail = showBootError;

  window.addEventListener("error", function (event) {
    var target = event.target;
    if (target && target.tagName) {
      var tag = target.tagName.toUpperCase();
      var rel = String(target.rel || "").toLowerCase();
      if ((tag === "LINK" && rel.indexOf("stylesheet") !== -1) || tag === "SCRIPT") {
        showBootError("Een stijlbestand of script kon niet laden. Vernieuw de pagina; blijft dit gebeuren, controleer netwerk/cache.", { fatal: true });
      }
      return;
    }
    if (root.classList.contains("orp-app-booting")) {
      showBootError("Het portaal kon niet volledig starten door een browserfout. Vernieuw de pagina en probeer opnieuw.");
    }
  }, true);

  window.addEventListener("unhandledrejection", function () {
    if (root.classList.contains("orp-app-booting")) {
      showBootError("Het portaal kon niet volledig starten door een browserfout. Vernieuw de pagina en probeer opnieuw.");
    }
  }, true);

  function stylesheetIsAvailable(link) {
    var href = link.href;
    for (var index = 0; index < document.styleSheets.length; index += 1) {
      if (document.styleSheets[index].href === href) return true;
    }
    return false;
  }

  function verifyCriticalStylesheets() {
    var links = document.querySelectorAll('link[rel~="stylesheet"]');
    for (var index = 0; index < links.length; index += 1) {
      if (!stylesheetIsAvailable(links[index])) {
        showBootError("Een stijlbestand kon niet laden. Vernieuw de pagina; blijft dit gebeuren, controleer netwerk/cache.", { fatal: true });
        return;
      }
    }
  }

  if (document.readyState === "complete") {
    window.setTimeout(verifyCriticalStylesheets, 0);
  } else {
    window.addEventListener("load", function () {
      verifyCriticalStylesheets();
    }, { once: true });
  }

  document.addEventListener("click", function (event) {
    var button = event.target.closest("[data-boot-reload]");
    if (button) window.location.reload();
  });
})();
