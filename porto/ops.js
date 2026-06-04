/* Porto OPS-module: OPS bediening, verzoeken, eenheden en contextacties. */

function formatPortoDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = String(Math.floor(total / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const secs = String(total % 60).padStart(2, "0");
  return `${hours}:${minutes}:${secs}`;
}

function opsElapsedSeconds(ops = portoCurrentOps) {
  const started = Date.parse(ops?.startedAt || "");
  if (!Number.isFinite(started)) return 0;
  return Math.max(0, Math.floor((Date.now() - started) / 1000));
}

function renderVehicleRanges() {
  const table = $("#portoVehicleRangeTable");
  if (!table) return;
  const rows = portoVehicleRanges.length
    ? portoVehicleRanges.map((range) => `
      <strong>${escapeHtml(range.from)} t/m ${escapeHtml(range.to)}</strong>
      <span>${escapeHtml(range.vehicleCode ? `${range.vehicleCode} - ` : "")}${escapeHtml(range.vehicleType)}</span>`).join("")
    : '<strong>-</strong><span>Geen reeksen ingesteld</span>';
  table.innerHTML = `<div>Nummer</div><div>Voertuig</div>${rows}`;
}

function applyPortoPayload(payload) {
  PortoAudio.trackOpsSounds(payload, portoProfile);
  portoCurrentOps = payload.currentOps || null;
  portoCanTakeOps = Boolean(payload.canTakeOps);
  portoCanManageOps = Boolean(payload.canManageOps);
  portoCanViewOpsLog = Boolean(payload.canViewOpsLog);
  portoCanUseDevTools = Boolean(payload.canUseDevTools);
  portoOpsRequests = payload.opsRequests || [];
  portoAvailableVehicleRanges = payload.availableVehicleRanges || [];
  portoLinkableUnits = payload.linkableUnits || [];
  portoActiveUnits = payload.activeUnits || [];
  portoDiscordChannels = payload.discordChannels || [];
  portoDiscordChannelGroups = payload.discordChannelGroups || [];
  portoMapEnabled = Boolean(payload.mapEnabled);
  portoOpsLog = payload.opsLog || [];
  portoVehicleRanges = payload.vehicleRanges || portoVehicleRanges;
}

function isCurrentOpsUser() {
  return Boolean(portoCurrentOps && portoProfile && portoCurrentOps.memberId === portoProfile.id);
}

function canUseOpsWorkspace() {
  return Boolean(isCurrentOpsUser() || (portoCanManageOps && portoOpsViewMode === "ops"));
}

function setPortoOpsPolling(enabled) {
  if (enabled && !portoOpsPoll) {
    portoOpsPoll = window.setInterval(() => loadPortoDuty({ automatic: true }), PORTO_AUTO_REFRESH_MS);
  }
  if (!enabled && portoOpsPoll) {
    window.clearInterval(portoOpsPoll);
    portoOpsPoll = null;
  }
}

function renderPortoWorkspaceMode() {
  const opsWorkspace = canUseOpsWorkspace();
  const dutyWorkspace = !opsWorkspace && isAssignedDuty();
  document.body.classList.toggle("porto-workspace", opsWorkspace || dutyWorkspace);
  document.body.classList.toggle("porto-ops-workspace", opsWorkspace);
  document.body.classList.toggle("porto-duty-workspace", dutyWorkspace);
  setPortoOpsPolling(opsWorkspace);
}

function opsLogPersonKey(entry) {
  return String(entry.memberId || entry.serviceNumber || entry.name || "onbekend");
}

function renderOpsLogAccess() {
  const button = $("#portoOpenOpsLogBtn");
  if (button) button.hidden = !portoCanViewOpsLog;
}

function openPortoOpsLogPage() {
  if (!portoCanViewOpsLog) return;
  portoViewingOpsLog = true;
  renderDutyPanel();
  renderOpsPanel();
}

function closePortoOpsLogPage() {
  portoViewingOpsLog = false;
  renderDutyPanel();
  renderOpsPanel();
}

function renderOpsStatus() {
  const text = $("#portoCurrentOpsText");
  const durationBadge = $("#portoOpsDurationBadge");
  const claimButton = $("#portoOpsClaimBtn");
  const releaseButton = $("#portoOpsReleaseBtn");
  if (!text || !claimButton || !releaseButton) return;
  const duration = formatPortoDuration(opsElapsedSeconds(portoCurrentOps));
  text.textContent = portoCurrentOps ? `OPS in dienst: ${portoCurrentOps.name} - ${duration}` : "Huidige OPS:";
  if (durationBadge) {
    durationBadge.hidden = !portoCurrentOps;
    durationBadge.textContent = `${isCurrentOpsUser() ? "Jouw OPS duur" : "OPS duur"}: ${duration}`;
  }
  claimButton.hidden = Boolean(portoCurrentOps) || !portoCanTakeOps;
  releaseButton.hidden = !portoCurrentOps || !portoCanManageOps;
}

function vehicleCategoryOptionsHtml() {
  const options = portoAvailableVehicleRanges
    .filter((range) => (range.numbers || []).length)
    .map((range) => `<option value="${escapeHtml(range.prefix)}">${escapeHtml(range.vehicleCode ? `${range.vehicleCode} - ` : "")}${escapeHtml(range.vehicleType)} (${escapeHtml(range.from)} t/m ${escapeHtml(range.to)})</option>`)
    .join("");
  return options || '<option value="">Geen vrije categorieen</option>';
}

function linkOptionsHtml(currentVehicleNumber = "") {
  const options = portoLinkableUnits
    .filter((unit) => unit.vehicleNumber !== currentVehicleNumber)
    .map((unit) => `<option value="${escapeHtml(unit.vehicleNumber)}">${escapeHtml(unit.label)}</option>`)
    .join("");
  return options || '<option value="">Geen koppelbare eenheden</option>';
}

function opsMemberSpecializations(member) {
  // Porto toont alleen specialisaties die de OPS helpen met indelen, plus IBT-status.
  const visibleSpecializations = new Set(["IBT", "TMO", "SIV", "ZULU", "OGM"]);
  const values = [...(member.specializations || []), ...(member.completedTrainings || []), ...(member.completedOperational || [])]
    .filter(Boolean)
    .filter((item) => visibleSpecializations.has(item));
  return [...new Set(values)];
}

function findOpsMember(unitId) {
  const id = String(unitId || "");
  if (!id) return null;
  for (const unit of portoActiveUnits || []) {
    const members = unit.members || [];
    const member = members.find((entry) =>
      [entry.id, entry.memberId, entry.vehicleNumber].filter(Boolean).map(String).includes(id)
    );
    if (member) return { unit, member };
    if (String(unit.vehicleNumber || "") === id && members[0]) return { unit, member: members[0] };
  }
  return null;
}

function primaryOpsMemberId(unit) {
  // OPS-acties sturen altijd een echte unit-id naar de server; bij gekoppelde eenheden pakken we de eerste persoon als anker.
  return String((unit.members || [])[0]?.id || "");
}

function closePortoOpsContextMenu() {
  const menu = $("#portoOpsUnitContextMenu");
  if (!menu) return;
  menu.hidden = true;
  portoOpsContextUnitId = "";
}

async function copyTextToClipboard(text) {
  const value = String(text || "").trim();
  if (!value) return false;
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return true;
  }
  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();
  const copied = document.execCommand("copy");
  input.remove();
  return copied;
}

