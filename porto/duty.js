/* Porto dienstmodule: statusknoppen, dienstpaneel, voertuigkeuze en Status 0 flow. */

let portoDutyTimeTimer = null;
let portoModernStatus4Pending = false;

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
  clearPortoAutoAssignTimer();
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
  if (typeof setPortoBrowserHeartbeat === "function") setPortoBrowserHeartbeat(false);
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
      <div><span>Rang:</span><strong>-</strong></div>
      <div><span>Naam:</span><strong>-</strong></div>
      <div><span>Telefoonnummer:</span><strong>-</strong></div>
    </article>` : `
    <article class="porto-unit-member ${escapeHtml(nameClass.replace("porto-member-name", ""))}"${title ? ` title="${escapeHtml(title)}"` : ""}>
      <span class="porto-unit-slot">Eenheid ${index + 1}</span>
      <span class="porto-unit-service-number">${escapeHtml(member.serviceNumber || "-")}</span>
      <div><span>Rang:</span><strong>${escapeHtml(member.rank || "-")}</strong></div>
      <div><span>Naam:</span><strong class="${escapeHtml(nameClass)}">${escapeHtml(member.name || "Onbekend")}</strong></div>
      <div><span>Telefoonnummer:</span><strong>${escapeHtml(member.phone || "Niet ingevuld")}</strong></div>
    </article>`;
  }).join("");
}

function modernDutyMembers() {
  const members = [...(portoDuty?.unitMembers || [])];
  if (!members.length && (portoDuty || portoProfile)) {
    members.push({
      name: portoProfile?.name || portoDuty?.name,
      rank: portoProfile?.rank || portoDuty?.rank,
      serviceNumber: portoProfile?.serviceNumber || portoDuty?.serviceNumber,
      phone: portoProfile?.portoPhone || portoDuty?.phone,
      avatar: portoProfile?.avatar || portoDuty?.avatar,
      completedTrainings: Array.isArray(portoProfile?.completedTrainings) ? portoProfile.completedTrainings : [],
      completedOperational: Array.isArray(portoProfile?.completedOperational) ? portoProfile.completedOperational : [],
      specializations: [
        ...(Array.isArray(portoProfile?.completedTrainings) ? portoProfile.completedTrainings : []),
        ...(Array.isArray(portoProfile?.completedOperational) ? portoProfile.completedOperational : [])
      ],
      dutyRole: portoDuty?.dutyRole || ""
    });
  }
  return members.slice(0, 3);
}

function isCurrentPortoDutyMember(member) {
  const ownId = String(portoProfile?.id || portoDuty?.id || "").trim();
  const memberId = String(member?.id || member?.memberId || "").trim();
  const ownServiceNumber = String(portoProfile?.serviceNumber || portoDuty?.serviceNumber || "").trim();
  const memberServiceNumber = String(member?.serviceNumber || "").trim();
  const ownDiscordId = String(portoProfile?.discordId || portoDuty?.discordId || "").trim();
  const memberDiscordId = String(member?.discordId || member?.discordID || "").trim();
  return Boolean(
    (ownId && memberId && ownId === memberId) ||
    (ownServiceNumber && memberServiceNumber && ownServiceNumber === memberServiceNumber) ||
    (ownDiscordId && memberDiscordId && ownDiscordId === memberDiscordId)
  );
}

function modernOccupancyBars(count) {
  return Array.from({ length: 3 }, (_, index) => `<span class="${index < count ? "filled" : ""}"></span>`).join("");
}

function modernDutyBrandLogo() {
  return portoOrganization.key === "politie"
    ? "assets/politie-logo.png?v=20260613-form-branding"
    : "assets/defensielogo-transparent.png?v=20260711-modern-duty";
}

function modernDutyBrandTitle() {
  return portoOrganization.key === "politie" ? "Politie Oranjestad" : "Koninklijke Marechaussee";
}

function modernDutyStatusIcon(code) {
  return {
    "1": "&#10003;",
    "2": "&#128663;",
    "3": "&#9906;",
    "4": "&#8211;",
    "5": "&#128666;",
    "6": "&#128246;",
    "7": "&#9888;",
    "8": "&#9211;"
  }[String(code)] || escapeHtml(code);
}

function modernDutyChannelLabel() {
  return portoDuty?.discordChannelLabel || portoDuty?.discordChannelName || "Porto kanaal";
}

function portoDutyTimePayloadAgeSeconds() {
  const generatedAt = Date.parse(portoDutyTime?.generatedAt || "");
  if (!Number.isFinite(generatedAt)) return 0;
  return Math.max(0, Math.floor((Date.now() - generatedAt) / 1000));
}

function portoDutyTimeSeconds(key) {
  const base = Math.max(0, Math.floor(Number(portoDutyTime?.[key]) || 0));
  if (!portoDutyTime?.running) return base;
  const elapsed = portoDutyTimePayloadAgeSeconds();
  if (key === "currentSessionSeconds") return base + elapsed;
  if (key === "weekTotalSeconds") {
    const weekEndsAt = Date.parse(portoDutyTime.weekEndsAt || "");
    if (!Number.isFinite(weekEndsAt) || Date.now() < weekEndsAt) return base + elapsed;
  }
  return base;
}

function portoDutyTimeText(key) {
  if (!portoDutyTime) return "00:00:00";
  return formatPortoDuration(portoDutyTimeSeconds(key));
}

function updatePortoDutyTimeDisplay() {
  document.querySelectorAll("[data-porto-duty-session-time]").forEach((element) => {
    element.textContent = portoDutyTimeText("currentSessionSeconds");
  });
  document.querySelectorAll("[data-porto-duty-week-time]").forEach((element) => {
    element.textContent = portoDutyTimeText("weekTotalSeconds");
  });
}

function setPortoDutyTimeTicker(enabled) {
  if (enabled && portoDutyTime?.running && !portoDutyTimeTimer) {
    portoDutyTimeTimer = window.setInterval(updatePortoDutyTimeDisplay, 1000);
  }
  if ((!enabled || !portoDutyTime?.running) && portoDutyTimeTimer) {
    window.clearInterval(portoDutyTimeTimer);
    portoDutyTimeTimer = null;
  }
}

function modernDutyTimeMetaHtml() {
  return `
        <article class="porto-modern-duty-time-card"><i aria-hidden="true">&#9201;</i><span>Huidige dienst sessie</span><strong data-porto-duty-session-time>${escapeHtml(portoDutyTimeText("currentSessionSeconds"))}</strong></article>
        <article class="porto-modern-duty-time-card"><i aria-hidden="true">&#128337;</i><span>Diensttijd deze week</span><strong data-porto-duty-week-time>${escapeHtml(portoDutyTimeText("weekTotalSeconds"))}</strong></article>`;
}

