(function () {
  var root = document.documentElement;
  var fatalLoadError = false;
  var stylesheetVerifyAttempts = 0;
  var stylesheetVerifyTimer = 0;
  var maxStylesheetVerifyAttempts = 8;
  var stylesheetVerifyDelayMs = 250;
  var criticalStylesheetPaths = {
    "/shared.css": true,
    "/personeelsportaal.css": true
  };
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

  function assetPath(target) {
    var value = target && (target.href || target.src);
    if (!value) return "onbekend bestand";
    try {
      return new URL(value, window.location.href).pathname;
    } catch (error) {
      return String(value);
    }
  }

  function isStylesheetLink(target) {
    if (!target || !target.tagName) return false;
    var tag = target.tagName.toUpperCase();
    var rel = String(target.rel || "").toLowerCase();
    return tag === "LINK" && rel.indexOf("stylesheet") !== -1;
  }

  function isCriticalStylesheet(target) {
    if (!isStylesheetLink(target)) return false;
    if (target.dataset && target.dataset.orpCriticalStylesheet === "1") return true;
    return criticalStylesheetPaths[assetPath(target)] === true;
  }

  function criticalStylesheetLinks() {
    var links = document.querySelectorAll('link[rel~="stylesheet"]');
    var critical = [];
    for (var index = 0; index < links.length; index += 1) {
      if (isCriticalStylesheet(links[index])) critical.push(links[index]);
    }
    return critical;
  }

  window.addEventListener("error", function (event) {
    var target = event.target;
    if (target && target.tagName) {
      var tag = target.tagName.toUpperCase();
      var rel = String(target.rel || "").toLowerCase();
      if (tag === "LINK" && rel.indexOf("stylesheet") !== -1) {
        if (!isCriticalStylesheet(target)) return;
        if (target.dataset) target.dataset.orpLoadError = "1";
        showBootError("Stijlbestand kon niet laden: " + assetPath(target) + ". Vernieuw de pagina; blijft dit gebeuren, controleer netwerk/cache.", { fatal: true });
      } else if (tag === "SCRIPT") {
        showBootError("Script kon niet laden: " + assetPath(target) + ". Vernieuw de pagina; blijft dit gebeuren, controleer netwerk/cache.", { fatal: true });
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

  function markStylesheetLoad(link) {
    if (link.dataset) link.dataset.orpLoaded = "1";
  }

  function trackCriticalStylesheets() {
    var links = criticalStylesheetLinks();
    for (var index = 0; index < links.length; index += 1) {
      var link = links[index];
      if (link.dataset && link.dataset.orpBootTracked === "1") continue;
      if (link.dataset) link.dataset.orpBootTracked = "1";
      link.addEventListener("load", function (event) {
        markStylesheetLoad(event.currentTarget);
      });
      link.addEventListener("error", function (event) {
        if (event.currentTarget && event.currentTarget.dataset) event.currentTarget.dataset.orpLoadError = "1";
      });
      if (link.sheet) markStylesheetLoad(link);
    }
  }

  function stylesheetIsAvailable(link) {
    if (!link) return true;
    if (link.dataset && link.dataset.orpLoadError === "1") return false;
    if (link.sheet || (link.dataset && link.dataset.orpLoaded === "1")) return true;
    var href = link.href;
    for (var index = 0; index < document.styleSheets.length; index += 1) {
      var sheet = document.styleSheets[index];
      if (sheet.ownerNode === link || sheet.href === href) return true;
    }
    return false;
  }

  function verifyCriticalStylesheets() {
    trackCriticalStylesheets();
    var links = criticalStylesheetLinks();
    var missing = [];
    for (var index = 0; index < links.length; index += 1) {
      if (!stylesheetIsAvailable(links[index])) {
        missing.push(assetPath(links[index]));
      }
    }
    if (!missing.length) {
      stylesheetVerifyAttempts = 0;
      return;
    }
    if (stylesheetVerifyAttempts < maxStylesheetVerifyAttempts) {
      stylesheetVerifyAttempts += 1;
      window.clearTimeout(stylesheetVerifyTimer);
      stylesheetVerifyTimer = window.setTimeout(verifyCriticalStylesheets, stylesheetVerifyDelayMs);
      return;
    }
    showBootError("Een stijlbestand kon niet laden: " + missing.join(", ") + ". Vernieuw de pagina; blijft dit gebeuren, controleer netwerk/cache.", { fatal: true });
  }

  trackCriticalStylesheets();

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
