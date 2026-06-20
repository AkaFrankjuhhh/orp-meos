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

function applyPortoPayload(payload, options = {}) {
  PortoAudio.trackOpsSounds(payload, portoProfile, options);
  portoCurrentOps = payload.currentOps || null;
  portoCanTakeOps = Boolean(payload.canTakeOps);
  portoCanManageOps = Boolean(payload.canManageOps);
  portoCanViewOpsLog = Boolean(payload.canViewOpsLog);
  portoCanUseDevTools = Boolean(payload.canUseDevTools);
  portoOpsRequests = payload.opsRequests || [];
  portoAvailableVehicleRanges = payload.availableVehicleRanges || [];
  portoLinkableUnits = payload.linkableUnits || [];
  portoActiveUnits = payload.activeUnits || [];
  portoSideTaskOverview = payload.sideTaskOverview || [];
  portoDiscordChannels = payload.discordChannels || [];
  portoDiscordChannelGroups = payload.discordChannelGroups || [];
  portoMapEnabled = Boolean(payload.mapEnabled);
  portoOpsLog = payload.opsLog || [];
  portoVehicleRanges = payload.vehicleRanges || portoVehicleRanges;
}

function isCurrentOpsUser() {
  return Boolean(portoCanManageOps && portoCurrentOps && portoProfile && portoCurrentOps.memberId === portoProfile.id);
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
  const entry = $("#portoOpsLogEntry");
  const button = $("#portoOpenOpsLogBtn");
  const visible = Boolean(portoCanViewOpsLog && !portoViewingOpsLog && !canUseOpsWorkspace());
  if (entry) entry.hidden = !visible;
  if (button) button.hidden = !visible;
}

