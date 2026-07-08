/* Porto dienstmodule: statusknoppen, dienstpaneel, voertuigkeuze en Status 0 flow. */

function isDevBypassProfile() {
  return Boolean(portoCanUseDevTools);
}

function canUseManagementBypass() {
  return Boolean(portoCanUseManagementBypass);
}

function isAssignedDuty() {
  return Boolean(portoDuty && String(portoDuty.status) !== "8" && portoDuty.vehicleNumber);
}

function renderStatusButtons() {
  const grid = $("#portoStatusGrid");
  if (!grid) return;
  grid.innerHTML = portoStatuses
    .map((status) => `
      <button class="porto-status-tile ${status.className}" type="button" data-status="${status.code}">
        <strong>${status.title}</strong>
        <span>${status.label}</span>
      </button>`)
    .join("");
}

function statusText(unit) {
  if (!unit) return "Status 0";
  const status = portoStatuses.find((entry) => entry.code === String(unit.status));
  if (!status) return "Status 0";
  return unit.statusDetail ? `${status.title} - ${unit.statusDetail}` : `${status.title} - ${status.label}`;
}

function statusClassName(unit) {
  if (unit?.autoOffline) return "auto-offline";
  const status = portoStatuses.find((entry) => entry.code === String(unit?.status));
  return status?.className || "pending";
}

function setPortoDutyPolling(enabled) {
  if (enabled && portoSignedOffUntilStatus0) return;
  if (enabled && !portoDutyPoll) {
    portoDutyPoll = window.setInterval(() => loadPortoDuty({ automatic: true }), PORTO_AUTO_REFRESH_MS);
  }
  if (!enabled && portoDutyPoll) {
    window.clearInterval(portoDutyPoll);
    portoDutyPoll = null;
  }
}

function setPortoSignedOffUntilStatus0(enabled) {
  portoSignedOffUntilStatus0 = Boolean(enabled);
  if (!portoSignedOffUntilStatus0) return;
  setPortoDutyPolling(false);
  if (typeof setPortoOpsPolling === "function") setPortoOpsPolling(false);
  if (portoDeferredDutyLoadTimer) {
    window.clearTimeout(portoDeferredDutyLoadTimer);
    portoDeferredDutyLoadTimer = null;
  }
  if (portoLiveRefreshTimer) {
    window.clearTimeout(portoLiveRefreshTimer);
    portoLiveRefreshTimer = null;
  }
  if (portoLiveRefreshDeferTimer) {
    window.clearTimeout(portoLiveRefreshDeferTimer);
    portoLiveRefreshDeferTimer = null;
  }
}

function clearPortoAutoAssignTimer() {
  if (portoAutoAssignTimer) {
    window.clearTimeout(portoAutoAssignTimer);
    portoAutoAssignTimer = null;
  }
  portoAutoAssignUnitId = "";
}

function pendingAutoAssignDelayMs(unit) {
  const requestedAt = Date.parse(unit?.requestedAt || unit?.updatedAt || "");
  const delayMs = 60000;
  if (!Number.isFinite(requestedAt)) return delayMs;
  return Math.max(0, delayMs - (Date.now() - requestedAt));
}

function schedulePortoAutoAssign(waitingForOps) {
  if (!waitingForOps || !portoDuty?.id) {
    clearPortoAutoAssignTimer();
    return;
  }
  if (portoAutoAssignTimer && portoAutoAssignUnitId === portoDuty.id) return;
  clearPortoAutoAssignTimer();
  portoAutoAssignUnitId = portoDuty.id;
  portoAutoAssignTimer = window.setTimeout(() => {
    portoAutoAssignTimer = null;
    runPortoAutoAssign();
  }, pendingAutoAssignDelayMs(portoDuty));
}

