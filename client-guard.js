(function () {
  const host = window.location.hostname;
  const isLocal = host === "localhost" || host === "127.0.0.1" || host === "::1";
  if (isLocal || window.__ORP_ALLOW_DEVTOOLS__ === true) return;

  const blockedKeys = new Set(["F12"]);
  const blockedCombos = [
    (event) => event.ctrlKey && event.shiftKey && ["I", "J", "C"].includes(event.key.toUpperCase()),
    (event) => event.ctrlKey && event.key.toUpperCase() === "U"
  ];

  document.addEventListener("contextmenu", (event) => {
    event.preventDefault();
  });

  document.addEventListener("keydown", (event) => {
    if (blockedKeys.has(event.key) || blockedCombos.some((matches) => matches(event))) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);
}());