function openPortoOpsLogPage() {
  if (!portoCanViewOpsLog || canUseOpsWorkspace()) return;
  portoViewingOpsLog = true;
  renderOpsLog();
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
  text.textContent = portoCurrentOps ? `${portoOperatorLabel} in dienst: ${portoCurrentOps.name} - ${duration}` : `Huidige ${portoOperatorLabel}:`;
  if (durationBadge) {
    durationBadge.hidden = !portoCurrentOps;
    durationBadge.textContent = `${isCurrentOpsUser() ? `Jouw ${portoOperatorLabel} duur` : `${portoOperatorLabel} duur`}: ${duration}`;
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
  // OPS-acties sturen altijd een echte unit-id naar de server; op 30-00 pakken we expliciet de lead.
  return String(primaryOpsMember(unit)?.id || "");
}

function primaryOpsMember(unit) {
  const members = unit.members || [];
  return members.find((member) => member.operatorSlot === "lead") || members[0] || {};
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
  const channelButton = menu.querySelector("[data-ops-context-action='discord-channel']");
  if (channelButton) channelButton.disabled = !(portoDiscordChannels || []).some((channel) => channel.configured);
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

function opsStatusSortRank(status) {
  const ranks = { "7": 0, "6": 1, "5": 2, "1": 3, "2": 4, "3": 5, "4": 6 };
  return Object.prototype.hasOwnProperty.call(ranks, String(status)) ? ranks[String(status)] : 7;
}

function opsUnitSortRank(unit) {
  const members = Array.isArray(unit?.members) ? unit.members : [];
  if (!members.length) return 7;
  return Math.min(...members.map((member) => opsStatusSortRank(member.status)));
}

function opsUnitVehicleLine(unit) {
  return unit?.vehicleName || `${unit?.vehicleCode ? `${unit.vehicleCode} - ` : ""}${unit?.vehicleType || "Geen voertuig"}`;
}

function sortedOpsUnitGroups(units) {
  const list = [...(units || [])];
  return list.sort((a, b) => {
    const statusDelta = opsUnitSortRank(a) - opsUnitSortRank(b);
    if (statusDelta) return statusDelta;
    return (a.vehicleNumber || "").localeCompare(b.vehicleNumber || "", "nl", { numeric: true });
  });
}

function memberHasIbt(member) {
  return opsMemberSpecializations(member).includes("IBT");
}

function visibleModernSpecializations(member) {
  return opsMemberSpecializations(member).filter((item) => item !== "IBT");
}

function memberInitial(name) {
  return String(name || "?").trim().charAt(0).toUpperCase() || "?";
}

function memberAvatarHtml(member) {
  const avatar = String(member?.avatar || "").trim();
  if (!avatar) return `<span class="porto-modern-member-initial">${escapeHtml(memberInitial(member?.name))}</span>`;
  return `<img class="porto-modern-member-avatar" src="${escapeHtml(avatar)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`;
}

function setButtonPressed(button, active) {
  if (!button) return;
  button.classList.toggle("active", active);
  button.setAttribute("aria-pressed", active ? "true" : "false");
}

function renderOpsViewControls() {
  setButtonPressed($("#portoOpsGridLayoutBtn"), portoOpsUnitLayout === "grid");
  setButtonPressed($("#portoOpsListLayoutBtn"), portoOpsUnitLayout === "list");
}

function vehicleSummaryKey(unit) {
  const text = `${unit?.vehicleCode || ""} ${unit?.vehicleType || ""} ${unit?.vehicleName || ""}`.toUpperCase();
  if (text.includes("SIV")) return "SIV";
  if (text.includes("OGM") || text.includes("ONGEMARKEERD")) return "OGM";
  if (text.includes("OFR") || text.includes("OFF-ROAD") || text.includes("OFF ROAD")) return "Off-Road";
  if (text.includes("NH") || text.includes("NOODHULP")) return "NH";
  return "";
}

function renderOpsUnitsSummary(units) {
  const summary = $("#portoOpsUnitsSummary");
  if (!summary) return;
  const activeUnits = units || [];
  summary.hidden = false;
  const members = activeUnits.flatMap((unit) => unit.members || []);
  const statusCounts = new Map();
  for (const member of members) {
    const code = String(member.status || "");
    statusCounts.set(code, (statusCounts.get(code) || 0) + 1);
  }
  const vehicleCounts = new Map([["NH", 0], ["Off-Road", 0], ["SIV", 0], ["OGM", 0]]);
  for (const unit of activeUnits) {
    const key = vehicleSummaryKey(unit);
    if (key) vehicleCounts.set(key, (vehicleCounts.get(key) || 0) + 1);
  }
  const statusItems = ["1", "4"].map((code) => {
    const status = portoStatuses.find((entry) => entry.code === code);
    const summaryLabels = { "4": "Afwezig" };
    const fake = { status: code };
    return `
      <article class="porto-ops-summary-item status-${escapeHtml(status?.className || code)}">
        <span class="porto-ops-summary-dot ${escapeHtml(statusClassName(fake))}"></span>
        <strong>${statusCounts.get(code) || 0}</strong>
        <small>${escapeHtml(summaryLabels[code] || status?.label || `Status ${code}`)}</small>
      </article>`;
  }).join("");
  const vehicleItems = [...vehicleCounts.entries()].map(([label, count]) => `
    <article class="porto-ops-summary-item vehicle">
      <span>${escapeHtml(label)}</span>
      <strong>${count}</strong>
      <small>voertuigen</small>
    </article>`).join("");
  summary.innerHTML = `
    <article class="porto-ops-summary-item total">
      <span>Mensen</span>
      <strong>${members.length}</strong>
      <small>${activeUnits.length} eenheden</small>
    </article>
    ${statusItems}
    ${vehicleItems}`;
}

function renderSideTaskOverview() {
  const overview = $("#portoSideTaskOverview");
  if (!overview) return;
  const statuses = portoSideTaskOverview || [];
  overview.hidden = !statuses.length;
  overview.innerHTML = statuses.map((status) => `
    <article class="porto-side-task-overview-item ${escapeHtml(status.state || "absent")}" title="${escapeHtml(status.label)}: ${escapeHtml(status.text)}">
      <span>${escapeHtml(status.label)}</span>
      <strong>${escapeHtml(status.text)}</strong>
      <small>Neventaken porto</small>
    </article>
  `).join("");
}

function renderModernOpsUnitCard(unit, options = {}) {
  const vehicleLine = opsUnitVehicleLine(unit);
  const primaryMember = primaryOpsMember(unit);
  const primaryActionId = primaryOpsMemberId(unit);
  const memberCount = (unit.members || []).length;
  const members = (unit.members || []).slice(0, 3).map((member) => {
    const hasIbt = memberHasIbt(member);
    const specializations = visibleModernSpecializations(member);
    const slotLabel = unit.vehicleNumber === "30-00"
      ? member.operatorSlot === "lead"
        ? (portoOperatorLabel || "OPS")
        : "Koppel"
      : "";
    const specsHtml = specializations.length
      ? `<span class="porto-modern-member-specs">${specializations.map((item) => escapeHtml(item)).join(" / ")}</span>`
      : "";
    const slotHtml = slotLabel ? `<span class="porto-modern-member-slot">${escapeHtml(slotLabel)}</span>` : "";
    return `
      <article class="porto-modern-member ${hasIbt ? "" : "no-ibt"} ${member.autoOffline ? "auto-offline" : ""}" data-ops-unit-member="${escapeHtml(member.id)}" title="Rechtermuisknop voor acties">
        ${memberAvatarHtml(member)}
        <div>
          <strong>${escapeHtml(member.name || "Onbekend")}${slotHtml}</strong>
          ${specsHtml}
        </div>
        <button class="porto-modern-member-action" type="button" data-ops-open-menu="${escapeHtml(member.id)}" aria-label="Acties voor ${escapeHtml(member.name || "persoon")}">&rsaquo;</button>
      </article>`;
  }).join("");
  const statusButton = primaryActionId
    ? `<button class="porto-status-pill porto-ops-status-button ${statusClassName(primaryMember)}" type="button" data-ops-status-unit="${escapeHtml(primaryActionId)}" title="Rechtermuisknop voor status wijzigen">${escapeHtml(memberStatusLabel(primaryMember))}</button>`
    : '<span class="porto-status-pill pending">Geen status</span>';
  return `
    <article class="porto-modern-unit-card ${unit.autoOffline ? "auto-offline" : ""} ${options.channelCard ? "in-channel" : ""}" ${primaryActionId ? `data-ops-unit-card="${escapeHtml(primaryActionId)}"` : ""}>
      <header class="porto-modern-unit-head">
        <div class="porto-modern-callsign" data-ops-number-unit="${escapeHtml(primaryActionId)}" title="Rechtermuisknop voor nummer wijzigen">
          <span class="porto-modern-status-light ${statusClassName(primaryMember)}"></span>
          <strong>${escapeHtml(unit.vehicleNumber || "-")}</strong>
        </div>
        <button class="porto-modern-vehicle" type="button" data-ops-vehicle-unit="${escapeHtml(primaryActionId)}" title="Rechtermuisknop voor voertuig wijzigen">${escapeHtml(vehicleLine)}</button>
        <div class="porto-modern-status" data-ops-status-unit="${escapeHtml(primaryActionId)}" title="Rechtermuisknop voor status wijzigen">${statusButton}</div>
      </header>
      <div class="porto-modern-unit-meta">
        <span>${memberCount}/3 personen</span>
      </div>
      <div class="porto-modern-members">${members}</div>
    </article>`;
}

function renderOpsUnits() {
  const count = $("#portoOpsUnitsCount");
  if (!count) return;
  renderOpsViewControls();
  const units = sortedOpsUnitGroups(portoActiveUnits);
  const memberCount = units.reduce((total, unit) => total + (unit.members || []).length, 0);
  count.textContent = `${memberCount} actief`;
  renderOpsUnitsSummary(units);
  renderSideTaskOverview();
}

function captureActiveDiscordChannelStatusInput() {
  const activeInput = document.activeElement;
  if (!activeInput?.matches?.("[data-discord-channel-status]")) return null;
  return {
    channelKey: activeInput.dataset.discordChannelStatus,
    value: activeInput.value,
    selectionStart: activeInput.selectionStart,
    selectionEnd: activeInput.selectionEnd
  };
}

function restoreActiveDiscordChannelStatusInput(draft) {
  if (!draft?.channelKey) return;
  const input = [...document.querySelectorAll("[data-discord-channel-status]")]
    .find((entry) => entry.dataset.discordChannelStatus === draft.channelKey);
  if (!input) return;
  input.value = draft.value;
  input.focus({ preventScroll: true });
  if (Number.isInteger(draft.selectionStart) && Number.isInteger(draft.selectionEnd)) {
    input.setSelectionRange(draft.selectionStart, draft.selectionEnd);
  }
}

function renderDiscordChannels() {
  const container = $("#portoDiscordChannels");
  if (!container) return;
  // Live updates rebuild the cards. Keep an OPS' active channel-status draft intact while typing.
  const activeStatusDraft = captureActiveDiscordChannelStatusInput();
  const channels = portoDiscordChannels || [];
  const channelsByKey = new Map(channels.map((channel) => [channel.key, channel]));
  const visibleGroups = (portoDiscordChannelGroups || []).filter((group) => (group.units || []).length > 0);
  container.className = `porto-discord-channels ${portoOpsUnitLayout === "list" ? "list" : "grid"}`;
  if (!visibleGroups.length) {
    container.innerHTML = '<div class="porto-ops-empty">Geen Discord Porto-kanalen actief.</div>';
    return;
  }
  container.innerHTML = visibleGroups.map((group) => {
    const channel = channelsByKey.get(group.key) || group;
    const units = sortedOpsUnitGroups(group.units || []);
    const canManageDiscordChannel = Boolean(channel.configured && !group.readonly);
    const channelAttribute = canManageDiscordChannel ? ` data-discord-channel="${escapeHtml(channel.key)}"` : "";
    const statusControl = canManageDiscordChannel
      ? `<input type="text" value="${escapeHtml(group.status || "")}" placeholder="Discord status" data-discord-channel-status="${escapeHtml(channel.key)}" />
          <button class="porto-ops-assign secondary" type="button" data-save-discord-channel-status="${escapeHtml(channel.key)}">Opslaan</button>`
      : '<span class="porto-discord-channel-note">Niet gekoppeld aan een regulier Porto-kanaal</span>';
    return `
      <article class="porto-discord-channel ${canManageDiscordChannel ? "" : "readonly"}"${channelAttribute}>
        <header class="porto-discord-channel-head">
          <strong>${escapeHtml(channel.label || channel.key)}</strong>
          ${statusControl}
        </header>
        <div class="porto-discord-channel-units">
          ${units.map((unit) => renderModernOpsUnitCard(unit, { channelCard: true })).join("")}
        </div>
      </article>`;
  }).join("");
  restoreActiveDiscordChannelStatusInput(activeStatusDraft);
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

async function chooseOpsDiscordChannelUpdate(unitId, anchorEvent) {
  const options = (portoDiscordChannels || [])
    .filter((channel) => channel.configured)
    .map((channel) => ({ value: channel.key, label: channel.label || channel.key }));
  const selected = await showPortoContextChoice(anchorEvent, "Porto-kanaal", options);
  if (selected) await reassignPortoUnit(unitId, { discordChannelKey: selected.value });
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
    : `<div class="porto-ops-empty">Nog geen ${escapeHtml(portoOperatorLabel)} uren geregistreerd.</div>`;
  rows.innerHTML = portoOpsLog.length
    ? portoOpsLog.map((entry) => `
      <article class="porto-ops-log-row">
        <strong>${escapeHtml(entry.serviceNumber || "-")} - ${escapeHtml(entry.name || "Onbekend")}</strong>
        <span>${escapeHtml(formatPortoDuration(entry.durationSeconds))}</span>
        <small>${escapeHtml(entry.startedAt ? new Date(entry.startedAt).toLocaleString("nl-NL") : "-")} t/m ${escapeHtml(entry.endedAt ? new Date(entry.endedAt).toLocaleString("nl-NL") : "-")}</small>
      </article>
    `).join("")
    : `<div class="porto-ops-empty">Nog geen ${escapeHtml(portoOperatorLabel)} diensten gelogd.</div>`;
}

function renderOpsPanel() {
  const opsPanel = $("#portoOpsPanel");
  if (portoViewingOpsLog) {
    if (opsPanel) opsPanel.hidden = true;
    return;
  }
  const devTestButton = $("#portoOpsDevTestBtn");
  if (devTestButton) devTestButton.hidden = !portoCanUseDevTools;
  const dutyViewButton = $("#portoShowDutyViewBtn");
  if (dutyViewButton) dutyViewButton.hidden = !(portoCanManageOps && isAssignedDuty() && !isCurrentOpsUser());
  renderOpsStatus();
  renderOpsLogAccess();
  renderOpsRequests();
  renderDiscordChannels();
  renderOpsUnits();
  const mapCard = $("#portoMapCard");
  document.body.classList.toggle("porto-map-disabled", !portoMapEnabled);
  if (mapCard) mapCard.hidden = !portoMapEnabled;
  if (portoMapEnabled) {
    renderOpsMap();
  } else {
    const map = $("#portoOpsMap");
    if (map) map.replaceChildren();
  }
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
      showPortoInlineError(payload.error || `${portoOperatorLabel} kon niet worden bijgewerkt.`);
      await showPortoNotice(payload.error || `${portoOperatorLabel} kon niet worden bijgewerkt.`, `${portoOperatorLabel} mislukt`);
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