function openPortoOpsContextMenu(event, unitId) {
  const menu = $("#portoOpsUnitContextMenu");
  const context = findOpsMember(unitId);
  if (!menu || !context) return;
  event.preventDefault();
  portoOpsContextUnitId = unitId;
  const title = menu.querySelector("[data-ops-context-title]");
  if (title) title.textContent = `${context.member.vehicleNumber || context.unit.vehicleNumber || "-"} - ${context.member.name || "Onbekend"}`;
  const phone = String(context.member.phone || "").trim();
  const phoneLabel = menu.querySelector("[data-ops-context-phone]");
  if (phoneLabel) phoneLabel.textContent = phone || "Geen telefoonnummer";
  const copyButton = menu.querySelector("[data-ops-context-action='copy-phone']");
  if (copyButton) copyButton.disabled = !phone;
  positionContextMenu(menu, event.clientX, event.clientY);
}

function holdOpsRequestInteraction() {
  // OPS ververst automatisch; deze korte hold voorkomt dat dropdowns en knoppen verdwijnen tijdens indelen/koppelen.
  portoOpsRequestInteractionUntil = Date.now() + 5000;
}

function isEditingOpsRequest() {
  const list = $("#portoOpsRequests");
  const active = document.activeElement;
  return Boolean(
    list &&
      (Date.now() < portoOpsRequestInteractionUntil ||
        list.matches(":hover") ||
        (active && list.contains(active) && active.matches("select, button")))
  );
}

