(function () {
  if (window.__orpExternalLoaderFailsafe) return;
  window.__orpExternalLoaderFailsafe = true;

  function releaseBootScreen() {
    if (window.__orpPortalAppReady === true && typeof window.__orpBootReady === "function") window.__orpBootReady();
  }

  window.__orpReleaseBootScreen = releaseBootScreen;
})();
