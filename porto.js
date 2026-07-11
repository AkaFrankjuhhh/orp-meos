const $ = (selector) => document.querySelector(selector);

const portoRuntimeConfig = window.ORPPortoData || {
  organization: {
    key: "defensie",
    label: "Defensie",
    portalTitle: "Defensie Personeelsportaal",
    portalSubtitle: "Defensie Oranjestad",
    requiredRoleLabel: "Defensie"
  },
  operatorLabel: "OPS",
  operatorTraining: "OPS",
  lockTitle: "Defensie Porto-Systeem",
  lockSubtitle: "Defensie Oranjestad",
  lockText: "Alleen aangemelde Defensie leden met een gekoppeld Defensie Personeelsportaal-profiel kunnen het Porto-Systeem openen."
};
const portoOrganization = portoRuntimeConfig.organization || {};
const portoOperatorLabel = portoRuntimeConfig.operatorLabel || "OPS";
const portoOperatorTraining = portoRuntimeConfig.operatorTraining || portoOperatorLabel;

const profileTrainings = portoRuntimeConfig.profileTrainings || ["BKV", "Mentor-Traject", "IBT", "TMO", "SIV", "ZULU", "OGM", "KW", "SMG"];
const profileOperational = portoRuntimeConfig.profileOperational || ["OPS", "OPCO", "OVD"];
const portoDutyRoleSuffix = portoOrganization.key === "politie" ? "P" : "K";
const portoDutyRoles = portoOrganization.key === "politie"
  ? []
  : [
      { key: "OPCO", label: "OPCO", requiredAny: ["OPCO"], nicknameLabel: `OPCO-${portoDutyRoleSuffix}` },
      { key: "OVD", label: "OVD", requiredAny: ["OVD", "OVD-P", "OVD-K"], nicknameLabel: `OVD-${portoDutyRoleSuffix}` }
    ];
const portoStatuses = [
  { code: "1", title: "Status 1", label: "Beschikbaar", className: "available" },
  { code: "2", title: "Status 2", label: "Aanrijdend", className: "driving" },
  { code: "3", title: "Status 3", label: "Ter plaatse", className: "onscene" },
  { code: "4", title: "Status 4", label: "Niet beschikbaar", className: "unavailable", hasChoices: true },
  { code: "5", title: "Status 5", label: "Transport aanvraag", className: "transport" },
  { code: "6", title: "Status 6", label: "Spraak aanvraag", className: "speech" },
  { code: "7", title: "Status 7", label: "Spraak aanvraag urgent", className: "urgent" },
  { code: "8", title: "Status 8", label: "Uit dienst", className: "offduty" }
];
let portoProfile = null;
let portoDuty = null;
let portoVehicleRanges = [];
let portoCurrentOps = null;
let portoCanTakeOps = false;
let portoCanManageOps = false;
let portoCanViewOpsLog = false;
let portoCanUseDevTools = false;
let portoCanUseManagementBypass = false;
let portoManagementBypassLabel = "Kader Bypass";
let portoOpsRequests = [];
let portoAvailableVehicleRanges = [];
let portoLinkableUnits = [];
let portoActiveUnits = [];
let portoSideTaskOverview = [];
let portoPhonebook = [];
let portoPhonebookView = [];
let portoPhonebookSignature = "";
let portoPhonebookLastRenderKey = "";
let portoPhonebookRenderTimer = null;
let portoPhonebookRenderVersion = 0;
let portoDiscordChannels = [];
let portoDiscordChannelGroups = [];
let portoMapEnabled = false;
let portoOpsLog = [];
let portoOpsContextUnitId = "";
let portoDutyPoll = null;
let portoOpsPoll = null;
let portoOpsRequestInteractionUntil = 0;
let portoEventSource = null;
let portoLiveRefreshTimer = null;
let portoLiveRefreshDeferTimer = null;
let portoOpsViewMode = "duty";
let portoViewingOpsLog = false;
let portoInlineErrorTimer = null;
let portoDutyLoadPromise = null;
let portoStatusWritePromise = null;
let portoOpsWritePromise = null;
let portoLastDutyLoadAt = 0;
let portoDeferredDutyLoadTimer = null;
let portoSignedOffUntilStatus0 = false;
let portoAutoAssignTimer = null;
let portoAutoAssignUnitId = "";
const PORTO_AUTO_REFRESH_MS = 8000;
const PORTO_OPS_LAYOUT_KEY = "orp-porto-ops-layout";
const PORTO_UI_MODE_KEY = "orp-porto-ui-mode";
let portoUiMode = "classic";
let portoSelectedModernOpsUnitId = "";