function renderOpsRequests() {
  const panel = $("#portoOpsPanel");
  const list = $("#portoOpsRequests");
  const count = $("#portoOpsCount");
  if (!panel || !list || !count) return;
  const showPanel = Boolean(canUseOpsWorkspace() && portoCanManageOps);
  panel.hidden = !showPanel;
  if (!showPanel) return;
  count.textContent = `${portoOpsRequests.length} verzoek${portoOpsRequests.length === 1 ? "" : "en"}`;
  // De OPS-poll ververst elke paar seconden; tijdens kiezen in een dropdown mag de DOM niet vervangen worden.
  if (isEditingOpsRequest()) return;
  if (!portoOpsRequests.length) {
    list.innerHTML = '<div class="porto-ops-empty">Geen open Status 0-aanmeldingen.</div>';
    return;
  }
  const vehicleOptions = vehicleCategoryOptionsHtml();
  const linkOptions = linkOptionsHtml();
  list.innerHTML = portoOpsRequests.map((request) => {
    const requestSpecializations = opsMemberSpecializations(request);
    const requestHasIbt = requestSpecializations.includes("IBT");
    const requestPills = requestSpecializations.map((item) => `<span class="porto-specialty-pill">${escapeHtml(item)}</span>`);
    if (!requestHasIbt) requestPills.push('<span class="porto-specialty-pill no-ibt">Geen IBT</span>');
    const requestSpecializationsHtml = requestPills.length
      ? `<div class="porto-ops-request-specialties">${requestSpecializations.length ? "<span>Specialisaties</span>" : ""}<div>${requestPills.join("")}</div></div>`
      : "";
    const requestNoteHtml = request.requestNote
      ? `<div class="porto-ops-request-note"><span>Koppelverzoek:</span><p>${escapeHtml(request.requestNote)}</p></div>`
      : "";
    return `
    <article class="porto-ops-request" data-ops-request="${escapeHtml(request.id)}" title="Rechtermuisknop voor extra opties">
      <div class="porto-ops-person">
        <strong>${escapeHtml(request.rank || "-")} - ${escapeHtml(request.name || "Onbekend")}</strong>
        <span>${escapeHtml(request.serviceNumber || "-")} - ${escapeHtml(request.phone || "Geen telefoonnummer")}</span>
        ${requestSpecializationsHtml}
        ${requestNoteHtml}
      </div>
      <div class="porto-ops-choice">
        <label>
          <span>Koppel aan</span>
          <select data-link-select="${escapeHtml(request.id)}">${linkOptions}</select>
        </label>
        <button class="porto-ops-assign secondary" type="button" data-link-unit="${escapeHtml(request.id)}">Koppelen</button>
      </div>
      <div class="porto-ops-choice">
        <label>
          <span>Kies voertuig</span>
          <select data-category-select="${escapeHtml(request.id)}">${vehicleOptions}</select>
        </label>
        <button class="porto-ops-assign" type="button" data-assign-unit="${escapeHtml(request.id)}">Indelen</button>
      </div>
    </article>`;
  }).join("");
}

