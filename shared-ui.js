(function () {
  const query = (selector, root = document) => root.querySelector(selector);
  const queryAll = (selector, root = document) => [...root.querySelectorAll(selector)];
  const uiModeStorageKey = "orp-ui-mode";
  const uiModeCookieName = "orp_ui_mode";
  const uiModes = new Set(["classic", "calm"]);

  // Gedeelde HTML escape voor alle frontendtemplates.
  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function normalizeDialogText(value) {
    if (value == null) return "";
    if (typeof value === "string") return value;
    if (typeof value.message === "string") return value.message;
    if (typeof value.error === "string") return value.error;
    if (typeof value.body === "string") return value.body;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  function formatDate(value) {
    if (!value) return "-";
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
    if (!match) return value;
    return `${match[3]}/${match[2]}/${match[1]}`;
  }

  function formatDateTime(value) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return formatDate(value);
    return date.toLocaleString("nl-NL", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  // EÃ©n nette dialog-helper voor Defensie Personeelsportaal en Porto, met optionele keuzelijst.
  function createNoticeDialog(options = {}) {
    const id = options.id || "siteNoticeDialog";
    const className = options.className || "site-notice-dialog";
    const titleAttr = `data-${id}-title`;
    const messageAttr = `data-${id}-message`;
    const actionsAttr = `data-${id}-actions`;
    const choicesAttr = `data-${id}-choices`;
    const closeAttr = `data-${id}-close`;

    function ensureDialog() {
      let dialog = document.getElementById(id);
      if (dialog) return dialog;
      dialog = document.createElement("dialog");
      dialog.id = id;
      dialog.className = className;
      dialog.innerHTML = `
        <form method="dialog" class="dialog-form site-notice-card">
          <div class="panel-head">
            <h2 ${titleAttr}>Melding</h2>
            <button class="ghost icon" value="cancel" type="button" ${closeAttr}>&times;</button>
          </div>
          <p class="muted" ${messageAttr}></p>
          <div class="site-choice-list" ${choicesAttr} hidden></div>
          <menu ${actionsAttr}></menu>
        </form>`;
      document.body.appendChild(dialog);
      dialog.querySelector(`[${closeAttr}]`).addEventListener("click", () => dialog.close("cancel"));
      return dialog;
    }

    function showNotice(message, title = "Melding") {
      return new Promise((resolve) => {
        const dialog = ensureDialog();
        dialog.returnValue = "";
        dialog.querySelector(`[${titleAttr}]`).textContent = normalizeDialogText(title);
        dialog.querySelector(`[${messageAttr}]`).textContent = normalizeDialogText(message);
        dialog.querySelector(`[${choicesAttr}]`).hidden = true;
        dialog.querySelector(`[${actionsAttr}]`).innerHTML = '<button class="primary" value="ok" type="submit">Ok</button>';
        dialog.addEventListener("close", () => resolve(true), { once: true });
        dialog.showModal();
      });
    }

    function showConfirm(message, title = "Weet je het zeker?") {
      return new Promise((resolve) => {
        const dialog = ensureDialog();
        dialog.returnValue = "";
        dialog.querySelector(`[${titleAttr}]`).textContent = normalizeDialogText(title);
        dialog.querySelector(`[${messageAttr}]`).textContent = normalizeDialogText(message);
        dialog.querySelector(`[${choicesAttr}]`).hidden = true;
        dialog.querySelector(`[${actionsAttr}]`).innerHTML = `
          <button class="ghost" value="cancel" type="submit">Annuleren</button>
          <button class="primary danger" value="confirm" type="submit">Bevestigen</button>`;
        dialog.addEventListener("close", () => resolve(dialog.returnValue === "confirm"), { once: true });
        dialog.showModal();
      });
    }

    function showChoice(title, items) {
      return new Promise((resolve) => {
        const dialog = ensureDialog();
        dialog.returnValue = "";
        const choices = dialog.querySelector(`[${choicesAttr}]`);
        dialog.querySelector(`[${titleAttr}]`).textContent = title;
        dialog.querySelector(`[${messageAttr}]`).textContent = "Kies een optie hieronder.";
        choices.hidden = false;
        choices.innerHTML = items.map((item, index) => `<button type="button" data-choice-index="${index}">${escapeHtml(item.label)}</button>`).join("");
        dialog.querySelector(`[${actionsAttr}]`).innerHTML = '<button class="ghost" value="cancel" type="submit">Annuleren</button>';
        const onChoice = (event) => {
          const button = event.target.closest("[data-choice-index]");
          if (!button) return;
          dialog.returnValue = button.dataset.choiceIndex;
          dialog.close(button.dataset.choiceIndex);
        };
        choices.addEventListener("click", onChoice);
        dialog.addEventListener("close", () => {
          choices.removeEventListener("click", onChoice);
          const index = Number(dialog.returnValue);
          resolve(Number.isInteger(index) && items[index] ? items[index] : null);
        }, { once: true });
        dialog.showModal();
      });
    }

    return { ensureDialog, showNotice, showConfirm, showChoice };
  }

  function resizeAutoGrowingTextarea(textarea) {
    if (!textarea) return;
    textarea.style.height = "auto";
    const minHeight = Number.parseFloat(getComputedStyle(textarea).minHeight) || 0;
    textarea.style.height = `${Math.max(minHeight, textarea.scrollHeight)}px`;
  }

  function bindAutoGrowingTextareas(root = document) {
    const scope = root || document;
    const textareas = scope.matches?.("textarea") ? [scope] : queryAll("textarea", scope);
    textareas.forEach((textarea) => {
      textarea.dataset.autoGrow = "true";
      resizeAutoGrowingTextarea(textarea);
      if (textarea.dataset.autoGrowBound === "true") return;
      textarea.dataset.autoGrowBound = "true";
      textarea.addEventListener("input", () => resizeAutoGrowingTextarea(textarea));
    });
  }

  function resizeAutoGrowingTextareas(root = document) {
    const scope = root || document;
    const textareas = scope.matches?.("textarea") ? [scope] : queryAll('textarea[data-auto-grow="true"]', scope);
    textareas.forEach(resizeAutoGrowingTextarea);
  }

  function readCookie(name) {
    const prefix = `${name}=`;
    const cookie = document.cookie
      .split(";")
      .map((item) => item.trim())
      .find((item) => item.startsWith(prefix));
    return cookie ? decodeURIComponent(cookie.slice(prefix.length)) : "";
  }

  function storedUiMode() {
    try {
      const localMode = localStorage.getItem(uiModeStorageKey);
      if (uiModes.has(localMode)) return localMode;
    } catch {
      // LocalStorage kan in private/strikte browsermodi falen; cookie blijft dan de fallback.
    }
    const cookieMode = readCookie(uiModeCookieName);
    return uiModes.has(cookieMode) ? cookieMode : "classic";
  }

  function applyUiMode(mode) {
    const nextMode = uiModes.has(mode) ? mode : "classic";
    document.documentElement.dataset.uiMode = nextMode;
    document.documentElement.classList.toggle("ui-calm", nextMode === "calm");
    document.documentElement.classList.toggle("ui-classic", nextMode === "classic");
    try {
      localStorage.setItem(uiModeStorageKey, nextMode);
    } catch {
      // Cookie hieronder is genoeg voor dezelfde origin als localStorage niet beschikbaar is.
    }
    document.cookie = `${uiModeCookieName}=${encodeURIComponent(nextMode)}; path=/; max-age=31536000; SameSite=Lax`;
    queryAll("[data-ui-mode-choice]").forEach((button) => {
      const active = button.dataset.uiModeChoice === nextMode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    return nextMode;
  }

  function uiModeToggleHtml() {
    return `
      <section class="ui-mode-switch" data-ui-mode-switch-root aria-label="UI stijl kiezen">
        <span>UI</span>
        <div class="ui-mode-options">
          <button type="button" data-ui-mode-choice="classic" aria-pressed="false">Klassiek</button>
          <button type="button" data-ui-mode-choice="calm" aria-pressed="false">Rustig</button>
        </div>
      </section>`;
  }

  function ensureUiModeToggle(target) {
    const host = typeof target === "string" ? query(target) : target;
    if (!host) return null;
    const existing = host.querySelector("[data-ui-mode-switch-root]");
    if (existing) return existing;
    const wrapper = document.createElement("div");
    wrapper.dataset.uiModeSwitchRoot = "true";
    wrapper.innerHTML = uiModeToggleHtml();
    host.prepend(wrapper.firstElementChild);
    host.addEventListener("click", (event) => {
      const button = event.target.closest("[data-ui-mode-choice]");
      if (!button || !host.contains(button)) return;
      applyUiMode(button.dataset.uiModeChoice);
    });
    applyUiMode(storedUiMode());
    return host.querySelector("[data-ui-mode-switch-root]");
  }

  applyUiMode(storedUiMode());

  window.DefensiePortalUI = {
    query,
    queryAll,
    escapeHtml,
    formatDate,
    formatDateTime,
    createNoticeDialog,
    bindAutoGrowingTextareas,
    resizeAutoGrowingTextareas,
    applyUiMode,
    storedUiMode,
    ensureUiModeToggle
  };
}());