function applyPortoBranding() {
  const organizationKey = portoOrganization.key || "defensie";
  document.body.classList.toggle("porto-org-politie", organizationKey === "politie");
  document.body.classList.toggle("porto-org-defensie", organizationKey !== "politie");
  const favicon = organizationKey === "politie" ? "/assets/politie-logo.png?v=20260613-form-branding" : "/assets/favicon.png?v=20260526";
  document.querySelectorAll("link[rel~='icon']").forEach((link) => {
    link.href = favicon;
  });
  document.title = `Porto-Systeem | ${portoRuntimeConfig.lockSubtitle || portoOrganization.portalSubtitle || "Defensie Oranjestad"}`;
  const lockBrand = document.querySelector(".lock-brand span");
  if (lockBrand) lockBrand.textContent = portoRuntimeConfig.lockSubtitle || portoOrganization.portalSubtitle || "Defensie Oranjestad";
  const lockTitle = $("#portoStatusIntro h1");
  if (lockTitle) lockTitle.textContent = portoRuntimeConfig.lockTitle || `${portoOrganization.label || "Defensie"} Porto-Systeem`;
  const lockscreenTitle = document.querySelector("#portoLockscreen h1");
  if (lockscreenTitle) lockscreenTitle.textContent = "Porto-Systeem";
  const lockText = document.querySelector("#portoLockscreen p");
  if (lockText) lockText.textContent = portoRuntimeConfig.lockText || `Alleen aangemelde ${portoOrganization.requiredRoleLabel || "Defensie"} leden kunnen het Porto-Systeem openen.`;
  const currentOpsText = $("#portoCurrentOpsText");
  if (currentOpsText) currentOpsText.textContent = `Huidige ${portoOperatorLabel}:`;
  const claimButton = $("#portoOpsClaimBtn");
  if (claimButton) claimButton.textContent = `${portoOperatorLabel} oppakken`;
  const releaseButton = $("#portoOpsReleaseBtn");
  if (releaseButton) releaseButton.textContent = `${portoOperatorLabel} afsluiten`;
  const releaseWorkspaceButton = $("#portoOpsReleaseWorkspaceBtn");
  if (releaseWorkspaceButton) releaseWorkspaceButton.textContent = `${portoOperatorLabel} neerleggen`;
  const showOpsViewButton = $("#portoShowOpsViewBtn");
  if (showOpsViewButton) showOpsViewButton.textContent = portoOrganization.key === "politie" ? "OC overzicht" : "OVD/OPCO overzicht";
  const opsPanelTitle = document.querySelector("#portoOpsPanel h2");
  if (opsPanelTitle) opsPanelTitle.textContent = `${portoOperatorLabel} Bediening`;
  const opsLogTitle = document.querySelector("#portoOpsLogPage h2");
  if (opsLogTitle) opsLogTitle.textContent = `${portoOperatorLabel} Logs`;
  const opsLogSubtitle = document.querySelector("#portoOpsLogPage .muted");
  if (opsLogSubtitle) opsLogSubtitle.textContent = `Overzicht van ${portoOperatorLabel} diensten en top 5 ${portoOperatorLabel} uren.`;
  const opsTopTitle = document.querySelector("#portoOpsLogTopRows")?.closest("section")?.querySelector("h3");
  if (opsTopTitle) opsTopTitle.textContent = `Top 5 ${portoOperatorLabel} uren`;
}

function portoStorageGet(key, fallback) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function portoStorageSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Opslaan van voorkeuren is handig, maar mag de Porto nooit blokkeren.
  }
}

function storedPortoUiMode() {
  return portoStorageGet(PORTO_UI_MODE_KEY, "classic") === "modern" ? "modern" : "classic";
}

function applyPortoUiMode(mode) {
  portoUiMode = mode === "modern" ? "modern" : "classic";
  document.body.dataset.portoUi = portoUiMode;
  portoStorageSet(PORTO_UI_MODE_KEY, portoUiMode);
  document.querySelectorAll("[data-porto-ui-choice]").forEach((button) => {
    const active = button.dataset.portoUiChoice === portoUiMode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
  if (typeof renderDutyPanel === "function") renderDutyPanel();
  if (typeof renderOpsPanel === "function") renderOpsPanel({ forceRequests: true });
}

function bindPortoUiToggle() {
  applyPortoUiMode(storedPortoUiMode());
  document.querySelector(".porto-ui-switch")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-porto-ui-choice]");
    if (!button) return;
    applyPortoUiMode(button.dataset.portoUiChoice);
  });
}