function memberStatusLabel(member) {
  const status = portoStatuses.find((entry) => entry.code === String(member.status));
  if (!status) return "Status 0";
  return member.statusDetail ? `${status.title} - ${member.statusDetail}` : `${status.title} - ${status.label}`;
}

function renderOpsUnitCard(unit, options = {}) {
  const vehicleLine = unit.vehicleName || `${unit.vehicleCode ? `${unit.vehicleCode} - ` : ""}${unit.vehicleType || "Geen voertuig"}`;
  const primaryMember = (unit.members || [])[0] || {};
  const primaryActionId = primaryOpsMemberId(unit);
  const statusButton = primaryActionId
    ? `<button class="porto-status-pill porto-ops-status-button ${statusClassName(primaryMember)}" type="button" data-ops-status-unit="${escapeHtml(primaryActionId)}" title="Rechtermuisknop voor status wijzigen">${escapeHtml(memberStatusLabel(primaryMember))}</button>`
    : '<span class="porto-status-pill pending">Geen status</span>';
  const members = (unit.members || []).map((member) => {
    const specializations = opsMemberSpecializations(member);
    const hasIbt = specializations.includes("IBT");
    const specialtyPills = specializations.map((item) => `<span class="porto-specialty-pill">${escapeHtml(item)}</span>`);
    if (!hasIbt) specialtyPills.push('<span class="porto-specialty-pill no-ibt">Geen IBT</span>');
    const specializationsHtml = specialtyPills.length
      ? `<div class="porto-ops-specialties">${specializations.length ? "<span>Specialisaties:</span>" : ""}<div>${specialtyPills.join("")}</div></div>`
      : "";
    return `
      <article class="porto-ops-unit-member compact ${member.autoOffline ? "auto-offline" : ""}" data-ops-unit-member="${escapeHtml(member.id)}" title="Rechtermuisknop voor koppelen of uit dienst melden">
        <div class="porto-ops-unit-left">
          <div><span>Naam:</span><strong>${escapeHtml(member.name || "Onbekend")}</strong></div>
          ${specializationsHtml}
        </div>
      </article>`;
  }).join("");
  return `
    <article class="porto-ops-unit-card compact grouped ${unit.autoOffline ? "auto-offline" : ""} ${options.channelCard ? "in-channel" : ""}" ${primaryActionId ? `draggable="true" data-discord-unit="${escapeHtml(primaryActionId)}"` : ""}>
      <header class="porto-ops-unit-group-head three-columns">
        <div data-ops-number-unit="${escapeHtml(primaryActionId)}" title="Rechtermuisknop voor nummer wijzigen"><span>Roepnummer:</span><button class="porto-unit-header-action" type="button" tabindex="-1">${escapeHtml(unit.vehicleNumber || "-")}</button></div>
        <div data-ops-status-unit="${escapeHtml(primaryActionId)}" title="Rechtermuisknop voor status wijzigen"><span>Status:</span>${statusButton}</div>
        <div data-ops-vehicle-unit="${escapeHtml(primaryActionId)}" title="Rechtermuisknop voor voertuig wijzigen"><span>Voertuig:</span><button class="porto-unit-header-action align-right" type="button" tabindex="-1">${escapeHtml(vehicleLine)}</button></div>
      </header>
      <div class="porto-ops-unit-group-members ${unit.members?.length >= 3 ? "three-members" : "two-members"}">${members}</div>
    </article>`;
}

