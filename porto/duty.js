/* Porto dienstmodule: statusknoppen, dienstpaneel, voertuigkeuze en Status 0 flow. */

function isDevBypassProfile() {
  return Boolean(portoCanUseDevTools);
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
  if (enabled && !portoDutyPoll) {
    portoDutyPoll = window.setInterval(() => loadPortoDuty({ automatic: true }), PORTO_AUTO_REFRESH_MS);
  }
  if (!enabled && portoDutyPoll) {
    window.clearInterval(portoDutyPoll);
    portoDutyPoll = null;
  }
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
      phone: portoProfile?.portoPhone || portoDuty.phone
    });
  }
  while (members.length < 2) members.push({ empty: true });
  bar.innerHTML = members.map((member, index) => member.empty ? `
    <article class="porto-unit-member empty">
      <span class="porto-unit-slot">Eenheid ${index + 1}</span>
      <div><span>Rang + Dienstnummer:</span><strong>-</strong></div>
      <div><span>Naam:</span><strong>-</strong></div>
      <div><span>Telefoonnummer:</span><strong>-</strong></div>
    </article>` : `
    <article class="porto-unit-member">
      <span class="porto-unit-slot">Eenheid ${index + 1}</span>
      <div><span>Rang + Dienstnummer:</span><strong>${escapeHtml(member.rank || "-")} - ${escapeHtml(member.serviceNumber || "-")}</strong></div>
      <div><span>Naam:</span><strong>${escapeHtml(member.name || "Onbekend")}</strong></div>
      <div><span>Telefoonnummer:</span><strong>${escapeHtml(member.phone || "Niet ingevuld")}</strong></div>
    </article>`).join("");
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
  if (!intro || !panel || !pendingPanel) return;
  if (portoViewingOpsLog) {
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
  if (devBypassButton) devBypassButton.hidden = !(waitingForOps && isDevBypassProfile());
  panel.hidden = !assignedDuty || opsWorkspace;
  renderOpsLogAccess();
  setPortoDutyPolling((waitingForOps || assignedDuty) && !opsWorkspace);
  renderPortoWorkspaceMode();
  if (!assignedDuty || opsWorkspace || !portoProfile) return;
  renderDutyAssignment();
  renderUnitMemberBar();
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
    const response = await fetch("/api/porto/status");
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

window.PortoModules.registerFeature("duty", { ready: true });