function portoRankSortIndex(rank) {
  const ranks = Array.isArray(portoRuntimeConfig.ranks) ? portoRuntimeConfig.ranks : [];
  const needle = String(rank || "").toLowerCase();
  const index = ranks.findIndex((entry) => String(entry || "").toLowerCase() === needle);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function portoServiceNumberParts(serviceNumber) {
  const text = String(serviceNumber || "");
  const exact = text.match(/^(\d+)[-/](\d+)$/);
  if (exact) return [Number(exact[1]), Number(exact[2])];
  const parts = text.match(/\d+/g)?.map(Number) || [];
  return [parts[0] ?? Number.MAX_SAFE_INTEGER, parts[1] ?? Number.MAX_SAFE_INTEGER];
}

function comparePortoPhonebookEntries(left, right) {
  const rankDiff = portoRankSortIndex(left.rank) - portoRankSortIndex(right.rank);
  if (rankDiff) return rankDiff;
  const [leftMain, leftSub] = portoServiceNumberParts(left.serviceNumber);
  const [rightMain, rightSub] = portoServiceNumberParts(right.serviceNumber);
  if (leftMain !== rightMain) return leftMain - rightMain;
  if (leftSub !== rightSub) return leftSub - rightSub;
  return String(left.name || "").localeCompare(String(right.name || ""), "nl", { sensitivity: "base" });
}

function portoPhonebookSearchText(person) {
  return [person.rank, person.name, person.serviceNumber, person.phone]
    .map((value) => String(value || "").toLowerCase())
    .join(" ");
}

function phonebookSignature(entries) {
  return (entries || [])
    .map((person) => [person.id, person.rank, person.name, person.serviceNumber, person.phone].join("|"))
    .join("\n");
}

function setPortoPhonebook(entries) {
  if (!Array.isArray(entries)) return false;
  const signature = phonebookSignature(entries);
  if (signature === portoPhonebookSignature) return false;
  portoPhonebookSignature = signature;
  portoPhonebook = entries;
  portoPhonebookView = entries.map((person) => ({
    ...person,
    searchText: portoPhonebookSearchText(person)
  }));
  portoPhonebookLastRenderKey = "";
  return true;
}

function portoPhonebookRowHtml(person) {
  const phone = person.phone || "<Geen bekend nummer>";
  const phoneClass = person.phone ? "porto-phonebook-phone" : "porto-phonebook-phone missing";
  const title = person.serviceNumber ? ` title="Dienstnummer: ${escapeHtml(person.serviceNumber)}"` : "";
  return `
    <div class="porto-phonebook-row"${title}>
      <span data-label="Rang">${escapeHtml(person.rank || "-")}</span>
      <span data-label="Naam">${escapeHtml(person.name || "-")}</span>
      <span data-label="Telefoonnummer" class="${phoneClass}">${escapeHtml(phone)}</span>
    </div>`;
}

function renderPortoPhonebook() {
  const rows = $("#portoPhonebookRows");
  if (!rows) return;
  const query = ($("#portoPhonebookSearch")?.value || "").trim().toLowerCase();
  const renderKey = `${portoPhonebookSignature}|${query}`;
  if (renderKey === portoPhonebookLastRenderKey) return;
  portoPhonebookLastRenderKey = renderKey;
  const renderVersion = ++portoPhonebookRenderVersion;
  const entries = portoPhonebookView.filter((person) => !query || person.searchText.includes(query));
  if (!entries.length) {
    rows.innerHTML = '<div class="porto-phonebook-empty">Geen personen gevonden.</div>';
    return;
  }
  const firstBatchSize = 80;
  const chunkSize = 160;
  rows.innerHTML = entries.slice(0, firstBatchSize).map(portoPhonebookRowHtml).join("");
  let index = firstBatchSize;
  const appendChunk = () => {
    if (renderVersion !== portoPhonebookRenderVersion || index >= entries.length) return;
    const nextIndex = Math.min(index + chunkSize, entries.length);
    rows.insertAdjacentHTML("beforeend", entries.slice(index, nextIndex).map(portoPhonebookRowHtml).join(""));
    index = nextIndex;
    if (index < entries.length) {
      if ("requestIdleCallback" in window) window.requestIdleCallback(appendChunk, { timeout: 120 });
      else window.setTimeout(appendChunk, 16);
    }
  };
  if (index < entries.length) {
    if ("requestIdleCallback" in window) window.requestIdleCallback(appendChunk, { timeout: 120 });
    else window.setTimeout(appendChunk, 16);
  }
}

function schedulePortoPhonebookRender() {
  if (portoPhonebookRenderTimer) window.clearTimeout(portoPhonebookRenderTimer);
  portoPhonebookRenderTimer = window.setTimeout(() => {
    portoPhonebookRenderTimer = null;
    renderPortoPhonebook();
  }, 40);
}

function openPortoPhonebook() {
  const dialog = $("#portoPhonebookDialog");
  if (!dialog) return;
  renderPortoPhonebook();
  if (typeof dialog.showModal === "function" && !dialog.open) dialog.showModal();
  else dialog.setAttribute("open", "");
  window.setTimeout(() => $("#portoPhonebookSearch")?.focus(), 0);
  if (!portoPhonebookSignature) {
    loadPortoDuty({ includePhonebook: true }).then(renderPortoPhonebook).catch(() => {});
  }
}

function closePortoPhonebook() {
  const dialog = $("#portoPhonebookDialog");
  if (!dialog) return;
  if (typeof dialog.close === "function") dialog.close();
  else dialog.removeAttribute("open");
}

const storedOpsLayout = portoStorageGet(PORTO_OPS_LAYOUT_KEY, "grid");
let portoOpsUnitLayout = ["grid", "list"].includes(storedOpsLayout) ? storedOpsLayout : "grid";

function hasActivePortoLiveInteraction() {
  const active = document.activeElement;
  if (typeof isEditingOpsRequest === "function" && isEditingOpsRequest()) return true;
  if (!$("#portoOpsUnitContextMenu")?.hidden) return true;
  if (active?.matches?.("textarea, input, select, [contenteditable='true']")) return true;
  if (active?.closest?.("dialog[open], .site-notice-dialog[open]")) return true;
  return false;
}

function schedulePortoLiveRefresh(scope = "porto") {
  if (portoSignedOffUntilStatus0) return;
  if (portoLiveRefreshTimer) return;
  portoLiveRefreshTimer = window.setTimeout(async () => {
    portoLiveRefreshTimer = null;
    if (document.body.classList.contains("porto-locked") || portoSignedOffUntilStatus0) return;
    if (hasActivePortoLiveInteraction()) {
      if (!portoLiveRefreshDeferTimer) {
        portoLiveRefreshDeferTimer = window.setTimeout(() => {
          portoLiveRefreshDeferTimer = null;
          schedulePortoLiveRefresh(scope);
        }, 1000);
      }
      return;
    }
    await loadPortoDuty({ automatic: true });
  }, 1000);
}

function startPortoLiveUpdates() {
  if (portoEventSource || typeof EventSource === "undefined") return;
  portoEventSource = new EventSource("/api/events");
  portoEventSource.addEventListener("porto:update", () => schedulePortoLiveRefresh("porto"));
  portoEventSource.addEventListener("people:update", () => schedulePortoLiveRefresh("people"));
  portoEventSource.addEventListener("state:update", (event) => {
    const payload = JSON.parse(event.data || "{}");
    if (["porto", "people", "forms"].includes(payload.scope || "")) schedulePortoLiveRefresh(payload.scope || "state");
  });
  portoEventSource.onerror = () => {
    portoEventSource?.close();
    portoEventSource = null;
    window.setTimeout(startPortoLiveUpdates, 5000);
  };
}

// Porto-audio is verplaatst naar porto/audio.js.
const PortoAudio = window.PortoAudio;

// Gedeelde Porto pop-up helper komt uit shared-ui.js.
const portoNotice = DefensiePortalUI.createNoticeDialog({ id: "portoNoticeDialog", className: "site-notice-dialog porto-notice-dialog" });
const showPortoNotice = portoNotice.showNotice;
const showPortoConfirm = portoNotice.showConfirm;
const showPortoChoice = portoNotice.showChoice;
function positionContextMenu(menu, x, y) {
  menu.hidden = false;
  menu.style.maxHeight = `${Math.max(180, window.innerHeight - 20)}px`;
  menu.style.overflowY = "auto";
  menu.style.left = "0px";
  menu.style.top = "0px";
  const rect = menu.getBoundingClientRect();
  const left = Math.min(Math.max(10, x), window.innerWidth - rect.width - 10);
  const top = Math.min(Math.max(10, y), window.innerHeight - rect.height - 10);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function showPortoContextChoice(anchorEvent, title, items) {
  if (!items.length) {
    return showPortoNotice("Geen opties beschikbaar.", title).then(() => null);
  }
  return new Promise((resolve) => {
    let menu = $("#portoChoiceContextMenu");
    if (!menu) {
      menu = document.createElement("div");
      menu.id = "portoChoiceContextMenu";
      menu.className = "context-menu porto-ops-context-menu porto-choice-context-menu";
      menu.hidden = true;
      document.body.appendChild(menu);
    }
    menu.innerHTML = `
      <strong>${escapeHtml(title)}</strong>
      ${items.map((item, index) => `<button type="button" data-choice-index="${index}">${escapeHtml(item.label)}</button>`).join("")}
      <button type="button" class="ghost" data-choice-cancel>Annuleren</button>`;

    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      menu.hidden = true;
      menu.removeEventListener("click", onMenuClick);
      document.removeEventListener("click", onDocumentClick, true);
      document.removeEventListener("contextmenu", onDocumentContext, true);
      document.removeEventListener("keydown", onKeyDown, true);
      resolve(value);
    };
    const onMenuClick = (event) => {
      const choice = event.target.closest("[data-choice-index]");
      if (choice) {
        finish(items[Number(choice.dataset.choiceIndex)] || null);
        return;
      }
      if (event.target.closest("[data-choice-cancel]")) finish(null);
    };
    const onDocumentClick = (event) => {
      if (!menu.contains(event.target)) finish(null);
    };
    const onDocumentContext = (event) => {
      if (!menu.contains(event.target)) finish(null);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") finish(null);
    };

    menu.addEventListener("click", onMenuClick);
    positionContextMenu(menu, anchorEvent?.clientX || window.innerWidth / 2, anchorEvent?.clientY || window.innerHeight / 2);
    window.setTimeout(() => {
      document.addEventListener("click", onDocumentClick, true);
      document.addEventListener("contextmenu", onDocumentContext, true);
      document.addEventListener("keydown", onKeyDown, true);
    }, 0);
  });
}
const escapeHtml = DefensiePortalUI.escapeHtml;

function avatarFor(profile) {
  if (profile?.avatar) return profile.avatar;
  const initials = String(profile?.name || "P")
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
      <rect width="96" height="96" rx="48" fill="#e17000"/>
      <text x="50%" y="55%" text-anchor="middle" dominant-baseline="middle" fill="#fff" font-family="Segoe UI, Arial" font-size="34" font-weight="800">${initials}</text>
    </svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function setPortoLocked(locked) {
  document.body.classList.toggle("porto-locked", locked);
  if (locked) {
    document.body.classList.remove("porto-workspace", "porto-ops-workspace", "porto-duty-workspace");
    setPortoDutyPolling(false);
    setPortoOpsPolling(false);
  }
}

function showPortoLockError() {
  const errorCode = new URLSearchParams(window.location.search).get("authError");
  const messages = {
    "no-profile": `Geen profiel gevonden in ${portoOrganization.portalTitle || "het personeelsportaal"}.`,
    "no-role": `Geen Discord gekoppeld: je mist de ${portoOrganization.requiredRoleLabel || portoOrganization.label || "organisatie"} rol.`,
    "login-failed": "Aanmelden via Discord is mislukt. Probeer opnieuw."
  };
  const errorElement = $("#portoLockError");
  if (!errorElement || !messages[errorCode]) return;
  errorElement.textContent = messages[errorCode];
  errorElement.hidden = false;
  window.history.replaceState({}, document.title, window.location.pathname);
}

function showPortoInlineError(message) {
  const errorElement = $("#portoLockError");
  if (!errorElement) return;
  errorElement.textContent = message;
  errorElement.hidden = false;
  if (portoInlineErrorTimer) window.clearTimeout(portoInlineErrorTimer);
  portoInlineErrorTimer = window.setTimeout(() => {
    errorElement.hidden = true;
    portoInlineErrorTimer = null;
  }, 8000);
}

// Begrens zoom en slepen zodat de kaart nooit buiten het paneel schuift.
document.addEventListener("pointerdown", PortoAudio.unlock, { once: true });
document.addEventListener("keydown", PortoAudio.unlock, { once: true });

$("#portoLoginBtn").addEventListener("click", () => {
  window.location.href = "/api/auth/login?returnTo=/porto.html";
});
$("#portoProfileOpenBtn").addEventListener("click", openPortoProfileDialog);
$("#portoProfileOpenText").addEventListener("click", openPortoProfileDialog);
$("#closePortoProfileDialog").addEventListener("click", () => $("#portoProfileDialog").close());
$("#cancelPortoProfileDialog").addEventListener("click", () => $("#portoProfileDialog").close());
document.addEventListener("click", (event) => {
  const trigger = event.target instanceof Element ? event.target.closest("[data-phonebook-open]") : null;
  if (trigger) openPortoPhonebook();
});
$("#portoPhonebookDialog")?.addEventListener("submit", (event) => {
  event.preventDefault();
});
$("#closePortoPhonebookDialog")?.addEventListener("click", closePortoPhonebook);
$("#cancelPortoPhonebookDialog")?.addEventListener("click", closePortoPhonebook);
$("#portoPhonebookSearch")?.addEventListener("input", schedulePortoPhonebookRender);
$("#portoProfileForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const response = await fetch("/api/porto/profile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ portoPhone: $("#portoPhone").value.trim() })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    await showPortoNotice(payload.error || "Telefoonnummer kon niet worden opgeslagen.", "Opslaan mislukt");
    return;
  }
  portoProfile = payload.profile || portoProfile;
  portoDuty = payload.unit || portoDuty;
  applyPortoPayload(payload);
  renderPortoProfileDialog();
  renderDutyPanel();
  renderOpsPanel();
  $("#portoProfileDialog").close();
});
$("#portoLogoutBtn").addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method: "POST" });
  setPortoLocked(true);
});
$("#portoStatus0Btn").addEventListener("click", () => updatePortoStatus("0"));
$("#portoOpenOpsLogBtn")?.addEventListener("click", openPortoOpsLogPage);
$("#portoCloseOpsLogBtn")?.addEventListener("click", closePortoOpsLogPage);
$("#portoCancelPendingBtn").addEventListener("click", () => updatePortoStatus("8"));
$("#portoManagementBypassBtn").addEventListener("click", runPortoManagementBypass);
$("#portoDevBypassBtn").addEventListener("click", runPortoDevBypass);
$("#portoDutyVehicleSelect").addEventListener("change", (event) => updatePortoVehicle(event.target.value));
$("#portoOpsClaimBtn").addEventListener("click", () => updatePortoOps("claim"));
$("#portoOpsReleaseBtn").addEventListener("click", () => updatePortoOps("release"));
$("#portoOpsReleaseWorkspaceBtn").addEventListener("click", () => updatePortoOps("release"));
$("#portoOpsDevTestBtn").addEventListener("click", runPortoOpsDevTest);
$("#portoShowOpsViewBtn")?.addEventListener("click", () => {
  portoOpsViewMode = "ops";
  renderDutyPanel();
  renderOpsPanel();
});
$("#portoShowDutyViewBtn")?.addEventListener("click", () => {
  portoOpsViewMode = "duty";
  renderDutyPanel();
  renderOpsPanel();
});
$("#portoOpsGridLayoutBtn")?.addEventListener("click", () => {
  portoOpsUnitLayout = "grid";
  portoStorageSet(PORTO_OPS_LAYOUT_KEY, portoOpsUnitLayout);
  renderOpsPanel();
});
$("#portoOpsListLayoutBtn")?.addEventListener("click", () => {
  portoOpsUnitLayout = "list";
  portoStorageSet(PORTO_OPS_LAYOUT_KEY, portoOpsUnitLayout);
  renderOpsPanel();
});
$("#portoOpsRequests").addEventListener("pointerdown", holdOpsRequestInteraction);
$("#portoOpsRequests").addEventListener("focusin", holdOpsRequestInteraction);
$("#portoOpsRequests").addEventListener("change", holdOpsRequestInteraction);
$("#portoOpsRequests").addEventListener("click", async (event) => {
  const assignButton = event.target.closest("[data-assign-unit]");
  const linkButton = event.target.closest("[data-link-unit]");
  const actionButton = assignButton || linkButton;
  const unitId = assignButton?.dataset.assignUnit || linkButton?.dataset.linkUnit;
  if (!unitId) return;
  event.preventDefault();
  holdOpsRequestInteraction();
  actionButton.disabled = true;
  try {
    if (assignButton) {
      const select = assignButton.closest(".porto-ops-request")?.querySelector("[data-category-select]");
      await assignPortoUnit(unitId, { vehiclePrefix: select?.value || "" });
      return;
    }
    const select = linkButton.closest(".porto-ops-request")?.querySelector("[data-link-select]");
    await assignPortoUnit(unitId, { linkToVehicleNumber: select?.value || "" });
  } finally {
    actionButton.disabled = false;
  }
});
$("#portoOpsRequests").addEventListener("contextmenu", async (event) => {
  const request = event.target.closest("[data-ops-request]");
  if (!request?.dataset.opsRequest) return;
  await openPortoRequestContextMenu(event, request.dataset.opsRequest);
});
$("#portoModernOpsDashboard")?.addEventListener("click", async (event) => {
  const dutyViewButton = event.target.closest("[data-modern-duty-view]");
  if (dutyViewButton) {
    portoOpsViewMode = "duty";
    renderDutyPanel();
    renderOpsPanel();
    return;
  }
  const profileButton = event.target.closest("[data-modern-profile-open]");
  if (profileButton) {
    openPortoProfileDialog();
    return;
  }
  const releaseButton = event.target.closest("[data-modern-ops-release]");
  if (releaseButton) {
    await updatePortoOps("release");
    return;
  }
  const refreshButton = event.target.closest("[data-modern-refresh]");
  if (refreshButton) {
    await loadPortoDuty({ includePhonebook: true });
    return;
  }
  const menuButton = event.target.closest("[data-ops-open-menu]");
  if (menuButton?.dataset.opsOpenMenu) {
    openPortoOpsContextMenu(event, menuButton.dataset.opsOpenMenu);
    return;
  }
  const statusButton = event.target.closest("[data-ops-status-unit]");
  if (statusButton?.dataset.opsStatusUnit) {
    await chooseOpsStatusUpdate(statusButton.dataset.opsStatusUnit, event);
    return;
  }
  const rejectButton = event.target.closest("[data-reject-unit]");
  if (rejectButton?.dataset.rejectUnit) {
    rejectButton.disabled = true;
    try {
      await rejectPortoRequest(rejectButton.dataset.rejectUnit);
    } finally {
      rejectButton.disabled = false;
    }
    return;
  }
  const linkButton = event.target.closest("[data-link-unit]");
  if (linkButton?.dataset.linkUnit) {
    const request = linkButton.closest("[data-ops-request]");
    const select = request?.querySelector("[data-link-select]");
    linkButton.disabled = true;
    try {
      await assignPortoUnit(linkButton.dataset.linkUnit, { linkToVehicleNumber: select?.value || "" });
    } finally {
      linkButton.disabled = false;
    }
    return;
  }
  const assignButton = event.target.closest("[data-assign-unit]");
  if (assignButton) {
    const request = assignButton.closest("[data-ops-request]");
    const select = request?.querySelector("[data-category-select]");
    assignButton.disabled = true;
    try {
      await assignPortoUnit(assignButton.dataset.assignUnit, { vehiclePrefix: select?.value || "" });
    } finally {
      assignButton.disabled = false;
    }
    return;
  }
  const row = event.target.closest("[data-modern-ops-unit]");
  if (row?.dataset.modernOpsUnit && !event.target.closest("button, select")) {
    portoSelectedModernOpsUnitId = row.dataset.modernOpsUnit;
    renderOpsPanel();
  }
});
$("#portoModernOpsDashboard")?.addEventListener("contextmenu", async (event) => {
  if (event.target.closest("[data-ops-status-unit], [data-ops-number-unit], [data-ops-vehicle-unit], [data-ops-unit-member], [data-ops-unit-card]")) {
    await handleOpsUnitContextMenu(event);
    return;
  }
  const row = event.target.closest("[data-modern-ops-unit]");
  if (row?.dataset.modernOpsUnit) {
    event.preventDefault();
    openPortoOpsContextMenu(event, row.dataset.modernOpsUnit);
    return;
  }
});
let portoDiscordChannelStatusSavePending = false;