function renderOpsUnits() {
  const list = $("#portoOpsUnits");
  const count = $("#portoOpsUnitsCount");
  if (!list || !count) return;
  const memberCount = portoActiveUnits.reduce((total, unit) => total + (unit.members || []).length, 0);
  count.textContent = `${memberCount} actief`;
  if (!portoActiveUnits.length) {
    list.innerHTML = '<div class="porto-ops-empty">Geen actieve eenheden.</div>';
    return;
  }
  list.innerHTML = portoActiveUnits.map((unit) => renderOpsUnitCard(unit)).join("");
}

function renderDiscordChannels() {
  const container = $("#portoDiscordChannels");
  if (!container) return;
  const channels = portoDiscordChannels || [];
  const channelsByKey = new Map(channels.map((channel) => [channel.key, channel]));
  const visibleGroups = (portoDiscordChannelGroups || []).filter((group) => (group.units || []).length > 0);
  if (!visibleGroups.length) {
    container.innerHTML = '<div class="porto-ops-empty">Geen Discord Porto-kanalen actief.</div>';
    return;
  }
  container.innerHTML = visibleGroups.map((group) => {
    const channel = channelsByKey.get(group.key) || group;
    const units = group.units || [];
    return `
      <article class="porto-discord-channel" data-discord-channel="${escapeHtml(channel.key)}">
        <header class="porto-discord-channel-head">
          <strong>${escapeHtml(channel.label || channel.key)}</strong>
          <input type="text" value="${escapeHtml(group.status || "")}" placeholder="Discord status" data-discord-channel-status="${escapeHtml(channel.key)}" />
          <button class="porto-ops-assign secondary" type="button" data-save-discord-channel-status="${escapeHtml(channel.key)}">Opslaan</button>
        </header>
        <div class="porto-discord-channel-units">
          ${units.map((unit) => renderOpsUnitCard(unit, { channelCard: true })).join("")}
        </div>
      </article>`;
  }).join("");
}

async function chooseOpsVehicleUpdate(unitId, anchorEvent) {
  const options = portoAvailableVehicleRanges
    .filter((range) => (range.numbers || []).length)
    .map((range) => ({ value: range.prefix, label: `${range.vehicleCode ? `${range.vehicleCode} - ` : ""}${range.vehicleType} (${range.from} t/m ${range.to})` }));
  const selected = await showPortoContextChoice(anchorEvent, "Voertuig wijzigen", options);
  if (selected) await reassignPortoUnit(unitId, { vehiclePrefix: selected.value });
}

async function chooseOpsNumberUpdate(unitId, anchorEvent) {
  const context = findOpsMember(unitId);
  if (!context) return;
  const currentNumber = context.member.vehicleNumber || context.unit.vehicleNumber || "";
  const currentRange = (portoVehicleRanges || []).find((range) => (range.numbers || []).includes(currentNumber));
  if (!currentRange) {
    await showPortoNotice("Geen voertuigreeks gevonden voor dit roepnummer.", "Nummer wijzigen");
    return;
  }
  const usedNumbers = new Set(portoActiveUnits.map((unit) => unit.vehicleNumber).filter((number) => number && number !== currentNumber));
  const options = (currentRange.numbers || [])
    .filter((number) => number === currentNumber || !usedNumbers.has(number))
    .map((number) => ({ value: number, label: `${number} - ${currentRange.vehicleCode || currentRange.vehicleType || "Voertuig"}` }));
  const selected = await showPortoContextChoice(anchorEvent, `Nummer wijzigen (${currentRange.vehicleCode || currentRange.vehicleType})`, options);
  if (selected) await reassignPortoUnit(unitId, { vehicleNumber: selected.value });
}