function modernVehicleSelectHtml() {
  const choices = portoDuty?.vehicleChoices || [];
  const currentVehicle = portoDuty?.vehicleName || "";
  if (!choices.length) {
    return `
    <label class="porto-modern-vehicle-select">
      <i aria-hidden="true">&#128663;</i>
      <span>Voertuig</span>
      <strong>${escapeHtml(portoDuty?.vehicleName || portoDuty?.vehicleType || "Onvoertuig")}</strong>
    </label>`;
  }
  return `
    <label class="porto-modern-vehicle-select">
      <i aria-hidden="true">&#128663;</i>
      <span>Voertuig</span>
      <select data-modern-vehicle>
        <option value="">Kies voertuig</option>
        ${choices.map((vehicle) => `<option value="${escapeHtml(vehicle)}" ${vehicle === currentVehicle ? "selected" : ""}>${escapeHtml(vehicle)}</option>`).join("")}
      </select>
    </label>`;
}

function modernStatus4ChoicesHtml() {
  const showChoices = portoModernStatus4Pending || String(portoDuty?.status) === "4";
  return `
    <section class="porto-modern-status4-choices" ${showChoices ? "" : "hidden"}>
      <span>Status 4 reden</span>
      <div>
        <button type="button" data-modern-status4="Staandehouding">Staandehouding</button>
        <button type="button" data-modern-status4="Afhandeling">Afhandeling</button>
        <button type="button" data-modern-status4="In hoofd">In hoofd</button>
        <button type="button" data-modern-status4="Overige">Overige</button>
      </div>
    </section>`;
}