async function saveDiscordChannelStatus(button) {
  if (!button?.dataset.saveDiscordChannelStatus) return;
  if (portoDiscordChannelStatusSavePending) return;
  portoDiscordChannelStatusSavePending = true;
  button.disabled = true;
  const channelKey = button.dataset.saveDiscordChannelStatus;
  const input = [...document.querySelectorAll("[data-discord-channel-status]")]
    .find((entry) => entry.dataset.discordChannelStatus === channelKey);
  const unit = (portoDiscordChannelGroups || []).find((group) => group.key === channelKey)?.units?.[0];
  const unitId = unit ? primaryOpsMemberId(unit) : "";
  if (!unitId) {
    await showPortoNotice("Dit kanaal heeft geen actieve eenheden om status aan te koppelen.", "Kanaalstatus");
    portoDiscordChannelStatusSavePending = false;
    button.disabled = false;
    return;
  }
  try {
    await reassignPortoUnit(unitId, { discordChannelKey: channelKey, discordChannelStatus: input?.value || "" });
  } finally {
    portoDiscordChannelStatusSavePending = false;
    button.disabled = false;
  }
}

$("#portoDiscordChannels")?.addEventListener("pointerdown", (event) => {
  const button = event.target.closest("[data-save-discord-channel-status]");
  if (!button) return;
  event.preventDefault();
  void saveDiscordChannelStatus(button);
});
$("#portoDiscordChannels")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-save-discord-channel-status]");
  if (!button) return;
  event.preventDefault();
  void saveDiscordChannelStatus(button);
});
function handleOpsUnitClick(event) {
  const menuButton = event.target.closest("[data-ops-open-menu]");
  if (menuButton?.dataset.opsOpenMenu) {
    event.preventDefault();
    event.stopPropagation();
    openPortoOpsContextMenu(event, menuButton.dataset.opsOpenMenu);
    return;
  }
  if (event.target.closest("[data-ops-status-unit]")) event.preventDefault();
}