async function chooseOpsStatusUpdate(unitId, anchorEvent) {
  const statusOptions = portoStatuses
    .filter((status) => status.code !== "8")
    .map((status) => ({ value: status.code, label: `${status.title} - ${status.label}` }));
  const selected = await showPortoContextChoice(anchorEvent, "Status wijzigen", statusOptions);
  if (!selected) return;
  let statusDetail = "";
  if (selected.value === "4") {
    const detail = await showPortoContextChoice(anchorEvent, "Status 4 reden", [
      { value: "Staandehouding", label: "Staandehouding" },
      { value: "Afhandeling", label: "Afhandeling" },
      { value: "In hoofd", label: "In hoofd" },
      { value: "Overige", label: "Overige" }
    ]);
    if (!detail) return;
    statusDetail = detail.value;
  }
  await reassignPortoUnit(unitId, { status: selected.value, statusDetail });
}

async function reassignPortoUnit(unitId, assignment) {
  if (!assignment?.vehiclePrefix && !assignment?.linkToVehicleNumber && !assignment?.vehicleNumber && !assignment?.offDuty && !assignment?.unlink && !assignment?.status && !assignment?.discordChannelKey && assignment?.discordChannelStatus === undefined) {
    await showPortoNotice("Kies eerst een voertuigcategorie, koppel-eenheid, roepnummer, status of actie.", "Geen actie gekozen");
    return;
  }
  const response = await fetch("/api/porto/reassign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ unitId, ...assignment })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    await showPortoNotice(payload.error || "Eenheid kon niet worden aangepast.", "Actie mislukt");
    return;
  }
  if (payload.unit?.memberId === portoProfile?.id) portoDuty = payload.unit;
  portoLastDutyLoadAt = Date.now();
  applyPortoPayload(payload);
  portoOpsRequestInteractionUntil = 0;
  document.activeElement?.blur?.();
  renderDutyPanel();
  renderOpsPanel();
}

function renderOpsLog() {
  const rows = $("#portoOpsLogRows");
  const topRows = $("#portoOpsLogTopRows");
  if (!rows || !topRows) return;
  const totals = new Map();
  for (const entry of portoOpsLog || []) {
    const key = opsLogPersonKey(entry);
    const current = totals.get(key) || {
      serviceNumber: entry.serviceNumber || "-",
      name: entry.name || "Onbekend",
      durationSeconds: 0
    };
    current.durationSeconds += Number(entry.durationSeconds || 0);
    totals.set(key, current);
  }
  const top = [...totals.values()]
    .sort((a, b) => b.durationSeconds - a.durationSeconds)
    .slice(0, 5);
  topRows.innerHTML = top.length
    ? top.map((entry, index) => `
      <article class="porto-ops-log-top-row">
        <span>${index + 1}</span>
        <strong>${escapeHtml(entry.serviceNumber || "-")} - ${escapeHtml(entry.name || "Onbekend")}</strong>
        <b>${escapeHtml(formatPortoDuration(entry.durationSeconds))}</b>
      </article>
    `).join("")
    : '<div class="porto-ops-empty">Nog geen OPS uren geregistreerd.</div>';
  rows.innerHTML = portoOpsLog.length
    ? portoOpsLog.map((entry) => `
      <article class="porto-ops-log-row">
        <strong>${escapeHtml(entry.serviceNumber || "-")} - ${escapeHtml(entry.name || "Onbekend")}</strong>
        <span>${escapeHtml(formatPortoDuration(entry.durationSeconds))}</span>
        <small>${escapeHtml(entry.startedAt ? new Date(entry.startedAt).toLocaleString("nl-NL") : "-")} t/m ${escapeHtml(entry.endedAt ? new Date(entry.endedAt).toLocaleString("nl-NL") : "-")}</small>
      </article>
    `).join("")
    : '<div class="porto-ops-empty">Nog geen OPS diensten gelogd.</div>';
}

