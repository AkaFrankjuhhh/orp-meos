(function () {
  if (window.__orpBootFailsafeInstalled) return;
  window.__orpBootFailsafeInstalled = true;

  function releaseBootScreen() {
    if (window.__orpPortalAppReady === true && typeof window.__orpBootReady === "function") window.__orpBootReady();
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
})();