async function handleOpsUnitContextMenu(event) {
  const statusButton = event.target.closest("[data-ops-status-unit]");
  const numberButton = event.target.closest("[data-ops-number-unit]");
  const vehicleButton = event.target.closest("[data-ops-vehicle-unit]");
  if (statusButton?.dataset.opsStatusUnit) {
    event.preventDefault();
    await chooseOpsStatusUpdate(statusButton.dataset.opsStatusUnit, event);
    return;
  }
  if (numberButton?.dataset.opsNumberUnit) {
    event.preventDefault();
    await chooseOpsNumberUpdate(numberButton.dataset.opsNumberUnit, event);
    return;
  }
  if (vehicleButton?.dataset.opsVehicleUnit) {
    event.preventDefault();
    await chooseOpsVehicleUpdate(vehicleButton.dataset.opsVehicleUnit, event);
    return;
  }
  const memberCard = event.target.closest("[data-ops-unit-member]");
  if (memberCard?.dataset.opsUnitMember) {
    // Personen in een gegroepeerd roepnummer openen hun eigen OPS-menu: koppelen of uit dienst melden.
    event.preventDefault();
    openPortoOpsContextMenu(event, memberCard.dataset.opsUnitMember);
    return;
  }
  const unitCard = event.target.closest("[data-ops-unit-card]");
  if (unitCard?.dataset.opsUnitCard) {
    event.preventDefault();
    openPortoOpsContextMenu(event, unitCard.dataset.opsUnitCard);
  }
}

