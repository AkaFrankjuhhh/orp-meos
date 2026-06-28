(function () {
  if (window.__orpExternalLoaderFailsafe) return;
  window.__orpExternalLoaderFailsafe = true;

  var loaderSelectors = [
    "#portalBootLoader",
    "#portalLoadingScreen",
    "#portalLoader",
    "#appLoader",
    "#bootLoader",
    "[data-portal-loader]",
    "[data-app-loader]",
    "[data-boot-loader]",
    ".portal-loader",
    ".portal-loading-screen",
    ".portal-boot-loader",
    ".portal-boot-screen",
    ".boot-loader",
    ".boot-screen",
    ".app-loader",
    ".app-loading-screen",
    ".loading-screen",
    ".loading-overlay",
    ".splash-screen"
  ];

  var appRootSelectors = [
    "#app",
    "#root",
    "main",
    "[data-app-root]",
    ".app",
    ".app-shell",
    ".layout-shell",
    ".portal-shell"
  ];

  function revealDocument() {
    if (!document.documentElement || !document.body) return;
    document.documentElement.classList.add("orp-app-ready");
    document.documentElement.classList.remove("orp-app-loading", "is-loading", "loading");
    document.documentElement.style.visibility = "visible";
    document.documentElement.style.opacity = "1";
    document.body.classList.remove("orp-app-loading", "is-loading", "loading");
    document.body.style.visibility = "visible";
    document.body.style.opacity = "1";
    document.body.style.overflow = "";

    appRootSelectors.forEach(function (selector) {
      document.querySelectorAll(selector).forEach(function (element) {
        element.style.visibility = "visible";
        element.style.opacity = "1";
      });
    });
  }

  function hideKnownLoaders() {
    loaderSelectors.forEach(function (selector) {
      document.querySelectorAll(selector).forEach(function (element) {
        element.style.display = "none";
        element.style.visibility = "hidden";
        element.style.opacity = "0";
        element.setAttribute("aria-hidden", "true");
      });
    });
  }

  function hideTextLoader() {
    if (!document.body) return;
    document.querySelectorAll("body *").forEach(function (element) {
      var text = (element.textContent || "").replace(/\s+/g, " ").trim();
      if (text.length > 700) return;
      if (text.indexOf("Portaal laden") !== -1 && text.indexOf("beveiligde omgeving") !== -1) {
        element.style.display = "none";
        element.style.visibility = "hidden";
        element.style.opacity = "0";
        element.setAttribute("aria-hidden", "true");
      }
    });
  }

  function releaseBootScreen() {
    revealDocument();
    hideKnownLoaders();
    hideTextLoader();
  }

  window.__orpReleaseBootScreen = releaseBootScreen;

  function scheduleRelease(delayMs) {
    window.setTimeout(releaseBootScreen, delayMs);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      scheduleRelease(1200);
    }, { once: true });
  } else {
    scheduleRelease(1200);
  }

  window.addEventListener("load", function () {
    scheduleRelease(1200);
  }, { once: true });

  window.addEventListener("error", function () {
    scheduleRelease(300);
  });

  window.addEventListener("unhandledrejection", function () {
    scheduleRelease(300);
  });

  scheduleRelease(8000);
})();