function renderOpsPanel() {
  renderOpsLogAccess();
  renderOpsLog();
  if (portoViewingOpsLog) {
    $("#portoOpsPanel").hidden = true;
    return;
  }
  const devTestButton = $("#portoOpsDevTestBtn");
  if (devTestButton) devTestButton.hidden = !portoCanUseDevTools;
  const dutyViewButton = $("#portoShowDutyViewBtn");
  if (dutyViewButton) dutyViewButton.hidden = !(portoCanManageOps && isAssignedDuty() && !isCurrentOpsUser());
  renderOpsStatus();
  renderOpsRequests();
  renderDiscordChannels();
  renderOpsUnits();
  const mapCard = $("#portoMapCard");
  document.body.classList.toggle("porto-map-disabled", !portoMapEnabled);
  if (mapCard) mapCard.hidden = !portoMapEnabled;
  if (portoMapEnabled) renderOpsMap();
}

async function runPortoOpsDevTest() {
  const response = await fetch("/api/porto/dev-test", { method: "POST" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    await showPortoNotice(payload.error || "Testaanmelding kon niet worden gemaakt.", "Dev test mislukt");
    return;
  }
  applyPortoPayload(payload);
  renderOpsPanel();
  const name = payload.devTestPerson?.name || "Een medewerker";
  await showPortoNotice(`${name} is als Status 0-testaanmelding toegevoegd.`, "Dev test");
}

async function updatePortoOps(action) {
  if (portoOpsWritePromise) return portoOpsWritePromise;
  portoOpsWritePromise = (async () => {
    const response = await fetch("/api/porto/ops", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      showPortoInlineError(payload.error || "OPS kon niet worden bijgewerkt.");
      await showPortoNotice(payload.error || "OPS kon niet worden bijgewerkt.", "OPS mislukt");
      return;
    }
    portoLastDutyLoadAt = Date.now();
    applyPortoPayload(payload);
    portoOpsRequestInteractionUntil = 0;
    document.activeElement?.blur?.();
    renderVehicleRanges();
    renderDutyPanel();
    renderOpsPanel();
  })()
    .finally(() => {
      portoOpsWritePromise = null;
    });
  return portoOpsWritePromise;
}

async function assignPortoUnit(unitId, assignment) {
  if (!assignment?.vehiclePrefix && !assignment?.linkToVehicleNumber && !assignment?.vehicleNumber && !assignment?.offDuty && !assignment?.unlink && !assignment?.status && !assignment?.discordChannelKey && !assignment?.reject && assignment?.discordChannelStatus === undefined) {
    await showPortoNotice("Kies eerst een voertuigcategorie, koppel-eenheid, roepnummer, status of actie.", "Geen actie gekozen");
    return;
  }
  const response = await fetch("/api/porto/assign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ unitId, ...assignment })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    await showPortoNotice(payload.error || "Eenheid kon niet worden ingedeeld.", "Indelen mislukt");
    return;
  }
  portoLastDutyLoadAt = Date.now();
  applyPortoPayload(payload);
  portoOpsRequestInteractionUntil = 0;
  document.activeElement?.blur?.();
  renderVehicleRanges();
  renderDutyPanel();
  renderOpsPanel();
}

async function rejectPortoRequest(unitId) {
  const request = (portoOpsRequests || []).find((entry) => String(entry.id) === String(unitId));
  const confirmed = await showPortoConfirm(
    `${request?.name || "Deze aanmelding"} weigeren en niet aanmelden?`,
    "Aanmelding weigeren"
  );
  if (!confirmed) return;
  await assignPortoUnit(unitId, { reject: true });
}

async function openPortoRequestContextMenu(event, unitId) {
  event.preventDefault();
  holdOpsRequestInteraction();
  const request = (portoOpsRequests || []).find((entry) => String(entry.id) === String(unitId));
  if (!request) return;
  const selected = await showPortoContextChoice(event, request.name || "Aanmelding", [
    { value: "reject", label: "Weigeren" }
  ]);
  if (selected?.value === "reject") await rejectPortoRequest(unitId);
}

window.PortoModules.registerFeature("ops", { ready: true });




window.setInterval(() => { renderOpsStatus(); if (typeof renderDutyOpsInfo === "function") renderDutyOpsInfo(); }, 1000);