$("#portoDiscordChannels")?.addEventListener("click", handleOpsUnitClick);
$("#portoDiscordChannels")?.addEventListener("contextmenu", handleOpsUnitContextMenu);

$("#portoOpsUnitContextMenu")?.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-ops-context-action]");
  if (!button || !portoOpsContextUnitId) return;
  const action = button.dataset.opsContextAction;
  const unitId = portoOpsContextUnitId;
  const context = findOpsMember(unitId);
  if (!context) {
    closePortoOpsContextMenu();
    return;
  }
  if (action === "copy-phone") {
    const phone = String(context.member.phone || "").trim();
    closePortoOpsContextMenu();
    if (!phone) {
      await showPortoNotice("Deze persoon heeft geen telefoonnummer ingevuld.", "Telefoonnummer");
      return;
    }
    const copied = await copyTextToClipboard(phone);
    await showPortoNotice(
      copied ? `${phone} is gekopieerd.` : `Kopiëren lukte niet. Nummer: ${phone}`,
      "Telefoonnummer"
    );
    return;
  }
  if (action === "link") {
    const options = portoLinkableUnits
      .filter((unit) => unit.vehicleNumber !== (context.member.vehicleNumber || context.unit.vehicleNumber))
      .map((unit) => ({ value: unit.vehicleNumber, label: unit.label }));
    closePortoOpsContextMenu();
    const selected = await showPortoContextChoice(event, "Koppelen aan", options);
    if (selected) await reassignPortoUnit(unitId, { linkToVehicleNumber: selected.value });
    return;
  }

  if (action === "discord-channel") {
    closePortoOpsContextMenu();
    await chooseOpsDiscordChannelUpdate(unitId, event);
    return;
  }

  if (action === "number") {
    closePortoOpsContextMenu();
    await chooseOpsNumberUpdate(unitId, event);
    return;
  }

  if (action === "unlink") {
    const groupSize = (context.unit.members || []).length;
    closePortoOpsContextMenu();
    if (groupSize <= 1) {
      await showPortoNotice("Deze persoon staat al los op een eigen roepnummer.", "Loskoppelen");
      return;
    }
    const confirmed = await showPortoConfirm(
      `${context.member.name || "Deze persoon"} loskoppelen naar het eerste vrije nummer in dezelfde reeks?`,
      "Loskoppelen"
    );
    if (confirmed) await reassignPortoUnit(unitId, { unlink: true });
    return;
  }

  if (action === "offduty") {
    const callsign = context.member.vehicleNumber || context.unit.vehicleNumber || "deze eenheid";
    const memberName = context.member.name || "deze persoon";
    const groupSize = (context.unit.members || []).length;
    closePortoOpsContextMenu();
    const choice = groupSize > 1
      ? await showPortoChoice(
          "Uit dienst melden",
          [
            { label: `Alleen ${memberName}`, value: "member", tone: "neutral" },
            { label: `Gehele ${callsign}`, value: "vehicle", tone: "danger" }
          ]
        )
      : { value: "member" };
    const scope = choice?.value || choice;
    if (!scope) return;
    const confirmed = await showPortoConfirm(
      scope === "member"
        ? `Weet je zeker dat je ${memberName} uit dienst wilt melden?`
        : `Weet je zeker dat je roepnummer ${callsign} volledig uit dienst wilt melden?`,
      "Uit dienst melden"
    );
    if (confirmed) {
      await reassignPortoUnit(unitId, { offDuty: true, offDutyScope: scope, vehicleNumber: callsign });
    }
  }
});

