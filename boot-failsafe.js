(function () {
  if (window.__orpBootFailsafeInstalled) return;
  window.__orpBootFailsafeInstalled = true;

  var released = false;
  var loaderSelectors = [
    "[data-portal-boot]",
    "[data-app-loader]",
    "#orp-boot-screen",
    "#portalBootScreen",
    ".portal-boot",
    ".portal-boot-screen",
    ".portal-loading-screen",
    ".portal-loader",
    ".app-boot-screen"
  ];

  function markReady() {
    if (document.documentElement) {
      document.documentElement.classList.add(
        "orp-app-loaded",
        "orp-app-ready",
        "app-loaded",
        "portal-ready",
        "is-ready"
      );
      document.documentElement.classList.remove("orp-app-booting", "orp-app-load-error");
    }

    if (document.body) {
      document.body.classList.add(
        "orp-app-loaded",
        "orp-app-ready",
        "app-loaded",
        "portal-ready",
        "is-ready"
      );
      document.body.classList.remove("portal-loading", "app-loading", "is-loading");
    }
  }

  function hideElement(element) {
    if (!element || element === document.body || element === document.documentElement) return;

    element.setAttribute("aria-hidden", "true");
    element.classList.add("is-hidden", "hidden");
    element.hidden = true;
    element.style.setProperty("display", "none", "important");
    element.style.setProperty("visibility", "hidden", "important");
    element.style.setProperty("pointer-events", "none", "important");
  }

  function hideKnownLoaders() {
    loaderSelectors.forEach(function (selector) {
      document.querySelectorAll(selector).forEach(hideElement);
    });
  }

  function hideTextLoader() {
    var nodes = document.querySelectorAll("body h1, body h2, body h3, body p, body strong, body div");

    nodes.forEach(function (element) {
      var text = element.textContent || "";
      if (text.indexOf("Portaal laden") === -1) return;

      var loader = element.closest(loaderSelectors.join(", "));
      if (!loader) {
        loader = element.parentElement;

        while (loader && loader.parentElement && loader.parentElement !== document.body) {
          var loaderText = loader.textContent || "";
          if (
            loaderText.indexOf("Portaal laden") !== -1 &&
            loaderText.indexOf("beveiligde omgeving") !== -1
          ) {
            break;
          }
          loader = loader.parentElement;
        }
      }

      hideElement(loader || element.parentElement);
    });
  }

  function releaseBootScreen() {
    if (released) return;
    released = true;

    markReady();
    hideKnownLoaders();
    hideTextLoader();
  }

  var previousRelease = window.__orpReleaseBootScreen;
  window.__orpBootFailsafeRelease = releaseBootScreen;
  window.__orpReleaseBootScreen = function () {
    if (typeof previousRelease === "function") {
      try {
        previousRelease();
      } catch (error) {
        console.warn("Portal boot release failed", error);
      }
    }
    releaseBootScreen();
  };

  function scheduleRelease(delay) {
    window.setTimeout(releaseBootScreen, delay);
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      function () {
        scheduleRelease(3500);
      },
      { once: true }
    );
  } else {
    scheduleRelease(1500);
  }

  if (document.readyState === "complete") {
    scheduleRelease(1200);
  } else {
    window.addEventListener(
      "load",
      function () {
        scheduleRelease(1200);
      },
      { once: true }
    );
  }

  window.addEventListener("error", function () {
    scheduleRelease(250);
  });

  window.addEventListener("unhandledrejection", function () {
    scheduleRelease(250);
  });

  scheduleRelease(8000);
})();
