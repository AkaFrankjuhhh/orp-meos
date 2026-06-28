(function () {
  function showLockError(message) {
    var target = document.getElementById("lockError");
    if (!target) return;
    target.textContent = "Browserfout: " + message;
    target.hidden = false;
  }

  function reportClientError(payload) {
    fetch("/api/client-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).catch(function () {});
  }

  window.addEventListener("error", function (event) {
    var message = event.message || "Onbekende browserfout";
    showLockError(message);
    reportClientError({
      message: message,
      source: event.filename || "",
      line: event.lineno || "",
      page: location.href
    });
  });

  window.addEventListener("unhandledrejection", function (event) {
    var reason = event.reason && (event.reason.stack || event.reason.message) || String(event.reason || "Onbekende promise fout");
    showLockError(reason);
    reportClientError({
      message: reason,
      source: "unhandledrejection",
      line: "",
      page: location.href
    });
  });
})();