document.addEventListener("click", (event) => {
  if (event.target.closest("[data-duty-ops-claim]")) updatePortoOps("claim");
  if (event.target.closest("#portoModernOpsOverviewBtn")) {
    portoOpsViewMode = "ops";
    renderDutyPanel();
    renderOpsPanel();
  }
  const modernStatusButton = event.target.closest("[data-modern-status]");
  if (modernStatusButton) {
    const status = modernStatusButton.dataset.modernStatus;
    if (status === "4") {
      const modernChoices = event.target.closest("#portoModernDutyDashboard")?.querySelector(".porto-modern-status4-choices");
      if (modernChoices) modernChoices.hidden = false;
      updatePortoStatus("4");
    } else {
      const modernChoices = event.target.closest("#portoModernDutyDashboard")?.querySelector(".porto-modern-status4-choices");
      if (modernChoices) modernChoices.hidden = true;
      $("#portoStatus4Choices").hidden = true;
      updatePortoStatus(status);
    }
  }
  const modernStatus4Button = event.target.closest("[data-modern-status4]");
  if (modernStatus4Button) {
    const modernChoices = modernStatus4Button.closest(".porto-modern-status4-choices");
    if (modernChoices) modernChoices.hidden = true;
    updatePortoStatus("4", modernStatus4Button.dataset.modernStatus4);
  }
  const modernVehicleSelect = event.target.closest("[data-modern-vehicle]");
  if (modernVehicleSelect && event.type === "click") {
    return;
  }
  if (!event.target.closest("#portoOpsUnitContextMenu")) closePortoOpsContextMenu();
});