function renderModernDutyDashboard() {
  const container = $("#portoModernDutyDashboard");
  if (!container || !portoDuty || !portoProfile) return;
  const members = modernDutyMembers();
  const memberCardsList = [...members];
  while (memberCardsList.length < 3) memberCardsList.push({ empty: true });
  const status = portoStatuses.find((entry) => entry.code === String(portoDuty.status)) || portoStatuses[0];
  const memberNames = members.map((member) => member.name).filter(Boolean).join(" + ") || portoProfile.name || "Onbekend";
  const statusButtons = portoStatuses.map((entry) => {
    const active = entry.code === String(portoDuty.status) || (entry.code === "4" && portoModernStatus4Pending);
    return `
    <button class="porto-modern-status-button ${escapeHtml(entry.className)} ${active ? "active" : ""}" type="button" data-modern-status="${escapeHtml(entry.code)}">
      <span>${modernDutyStatusIcon(entry.code)}</span>
      <em>${escapeHtml(entry.code)}</em>
      <strong>${escapeHtml(entry.label)}</strong>
    </button>`;
  }).join("");
  const memberCards = memberCardsList.map((member, index) => {
    if (member.empty) {
      return `
      <article class="porto-modern-duty-member empty">
        <span>Eenheid ${index + 1}</span>
        <div class="porto-modern-duty-member-main">
          <span class="porto-modern-member-initial">+</span>
          <strong>Open plek</strong>
        </div>
        <dl>
          <div><dt>Rang</dt><dd>-</dd></div>
          <div><dt>Telefoonnummer</dt><dd>Vrije positie beschikbaar</dd></div>
        </dl>
      </article>`;
    }
    const nameClass = typeof memberNameClass === "function" ? memberNameClass(member) : "porto-member-name";
    const title = typeof memberNameTitle === "function" ? memberNameTitle(member) : "";
    const selfAttribute = isCurrentPortoDutyMember(member) ? ` data-modern-duty-self-card="true"` : "";
    return `
      <article class="porto-modern-duty-member"${selfAttribute}${title ? ` title="${escapeHtml(title)}"` : ""}>
        <span>Eenheid ${index + 1}</span>
        <span class="porto-modern-duty-member-number">${escapeHtml(member.serviceNumber || "-")}</span>
        <div class="porto-modern-duty-member-main">
          ${typeof memberAvatarHtml === "function" ? memberAvatarHtml(member) : ""}
          <strong class="${escapeHtml(nameClass)}">${escapeHtml(member.name || "Onbekend")}</strong>
        </div>
        <dl>
          <div><dt>Rang</dt><dd>${escapeHtml(member.rank || "-")}</dd></div>
          <div><dt>Telefoonnummer</dt><dd>${escapeHtml(member.phone || "Niet ingevuld")}</dd></div>
        </dl>
      </article>`;
  }).join("");
  const currentAvatar = typeof memberAvatarHtml === "function" ? memberAvatarHtml(portoProfile) : "";
  const brandLogo = modernDutyBrandLogo();
  const brandTitle = modernDutyBrandTitle();
  const orgSubtitle = portoOrganization.key === "politie" ? "Oranjestad Roleplay" : "FiveM Roleplay";
  container.hidden = portoUiMode !== "modern";
  container.innerHTML = `
    <button class="porto-modern-duty-user-chip" type="button" data-modern-profile-open aria-label="Open persoonlijk profiel">
      ${currentAvatar}
      <span><strong>${escapeHtml(portoProfile.name || "Profiel")}</strong><small>${escapeHtml(portoProfile.serviceNumber || "-")}</small></span>
      <b aria-hidden="true">⌄</b>
    </button>
    <section class="porto-modern-duty-card">
      <header class="porto-modern-duty-shell-head">
        <div class="porto-modern-duty-brand">
          <span><img src="${escapeHtml(brandLogo)}" alt="" /></span>
          <div>
            <strong>${escapeHtml(brandTitle)}</strong>
            <small>${escapeHtml(orgSubtitle)}</small>
          </div>
        </div>
      </header>
      <header class="porto-modern-duty-head">
        <div class="porto-modern-duty-avatars">
          ${members.map((member) => typeof memberAvatarHtml === "function" ? memberAvatarHtml(member) : "").join("")}
        </div>
        <div class="porto-modern-duty-title">
          <span>Huidige status</span>
          <h1>${escapeHtml(portoDuty.vehicleNumber || "-")} <b></b> ${escapeHtml(memberNames)}</h1>
          <strong class="status-${escapeHtml(status.className)}">${escapeHtml(status.title)} - ${escapeHtml(status.label)}</strong>
          <small class="porto-modern-duty-linked">${members.length > 1 ? "Gekoppeld team" : "Solo eenheid"}</small>
        </div>
        <div class="porto-modern-radio-icon" aria-hidden="true">&#128246;</div>
      </header>
      <section class="porto-modern-duty-meta-grid">
        <article><i aria-hidden="true">&#128246;</i><span>Kanaal</span><strong>${escapeHtml(modernDutyChannelLabel())}</strong></article>
        <article>${modernVehicleSelectHtml()}</article>
        <article><i aria-hidden="true">&#128101;</i><span>Bezetting</span><strong>${members.length} / 3</strong><div>${modernOccupancyBars(members.length)}</div></article>
        <article><i aria-hidden="true">&#128279;</i><span>Koppeling</span><strong>${members.length > 1 ? "Actief" : "Solo"}</strong></article>
        ${modernDutyTimeMetaHtml()}
      </section>
      <section class="porto-modern-duty-members">${memberCards}</section>
      <h2>Statussen</h2>
      <section class="porto-modern-status-grid">${statusButtons}</section>
      ${modernStatus4ChoicesHtml()}
      <footer class="porto-modern-duty-actions">
        <button class="porto-modern-secondary" type="button" data-phonebook-open>Telefoonnummers</button>
        <button class="porto-modern-secondary" type="button" id="portoModernOpsOverviewBtn">${escapeHtml(portoOrganization.key === "politie" ? "OC overzicht" : "OVD/OPCO/OC overzicht")}</button>
      </footer>
    </section>`;
  updatePortoDutyTimeDisplay();
  setPortoDutyTimeTicker(true);
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

function closePortoDutyRoleContextMenu() {
  const menu = $("#portoDutyRoleContextMenu");
  if (menu) menu.hidden = true;
}

function ensurePortoDutyRoleContextMenu() {
  let menu = $("#portoDutyRoleContextMenu");
  if (menu) return menu;
  menu = document.createElement("div");
  menu.id = "portoDutyRoleContextMenu";
  menu.className = "context-menu porto-ops-context-menu porto-duty-role-context-menu";
  menu.hidden = true;
  menu.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-duty-context-role]");
    if (!button || button.disabled) return;
    button.disabled = true;
    try {
      await updatePortoDutyRole(button.dataset.dutyContextRole || "");
    } finally {
      closePortoDutyRoleContextMenu();
      button.disabled = false;
    }
  });
  document.body.appendChild(menu);
  return menu;
}