function renderDutyAssignment() {
  if (!portoDuty) return;
  const callsign = $("#portoDutyCallsign");
  const type = $("#portoDutyVehicleType");
  const select = $("#portoDutyVehicleSelect");
  if (!callsign || !type || !select) return;
  const vehicleCode = portoDuty.vehicleCode ? `${portoDuty.vehicleCode} - ` : "";
  callsign.textContent = portoDuty.vehicleNumber || "-";
  type.textContent = `${vehicleCode}${portoDuty.vehicleType || "Geen voertuigtype"}`;
  const choices = portoDuty.vehicleChoices || [];
  const currentVehicle = portoDuty.vehicleName || "";
  select.disabled = !choices.length;
  select.innerHTML = [
    `<option value="">${choices.length ? "Kies voertuig" : "Geen voertuigen ingesteld"}</option>`,
    ...choices.map((vehicle) => `<option value="${escapeHtml(vehicle)}" ${vehicle === currentVehicle ? "selected" : ""}>${escapeHtml(vehicle)}</option>`)
  ].join("");
}

async function updatePortoVehicle(vehicleName) {
  if (!vehicleName) return;
  const response = await fetch("/api/porto/vehicle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vehicleName })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    await showPortoNotice(payload.error || "Voertuig kon niet worden opgeslagen.", "Opslaan mislukt");
    renderDutyAssignment();
    return;
  }
  portoDuty = payload.unit || portoDuty;
  if (payload.profile) portoProfile = payload.profile;
  applyPortoPayload(payload, { suppressOwnAssignmentSound: true });
  renderDutyPanel();
  renderOpsPanel();
}

function renderUnitMemberBar() {
  const bar = $("#portoUnitMemberBar");
  if (!bar || !portoDuty) return;
  const members = [...(portoDuty.unitMembers || [])];
  if (!members.length) {
    members.push({
      name: portoProfile?.name || portoDuty.name,
      rank: portoProfile?.rank || portoDuty.rank,
      serviceNumber: portoProfile?.serviceNumber || portoDuty.serviceNumber,
      phone: portoProfile?.portoPhone || portoDuty.phone,
      completedTrainings: Array.isArray(portoProfile?.completedTrainings) ? portoProfile.completedTrainings : [],
      completedOperational: Array.isArray(portoProfile?.completedOperational) ? portoProfile.completedOperational : [],
      specializations: [
        ...(Array.isArray(portoProfile?.completedTrainings) ? portoProfile.completedTrainings : []),
        ...(Array.isArray(portoProfile?.completedOperational) ? portoProfile.completedOperational : [])
      ],
      dutyRole: portoDuty.dutyRole || ""
    });
  }
  while (members.length < 2) members.push({ empty: true });
  bar.innerHTML = members.map((member, index) => {
    const nameClass = typeof memberNameClass === "function" ? memberNameClass(member) : "porto-member-name";
    const title = typeof memberNameTitle === "function" ? memberNameTitle(member) : "";
    return member.empty ? `
    <article class="porto-unit-member empty">
      <span class="porto-unit-slot">Eenheid ${index + 1}</span>
      <div><span>Rang + Dienstnummer:</span><strong>-</strong></div>
      <div><span>Naam:</span><strong>-</strong></div>
      <div><span>Telefoonnummer:</span><strong>-</strong></div>
    </article>` : `
    <article class="porto-unit-member ${escapeHtml(nameClass.replace("porto-member-name", ""))}"${title ? ` title="${escapeHtml(title)}"` : ""}>
      <span class="porto-unit-slot">Eenheid ${index + 1}</span>
      <div><span>Rang + Dienstnummer:</span><strong>${escapeHtml(member.rank || "-")} - ${escapeHtml(member.serviceNumber || "-")}</strong></div>
      <div><span>Naam:</span><strong class="${escapeHtml(nameClass)}">${escapeHtml(member.name || "Onbekend")}</strong></div>
      <div><span>Telefoonnummer:</span><strong>${escapeHtml(member.phone || "Niet ingevuld")}</strong></div>
    </article>`;
  }).join("");
}

function personOperationalValues(person = portoProfile) {
  return new Set([
    ...(Array.isArray(person?.completedOperational) ? person.completedOperational : []),
    ...(Array.isArray(person?.completedTrainings) ? person.completedTrainings : [])
  ].map(String));
}