document.addEventListener("change", (event) => {
  const modernVehicleSelect = event.target.closest("[data-modern-vehicle]");
  if (modernVehicleSelect) updatePortoVehicle(modernVehicleSelect.value);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closePortoOpsContextMenu();
});
$("#portoStatusGrid").addEventListener("click", (event) => {
  const button = event.target.closest("[data-status]");
  if (!button || button.disabled) return;
  if (button.dataset.status === "4") {
    $("#portoStatus4Choices").hidden = false;
    updatePortoStatus("4");
    return;
  }
  $("#portoStatus4Choices").hidden = true;
  updatePortoStatus(button.dataset.status);
});
$("#portoStatus4Choices").addEventListener("click", (event) => {
  const button = event.target.closest("[data-status4]");
  if (!button) return;
  $("#portoStatus4Choices").hidden = true;
  updatePortoStatus("4", button.dataset.status4);
});
$("#portoDutyRoleActions")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-duty-role]");
  if (!button || button.disabled) return;
  button.disabled = true;
  updatePortoDutyRole(button.dataset.dutyRole || "").finally(() => {
    button.disabled = false;
  });
});

applyPortoBranding();
bindPortoUiToggle();
showPortoLockError();
renderStatusButtons();
renderVehicleRanges();
renderOpsPanel();
loadPortoProfile().then(() => {
  if (!document.body.classList.contains("porto-locked")) startPortoLiveUpdates();
});