function openPortoDutyRoleContextMenu(event) {
  const allowedRoles = allowedPortoDutyRoles();
  const assigned = Boolean(portoDuty && String(portoDuty.status) !== "8" && portoDuty.vehicleNumber);
  if (!assigned || !allowedRoles.length) return false;
  event.preventDefault();
  event.stopPropagation();
  const currentRole = String(portoDuty?.dutyRole || "").trim();
  const menu = ensurePortoDutyRoleContextMenu();
  menu.innerHTML = `
    <strong>Dienstrol</strong>
    <span class="porto-ops-context-phone">${escapeHtml(portoDuty.vehicleNumber || "Huidig roepnummer")}</span>
    ${allowedRoles.map((role) => {
      const active = currentRole === role.key;
      return `
        <button class="${active ? "active" : ""}" type="button" data-duty-context-role="${escapeHtml(role.key)}">
          <span>
            <strong>${escapeHtml(role.label)} ${active ? "neerleggen" : "aannemen"}</strong>
            <small>${escapeHtml(role.nicknameLabel)} voor jouw huidige roepnummer</small>
          </span>
        </button>`;
    }).join("")}`;
  if (typeof positionContextMenu === "function") {
    positionContextMenu(menu, event.clientX, event.clientY);
  } else {
    menu.hidden = false;
  }
  return true;
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
      <span><span>Huidige dienst sessie:</span> <strong data-porto-duty-session-time>${escapeHtml(portoDutyTimeText("currentSessionSeconds"))}</strong></span>
      <span><span>Diensttijd deze week:</span> <strong data-porto-duty-week-time>${escapeHtml(portoDutyTimeText("weekTotalSeconds"))}</strong></span>
      <span><span>Huidige tijd:</span> <strong data-duty-current-time>${escapeHtml(currentTime)}</strong></span>
      ${portoCanTakeOps ? `<button class="porto-ops-action" type="button" data-duty-ops-claim>${escapeHtml(portoOperatorLabel)} overnemen</button>` : ""}
    `;
    updateDutyOpsInfoDisplay();
    return;
  }
  container.innerHTML = `
    <span><span>Huidige ${escapeHtml(portoOperatorLabel)}:</span> <strong>${escapeHtml(portoCurrentOps.name || "Onbekend")}</strong></span>
    <span><span>Telefoonnummer ${escapeHtml(portoOperatorLabel)}:</span> <strong>${escapeHtml(portoCurrentOps.phone || "Niet ingevuld")}</strong></span>
    <span><span>Duur:</span> <strong data-duty-ops-duration>${escapeHtml(formatPortoDuration(opsElapsedSeconds(portoCurrentOps)))}</strong></span>
    <span><span>Huidige dienst sessie:</span> <strong data-porto-duty-session-time>${escapeHtml(portoDutyTimeText("currentSessionSeconds"))}</strong></span>
    <span><span>Diensttijd deze week:</span> <strong data-porto-duty-week-time>${escapeHtml(portoDutyTimeText("weekTotalSeconds"))}</strong></span>
    <span><span>Huidige tijd:</span> <strong data-duty-current-time>${escapeHtml(currentTime)}</strong></span>
  `;
  updateDutyOpsInfoDisplay();
}

function updateDutyOpsInfoDisplay() {
  document.querySelectorAll("[data-duty-ops-duration]").forEach((element) => {
    element.textContent = formatPortoDuration(opsElapsedSeconds(portoCurrentOps));
  });
  document.querySelectorAll("[data-duty-current-time]").forEach((element) => {
    element.textContent = new Date().toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  });
  updatePortoDutyTimeDisplay();
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
  if (!assignedDuty || opsWorkspace || !portoProfile) {
    setPortoDutyTimeTicker(false);
    return;
  }
  renderModernDutyDashboard();
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
  const bypassAutoThrottle = Boolean(options.bypassAutoThrottle);
  if (automatic && portoSignedOffUntilStatus0) return null;
  if (portoDutyLoadPromise) return portoDutyLoadPromise;
  if (automatic && bypassAutoThrottle && portoDeferredDutyLoadTimer) {
    window.clearTimeout(portoDeferredDutyLoadTimer);
    portoDeferredDutyLoadTimer = null;
  }
  if (automatic && !bypassAutoThrottle) {
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
    if (typeof syncPortoBrowserHeartbeatForPayload === "function") syncPortoBrowserHeartbeatForPayload(payload);
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
    const wasSignedOffGuarded = Boolean(portoSignedOffUntilStatus0);
    if (status === "0") setPortoSignedOffUntilStatus0(false);
    if (status === "8") {
      setPortoSignedOffUntilStatus0(true);
      if (typeof syncPortoBrowserHeartbeatForPayload === "function") {
        syncPortoBrowserHeartbeatForPayload({ unit: null, recentlyEnded: true });
      }
    }
    const requestNoteInput = $("#portoStatusRequestInput");
    const requestNote = status === "0" ? String(requestNoteInput?.value || "").trim() : "";
    const response = await fetch("/api/porto/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, detail, requestNote, manualStatusChange: true })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (payload.code === "porto_recently_ended") {
        portoModernStatus4Pending = false;
        setPortoSignedOffUntilStatus0(true);
        portoDuty = null;
        portoLastDutyLoadAt = Date.now();
        applyPortoPayload({ unit: null, recentlyEnded: true });
        if (typeof syncPortoBrowserHeartbeatForPayload === "function") {
          syncPortoBrowserHeartbeatForPayload({ unit: null, recentlyEnded: true });
        }
        renderVehicleRanges();
        renderDutyPanel();
        renderOpsPanel();
      }
      showPortoInlineError(payload.error || "Porto status kon niet worden opgeslagen.");
      await showPortoNotice(payload.error || "Porto status kon niet worden opgeslagen.", "Status mislukt");
      if (status === "8" && payload.code !== "porto_recently_ended") {
        setPortoSignedOffUntilStatus0(wasSignedOffGuarded);
        if (!wasSignedOffGuarded && typeof setPortoBrowserHeartbeat === "function") {
          setPortoBrowserHeartbeat(Boolean(portoDuty && String(portoDuty.status || "") !== "8"));
        }
      }
      return false;
    }
    if (status !== "4" || detail) portoModernStatus4Pending = false;
    setPortoSignedOffUntilStatus0(status === "8" || Boolean(payload.recentlyEnded));
    if (typeof syncPortoBrowserHeartbeatForPayload === "function") syncPortoBrowserHeartbeatForPayload(payload);
    portoDuty = payload.unit || null;
    portoLastDutyLoadAt = Date.now();
    applyPortoPayload(payload);
    if (payload.profile) portoProfile = payload.profile;
    if (status === "0" && requestNoteInput) requestNoteInput.value = "";
    renderVehicleRanges();
    renderDutyPanel();
    renderOpsPanel();
    return true;
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
  if (portoSignedOffUntilStatus0) return;
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