function allowedPortoDutyRoles(person = portoProfile) {
  const values = personOperationalValues(person);
  return portoDutyRoles.filter((role) => role.requiredAny.some((value) => values.has(value)));
}

function portoDutyRoleLabel(roleKey) {
  return portoDutyRoles.find((role) => role.key === String(roleKey || "").trim())?.label || "";
}

function renderDutyRolePanel() {
  const panel = $("#portoDutyRolePanel");
  const actions = $("#portoDutyRoleActions");
  if (!panel || !actions) return;
  const allowedRoles = allowedPortoDutyRoles();
  const assigned = Boolean(portoDuty && String(portoDuty.status) !== "8" && portoDuty.vehicleNumber);
  panel.hidden = !assigned || !allowedRoles.length;
  if (panel.hidden) {
    actions.innerHTML = "";
    return;
  }
  const currentRole = String(portoDuty?.dutyRole || "").trim();
  actions.innerHTML = allowedRoles.map((role) => {
    const active = currentRole === role.key;
    return `
      <button class="porto-duty-role-button ${active ? "active" : ""}" type="button" data-duty-role="${escapeHtml(role.key)}">
        <strong>${escapeHtml(role.label)} ${active ? "neerleggen" : "aannemen"}</strong>
        <span>${escapeHtml(role.nicknameLabel)} voor jouw huidige roepnummer</span>
      </button>`;
  }).join("");
}

async function updatePortoDutyRole(roleKey) {
  const currentRole = String(portoDuty?.dutyRole || "").trim();
  const nextRole = currentRole === roleKey ? "" : roleKey;
  const response = await fetch("/api/porto/duty-role", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dutyRole: nextRole })
  });
  const responseText = await response.text().catch(() => "");
  let payload = {};
  try {
    payload = responseText ? JSON.parse(responseText) : {};
  } catch {
    payload = {};
  }
  if (!response.ok) {
    const fallback = responseText && responseText.length < 240
      ? responseText
      : `Dienstrol kon niet worden bijgewerkt. HTTP ${response.status}`;
    await showPortoNotice(payload.error || fallback, "Dienstrol mislukt");
    return;
  }
  portoDuty = payload.unit || portoDuty;
  if (payload.profile) portoProfile = payload.profile;
  applyPortoPayload(payload, { suppressOwnAssignmentSound: true });
  renderDutyPanel();
  renderOpsPanel();
}

function renderDutyOpsInfo() {
  const container = $("#portoDutyOpsInfo");
  if (!container) return;
  const currentTime = new Date().toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  if (!portoCurrentOps) {
    container.innerHTML = `
      <span><span>Huidige ${escapeHtml(portoOperatorLabel)}:</span> <strong>Geen ${escapeHtml(portoOperatorLabel)} in dienst</strong></span>
      <span><span>Huidige tijd:</span> <strong>${escapeHtml(currentTime)}</strong></span>
      ${portoCanTakeOps ? `<button class="porto-ops-action" type="button" data-duty-ops-claim>${escapeHtml(portoOperatorLabel)} overnemen</button>` : ""}
    `;
    return;
  }
  container.innerHTML = `
    <span><span>Huidige ${escapeHtml(portoOperatorLabel)}:</span> <strong>${escapeHtml(portoCurrentOps.name || "Onbekend")}</strong></span>
    <span><span>Telefoonnummer ${escapeHtml(portoOperatorLabel)}:</span> <strong>${escapeHtml(portoCurrentOps.phone || "Niet ingevuld")}</strong></span>
    <span><span>Duur:</span> <strong>${escapeHtml(formatPortoDuration(opsElapsedSeconds(portoCurrentOps)))}</strong></span>
    <span><span>Huidige tijd:</span> <strong>${escapeHtml(currentTime)}</strong></span>
  `;
}

