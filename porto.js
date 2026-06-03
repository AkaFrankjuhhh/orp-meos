const $ = (selector) => document.querySelector(selector);

const profileTrainings = ["BKV", "Mentor-Traject", "IBT", "TMO", "SIV", "ZULU", "OGM", "KW", "SMG"];
const profileOperational = ["OPS", "OPCO", "OVD"];
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
let portoOpsRequests = [];
let portoAvailableVehicleRanges = [];
let portoLinkableUnits = [];
let portoActiveUnits = [];
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
let portoCloseBeaconSent = false;
let portoOpsViewMode = "duty";
let portoInlineErrorTimer = null;
let portoDutyLoadPromise = null;
let portoStatusWritePromise = null;
let portoOpsWritePromise = null;
let portoLastDutyLoadAt = 0;
let portoDeferredDutyLoadTimer = null;
const PORTO_AUTO_REFRESH_MS = 8000;

function hasActivePortoLiveInteraction() {
  const active = document.activeElement;
  if (typeof isEditingOpsRequest === "function" && isEditingOpsRequest()) return true;
  if (!$("#portoOpsUnitContextMenu")?.hidden) return true;
  if (active?.matches?.("textarea, input, select, [contenteditable='true']")) return true;
  if (active?.closest?.("dialog[open], .site-notice-dialog[open]")) return true;
  return false;
}

function schedulePortoLiveRefresh(scope = "porto") {
  if (portoLiveRefreshTimer) return;
  portoLiveRefreshTimer = window.setTimeout(async () => {
    portoLiveRefreshTimer = null;
    if (document.body.classList.contains("porto-locked")) return;
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

function stopPortoLiveUpdates() {
  portoEventSource?.close();
  portoEventSource = null;
  if (portoLiveRefreshTimer) window.clearTimeout(portoLiveRefreshTimer);
  if (portoLiveRefreshDeferTimer) window.clearTimeout(portoLiveRefreshDeferTimer);
  portoLiveRefreshTimer = null;
  portoLiveRefreshDeferTimer = null;
}

function releasePortoOpsOnPageClose() {
  // Browser pagehide/beforeunload is te onbetrouwbaar voor operationele diensten.
  // OPS neerleggen gebeurt alleen nog via de bewuste knop.
  portoCloseBeaconSent = true;
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
    "no-profile": "Geen profiel gevonden in Defensie Personeelsportaal.",
    "no-role": "Geen Discord gekoppeld: je mist de Defensie rol.",
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
$("#portoCancelPendingBtn").addEventListener("click", () => updatePortoStatus("8"));
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
$("#portoDiscordChannels")?.addEventListener("dragstart", (event) => {
  const unit = event.target.closest("[data-discord-unit]");
  if (!unit?.dataset.discordUnit) return;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", unit.dataset.discordUnit);
});
$("#portoDiscordChannels")?.addEventListener("dragover", (event) => {
  const channel = event.target.closest("[data-discord-channel]");
  if (!channel?.dataset.discordChannel) return;
  event.preventDefault();
  channel.classList.add("drag-over");
});
$("#portoDiscordChannels")?.addEventListener("dragleave", (event) => {
  const channel = event.target.closest("[data-discord-channel]");
  if (channel && !channel.contains(event.relatedTarget)) channel.classList.remove("drag-over");
});
$("#portoDiscordChannels")?.addEventListener("drop", async (event) => {
  const channel = event.target.closest("[data-discord-channel]");
  if (!channel?.dataset.discordChannel) return;
  event.preventDefault();
  channel.classList.remove("drag-over");
  const unitId = event.dataTransfer.getData("text/plain");
  if (unitId) await reassignPortoUnit(unitId, { discordChannelKey: channel.dataset.discordChannel });
});
$("#portoDiscordChannels")?.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-save-discord-channel-status]");
  if (!button?.dataset.saveDiscordChannelStatus) return;
  const channelKey = button.dataset.saveDiscordChannelStatus;
  const input = [...document.querySelectorAll("[data-discord-channel-status]")]
    .find((entry) => entry.dataset.discordChannelStatus === channelKey);
  const unit = (portoDiscordChannelGroups || []).find((group) => group.key === channelKey)?.units?.[0];
  const unitId = unit ? primaryOpsMemberId(unit) : "";
  if (!unitId) {
    await showPortoNotice("Dit kanaal heeft geen actieve eenheden om status aan te koppelen.", "Kanaalstatus");
    return;
  }
  await reassignPortoUnit(unitId, { discordChannelKey: channelKey, discordChannelStatus: input?.value || "" });
});
$("#portoOpsUnits").addEventListener("click", (event) => {
  if (event.target.closest("[data-ops-status-unit]")) event.preventDefault();
});
$("#portoOpsUnits").addEventListener("contextmenu", async (event) => {
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
  if (!memberCard) return;
  // Personen in een gegroepeerd roepnummer openen hun eigen OPS-menu: koppelen of uit dienst melden.
  event.preventDefault();
  openPortoOpsContextMenu(event, memberCard.dataset.opsUnitMember);
});

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
  if (!event.target.closest("#portoOpsUnitContextMenu")) closePortoOpsContextMenu();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closePortoOpsContextMenu();
});
$("#portoStatusGrid").addEventListener("click", (event) => {
  const button = event.target.closest("[data-status]");
  if (!button || button.disabled) return;
  if (button.dataset.status === "4") {
    $("#portoStatus4Choices").hidden = false;
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

showPortoLockError();
renderStatusButtons();
renderVehicleRanges();
renderOpsPanel();
loadPortoProfile().then(() => {
  if (!document.body.classList.contains("porto-locked")) startPortoLiveUpdates();
});