function renderDutyPanel() {
  const intro = $("#portoStatusIntro");
  const panel = $("#portoDutyPanel");
  const pendingPanel = $("#portoPendingPanel");
  const opsLogPage = $("#portoOpsLogPage");
  const devBypassButton = $("#portoDevBypassBtn");
  const managementBypassButton = $("#portoManagementBypassBtn");
  if (!intro || !panel || !pendingPanel) return;
  if (portoViewingOpsLog) {
    clearPortoAutoAssignTimer();
    intro.hidden = true;
    pendingPanel.hidden = true;
    panel.hidden = true;
    if (opsLogPage) opsLogPage.hidden = false;
    renderOpsLog();
    renderOpsLogAccess();
    setPortoDutyPolling(false);
    renderPortoWorkspaceMode();
    return;
  }
  if (opsLogPage) opsLogPage.hidden = true;
  const hasDuty = Boolean(portoDuty && String(portoDuty.status) !== "8");
  const waitingForOps = Boolean(hasDuty && String(portoDuty.status) === "0" && !portoDuty.vehicleNumber);
  const opsWorkspace = canUseOpsWorkspace();
  const assignedDuty = Boolean(hasDuty && portoDuty.vehicleNumber);
  const opsViewButton = $("#portoShowOpsViewBtn");
  if (opsViewButton) opsViewButton.hidden = !(assignedDuty && portoCanManageOps && !isCurrentOpsUser());
  intro.hidden = hasDuty || opsWorkspace;
  pendingPanel.hidden = !waitingForOps;
  if (managementBypassButton) {
    managementBypassButton.hidden = !(waitingForOps && canUseManagementBypass());
    managementBypassButton.textContent = portoManagementBypassLabel || (portoOrganization.key === "politie" ? "Korpsleiding Bypass" : "Kader Bypass");
  }
  if (devBypassButton) devBypassButton.hidden = !(waitingForOps && isDevBypassProfile());
  schedulePortoAutoAssign(waitingForOps);
  panel.hidden = !assignedDuty || opsWorkspace;
  renderOpsLogAccess();
  setPortoDutyPolling((waitingForOps || assignedDuty) && !opsWorkspace);
  renderPortoWorkspaceMode();
  if (!assignedDuty || opsWorkspace || !portoProfile) return;
  renderDutyAssignment();
  renderUnitMemberBar();
  renderDutyRolePanel();
  renderDutyOpsInfo();
  const statusPill = $("#portoDutyCurrentStatus");
  statusPill.textContent = statusText(portoDuty);
  statusPill.className = `porto-status-pill ${statusClassName(portoDuty)}`;
  document.querySelectorAll(".porto-status-tile").forEach((button) => {
    button.classList.toggle("active", button.dataset.status === String(portoDuty.status));
    button.disabled = false;
  });
}

async function loadPortoDuty(options = {}) {
  const automatic = Boolean(options.automatic);
  if (automatic && portoSignedOffUntilStatus0) return null;
  if (portoDutyLoadPromise) return portoDutyLoadPromise;
  if (automatic) {
    const elapsed = Date.now() - portoLastDutyLoadAt;
    if (elapsed < PORTO_AUTO_REFRESH_MS) {
      if (!portoDeferredDutyLoadTimer) {
        portoDeferredDutyLoadTimer = window.setTimeout(() => {
          portoDeferredDutyLoadTimer = null;
          loadPortoDuty({ automatic: true });
        }, PORTO_AUTO_REFRESH_MS - elapsed);
      }
      return null;
    }
  }
  portoLastDutyLoadAt = Date.now();
  portoDutyLoadPromise = (async () => {
    const includePhonebook = Boolean(options.includePhonebook || !portoPhonebookSignature || $("#portoPhonebookDialog")?.open);
    const response = await fetch(`/api/porto/status${includePhonebook ? "" : "?phonebook=0"}`);
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      showPortoInlineError(payload.error || "Porto status kon niet worden geladen.");
      return;
    }
    const payload = await response.json();
    portoDuty = payload.unit || null;
    portoLastDutyLoadAt = Date.now();
    applyPortoPayload(payload);
    renderVehicleRanges();
    renderDutyPanel();
    renderOpsPanel();
  })()
    .catch(() => {
      showPortoInlineError("Porto status laden mislukt. Probeer opnieuw of herlaad de pagina.");
    })
    .finally(() => {
      portoDutyLoadPromise = null;
    });
  return portoDutyLoadPromise;
}

async function updatePortoStatus(status, detail = "") {
  if (portoStatusWritePromise) await portoStatusWritePromise.catch(() => {});
  portoStatusWritePromise = (async () => {
    if (status === "0") setPortoSignedOffUntilStatus0(false);
    const requestNoteInput = $("#portoStatusRequestInput");
    const requestNote = status === "0" ? String(requestNoteInput?.value || "").trim() : "";
    const response = await fetch("/api/porto/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, detail, requestNote })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (payload.code === "porto_recently_ended") {
        setPortoSignedOffUntilStatus0(true);
        portoDuty = null;
        portoLastDutyLoadAt = Date.now();
        applyPortoPayload({ unit: null, recentlyEnded: true });
        renderVehicleRanges();
        renderDutyPanel();
        renderOpsPanel();
      }
      showPortoInlineError(payload.error || "Porto status kon niet worden opgeslagen.");
      await showPortoNotice(payload.error || "Porto status kon niet worden opgeslagen.", "Status mislukt");
      return;
    }
    setPortoSignedOffUntilStatus0(status === "8" || Boolean(payload.recentlyEnded));
    portoDuty = payload.unit || null;
    portoLastDutyLoadAt = Date.now();
    applyPortoPayload(payload);
    if (payload.profile) portoProfile = payload.profile;
    if (status === "0" && requestNoteInput) requestNoteInput.value = "";
    renderVehicleRanges();
    renderDutyPanel();
    renderOpsPanel();
  })()
    .finally(() => {
      portoStatusWritePromise = null;
    });
  return portoStatusWritePromise;
}

async function runPortoDevBypass() {
  const response = await fetch("/api/porto/dev-bypass", { method: "POST" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    await showPortoNotice(payload.error || "Dev bypass kon niet worden uitgevoerd.", "Dev bypass mislukt");
    return;
  }
  portoDuty = payload.unit || null;
  portoLastDutyLoadAt = Date.now();
  if (payload.profile) portoProfile = payload.profile;
  applyPortoPayload(payload);
  renderVehicleRanges();
  renderDutyPanel();
  renderOpsPanel();
}

async function runPortoManagementBypass() {
  const response = await fetch("/api/porto/management-bypass", { method: "POST" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    await showPortoNotice(payload.error || `${portoManagementBypassLabel || "Bypass"} kon niet worden uitgevoerd.`, `${portoManagementBypassLabel || "Bypass"} mislukt`);
    return;
  }
  portoDuty = payload.unit || null;
  portoLastDutyLoadAt = Date.now();
  if (payload.profile) portoProfile = payload.profile;
  applyPortoPayload(payload);
  renderVehicleRanges();
  renderDutyPanel();
  renderOpsPanel();
}

async function runPortoAutoAssign() {
  if (!portoDuty || String(portoDuty.status) !== "0" || portoDuty.vehicleNumber) return;
  const response = await fetch("/api/porto/auto-assign", { method: "POST" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (payload.waitSeconds) {
      portoAutoAssignTimer = window.setTimeout(() => {
        portoAutoAssignTimer = null;
        runPortoAutoAssign();
      }, Math.max(1, Number(payload.waitSeconds)) * 1000);
      return;
    }
    showPortoInlineError(payload.error || "Automatisch aanmelden is niet gelukt.");
    return;
  }
  portoDuty = payload.unit || null;
  portoLastDutyLoadAt = Date.now();
  if (payload.profile) portoProfile = payload.profile;
  applyPortoPayload(payload);
  renderVehicleRanges();
  renderDutyPanel();
  renderOpsPanel();
}

window.PortoModules.registerFeature("duty", { ready: true });

